"""
Phase 7a: SOP Export endpoint — async job-based to avoid gateway timeouts.
POST /api/sops/{sop_id}/export?format=docx|pdf  → 202 { export_id, status }
GET  /api/exports/{export_id}                   → { status, download_url, ... }
"""
import asyncio
import uuid as uuid_module
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db, AsyncSessionLocal
from app.dependencies.auth import require_viewer
from app.extractor_job_store import create_job, get_job
from app.azure_job_client import start_extractor_job
from app.models import SOP, SOPStep, ExportHistory, User
from app.schemas import SOPDetail, with_sas

router = APIRouter(prefix="/api", tags=["exports"])

# In-memory job store — fine for single-instance deployment
_export_jobs: dict[str, dict] = {}


@router.post("/sops/{sop_id}/export", status_code=202)
async def start_export(
    sop_id: UUID,
    current_user: Annotated[User, Depends(require_viewer)],
    fmt: str = Query("docx", alias="format", pattern="^(docx|pdf)$"),
    template: str = Query("standard", pattern="^(standard|meeting_minutes|webinar)$"),
    db: AsyncSession = Depends(get_db),
    background_tasks: BackgroundTasks = BackgroundTasks(),
) -> dict:
    """Queue a DOCX/PDF export and return a job ID immediately."""
    sop = (await db.execute(select(SOP).where(SOP.id == sop_id))).scalar_one_or_none()
    if sop is None:
        raise HTTPException(status_code=404, detail=f"SOP {sop_id} not found")

    export_id = str(uuid_module.uuid4())
    _export_jobs[export_id] = {
        "status": "pending",
        "download_url": None,
        "filename": None,
        "format": fmt,
        "template": template,
        "error": None,
    }

    background_tasks.add_task(_run_export, export_id, sop_id, fmt, current_user.id, template)
    return {"export_id": export_id, "status": "pending"}


@router.get("/exports/{export_id}")
async def get_export_status(
    export_id: str,
    current_user: Annotated[User, Depends(require_viewer)],
) -> dict:
    """Poll export job status. Returns status + download_url when done."""
    job = _export_jobs.get(export_id)
    if not job:
        raise HTTPException(status_code=404, detail="Export job not found or expired")
    return job


async def _run_export(export_id: str, sop_id: UUID, fmt: str, user_id: UUID, template: str = "standard") -> None:
    """Background task: run full export pipeline and update job store."""
    def _fail(msg: str) -> None:
        _export_jobs[export_id] = {
            "status": "error", "error": msg,
            "download_url": None, "filename": None, "format": fmt,
        }

    try:
        async with AsyncSessionLocal() as db:
            stmt = (
                select(SOP)
                .where(SOP.id == sop_id)
                .options(
                    selectinload(SOP.steps).options(
                        selectinload(SOPStep.callouts),
                        selectinload(SOPStep.clips),
                        selectinload(SOPStep.discussions),
                    ),
                    selectinload(SOP.sections),
                    selectinload(SOP.watchlist),
                )
            )
            sop = (await db.execute(stmt)).scalar_one_or_none()
            if sop is None:
                return _fail(f"SOP {sop_id} not found")

            sop.steps.sort(key=lambda s: s.sequence)
            sop.sections.sort(key=lambda s: s.display_order)

            sop_detail = SOPDetail.model_validate(sop)

            sop_data = {
                "sop_title": sop_detail.title,
                "client_name": sop_detail.client_name or "",
                "process_name": sop_detail.process_name or "",
                "meeting_date": str(sop_detail.meeting_date) if sop_detail.meeting_date else "",
                "step_count": len(sop_detail.steps),
                "steps": [
                    {
                        "id": str(step.id),
                        "sequence": step.sequence,
                        "title": step.title,
                        "description": step.description or "",
                        "sub_steps": step.sub_steps or [],
                        "annotated_screenshot_url": step.annotated_screenshot_url,
                        "screenshot_url": step.screenshot_url,
                        "callouts": [
                            {"callout_number": c.callout_number, "label": c.label}
                            for c in step.callouts
                        ],
                    }
                    for step in sop_detail.steps
                ],
                "sections": [
                    {
                        "section_title": sec.section_title,
                        "content_type": sec.content_type,
                        "content_text": sec.content_text or "",
                        "content_json": sec.content_json,
                        "display_order": sec.display_order,
                    }
                    for sec in sop_detail.sections
                ],
                "process_map_config": sop_detail.process_map_config,
            }

            render_payload = {
                "sop_id": str(sop_id),
                "format": fmt,
                "template": template,
                "azure_blob_base_url": settings.azure_blob_base_url,
                "azure_sas_token": settings.azure_blob_sas_token,
                "sop_data": sop_data,
            }

            # Enqueue a render_doc job for the on-demand extractor Container App
            # Job. The always-on extractor HTTP service was retired in the
            # cost-saving job migration, so exports now go through extractor_jobs
            # like every other extractor task (extract / clip / render_annotated).
            job_id = await create_job("render_doc", render_payload)
            await start_extractor_job(job_id)

            # Poll until the job completes. DOCX+PDF (LibreOffice) can be slow on
            # a cold job start, so allow up to 5 minutes — matches the render_doc
            # fast-task expiry window in the job runner.
            job: dict = {}
            for _ in range(150):
                await asyncio.sleep(2)
                job = await get_job(job_id)
                if job.get("status") == "completed":
                    break
                if job.get("status") == "failed":
                    return _fail(f"Extractor error: {job.get('error_message')}")
            else:
                return _fail("Export timed out — extractor job did not complete")

            render_result = job.get("result") or {}
            file_url_base = render_result.get("pdf_url") if fmt == "pdf" else render_result.get("docx_url")
            if not file_url_base:
                return _fail("Extractor returned no file URL")

            export_record = ExportHistory(
                sop_id=sop_id,
                format=fmt,
                file_url=file_url_base,
                generated_by=user_id,
                sop_version=None,
            )
            db.add(export_record)
            await db.commit()

            download_url = with_sas(file_url_base) or file_url_base
            prefix = {"meeting_minutes": "meeting_minutes", "webinar": "webinar"}.get(template, "sop")
            filename = f"{prefix}_{sop_id}.{fmt}"

            _export_jobs[export_id] = {
                "status": "done",
                "download_url": download_url,
                "filename": filename,
                "format": fmt,
                "error": None,
            }

    except Exception as exc:
        _fail(str(exc)[:300])

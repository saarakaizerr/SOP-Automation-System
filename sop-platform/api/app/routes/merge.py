"""
SOP Version Merge routes
GET  /api/merge/groups                    — list project groups with 2+ SOPs
POST /api/merge/compare                   — trigger Gemini diff, create session
GET  /api/merge/sessions/{id}             — get session + diff
POST /api/merge/sessions/{id}/finalize    — approve changes, create merged SOP
PATCH /api/sops/{id}/project-code        — set project_code on a SOP
"""
import asyncio
import uuid
from datetime import date
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.dependencies.auth import require_editor
from app.models import SOP, SOPStatus, SOPStep, SOPMergeSession, User, ProcessGroup, StepClip, SOPSection
from app.schemas import (
    ProjectCodeUpdate, MergeCompareBody, MergeSessionResponse,
    MergeMatch, MergeFinalizeBody, CreateProcessGroupBody, ProcessGroupResponse,
)

router = APIRouter(prefix="/api", tags=["merge"])

_compare_tasks: set = set()


async def _run_compare_job(session_id: uuid.UUID, base_steps: list, updated_steps: list) -> None:
    """Background: call extractor compare-sops, update session when done."""
    from app.database import AsyncSessionLocal
    try:
        async with httpx.AsyncClient(timeout=600.0) as client:
            resp = await client.post(
                f"{settings.extractor_url}/api/compare-sops",
                json={"base_steps": base_steps, "updated_steps": updated_steps},
            )
            resp.raise_for_status()
            diff_result = resp.json()
        new_status = "reviewing"
    except Exception as exc:
        diff_result = {"error": str(exc)}
        new_status = "failed"

    async with AsyncSessionLocal() as db:
        row = (await db.execute(
            select(SOPMergeSession).where(SOPMergeSession.id == session_id)
        )).scalar_one_or_none()
        if row:
            row.diff_result = diff_result
            row.status = new_status
            await db.commit()


async def _copy_blob(
    src_url: str,
    dest_blob_path: str,
    base_url: str,
    sas_token: str,
    client: httpx.AsyncClient,
) -> str:
    """Server-side Azure blob copy within the same storage account. Returns new URL (no SAS)."""
    dest_base = f"{base_url.rstrip('/')}/{dest_blob_path}"
    resp = await client.put(
        f"{dest_base}?{sas_token}",
        headers={"x-ms-copy-source": f"{src_url}?{sas_token}", "x-ms-version": "2020-04-08"},
        content=b"",
    )
    resp.raise_for_status()
    return dest_base


# ── PATCH /api/sops/{sop_id}/project-code ────────────────────────────────────

@router.patch("/sops/{sop_id}/project-code")
async def set_project_code(
    sop_id: uuid.UUID,
    body: ProjectCodeUpdate,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
) -> dict:
    sop = (await db.execute(select(SOP).where(SOP.id == sop_id))).scalar_one_or_none()
    if sop is None:
        raise HTTPException(status_code=404, detail="SOP not found")
    sop.project_code = body.project_code
    await db.commit()
    return {"sop_id": str(sop_id), "project_code": sop.project_code}


# ── POST /api/merge/process-groups ───────────────────────────────────────────

@router.post("/merge/process-groups", response_model=ProcessGroupResponse)
async def create_process_group(
    body: CreateProcessGroupBody,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
) -> ProcessGroupResponse:
    """Create a named process group, auto-generate GRP-XXX code, assign to selected SOPs."""
    if len(body.sop_ids) < 2:
        raise HTTPException(status_code=400, detail="At least 2 SOPs required")

    count_result = await db.execute(select(func.count(ProcessGroup.id)))
    next_num = (count_result.scalar() or 0) + 1
    code = f"GRP-{next_num:03d}"

    group = ProcessGroup(name=body.name, code=code, created_by=current_user.id)
    db.add(group)
    await db.flush()

    assigned_ids: list[str] = []
    for sop_id_str in body.sop_ids:
        sop = (await db.execute(
            select(SOP).where(SOP.id == uuid.UUID(sop_id_str))
        )).scalar_one_or_none()
        if sop:
            sop.project_code = code
            assigned_ids.append(sop_id_str)

    await db.commit()
    return ProcessGroupResponse(id=str(group.id), name=group.name, code=code, sop_ids=assigned_ids)


# ── GET /api/merge/groups ─────────────────────────────────────────────────────

@router.get("/merge/groups")
async def list_merge_groups(
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Return all project_code groups that have 2+ SOPs, including group name if available."""
    stmt = (
        select(SOP, ProcessGroup.name.label("group_name"))
        .outerjoin(ProcessGroup, ProcessGroup.code == SOP.project_code)
        .where(SOP.project_code.isnot(None))
        .order_by(SOP.project_code, SOP.meeting_date)
    )
    rows = list((await db.execute(stmt)).all())

    groups: dict[str, dict] = {}
    for sop, group_name in rows:
        code = sop.project_code
        if code not in groups:
            groups[code] = {"name": group_name, "sops": []}
        groups[code]["sops"].append({
            "id": str(sop.id),
            "title": sop.title,
            "status": sop.status.value,
            "meeting_date": str(sop.meeting_date) if sop.meeting_date else None,
            "client_name": sop.client_name,
            "is_merged": sop.is_merged,
        })

    return [
        {"project_code": code, "name": g["name"], "sops": g["sops"]}
        for code, g in groups.items()
        if sum(1 for s in g["sops"] if not s["is_merged"]) >= 2
    ]


# ── DELETE /api/merge/process-groups/{code} ──────────────────────────────────

@router.delete("/merge/process-groups/{code}", status_code=204)
async def delete_process_group(
    code: str,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
) -> None:
    """Remove a process group: deletes merged SOPs, clears project_code on source SOPs, deletes group record."""
    merged_sops = (await db.execute(
        select(SOP).where(SOP.project_code == code, SOP.is_merged)
    )).scalars().all()
    if merged_sops:
        merged_ids = [sop.id for sop in merged_sops]
        await db.execute(
            update(SOPMergeSession)
            .where(SOPMergeSession.merged_sop_id.in_(merged_ids))
            .values(merged_sop_id=None)
        )
        for sop in merged_sops:
            await db.delete(sop)
        await db.flush()

    await db.execute(
        update(SOP).where(SOP.project_code == code, ~SOP.is_merged).values(project_code=None)
    )
    group = (await db.execute(
        select(ProcessGroup).where(ProcessGroup.code == code)
    )).scalar_one_or_none()
    if group:
        await db.delete(group)
    await db.commit()


# ── POST /api/merge/compare ───────────────────────────────────────────────────

@router.post("/merge/compare", response_model=MergeSessionResponse)
async def compare_sops(
    body: MergeCompareBody,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
) -> MergeSessionResponse:
    """Trigger Gemini diff between two SOPs. Returns immediately; poll GET /merge/sessions/{id}."""
    base_id = uuid.UUID(body.base_sop_id)
    updated_id = uuid.UUID(body.updated_sop_id)

    # Return in-progress or completed session if one already exists
    existing = (await db.execute(
        select(SOPMergeSession).where(
            SOPMergeSession.base_sop_id == base_id,
            SOPMergeSession.updated_sop_id == updated_id,
            SOPMergeSession.status.in_(["comparing", "reviewing"]),
        )
    )).scalar_one_or_none()

    if existing:
        matches = [MergeMatch(**m) for m in (existing.diff_result or {}).get("matches", [])]
        return MergeSessionResponse(
            session_id=str(existing.id),
            status=existing.status,
            base_sop_id=str(existing.base_sop_id),
            updated_sop_id=str(existing.updated_sop_id),
            merged_sop_id=str(existing.merged_sop_id) if existing.merged_sop_id else None,
            matches=matches,
        )

    # Load both SOPs with steps
    def _load_stmt(sop_id: uuid.UUID):
        return select(SOP).where(SOP.id == sop_id).options(selectinload(SOP.steps))

    base_sop = (await db.execute(_load_stmt(base_id))).scalar_one_or_none()
    updated_sop = (await db.execute(_load_stmt(updated_id))).scalar_one_or_none()

    if base_sop is None:
        raise HTTPException(status_code=404, detail=f"Base SOP {body.base_sop_id} not found")
    if updated_sop is None:
        raise HTTPException(status_code=404, detail=f"Updated SOP {body.updated_sop_id} not found")

    base_sop.steps.sort(key=lambda s: s.sequence)
    updated_sop.steps.sort(key=lambda s: s.sequence)

    base_steps = [
        {"id": str(s.id), "sequence": s.sequence, "title": s.title, "description": s.description or ""}
        for s in base_sop.steps
    ]
    updated_steps = [
        {"id": str(s.id), "sequence": s.sequence, "title": s.title, "description": s.description or ""}
        for s in updated_sop.steps
    ]

    # Create session immediately with status="comparing", spawn background task
    session = SOPMergeSession(
        base_sop_id=base_id,
        updated_sop_id=updated_id,
        created_by=current_user.id,
        status="comparing",
        diff_result=None,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    task = asyncio.create_task(_run_compare_job(session.id, base_steps, updated_steps))
    _compare_tasks.add(task)
    task.add_done_callback(_compare_tasks.discard)

    return MergeSessionResponse(
        session_id=str(session.id),
        status="comparing",
        base_sop_id=str(base_id),
        updated_sop_id=str(updated_id),
        matches=[],
    )


# ── GET /api/merge/sessions/{session_id} ─────────────────────────────────────

@router.get("/merge/sessions/{session_id}", response_model=MergeSessionResponse)
async def get_session(
    session_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
) -> MergeSessionResponse:
    session = (await db.execute(
        select(SOPMergeSession).where(SOPMergeSession.id == session_id)
    )).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    matches = [MergeMatch(**m) for m in (session.diff_result or {}).get("matches", [])]
    return MergeSessionResponse(
        session_id=str(session.id),
        status=session.status,
        base_sop_id=str(session.base_sop_id),
        updated_sop_id=str(session.updated_sop_id),
        merged_sop_id=str(session.merged_sop_id) if session.merged_sop_id else None,
        matches=matches,
    )


# ── POST /api/merge/sessions/{session_id}/finalize ───────────────────────────

@router.post("/merge/sessions/{session_id}/finalize")
async def finalize_merge(
    session_id: uuid.UUID,
    body: MergeFinalizeBody,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Create a new merged SOP from the approved step decisions."""
    session = (await db.execute(
        select(SOPMergeSession).where(SOPMergeSession.id == session_id)
    )).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == "merged":
        raise HTTPException(status_code=409, detail="Session already merged")

    def _load_full(sop_id: uuid.UUID):
        return select(SOP).where(SOP.id == sop_id).options(
            selectinload(SOP.steps).selectinload(SOPStep.clips),
            selectinload(SOP.sections),
        )

    base_sop = (await db.execute(_load_full(session.base_sop_id))).scalar_one()
    updated_sop = (await db.execute(_load_full(session.updated_sop_id))).scalar_one()

    step_map: dict[str, SOPStep] = {}
    for s in base_sop.steps:
        step_map[str(s.id)] = s
    for s in updated_sop.steps:
        step_map[str(s.id)] = s

    group_name: str | None = None
    if base_sop.project_code:
        pg = (await db.execute(
            select(ProcessGroup).where(ProcessGroup.code == base_sop.project_code)
        )).scalar_one_or_none()
        group_name = pg.name if pg else None

    merged_title = f"{group_name} (Updated)" if group_name else f"{base_sop.title} (Updated)"

    merged_sop = SOP(
        title=merged_title,
        status=SOPStatus.draft,
        client_name=base_sop.client_name,
        process_name=base_sop.process_name,
        meeting_date=date.today(),
        project_code=base_sop.project_code,
        created_by=current_user.id,
        is_merged=True,
    )
    db.add(merged_sop)
    await db.flush()

    created: list[tuple[int, SOPStep, list[StepClip]]] = []

    for seq, decision in enumerate(body.steps, start=1):
        source_step = step_map.get(decision.step_id)
        if source_step is None:
            raise HTTPException(
                status_code=400,
                detail=f"Step {decision.step_id} not found in base or updated SOP",
            )
        new_step = SOPStep(
            sop_id=merged_sop.id,
            sequence=seq,
            title=source_step.title,
            description=source_step.description,
            sub_steps=source_step.sub_steps,
            timestamp_start=source_step.timestamp_start,
            timestamp_end=source_step.timestamp_end,
            screenshot_url=source_step.screenshot_url,
            annotated_screenshot_url=source_step.annotated_screenshot_url,
            screenshot_width=source_step.screenshot_width,
            screenshot_height=source_step.screenshot_height,
        )
        db.add(new_step)
        await db.flush()

        step_clips: list[StepClip] = []
        for clip in source_step.clips:
            new_clip = StepClip(
                step_id=new_step.id,
                clip_url=clip.clip_url,
                duration_sec=clip.duration_sec,
                file_size_bytes=clip.file_size_bytes,
            )
            db.add(new_clip)
            step_clips.append(new_clip)

        created.append((seq, new_step, step_clips))

    # Copy sections from base SOP so the merged SOP has a full document structure
    for section in sorted(base_sop.sections, key=lambda s: s.display_order):
        db.add(SOPSection(
            sop_id=merged_sop.id,
            section_key=section.section_key,
            section_title=section.section_title,
            display_order=section.display_order,
            content_type=section.content_type,
            content_text=section.content_text,
            content_json=section.content_json,
            mermaid_syntax=section.mermaid_syntax,
            diagram_url=section.diagram_url,
        ))

    # Copy blobs into the merged SOP's own Azure folder so it has its own UUID path
    base_url = settings.azure_blob_base_url
    sas_token = settings.azure_blob_sas_token
    merged_id = str(merged_sop.id)

    if base_url and sas_token:
        async def _do_copy(obj: object, attr: str, src: str, dest_path: str) -> None:
            new_url = await _copy_blob(src, dest_path, base_url, sas_token, az)
            setattr(obj, attr, new_url)

        tasks = []
        for seq, step, clips in created:
            if step.screenshot_url:
                tasks.append(_do_copy(step, "screenshot_url", step.screenshot_url, f"{merged_id}/frames/frame_{seq:03d}.png"))
            if step.annotated_screenshot_url:
                tasks.append(_do_copy(step, "annotated_screenshot_url", step.annotated_screenshot_url, f"{merged_id}/frames/annotated_{seq:03d}.png"))
            for clip in clips:
                if clip.clip_url:
                    tasks.append(_do_copy(clip, "clip_url", clip.clip_url, f"{merged_id}/clips/clip_{seq:03d}.mp4"))

        async with httpx.AsyncClient(timeout=120.0) as az:
            await asyncio.gather(*tasks)

    session.merged_sop_id = merged_sop.id
    session.status = "merged"
    session.approved_changes = [d.model_dump() for d in body.steps]

    await db.commit()
    return {"merged_sop_id": str(merged_sop.id)}

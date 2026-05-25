from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel
import httpx
from sqlalchemy import select, func, delete, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.dependencies.auth import require_viewer, require_editor
from app.dependencies.pipeline_auth import require_internal_key
from app.models import SOP, SOPStep, SOPStatus, PipelineRun, PipelineStatus, User, UserRole, SOPLike, ExportHistory, SOPActivityLog, SOPMergeSession
from datetime import datetime, timezone
from app.schemas import SOPListItem, SOPDetail, SOPMetrics, LikeResponse, ExportHistoryItem, ActivityEvent, ProcessMapConfigBody, LikerItem

router = APIRouter(prefix="/api", tags=["sops"])

# Statuses visible per role
_VISIBLE_STATUSES: dict[str, list[SOPStatus]] = {
    UserRole.viewer.value: [SOPStatus.published],
    UserRole.editor.value: [SOPStatus.published, SOPStatus.draft, SOPStatus.in_review],
    UserRole.admin.value:  [],  # empty = no filter (all statuses)
}


@router.get("/sops", response_model=list[SOPListItem])
async def list_sops(
    current_user: Annotated[User, Depends(require_viewer)],
    status: Optional[SOPStatus] = None,
    db: AsyncSession = Depends(get_db),
):
    """List SOPs. Visibility is filtered by role: viewers see published only, editors see draft/in_review too, admins see all."""
    step_count_subq = (
        select(func.count(SOPStep.id))
        .where(SOPStep.sop_id == SOP.id)
        .correlate(SOP)
        .scalar_subquery()
    )
    latest_run_status_subq = (
        select(PipelineRun.status)
        .where(PipelineRun.sop_id == SOP.id)
        .order_by(PipelineRun.started_at.desc())
        .limit(1)
        .correlate(SOP)
        .scalar_subquery()
    )
    latest_run_stage_subq = (
        select(PipelineRun.current_stage)
        .where(PipelineRun.sop_id == SOP.id)
        .order_by(PipelineRun.started_at.desc())
        .limit(1)
        .correlate(SOP)
        .scalar_subquery()
    )
    latest_run_started_at_subq = (
        select(PipelineRun.started_at)
        .where(PipelineRun.sop_id == SOP.id)
        .order_by(PipelineRun.started_at.desc())
        .limit(1)
        .correlate(SOP)
        .scalar_subquery()
    )

    stmt = select(
        SOP,
        step_count_subq.label("step_count"),
        latest_run_status_subq.label("pipeline_status"),
        latest_run_stage_subq.label("pipeline_stage"),
        latest_run_started_at_subq.label("pipeline_started_at"),
    ).order_by(SOP.created_at.desc())

    # Role-based visibility filter (applied before any explicit status query param)
    allowed = _VISIBLE_STATUSES.get(current_user.role.value, [])
    if allowed:  # admin has empty list → no filter
        stmt = stmt.where(SOP.status.in_(allowed))

    # Optional caller-supplied status filter (intersects with role visibility)
    if status is not None:
        stmt = stmt.where(SOP.status == status)

    # Auto-heal: if pipeline_run is completed but SOP is still 'processing', flip to draft
    await db.execute(
        text("""
            UPDATE sops
            SET status = 'draft'
            WHERE status = 'processing'
              AND id IN (
                SELECT DISTINCT sop_id FROM pipeline_runs
                WHERE status = 'completed'
              )
        """)
    )
    await db.commit()

    rows = (await db.execute(stmt)).all()
    return [
        SOPListItem(
            id=row[0].id,
            title=row[0].title,
            status=row[0].status,
            client_name=row[0].client_name,
            process_name=row[0].process_name,
            meeting_date=row[0].meeting_date,
            created_at=row[0].created_at,
            step_count=row[1] or 0,
            pipeline_status=str(row[2].value) if row[2] is not None else None,
            pipeline_stage=row[3],
            pipeline_started_at=row[4],
            tags=row[0].tags or [],
            project_code=row[0].project_code,
            is_merged=row[0].is_merged,
        )
        for row in rows
    ]


@router.get("/sops/{sop_id}", response_model=SOPDetail)
async def get_sop(
    sop_id: UUID,
    current_user: Annotated[User, Depends(require_viewer)],
    db: AsyncSession = Depends(get_db),
):
    """Retrieve a single SOP with all steps (+ callouts, clips, discussions), sections, and watchlist."""
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
        raise HTTPException(status_code=404, detail=f"SOP {sop_id} not found")

    sop.steps.sort(key=lambda s: s.sequence)
    sop.sections.sort(key=lambda s: s.display_order)

    return SOPDetail.model_validate(sop)


@router.patch("/sops/{sop_id}/status", status_code=204)
async def update_status(
    sop_id: UUID,
    body: dict,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
):
    """Change SOP status. Editor/Admin only."""
    new_status = body.get("status", "")
    valid = {s.value for s in SOPStatus}
    if new_status not in valid:
        raise HTTPException(status_code=422, detail=f"Invalid status. Must be one of: {valid}")
    sop = (await db.execute(select(SOP).where(SOP.id == sop_id))).scalar_one_or_none()
    if sop is None:
        raise HTTPException(status_code=404, detail=f"SOP {sop_id} not found")
    old_status = sop.status.value
    sop.status = SOPStatus(new_status)
    db.add(SOPActivityLog(
        sop_id=sop_id,
        user_id=current_user.id,
        event_type="edit",
        label=f"Status changed to {new_status}",
        detail=f"{old_status} → {new_status}",
    ))
    await db.commit()


@router.patch("/sops/{sop_id}/tags", response_model=SOPListItem)
async def update_tags(
    sop_id: UUID,
    body: dict,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
):
    """Replace the tag list for a SOP. Editor/admin only."""
    sop = (await db.execute(select(SOP).where(SOP.id == sop_id))).scalar_one_or_none()
    if sop is None:
        raise HTTPException(status_code=404, detail=f"SOP {sop_id} not found")
    tags = body.get("tags", [])
    if not isinstance(tags, list):
        raise HTTPException(status_code=422, detail="tags must be an array")
    sop.tags = [
        {"name": str(t.get("name", "")).strip(), "color": str(t.get("color", "blue"))}
        for t in tags if isinstance(t, dict) and str(t.get("name", "")).strip()
    ]
    await db.commit()
    await db.refresh(sop)
    return SOPListItem(
        id=sop.id,
        title=sop.title,
        status=sop.status,
        client_name=sop.client_name,
        process_name=sop.process_name,
        meeting_date=sop.meeting_date,
        created_at=sop.created_at,
        step_count=0,
        tags=sop.tags or [],
    )


@router.post("/sops/{sop_id}/view", status_code=204)
async def track_view(
    sop_id: UUID,
    current_user: Annotated[User, Depends(require_viewer)],
    db: AsyncSession = Depends(get_db),
):
    """Increment view count each time the SOP procedure page is opened."""
    sop = (await db.execute(select(SOP).where(SOP.id == sop_id))).scalar_one_or_none()
    if sop is None:
        raise HTTPException(status_code=404, detail=f"SOP {sop_id} not found")
    sop.view_count = (sop.view_count or 0) + 1
    await db.commit()


@router.post("/sops/{sop_id}/like", response_model=LikeResponse)
async def toggle_like(
    sop_id: UUID,
    current_user: Annotated[User, Depends(require_viewer)],
    db: AsyncSession = Depends(get_db),
):
    """Toggle like for the current user. Returns new liked state and total like count."""
    sop = (await db.execute(select(SOP).where(SOP.id == sop_id))).scalar_one_or_none()
    if sop is None:
        raise HTTPException(status_code=404, detail=f"SOP {sop_id} not found")

    existing = (await db.execute(
        select(SOPLike).where(SOPLike.sop_id == sop_id, SOPLike.user_id == current_user.id)
    )).scalar_one_or_none()

    if existing:
        await db.execute(
            delete(SOPLike).where(SOPLike.sop_id == sop_id, SOPLike.user_id == current_user.id)
        )
        liked = False
    else:
        db.add(SOPLike(sop_id=sop_id, user_id=current_user.id))
        liked = True

    await db.commit()

    like_count = (await db.execute(
        select(func.count()).where(SOPLike.sop_id == sop_id)
    )).scalar_one()

    return LikeResponse(liked=liked, like_count=like_count)


@router.get("/sops/{sop_id}/metrics", response_model=SOPMetrics)
async def get_metrics(
    sop_id: UUID,
    current_user: Annotated[User, Depends(require_viewer)],
    db: AsyncSession = Depends(get_db),
):
    """Return engagement metrics and export history for a SOP."""
    sop = (await db.execute(select(SOP).where(SOP.id == sop_id))).scalar_one_or_none()
    if sop is None:
        raise HTTPException(status_code=404, detail=f"SOP {sop_id} not found")

    like_count = (await db.execute(
        select(func.count()).where(SOPLike.sop_id == sop_id)
    )).scalar_one()

    user_liked_row = (await db.execute(
        select(SOPLike).where(SOPLike.sop_id == sop_id, SOPLike.user_id == current_user.id)
    )).scalar_one_or_none()

    step_count = (await db.execute(
        select(func.count(SOPStep.id)).where(SOPStep.sop_id == sop_id)
    )).scalar_one()

    approved_count = (await db.execute(
        select(func.count(SOPStep.id)).where(SOPStep.sop_id == sop_id, SOPStep.is_approved)
    )).scalar_one()

    export_count = (await db.execute(
        select(func.count(ExportHistory.id)).where(ExportHistory.sop_id == sop_id)
    )).scalar_one()

    recent_exports = (await db.execute(
        select(ExportHistory)
        .where(ExportHistory.sop_id == sop_id)
        .order_by(ExportHistory.created_at.desc())
        .limit(10)
    )).scalars().all()

    # Likers list — admin only
    likers: list[LikerItem] = []
    if current_user.role == UserRole.admin:
        liker_rows = (await db.execute(
            select(User.id, User.name, User.email, SOPLike.created_at)
            .join(SOPLike, SOPLike.user_id == User.id)
            .where(SOPLike.sop_id == sop_id)
            .order_by(SOPLike.created_at.desc())
        )).all()
        likers = [
            LikerItem(id=row[0], name=row[1], email=row[2], liked_at=row[3])
            for row in liker_rows
        ]

    return SOPMetrics(
        view_count=sop.view_count or 0,
        like_count=like_count,
        user_liked=user_liked_row is not None,
        step_count=step_count,
        approved_step_count=approved_count,
        export_count=export_count,
        recent_exports=[ExportHistoryItem.model_validate(e) for e in recent_exports],
        likers=likers,
    )


@router.get("/sops/{sop_id}/history", response_model=list[ActivityEvent])
async def get_history(
    sop_id: UUID,
    current_user: Annotated[User, Depends(require_viewer)],
    db: AsyncSession = Depends(get_db),
):
    """Activity log for a SOP — created, pipeline runs, approvals, exports, and edit events."""
    sop = (await db.execute(select(SOP).where(SOP.id == sop_id))).scalar_one_or_none()
    if sop is None:
        raise HTTPException(status_code=404, detail=f"SOP {sop_id} not found")

    events: list[ActivityEvent] = []

    # Pre-load users for actor names (single query)
    users_map: dict[UUID, str] = {}
    all_users = (await db.execute(select(User.id, User.name))).all()
    for uid, uname in all_users:
        users_map[uid] = uname

    # SOP created
    creator_name = users_map.get(sop.created_by) if sop.created_by else None
    events.append(ActivityEvent(
        event_type="created",
        label="SOP created",
        detail=sop.title,
        timestamp=sop.created_at,
        actor_name=creator_name,
    ))

    # Pipeline runs — expand stage_results into individual stage events
    _STAGE_MAP = {
        "transcription": (
            "Transcription complete",
            lambda d: f"{d.get('lines', '?')} transcript lines · {d.get('speakers', '?')} speakers",
        ),
        "screen_detection": (
            "Screen-share detection complete",
            lambda d: f"{d.get('periods', '?')} screen-share period(s) found",
        ),
        "frame_extraction": (
            "Frame extraction complete",
            lambda d: f"{d.get('after_dedup', '?')} frames extracted ({d.get('raw_scenes', '?')} raw scenes)",
        ),
        "annotation": (
            "Frame annotation complete",
            lambda d: f"{d.get('annotated', '?')} frames annotated",
        ),
        "clips": (
            "Clips extracted",
            lambda d: f"{d.get('clips', '?')} clips generated",
        ),
        "step_content": (
            "Step content generated",
            lambda d: f"{d.get('steps', '?')} steps processed",
        ),
    }

    runs = (await db.execute(
        select(PipelineRun).where(PipelineRun.sop_id == sop_id).order_by(PipelineRun.started_at)
    )).scalars().all()
    for run in runs:
        events.append(ActivityEvent(
            event_type="pipeline",
            label="Processing started",
            detail=None,
            timestamp=run.started_at,
            actor_name="System",
        ))
        stage_results = run.stage_results or {}
        for key, (label, detail_fn) in _STAGE_MAP.items():
            if key in stage_results:
                try:
                    detail = detail_fn(stage_results[key]) if isinstance(stage_results[key], dict) else None
                except Exception:
                    detail = None
                events.append(ActivityEvent(
                    event_type="pipeline",
                    label=label,
                    detail=detail,
                    timestamp=run.completed_at or run.started_at,
                    actor_name="System",
                ))
        if run.status.value == "completed":
            events.append(ActivityEvent(
                event_type="pipeline",
                label="Pipeline completed",
                detail=None,
                timestamp=run.completed_at or run.started_at,
                actor_name="System",
            ))
        elif run.status.value == "failed":
            events.append(ActivityEvent(
                event_type="pipeline",
                label=f"Pipeline failed — {run.error_stage or 'unknown stage'}",
                detail=run.error_message,
                timestamp=run.completed_at or run.started_at,
                actor_name="System",
            ))
        else:
            events.append(ActivityEvent(
                event_type="pipeline",
                label=f"Pipeline in progress — {run.status.value.replace('_', ' ')}",
                detail=run.current_stage,
                timestamp=run.started_at,
                actor_name="System",
            ))

    # Exports (with actor name from generated_by)
    exports = (await db.execute(
        select(ExportHistory).where(ExportHistory.sop_id == sop_id).order_by(ExportHistory.created_at)
    )).scalars().all()
    for exp in exports:
        events.append(ActivityEvent(
            event_type="export",
            label=f"{exp.format.upper()} exported",
            detail=f"{round(exp.file_size_bytes / 1024)} KB" if exp.file_size_bytes else None,
            timestamp=exp.created_at,
            actor_name=users_map.get(exp.generated_by) if exp.generated_by else None,
        ))

    # Activity log events (edit, approve actions with actor names)
    log_entries = (await db.execute(
        select(SOPActivityLog)
        .where(SOPActivityLog.sop_id == sop_id)
        .order_by(SOPActivityLog.created_at)
    )).scalars().all()
    for entry in log_entries:
        events.append(ActivityEvent(
            event_type=entry.event_type,
            label=entry.label,
            detail=entry.detail,
            timestamp=entry.created_at,
            actor_name=users_map.get(entry.user_id) if entry.user_id else None,
        ))

    events.sort(key=lambda e: e.timestamp, reverse=True)
    return events


@router.get("/sops/{sop_id}/process-map")
async def get_process_map(
    sop_id: UUID,
    current_user: Annotated[User, Depends(require_viewer)],
    db: AsyncSession = Depends(get_db),
):
    """Return the current process map config for a SOP (null if not set yet)."""
    sop = (await db.execute(select(SOP).where(SOP.id == sop_id))).scalar_one_or_none()
    if sop is None:
        raise HTTPException(status_code=404, detail=f"SOP {sop_id} not found")
    config = sop.process_map_config
    if config and config.get("confirmed_url") and settings.azure_blob_sas_token:
        url = config["confirmed_url"]
        sas = settings.azure_blob_sas_token
        if sas not in url:
            sep = "&" if "?" in url else "?"
            config = {**config, "confirmed_url": f"{url}{sep}{sas}"}
    return {"process_map_config": config}


@router.patch("/sops/{sop_id}/process-map")
async def save_process_map(
    sop_id: UUID,
    body: ProcessMapConfigBody,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
):
    """Save (or update) the swim-lane process map config for a SOP. Editor/Admin only."""
    sop = (await db.execute(select(SOP).where(SOP.id == sop_id))).scalar_one_or_none()
    if sop is None:
        raise HTTPException(status_code=404, detail=f"SOP {sop_id} not found")
    existing = sop.process_map_config or {}
    sop.process_map_config = {
        "lanes": body.lanes,
        "assignments": body.assignments,
        "is_confirmed": body.is_confirmed,
        "confirmed_url": body.confirmed_url,  # null explicitly clears any uploaded image
        "confirmed_at": body.confirmed_at if body.confirmed_at is not None else existing.get("confirmed_at"),
    }
    sop.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"process_map_config": sop.process_map_config}


@router.post("/sops/{sop_id}/process-map/upload")
async def upload_process_map_image(
    sop_id: UUID,
    file: UploadFile,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
):
    """Upload a corrected process map PNG. Stores in Azure Blob, saves confirmed_url."""
    if file.content_type not in ("image/png", "image/jpeg"):
        raise HTTPException(status_code=400, detail="Only PNG or JPEG files are accepted")

    data = await file.read()
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 15 MB)")

    sop = (await db.execute(select(SOP).where(SOP.id == sop_id))).scalar_one_or_none()
    if sop is None:
        raise HTTPException(status_code=404, detail=f"SOP {sop_id} not found")

    blob_name = f"sop-{sop_id}/process_map_confirmed.png"
    blob_url = f"{settings.azure_blob_base_url}/{blob_name}"
    upload_url = f"{blob_url}?{settings.azure_blob_sas_token}"

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.put(
            upload_url,
            content=data,
            headers={"x-ms-blob-type": "BlockBlob", "Content-Type": "image/png"},
        )
        if resp.status_code not in (200, 201):
            raise HTTPException(status_code=502, detail=f"Azure upload failed: {resp.status_code}")

    confirmed_at = datetime.now(timezone.utc).isoformat()
    # Cache-bust so the browser fetches the new upload instead of the cached old one
    versioned_url = f"{blob_url}?v={int(datetime.now(timezone.utc).timestamp())}"
    existing = sop.process_map_config or {}
    sop.process_map_config = {
        **existing,
        "is_confirmed": True,
        "confirmed_url": versioned_url,
        "confirmed_at": confirmed_at,
    }
    sop.updated_at = datetime.now(timezone.utc)
    await db.commit()

    # Return URL with SAS so the frontend can display it immediately
    sas = settings.azure_blob_sas_token
    display_url = f"{versioned_url}&{sas}" if sas else versioned_url
    return {"confirmed_url": display_url, "confirmed_at": confirmed_at}


async def _delete_azure_prefix(sop_id: str) -> None:
    """Delete all Azure Blob files under {sop_id}/ prefix. Best-effort — errors are swallowed."""
    base_url = settings.azure_blob_base_url.rstrip("/")
    sas = settings.azure_blob_sas_token
    if not base_url or not sas:
        return
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # List all blobs under this SOP's prefix
            list_url = f"{base_url}?restype=container&comp=list&prefix={sop_id}/&{sas}"
            resp = await client.get(list_url)
            if resp.status_code != 200:
                return
            # Parse blob names from XML
            import re
            names = re.findall(r"<Name>([^<]+)</Name>", resp.text)
            # Delete each blob
            for name in names:
                await client.delete(f"{base_url}/{name}?{sas}")
    except Exception:
        pass  # Azure cleanup is best-effort; DB delete already committed


@router.delete("/sops/{sop_id}", status_code=204)
async def delete_sop(
    sop_id: UUID,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
):
    """Delete a SOP entirely: all DB rows (cascade) + all Azure Blob files. Editor/Admin only."""
    sop = (await db.execute(select(SOP).where(SOP.id == sop_id))).scalar_one_or_none()
    if sop is None:
        raise HTTPException(status_code=404, detail=f"SOP {sop_id} not found")

    # Delete merge sessions (no CASCADE on those FKs — must go before the SOP row)
    await db.execute(
        delete(SOPMergeSession).where(
            (SOPMergeSession.base_sop_id == sop_id)
            | (SOPMergeSession.updated_sop_id == sop_id)
            | (SOPMergeSession.merged_sop_id == sop_id)
        )
    )

    # Remove from processed_sharepoint_files so the video can be re-ingested if needed
    await db.execute(
        text("DELETE FROM processed_sharepoint_files WHERE sop_id = :sop_id"),
        {"sop_id": str(sop_id)},
    )

    # Delete the SOP row — cascades to steps, sections, transcript_lines,
    # pipeline_runs, export_history, sop_likes, sop_activity_log, etc.
    await db.delete(sop)
    await db.commit()

    # Clean up Azure Blob Storage (best-effort, after DB commit)
    await _delete_azure_prefix(str(sop_id))


class _RegisterUploadBody(BaseModel):
    video_url: str
    process_name: str
    sharepoint_file_id: str


@router.post("/pipeline/sync-sharepoint")
async def sync_sharepoint(
    current_user: Annotated[User, Depends(require_editor)],
) -> dict:
    """
    Trigger WF-detect to scan SharePoint for new video files.
    Called by the dashboard Scan SharePoint button. Editor/Admin only.
    Returns immediately — the scan runs asynchronously in n8n.
    """
    if not settings.n8n_wf_detect_webhook_url:
        raise HTTPException(status_code=503, detail="WF-detect webhook URL not configured")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(settings.n8n_wf_detect_webhook_url, json={})
            resp.raise_for_status()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to trigger WF-detect: {exc}")
    return {"ok": True}


@router.post("/pipeline/register-upload", dependencies=[Depends(require_internal_key)])
async def register_upload(
    body: _RegisterUploadBody,
    db: AsyncSession = Depends(get_db),
):
    """
    Called by WF-detect when a new video is found in SharePoint.
    Creates the SOP record (status=uploaded) and a placeholder pipeline_run
    (status=awaiting_approval) so Supabase Realtime fires a notification to the frontend.
    The video is NOT processed until an admin/editor clicks Initialize.
    """
    sop = SOP(
        title=body.process_name,
        process_name=body.process_name,
        video_url=body.video_url,
        status=SOPStatus.uploaded,
    )
    db.add(sop)
    await db.flush()  # get sop.id before adding the run

    run = PipelineRun(sop_id=sop.id, status=PipelineStatus.awaiting_approval)
    db.add(run)
    await db.commit()

    return {"sop_id": str(sop.id)}


@router.post("/sops/{sop_id}/start-pipeline")
async def start_pipeline(
    sop_id: UUID,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
):
    """
    Called when an admin/editor clicks Initialize in the notification bell or SOPCard.
    Updates SOP to processing, updates pipeline_run to queued, then fires n8n WF0 webhook.
    Rolls back to uploaded status if the webhook call fails so the user can retry.
    """
    sop = (await db.execute(select(SOP).where(SOP.id == sop_id))).scalar_one_or_none()
    if sop is None:
        raise HTTPException(status_code=404, detail=f"SOP {sop_id} not found")
    if sop.status != SOPStatus.uploaded:
        raise HTTPException(status_code=409, detail=f"SOP is not in uploaded status (current: {sop.status.value})")

    run = (await db.execute(
        select(PipelineRun)
        .where(PipelineRun.sop_id == sop_id, PipelineRun.status == PipelineStatus.awaiting_approval)
        .order_by(PipelineRun.started_at.desc())
        .limit(1)
    )).scalar_one_or_none()

    sop.status = SOPStatus.processing
    if run:
        run.status = PipelineStatus.queued
    await db.commit()

    if not settings.n8n_wf0_webhook_url:
        return {"ok": True, "warning": "N8N_WF0_WEBHOOK_URL not configured — pipeline not triggered"}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                settings.n8n_wf0_webhook_url,
                json={"sop_id": str(sop_id), "video_url": sop.video_url},
            )
            resp.raise_for_status()
    except Exception as exc:
        # Roll back status so the user can retry
        sop.status = SOPStatus.uploaded
        if run:
            run.status = PipelineStatus.awaiting_approval
        await db.commit()
        raise HTTPException(status_code=502, detail=f"Failed to trigger WF0 webhook: {exc}")

    return {"ok": True}


@router.patch("/sops/{sop_id}/rename")
async def rename_sop(
    sop_id: UUID,
    body: dict,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Rename a SOP title. Editor/Admin only."""
    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="Title cannot be empty")
    sop = (await db.execute(select(SOP).where(SOP.id == sop_id))).scalar_one_or_none()
    if sop is None:
        raise HTTPException(status_code=404, detail="SOP not found")
    sop.title = title
    await db.commit()
    return {"id": str(sop_id), "title": sop.title}

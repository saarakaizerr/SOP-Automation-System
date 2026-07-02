from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies.auth import require_viewer, require_editor
from app.models import SOP, SOPStep, StepCallout, User, SOPActivityLog
from app.schemas import StepSchema, CalloutPatchItem, CalloutSchema, RenderAnnotatedResponse, with_sas, NewCalloutItem, HighlightBoxItem, CreateStepBody
from app.config import settings
from app.extractor_job_store import create_job, get_job
from app.azure_job_client import start_extractor_job

router = APIRouter(prefix="/api", tags=["steps"])


async def _log(
    db: AsyncSession,
    sop_id,
    user_id,
    event_type: str,
    label: str,
    detail: str | None = None,
):
    """Add an activity log entry (caller must commit)."""
    db.add(SOPActivityLog(
        sop_id=sop_id,
        user_id=user_id,
        event_type=event_type,
        label=label,
        detail=detail,
    ))


@router.get("/sops/{sop_id}/steps", response_model=list[StepSchema])
async def list_steps(
    sop_id: UUID,
    current_user: Annotated[User, Depends(require_viewer)],
    db: AsyncSession = Depends(get_db),
):
    """All steps for a SOP, ordered by sequence."""
    sop_exists = await db.scalar(select(SOP.id).where(SOP.id == sop_id))
    if sop_exists is None:
        raise HTTPException(status_code=404, detail=f"SOP {sop_id} not found")

    stmt = (
        select(SOPStep)
        .where(SOPStep.sop_id == sop_id)
        .options(
            selectinload(SOPStep.callouts),
            selectinload(SOPStep.clips),
            selectinload(SOPStep.discussions),
        )
        .order_by(SOPStep.sequence)
    )
    steps = (await db.execute(stmt)).scalars().all()
    return [StepSchema.model_validate(step) for step in steps]


@router.post("/sops/{sop_id}/steps", response_model=StepSchema, status_code=201)
async def create_step(
    sop_id: UUID,
    body: CreateStepBody,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
):
    """Manually add a new step to a SOP. Editor/Admin only."""
    sop_exists = await db.scalar(select(SOP.id).where(SOP.id == sop_id))
    if sop_exists is None:
        raise HTTPException(status_code=404, detail=f"SOP {sop_id} not found")

    max_seq = await db.scalar(
        select(func.max(SOPStep.sequence)).where(SOPStep.sop_id == sop_id)
    ) or 0

    step = SOPStep(
        sop_id=sop_id,
        title=body.title.strip(),
        sequence=max_seq + 1,
        timestamp_start=0.0,
    )
    db.add(step)
    await db.flush()

    await _log(db, sop_id, current_user.id, "edit",
               f"Step {max_seq + 1} added manually", f'"{body.title.strip()}"')
    await db.commit()

    step = await db.scalar(
        select(SOPStep)
        .where(SOPStep.id == step.id)
        .options(
            selectinload(SOPStep.callouts),
            selectinload(SOPStep.clips),
            selectinload(SOPStep.discussions),
        )
    )
    return StepSchema.model_validate(step)


@router.get("/sops/{sop_id}/steps/{step_id}", response_model=StepSchema)
async def get_step(
    sop_id: UUID,
    step_id: UUID,
    current_user: Annotated[User, Depends(require_viewer)],
    db: AsyncSession = Depends(get_db),
):
    """Single step with callouts, clips, and discussions."""
    stmt = (
        select(SOPStep)
        .where(SOPStep.id == step_id, SOPStep.sop_id == sop_id)
        .options(
            selectinload(SOPStep.callouts),
            selectinload(SOPStep.clips),
            selectinload(SOPStep.discussions),
        )
    )
    step = (await db.execute(stmt)).scalar_one_or_none()
    if step is None:
        raise HTTPException(
            status_code=404, detail=f"Step {step_id} not found in SOP {sop_id}"
        )
    return StepSchema.model_validate(step)


@router.post("/steps/{step_id}/callouts", response_model=CalloutSchema)
async def add_callout(
    step_id: UUID,
    body: NewCalloutItem,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
):
    """Add a new manual callout to a step. Editor/Admin only."""
    step = await db.scalar(select(SOPStep).where(SOPStep.id == step_id))
    if step is None:
        raise HTTPException(status_code=404, detail=f"Step {step_id} not found")

    max_num = await db.scalar(
        select(StepCallout.callout_number)
        .where(StepCallout.step_id == step_id)
        .order_by(StepCallout.callout_number.desc())
        .limit(1)
    )
    next_num = (max_num or 0) + 1

    callout = StepCallout(
        step_id=step_id,
        callout_number=next_num,
        label=body.label,
        target_x=body.target_x,
        target_y=body.target_y,
        was_repositioned=True,
    )
    db.add(callout)
    await _log(db, step.sop_id, current_user.id, "edit",
               f"Callout #{next_num} added", step.title)
    await db.commit()
    await db.refresh(callout)
    return CalloutSchema.model_validate(callout)


@router.delete("/steps/{step_id}/callouts/{callout_id}", status_code=204)
async def delete_callout(
    step_id: UUID,
    callout_id: UUID,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
):
    """Delete a single callout. Editor/Admin only."""
    callout = await db.scalar(
        select(StepCallout).where(StepCallout.id == callout_id, StepCallout.step_id == step_id)
    )
    if callout is None:
        raise HTTPException(status_code=404, detail=f"Callout {callout_id} not found")
    step = await db.scalar(select(SOPStep).where(SOPStep.id == step_id))
    await db.delete(callout)
    if step:
        await _log(db, step.sop_id, current_user.id, "edit", "Callout removed", step.title)
    await db.commit()


@router.patch("/steps/{step_id}/highlight-boxes", response_model=StepSchema)
async def patch_highlight_boxes(
    step_id: UUID,
    items: list[HighlightBoxItem],
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
):
    """Replace highlight boxes for a step. Editor/Admin only."""
    stmt = (
        select(SOPStep)
        .where(SOPStep.id == step_id)
        .options(selectinload(SOPStep.callouts), selectinload(SOPStep.clips), selectinload(SOPStep.discussions))
    )
    step = (await db.execute(stmt)).scalar_one_or_none()
    if step is None:
        raise HTTPException(status_code=404, detail=f"Step {step_id} not found")

    step.highlight_boxes = [item.model_dump() for item in items]
    await _log(db, step.sop_id, current_user.id, "edit",
               "Highlight boxes updated", step.title)
    await db.commit()
    await db.refresh(step)
    return StepSchema.model_validate(step)


@router.patch("/steps/{step_id}/callouts", response_model=list[CalloutSchema])
async def patch_callouts(
    step_id: UUID,
    items: list[CalloutPatchItem],
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
):
    """Bulk-update callout positions. Sets original_x/y on first reposition."""
    for item in items:
        stmt = select(StepCallout).where(
            StepCallout.id == item.id,
            StepCallout.step_id == step_id,
        )
        callout = (await db.execute(stmt)).scalar_one_or_none()
        if callout is None:
            raise HTTPException(status_code=404, detail=f"Callout {item.id} not found")

        # Preserve original position on first reposition
        if item.was_repositioned and not callout.was_repositioned:
            callout.original_x = callout.target_x
            callout.original_y = callout.target_y

        callout.target_x = item.target_x
        callout.target_y = item.target_y
        callout.was_repositioned = item.was_repositioned
        callout.rotation = item.rotation
        if item.label is not None:
            callout.label = item.label

    # Get sop_id for activity log
    first_callout_step = (await db.execute(
        select(SOPStep).where(SOPStep.id == step_id)
    )).scalar_one_or_none()
    if first_callout_step:
        await _log(db, first_callout_step.sop_id, current_user.id, "edit",
                   "Callouts repositioned", first_callout_step.title)

    await db.commit()

    # Return updated callouts
    stmt = (
        select(StepCallout)
        .where(StepCallout.step_id == step_id)
        .order_by(StepCallout.callout_number)
    )
    callouts = (await db.execute(stmt)).scalars().all()
    return [CalloutSchema.model_validate(c) for c in callouts]


@router.patch("/steps/{step_id}/sub-steps", response_model=StepSchema)
async def update_sub_steps(
    step_id: UUID,
    body: dict,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
):
    """Replace sub_steps list for a step. Editor/Admin only."""
    sub_steps = body.get("sub_steps", [])
    if not isinstance(sub_steps, list):
        raise HTTPException(status_code=422, detail="sub_steps must be a list")
    # Filter out empty strings
    sub_steps = [s.strip() for s in sub_steps if isinstance(s, str) and s.strip()]

    stmt = (
        select(SOPStep)
        .where(SOPStep.id == step_id)
        .options(selectinload(SOPStep.callouts), selectinload(SOPStep.clips), selectinload(SOPStep.discussions))
    )
    step = (await db.execute(stmt)).scalar_one_or_none()
    if step is None:
        raise HTTPException(status_code=404, detail=f"Step {step_id} not found")

    step.sub_steps = sub_steps
    await _log(db, step.sop_id, current_user.id, "edit",
               "Sub-steps updated", step.title)
    await db.commit()
    await db.refresh(step)
    return StepSchema.model_validate(step)


@router.patch("/steps/{step_id}/description", response_model=StepSchema)
async def update_description(
    step_id: UUID,
    body: dict,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
):
    """Update a step description. Editor/Admin only."""
    description = (body.get("description") or "").strip() or None

    stmt = (
        select(SOPStep)
        .where(SOPStep.id == step_id)
        .options(selectinload(SOPStep.callouts), selectinload(SOPStep.clips), selectinload(SOPStep.discussions))
    )
    step = (await db.execute(stmt)).scalar_one_or_none()
    if step is None:
        raise HTTPException(status_code=404, detail=f"Step {step_id} not found")

    step.description = description
    await _log(db, step.sop_id, current_user.id, "edit",
               f"Step {step.sequence} description updated", step.title)
    await db.commit()
    await db.refresh(step)
    return StepSchema.model_validate(step)


@router.patch("/steps/{step_id}/rename", response_model=StepSchema)
async def rename_step(
    step_id: UUID,
    body: dict,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
):
    """Rename a step title. Editor/Admin only."""
    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="Title cannot be empty")

    stmt = (
        select(SOPStep)
        .where(SOPStep.id == step_id)
        .options(selectinload(SOPStep.callouts), selectinload(SOPStep.clips), selectinload(SOPStep.discussions))
    )
    step = (await db.execute(stmt)).scalar_one_or_none()
    if step is None:
        raise HTTPException(status_code=404, detail=f"Step {step_id} not found")

    old_title = step.title
    step.title = title
    await _log(db, step.sop_id, current_user.id, "edit",
               f"Step {step.sequence} renamed", f'"{old_title}" → "{title}"')
    await db.commit()
    await db.refresh(step)
    return StepSchema.model_validate(step)


@router.patch("/steps/{step_id}/approve", response_model=StepSchema)
async def approve_step(
    step_id: UUID,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
):
    """Toggle is_approved on a step. Editor/Admin only."""
    stmt = (
        select(SOPStep)
        .where(SOPStep.id == step_id)
        .options(selectinload(SOPStep.callouts), selectinload(SOPStep.clips), selectinload(SOPStep.discussions))
    )
    step = (await db.execute(stmt)).scalar_one_or_none()
    if step is None:
        raise HTTPException(status_code=404, detail=f"Step {step_id} not found")

    step.is_approved = not step.is_approved
    if step.is_approved:
        step.reviewed_by = current_user.id
        from datetime import datetime, timezone
        step.reviewed_at = datetime.now(timezone.utc)
        await _log(db, step.sop_id, current_user.id, "approved",
                   f"Step {step.sequence} approved", step.title)
    else:
        step.reviewed_by = None
        step.reviewed_at = None
        await _log(db, step.sop_id, current_user.id, "approved",
                   f"Step {step.sequence} approval revoked", step.title)

    await db.commit()
    await db.refresh(step)
    return StepSchema.model_validate(step)


@router.delete("/steps/{step_id}", status_code=204)
async def delete_step(
    step_id: UUID,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
):
    """Delete a step and re-sequence remaining steps. Editor/Admin only."""
    step = await db.scalar(select(SOPStep).where(SOPStep.id == step_id))
    if step is None:
        raise HTTPException(status_code=404, detail=f"Step {step_id} not found")

    sop_id = step.sop_id
    deleted_seq = step.sequence
    title = step.title

    await db.delete(step)
    await db.flush()

    # Re-sequence steps that come after the deleted one
    remaining = (await db.execute(
        select(SOPStep)
        .where(SOPStep.sop_id == sop_id, SOPStep.sequence > deleted_seq)
        .order_by(SOPStep.sequence)
    )).scalars().all()
    for s in remaining:
        s.sequence -= 1

    await _log(db, sop_id, current_user.id, "edit",
               f"Step {deleted_seq} deleted", f'"{title}"')
    await db.commit()


@router.post("/steps/{step_id}/render-annotated", response_model=RenderAnnotatedResponse)
async def render_annotated(
    step_id: UUID,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
):
    """Re-render annotated screenshot PNG via Container App Job after callout edits."""
    stmt = (
        select(SOPStep)
        .where(SOPStep.id == step_id)
        .options(selectinload(SOPStep.callouts))
    )
    step = (await db.execute(stmt)).scalar_one_or_none()
    if step is None:
        raise HTTPException(status_code=404, detail=f"Step {step_id} not found")

    screenshot_url = step.screenshot_url
    if not screenshot_url:
        raise HTTPException(status_code=422, detail="Step has no screenshot_url to annotate")

    # Build SAS URL for extractor to download the screenshot
    sas_screenshot_url = (
        f"{screenshot_url}?{settings.azure_blob_sas_token}"
        if settings.azure_blob_sas_token and "?" not in screenshot_url
        else screenshot_url
    )

    payload = {
        "step_id": str(step_id),
        "screenshot_url": sas_screenshot_url,
        "callouts": [
            {
                "number": c.callout_number,
                "target_x": c.target_x,
                "target_y": c.target_y,
                "rotation": c.rotation or 0.0,
                "confidence": c.confidence,
                "was_repositioned": c.was_repositioned or False,
            }
            for c in sorted(step.callouts, key=lambda c: c.callout_number)
        ],
        "highlight_boxes": step.highlight_boxes or [],
        "azure_blob_base_url": settings.azure_blob_base_url,
        "azure_sas_token": settings.azure_blob_sas_token,
    }

    import asyncio
    job_id = await create_job("render_doc", payload)
    await start_extractor_job(job_id)

    # Poll until the Container App Job completes (up to 120 seconds)
    for _ in range(60):
        await asyncio.sleep(2)
        job = await get_job(job_id)
        if job.get("status") == "completed":
            break
        if job.get("status") == "failed":
            raise HTTPException(status_code=502, detail=f"Extractor error: {job.get('error_message')}")
    else:
        raise HTTPException(status_code=504, detail="render-annotated timed out")

    annotated_url = job["result"]["annotated_screenshot_url"]

    # Persist the new URL and bump updated_at for cache-busting
    from datetime import datetime, timezone
    step.annotated_screenshot_url = annotated_url
    step.updated_at = datetime.now(timezone.utc)
    await db.commit()

    return RenderAnnotatedResponse(annotated_screenshot_url=with_sas(annotated_url) or annotated_url)

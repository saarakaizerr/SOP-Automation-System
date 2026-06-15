from typing import Annotated, Any, Optional
from uuid import UUID
import re
import uuid as uuid_module

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies.auth import require_viewer, require_editor
from app.models import SOP, SOPSection, TranscriptLine, PropertyWatchlist, User
from app.schemas import SectionSchema, TranscriptLineSchema, WatchlistSchema

router = APIRouter(prefix="/api", tags=["sections"])


class SectionUpdateRequest(BaseModel):
    section_title: Optional[str] = None
    content_type: Optional[str] = None
    content_text: Optional[str] = None
    content_json: Optional[Any] = None


class SectionCreateRequest(BaseModel):
    section_title: str
    content_type: str = "text"
    content_text: Optional[str] = None
    content_json: Optional[Any] = None


@router.get("/sops/{sop_id}/sections", response_model=list[SectionSchema])
async def list_sections(
    sop_id: UUID,
    current_user: Annotated[User, Depends(require_viewer)],
    db: AsyncSession = Depends(get_db),
):
    """All sections for a SOP, ordered by display_order."""
    sop_exists = await db.scalar(select(SOP.id).where(SOP.id == sop_id))
    if sop_exists is None:
        raise HTTPException(status_code=404, detail=f"SOP {sop_id} not found")

    stmt = (
        select(SOPSection)
        .where(SOPSection.sop_id == sop_id)
        .order_by(SOPSection.display_order)
    )
    sections = (await db.execute(stmt)).scalars().all()
    return [SectionSchema.model_validate(s) for s in sections]


@router.get("/sops/{sop_id}/transcript", response_model=list[TranscriptLineSchema])
async def list_transcript(
    sop_id: UUID,
    current_user: Annotated[User, Depends(require_viewer)],
    speaker: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Transcript lines for a SOP, optionally filtered by speaker name."""
    sop_exists = await db.scalar(select(SOP.id).where(SOP.id == sop_id))
    if sop_exists is None:
        raise HTTPException(status_code=404, detail=f"SOP {sop_id} not found")

    stmt = (
        select(TranscriptLine)
        .where(TranscriptLine.sop_id == sop_id)
        .order_by(TranscriptLine.sequence)
    )
    if speaker:
        stmt = stmt.where(TranscriptLine.speaker == speaker)

    lines = (await db.execute(stmt)).scalars().all()
    return [TranscriptLineSchema.model_validate(line) for line in lines]


@router.patch("/sections/{section_id}", response_model=SectionSchema)
async def update_section(
    section_id: UUID,
    body: SectionUpdateRequest,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
):
    """Update section title and/or content. Editor/admin only."""
    sec = (await db.execute(select(SOPSection).where(SOPSection.id == section_id))).scalar_one_or_none()
    if sec is None:
        raise HTTPException(status_code=404, detail="Section not found")
    if body.section_title is not None:
        sec.section_title = body.section_title
    if body.content_type is not None:
        sec.content_type = body.content_type
    if body.content_text is not None:
        sec.content_text = body.content_text
    if body.content_json is not None:
        sec.content_json = body.content_json
    await db.commit()
    await db.refresh(sec)
    return SectionSchema.model_validate(sec)


@router.post("/sops/{sop_id}/sections", response_model=SectionSchema, status_code=201)
async def create_section(
    sop_id: UUID,
    body: SectionCreateRequest,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
):
    """Add a new section to a SOP. Editor/admin only."""
    sop_exists = await db.scalar(select(SOP.id).where(SOP.id == sop_id))
    if sop_exists is None:
        raise HTTPException(status_code=404, detail=f"SOP {sop_id} not found")

    # derive a unique section_key from the title
    base_key = re.sub(r"[^a-z0-9]+", "_", body.section_title.lower()).strip("_")[:80]
    key = base_key
    suffix = 2
    while await db.scalar(select(SOPSection.id).where(SOPSection.sop_id == sop_id, SOPSection.section_key == key)):
        key = f"{base_key}_{suffix}"
        suffix += 1

    # place at the end
    max_order = await db.scalar(
        select(func.max(SOPSection.display_order)).where(SOPSection.sop_id == sop_id)
    ) or 0

    sec = SOPSection(
        id=uuid_module.uuid4(),
        sop_id=sop_id,
        section_key=key,
        section_title=body.section_title,
        display_order=max_order + 10,
        content_type=body.content_type,
        content_text=body.content_text,
        content_json=body.content_json,
    )
    db.add(sec)
    await db.commit()
    await db.refresh(sec)
    return SectionSchema.model_validate(sec)


@router.delete("/sections/{section_id}", status_code=204)
async def delete_section(
    section_id: UUID,
    current_user: Annotated[User, Depends(require_editor)],
    db: AsyncSession = Depends(get_db),
):
    """Delete a section. Editor/admin only."""
    sec = (await db.execute(select(SOPSection).where(SOPSection.id == section_id))).scalar_one_or_none()
    if sec is None:
        raise HTTPException(status_code=404, detail="Section not found")
    await db.delete(sec)
    await db.commit()


@router.get("/sops/{sop_id}/watchlist", response_model=list[WatchlistSchema])
async def list_watchlist(
    sop_id: UUID,
    current_user: Annotated[User, Depends(require_viewer)],
    db: AsyncSession = Depends(get_db),
):
    """Property watchlist entries for a SOP."""
    sop_exists = await db.scalar(select(SOP.id).where(SOP.id == sop_id))
    if sop_exists is None:
        raise HTTPException(status_code=404, detail=f"SOP {sop_id} not found")

    stmt = select(PropertyWatchlist).where(PropertyWatchlist.sop_id == sop_id)
    items = (await db.execute(stmt)).scalars().all()
    return [WatchlistSchema.model_validate(item) for item in items]

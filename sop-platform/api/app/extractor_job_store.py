"""
SQLAlchemy-backed store for extractor_jobs rows.
Reuses the existing DB session — no extra credentials needed.
"""

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import select, String, Text, TIMESTAMP, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import AsyncSessionLocal, Base


class ExtractorJob(Base):
    __tablename__ = "extractor_jobs"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_type: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued")
    input_params: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    result: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    started_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)


async def create_job(task_type: str, input_params: dict) -> str:
    """Insert a new extractor_jobs row and return its UUID string."""
    async with AsyncSessionLocal() as session:
        job = ExtractorJob(task_type=task_type, input_params=input_params)
        session.add(job)
        await session.commit()
        await session.refresh(job)
        return str(job.id)


async def get_job(job_id: str) -> dict:
    """Fetch an extractor_jobs row by id. Returns empty dict if not found."""
    async with AsyncSessionLocal() as session:
        job = (await session.execute(
            select(ExtractorJob).where(ExtractorJob.id == uuid.UUID(job_id))
        )).scalar_one_or_none()
        if not job:
            return {}
        return {
            "id": str(job.id),
            "status": job.status,
            "result": job.result,
            "error_message": job.error_message,
        }

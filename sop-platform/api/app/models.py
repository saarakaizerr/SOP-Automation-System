"""
SQLAlchemy 2.0 ORM models for the SOP Platform.
Maps every table defined in schema/001_initial_schema.sql.
"""

import enum
import uuid
from datetime import datetime, date
from typing import Optional, Any

from sqlalchemy import (
    String, Text, Integer, BigInteger, Float, Boolean, Date,
    ForeignKey, UniqueConstraint, text, TIMESTAMP,
    Enum as SAEnum,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


# ── Python Enums (mirror PostgreSQL enum types) ──────────────────────────────

class SOPStatus(str, enum.Enum):
    uploaded = "uploaded"
    processing = "processing"
    draft = "draft"
    in_review = "in_review"
    published = "published"
    archived = "archived"


class UserRole(str, enum.Enum):
    viewer = "viewer"
    editor = "editor"
    admin = "admin"


class CalloutConfidence(str, enum.Enum):
    ocr_exact = "ocr_exact"
    ocr_fuzzy = "ocr_fuzzy"
    gemini_only = "gemini_only"


class CalloutMatchMethod(str, enum.Enum):
    ocr_exact_text = "ocr_exact_text"
    ocr_fuzzy_text = "ocr_fuzzy_text"
    ocr_disambiguated = "ocr_disambiguated"
    gemini_coordinates = "gemini_coordinates"
    manual = "manual"


class PipelineStatus(str, enum.Enum):
    awaiting_approval = "awaiting_approval"
    queued = "queued"
    transcribing = "transcribing"
    detecting_screenshare = "detecting_screenshare"
    extracting_frames = "extracting_frames"
    deduplicating = "deduplicating"
    classifying_frames = "classifying_frames"
    generating_annotations = "generating_annotations"
    extracting_clips = "extracting_clips"
    generating_sections = "generating_sections"
    completed = "completed"
    failed = "failed"


class SectionContentType(str, enum.Enum):
    text = "text"
    table = "table"
    diagram = "diagram"
    list = "list"


# ── ORM Models ────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(
        SAEnum(UserRole, name="user_role", create_type=False),
        server_default=text("'viewer'::user_role"),
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )

    # Relationships
    created_sops: Mapped[list["SOP"]] = relationship(
        "SOP", foreign_keys="[SOP.created_by]", back_populates="creator"
    )
    published_sops: Mapped[list["SOP"]] = relationship(
        "SOP", foreign_keys="[SOP.published_by]", back_populates="publisher"
    )
    reviewed_steps: Mapped[list["SOPStep"]] = relationship(
        "SOPStep", foreign_keys="[SOPStep.reviewed_by]", back_populates="reviewer"
    )
    authored_versions: Mapped[list["SOPVersion"]] = relationship(
        "SOPVersion", back_populates="author"
    )
    export_history: Mapped[list["ExportHistory"]] = relationship(
        "ExportHistory", back_populates="exporter"
    )


class SOP(Base):
    __tablename__ = "sops"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(500))
    status: Mapped[SOPStatus] = mapped_column(
        SAEnum(SOPStatus, name="sop_status", create_type=False),
        server_default=text("'processing'::sop_status"),
    )

    # Source video
    video_url: Mapped[Optional[str]] = mapped_column(Text)
    video_duration_sec: Mapped[Optional[int]] = mapped_column(Integer)
    video_file_size_bytes: Mapped[Optional[int]] = mapped_column(BigInteger)
    cropped_video_url: Mapped[Optional[str]] = mapped_column(Text)
    screen_share_periods: Mapped[list[Any]] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb")
    )

    # Project code — groups related recordings as versions of the same process
    project_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # True when this SOP was created by the merge workflow
    is_merged: Mapped[bool] = mapped_column(Boolean, server_default=text("false"), nullable=False)

    # Template
    template_id: Mapped[Optional[str]] = mapped_column(String(100))

    # Metadata
    meeting_date: Mapped[Optional[date]] = mapped_column(Date)
    meeting_participants: Mapped[list[Any]] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb")
    )
    client_name: Mapped[Optional[str]] = mapped_column(String(255))
    process_name: Mapped[Optional[str]] = mapped_column(String(255))

    # Tags — [{name: str, color: str}, ...]
    tags: Mapped[list[Any]] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb")
    )

    # Process map config — {lanes: [{id,name,color}], assignments: [{step_id,lane_id,is_decision}]}
    process_map_config: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)

    # Engagement
    view_count: Mapped[int] = mapped_column(Integer, server_default=text("0"))

    # Ownership
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"))
    published_by: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"))

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )
    published_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True))
    archived_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True))

    # Relationships
    creator: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[created_by], back_populates="created_sops"
    )
    publisher: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[published_by], back_populates="published_sops"
    )
    steps: Mapped[list["SOPStep"]] = relationship(
        "SOPStep", back_populates="sop", cascade="all, delete-orphan"
    )
    transcript_lines: Mapped[list["TranscriptLine"]] = relationship(
        "TranscriptLine", back_populates="sop", cascade="all, delete-orphan"
    )
    sections: Mapped[list["SOPSection"]] = relationship(
        "SOPSection", back_populates="sop", cascade="all, delete-orphan"
    )
    pipeline_runs: Mapped[list["PipelineRun"]] = relationship(
        "PipelineRun", back_populates="sop", cascade="all, delete-orphan"
    )
    versions: Mapped[list["SOPVersion"]] = relationship(
        "SOPVersion", back_populates="sop", cascade="all, delete-orphan"
    )
    watchlist: Mapped[list["PropertyWatchlist"]] = relationship(
        "PropertyWatchlist", back_populates="sop", cascade="all, delete-orphan"
    )
    exports: Mapped[list["ExportHistory"]] = relationship(
        "ExportHistory", back_populates="sop", cascade="all, delete-orphan"
    )


class SOPStep(Base):
    __tablename__ = "sop_steps"
    __table_args__ = (UniqueConstraint("sop_id", "sequence"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sops.id", ondelete="CASCADE"))
    sequence: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[Optional[str]] = mapped_column(Text)
    sub_steps: Mapped[list[Any]] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb")
    )
    highlight_boxes: Mapped[list[Any]] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb")
    )
    timestamp_start: Mapped[float] = mapped_column(Float)
    timestamp_end: Mapped[Optional[float]] = mapped_column(Float)

    # Screenshots
    screenshot_url: Mapped[Optional[str]] = mapped_column(Text)
    annotated_screenshot_url: Mapped[Optional[str]] = mapped_column(Text)
    screenshot_width: Mapped[Optional[int]] = mapped_column(Integer)
    screenshot_height: Mapped[Optional[int]] = mapped_column(Integer)

    # AI metadata
    scene_score: Mapped[Optional[float]] = mapped_column(Float)
    frame_classification: Mapped[Optional[str]] = mapped_column(String(50))
    gemini_description: Mapped[Optional[str]] = mapped_column(Text)

    # Review status
    is_approved: Mapped[bool] = mapped_column(Boolean, server_default=text("FALSE"))
    reviewed_by: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True))

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )

    # Relationships
    sop: Mapped["SOP"] = relationship("SOP", back_populates="steps")
    callouts: Mapped[list["StepCallout"]] = relationship(
        "StepCallout", back_populates="step", cascade="all, delete-orphan"
    )
    clips: Mapped[list["StepClip"]] = relationship(
        "StepClip", back_populates="step", cascade="all, delete-orphan"
    )
    discussions: Mapped[list["StepDiscussion"]] = relationship(
        "StepDiscussion", back_populates="step", cascade="all, delete-orphan"
    )
    linked_transcript: Mapped[list["TranscriptLine"]] = relationship(
        "TranscriptLine", back_populates="linked_step"
    )
    reviewer: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[reviewed_by], back_populates="reviewed_steps"
    )


class StepCallout(Base):
    __tablename__ = "step_callouts"
    __table_args__ = (UniqueConstraint("step_id", "callout_number"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    step_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sop_steps.id", ondelete="CASCADE")
    )
    callout_number: Mapped[int] = mapped_column(Integer)
    label: Mapped[str] = mapped_column(Text)
    element_type: Mapped[Optional[str]] = mapped_column(String(50))
    target_x: Mapped[int] = mapped_column(Integer)
    target_y: Mapped[int] = mapped_column(Integer)
    confidence: Mapped[CalloutConfidence] = mapped_column(
        SAEnum(CalloutConfidence, name="callout_confidence", create_type=False),
        server_default=text("'gemini_only'::callout_confidence"),
    )
    match_method: Mapped[CalloutMatchMethod] = mapped_column(
        SAEnum(CalloutMatchMethod, name="callout_match_method", create_type=False),
        server_default=text("'gemini_coordinates'::callout_match_method"),
    )
    ocr_matched_text: Mapped[Optional[str]] = mapped_column(String(500))
    gemini_region_hint: Mapped[Optional[str]] = mapped_column(String(200))
    was_repositioned: Mapped[bool] = mapped_column(Boolean, server_default=text("FALSE"))
    original_x: Mapped[Optional[int]] = mapped_column(Integer)
    original_y: Mapped[Optional[int]] = mapped_column(Integer)
    rotation: Mapped[float] = mapped_column(Float, server_default=text("0.0"))
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )

    # Relationships
    step: Mapped["SOPStep"] = relationship("SOPStep", back_populates="callouts")


class StepClip(Base):
    __tablename__ = "step_clips"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    step_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sop_steps.id", ondelete="CASCADE")
    )
    clip_url: Mapped[str] = mapped_column(Text)
    duration_sec: Mapped[int] = mapped_column(Integer)
    file_size_bytes: Mapped[Optional[int]] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )

    # Relationships
    step: Mapped["SOPStep"] = relationship("SOPStep", back_populates="clips")


class StepDiscussion(Base):
    __tablename__ = "step_discussions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    step_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sop_steps.id", ondelete="CASCADE")
    )
    summary: Mapped[str] = mapped_column(Text)
    discussion_type: Mapped[Optional[str]] = mapped_column(String(50))
    transcript_refs: Mapped[list[Any]] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb")
    )
    transcript_start: Mapped[Optional[float]] = mapped_column(Float)
    transcript_end: Mapped[Optional[float]] = mapped_column(Float)
    speakers: Mapped[list[Any]] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb")
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )

    # Relationships
    step: Mapped["SOPStep"] = relationship("SOPStep", back_populates="discussions")


class TranscriptLine(Base):
    __tablename__ = "transcript_lines"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sops.id", ondelete="CASCADE"))
    sequence: Mapped[int] = mapped_column(Integer)
    speaker: Mapped[str] = mapped_column(String(255))
    timestamp_sec: Mapped[float] = mapped_column(Float)
    content: Mapped[str] = mapped_column(Text)
    linked_step_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("sop_steps.id", ondelete="SET NULL")
    )
    original_speaker: Mapped[Optional[str]] = mapped_column(String(255))
    original_content: Mapped[Optional[str]] = mapped_column(Text)
    was_edited: Mapped[bool] = mapped_column(Boolean, server_default=text("FALSE"))
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )

    # Relationships
    sop: Mapped["SOP"] = relationship("SOP", back_populates="transcript_lines")
    linked_step: Mapped[Optional["SOPStep"]] = relationship(
        "SOPStep", back_populates="linked_transcript"
    )


class SOPSection(Base):
    __tablename__ = "sop_sections"
    __table_args__ = (UniqueConstraint("sop_id", "section_key"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sops.id", ondelete="CASCADE"))
    section_key: Mapped[str] = mapped_column(String(100))
    section_title: Mapped[str] = mapped_column(String(500))
    display_order: Mapped[int] = mapped_column(Integer)
    content_type: Mapped[SectionContentType] = mapped_column(
        SAEnum(SectionContentType, name="section_content_type", create_type=False),
        server_default=text("'text'::section_content_type"),
    )
    content_text: Mapped[Optional[str]] = mapped_column(Text)
    content_json: Mapped[Optional[Any]] = mapped_column(JSONB)
    mermaid_syntax: Mapped[Optional[str]] = mapped_column(Text)
    diagram_url: Mapped[Optional[str]] = mapped_column(Text)
    is_approved: Mapped[bool] = mapped_column(Boolean, server_default=text("FALSE"))
    was_edited: Mapped[bool] = mapped_column(Boolean, server_default=text("FALSE"))
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )

    # Relationships
    sop: Mapped["SOP"] = relationship("SOP", back_populates="sections")


class SectionTemplate(Base):
    __tablename__ = "section_templates"

    section_key: Mapped[str] = mapped_column(String(100), primary_key=True)
    section_title: Mapped[str] = mapped_column(String(500))
    display_order: Mapped[int] = mapped_column(Integer)
    content_type: Mapped[SectionContentType] = mapped_column(
        SAEnum(SectionContentType, name="section_content_type", create_type=False)
    )
    ai_prompt: Mapped[Optional[str]] = mapped_column(Text)
    is_required: Mapped[bool] = mapped_column(Boolean, server_default=text("TRUE"))


class PipelineRun(Base):
    __tablename__ = "pipeline_runs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sops.id", ondelete="CASCADE"))
    status: Mapped[PipelineStatus] = mapped_column(
        SAEnum(PipelineStatus, name="pipeline_status", create_type=False),
        server_default=text("'queued'::pipeline_status"),
    )
    current_stage: Mapped[Optional[str]] = mapped_column(String(100))
    stage_results: Mapped[dict[str, Any]] = mapped_column(
        JSONB, server_default=text("'{}'::jsonb")
    )
    total_api_cost: Mapped[float] = mapped_column(Float, server_default=text("0"))
    gemini_input_tokens: Mapped[int] = mapped_column(BigInteger, server_default=text("0"))
    gemini_output_tokens: Mapped[int] = mapped_column(BigInteger, server_default=text("0"))
    processing_time_sec: Mapped[Optional[int]] = mapped_column(Integer)
    started_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True))
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    error_stage: Mapped[Optional[str]] = mapped_column(String(100))
    retry_count: Mapped[int] = mapped_column(Integer, server_default=text("0"))

    # Relationships
    sop: Mapped["SOP"] = relationship("SOP", back_populates="pipeline_runs")


class SOPVersion(Base):
    __tablename__ = "sop_versions"
    __table_args__ = (UniqueConstraint("sop_id", "version_number"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sops.id", ondelete="CASCADE"))
    version_number: Mapped[int] = mapped_column(Integer)
    author_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"))
    change_summary: Mapped[Optional[str]] = mapped_column(Text)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )

    # Relationships
    sop: Mapped["SOP"] = relationship("SOP", back_populates="versions")
    author: Mapped[Optional["User"]] = relationship(
        "User", back_populates="authored_versions"
    )


class PropertyWatchlist(Base):
    __tablename__ = "property_watchlist"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sops.id", ondelete="CASCADE"))
    property_name: Mapped[str] = mapped_column(String(255))
    known_issues: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), server_default=text("'active'"))
    required_actions: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )

    # Relationships
    sop: Mapped["SOP"] = relationship("SOP", back_populates="watchlist")


class ExportHistory(Base):
    __tablename__ = "export_history"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sops.id", ondelete="CASCADE"))
    format: Mapped[str] = mapped_column(String(20))
    file_url: Mapped[str] = mapped_column(Text)
    file_size_bytes: Mapped[Optional[int]] = mapped_column(BigInteger)
    generated_by: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"))
    sop_version: Mapped[Optional[int]] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )

    # Relationships
    sop: Mapped["SOP"] = relationship("SOP", back_populates="exports")
    exporter: Mapped[Optional["User"]] = relationship(
        "User", back_populates="export_history"
    )


class SOPMergeSession(Base):
    __tablename__ = "sop_merge_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"))
    base_sop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sops.id"))
    updated_sop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sops.id"))
    merged_sop_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("sops.id"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(20), server_default=text("'reviewing'"))
    diff_result: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    approved_changes: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)


class ProcessGroup(Base):
    __tablename__ = "process_groups"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )


class SOPLike(Base):
    __tablename__ = "sop_likes"

    sop_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sops.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )


class SOPActivityLog(Base):
    __tablename__ = "sop_activity_log"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sops.id", ondelete="CASCADE"))
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    event_type: Mapped[str] = mapped_column(String(50))
    label: Mapped[str] = mapped_column(Text)
    detail: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("NOW()")
    )

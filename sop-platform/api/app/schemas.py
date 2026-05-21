"""
Pydantic v2 response schemas for the SOP Platform API.
All schemas use from_attributes=True for SQLAlchemy ORM model serialization.
"""

import uuid
from datetime import datetime, date
from typing import Optional, Any

from pydantic import BaseModel, ConfigDict, field_validator

from app.config import settings
from app.models import (
    SOPStatus,
    CalloutConfidence,
    CalloutMatchMethod,
    PipelineStatus,
    SectionContentType,
    UserRole,
)


def _with_sas(url: Optional[str]) -> Optional[str]:
    """Append Azure SAS token to blob URLs if not already present."""
    if url and settings.azure_blob_sas_token and "?" not in url:
        return f"{url}?{settings.azure_blob_sas_token}"
    return url


# ── User schemas ───────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: str
    name: str
    role: UserRole = UserRole.viewer

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        import re
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v.strip()):
            raise ValueError("Invalid email address")
        return v.strip().lower()


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[UserRole] = None


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    name: str
    role: str
    created_at: datetime
    updated_at: datetime


class CalloutSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    step_id: uuid.UUID
    callout_number: int
    label: str
    element_type: Optional[str] = None
    target_x: int
    target_y: int
    confidence: CalloutConfidence
    match_method: CalloutMatchMethod
    ocr_matched_text: Optional[str] = None
    gemini_region_hint: Optional[str] = None
    was_repositioned: bool
    original_x: Optional[int] = None
    original_y: Optional[int] = None
    rotation: float = 0.0
    created_at: datetime
    updated_at: datetime


class StepClipSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    step_id: uuid.UUID
    clip_url: str
    duration_sec: int
    file_size_bytes: Optional[int] = None
    created_at: datetime

    @field_validator("clip_url", mode="after")
    @classmethod
    def add_sas_clip(cls, v: str) -> str:
        return _with_sas(v) or v


class DiscussionSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    step_id: uuid.UUID
    summary: str
    discussion_type: Optional[str] = None
    transcript_refs: list[Any] = []
    transcript_start: Optional[float] = None
    transcript_end: Optional[float] = None
    speakers: list[Any] = []
    created_at: datetime


class StepSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    sop_id: uuid.UUID
    sequence: int
    title: str
    description: Optional[str] = None
    sub_steps: Optional[list[Any]] = []

    @field_validator("sub_steps", mode="before")
    @classmethod
    def coerce_sub_steps(cls, v: Any) -> list:
        return v if isinstance(v, list) else []
    timestamp_start: float
    timestamp_end: Optional[float] = None
    screenshot_url: Optional[str] = None
    annotated_screenshot_url: Optional[str] = None
    screenshot_width: Optional[int] = None

    @field_validator("screenshot_url", "annotated_screenshot_url", mode="after")
    @classmethod
    def add_sas_screenshot(cls, v: Optional[str]) -> Optional[str]:
        return _with_sas(v)
    screenshot_height: Optional[int] = None
    scene_score: Optional[float] = None
    frame_classification: Optional[str] = None
    gemini_description: Optional[str] = None
    is_approved: bool
    reviewed_by: Optional[uuid.UUID] = None
    reviewed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    highlight_boxes: list[Any] = []
    callouts: list[CalloutSchema] = []
    clips: list[StepClipSchema] = []
    discussions: list[DiscussionSchema] = []


class SectionSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    sop_id: uuid.UUID
    section_key: str
    section_title: str
    display_order: int
    content_type: SectionContentType
    content_text: Optional[str] = None
    content_json: Optional[Any] = None
    mermaid_syntax: Optional[str] = None
    diagram_url: Optional[str] = None
    is_approved: bool
    was_edited: bool
    created_at: datetime
    updated_at: datetime


class WatchlistSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    sop_id: uuid.UUID
    property_name: str
    known_issues: Optional[str] = None
    status: str
    required_actions: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class TranscriptLineSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    sop_id: uuid.UUID
    sequence: int
    speaker: str
    timestamp_sec: float
    content: str
    linked_step_id: Optional[uuid.UUID] = None
    original_speaker: Optional[str] = None
    original_content: Optional[str] = None
    was_edited: bool
    created_at: datetime
    updated_at: datetime


class PipelineRunSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    sop_id: uuid.UUID
    status: PipelineStatus
    current_stage: Optional[str] = None
    stage_results: dict[str, Any] = {}
    total_api_cost: float
    gemini_input_tokens: int
    gemini_output_tokens: int
    processing_time_sec: Optional[int] = None
    started_at: datetime
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    error_stage: Optional[str] = None
    retry_count: int


class SOPListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    status: SOPStatus
    client_name: Optional[str] = None
    process_name: Optional[str] = None
    meeting_date: Optional[date] = None
    created_at: datetime
    step_count: int = 0
    pipeline_status: Optional[str] = None   # latest pipeline_runs.status
    pipeline_stage: Optional[str] = None    # latest pipeline_runs.current_stage
    pipeline_started_at: Optional[datetime] = None  # latest pipeline_runs.started_at
    tags: list[dict] = []  # [{name: str, color: str}]
    project_code: Optional[str] = None
    is_merged: bool = False


class SOPDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    status: SOPStatus
    video_url: Optional[str] = None
    video_duration_sec: Optional[int] = None
    video_file_size_bytes: Optional[int] = None
    cropped_video_url: Optional[str] = None

    @field_validator("video_url", "cropped_video_url", mode="after")
    @classmethod
    def add_sas_video(cls, v: Optional[str]) -> Optional[str]:
        return _with_sas(v)
    screen_share_periods: list[Any] = []
    template_id: Optional[str] = None
    meeting_date: Optional[date] = None
    meeting_participants: list[Any] = []
    client_name: Optional[str] = None
    process_name: Optional[str] = None
    created_by: Optional[uuid.UUID] = None
    published_by: Optional[uuid.UUID] = None
    created_at: datetime
    updated_at: datetime
    published_at: Optional[datetime] = None
    archived_at: Optional[datetime] = None

    process_map_config: Optional[Any] = None
    project_code: Optional[str] = None

    steps: list[StepSchema] = []
    sections: list[SectionSchema] = []
    watchlist: list[WatchlistSchema] = []


class ExportHistoryItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    format: str
    file_size_bytes: Optional[int] = None
    created_at: datetime
    file_url: Optional[str] = None

    @field_validator('file_url', mode='before')
    @classmethod
    def _apply_sas(cls, v: Optional[str]) -> Optional[str]:
        return _with_sas(v) or v if v else None


class LikerItem(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    liked_at: datetime


class SOPMetrics(BaseModel):
    view_count: int
    like_count: int
    user_liked: bool
    step_count: int
    approved_step_count: int
    export_count: int
    recent_exports: list[ExportHistoryItem]
    likers: list[LikerItem] = []


class LikeResponse(BaseModel):
    liked: bool
    like_count: int


class ActivityEvent(BaseModel):
    event_type: str   # 'created' | 'pipeline' | 'approved' | 'export' | 'edit'
    label: str
    detail: Optional[str] = None
    timestamp: datetime
    actor_name: Optional[str] = None


class CreateStepBody(BaseModel):
    title: str


class ProcessMapConfigBody(BaseModel):
    lanes: list[dict]
    assignments: list[dict]
    is_confirmed: bool = False
    confirmed_url: Optional[str] = None
    confirmed_at: Optional[str] = None


class CombinePartInput(BaseModel):
    sop_id: str
    label: str  # e.g. "Part 1: Login & Setup"

class CombineExportBody(BaseModel):
    parts: list[CombinePartInput]   # ordered list, min 2
    title: str                       # combined document title


class ProjectCodeUpdate(BaseModel):
    project_code: Optional[str] = None   # None = clear the code


class MergeCompareBody(BaseModel):
    base_sop_id: str
    updated_sop_id: str


class MergeMatch(BaseModel):
    status: str                          # unchanged | changed | added | removed
    base_step_id: Optional[str] = None
    updated_step_id: Optional[str] = None
    change_summary: Optional[str] = None


class MergeSessionResponse(BaseModel):
    session_id: str
    status: str
    base_sop_id: str
    updated_sop_id: str
    merged_sop_id: Optional[str] = None
    matches: list[MergeMatch] = []


class MergeStepDecision(BaseModel):
    step_id: str      # ID from base or updated SOP
    source: str       # "base" or "updated"


class MergeFinalizeBody(BaseModel):
    steps: list[MergeStepDecision]   # ordered final step list


class CreateProcessGroupBody(BaseModel):
    name: str
    sop_ids: list[str]   # UUIDs of SOPs to include in this group


class ProcessGroupResponse(BaseModel):
    id: str
    name: str
    code: str
    sop_ids: list[str]


class ExportResponse(BaseModel):
    download_url: str   # Azure URL with SAS token appended
    filename: str
    format: str         # 'docx' or 'pdf'


class CalloutPatchItem(BaseModel):
    id: uuid.UUID
    target_x: int
    target_y: int
    was_repositioned: bool
    label: Optional[str] = None
    rotation: float = 0.0


class NewCalloutItem(BaseModel):
    callout_number: int
    label: str = "Manual callout"
    target_x: int
    target_y: int

class HighlightBoxItem(BaseModel):
    id: str
    x: int
    y: int
    w: int
    h: int
    color: str = "yellow"


class RenderAnnotatedResponse(BaseModel):
    annotated_screenshot_url: str  # Azure base URL (no SAS)


# Public alias so routes can import this without referencing a private symbol
with_sas = _with_sas

// TypeScript interfaces matching api/app/schemas.py exactly

export interface AppUser {
  id: string
  email: string
  name: string
  role: 'viewer' | 'editor' | 'admin'
  created_at: string
  updated_at?: string
}

export interface UserCreateInput {
  email: string
  name: string
  role: 'viewer' | 'editor' | 'admin'
}

export interface UserUpdateInput {
  name?: string
  role?: 'viewer' | 'editor' | 'admin'
}


export type SOPStatus = 'uploaded' | 'processing' | 'draft' | 'in_review' | 'published' | 'archived'
export type CalloutConfidence = 'ocr_exact' | 'ocr_fuzzy' | 'gemini_only'
export type CalloutMatchMethod = 'ocr' | 'gemini' | 'manual'
export type PipelineStatus = 'pending' | 'running' | 'completed' | 'failed'
export type SectionContentType = 'text' | 'list' | 'table' | 'mermaid' | 'html'

export interface HighlightBox {
  id: string
  x: number
  y: number
  w: number
  h: number
  color: 'yellow' | 'red' | 'green' | 'blue'
}

export interface StepCallout {
  id: string
  step_id: string
  callout_number: number
  label: string
  element_type: string | null
  target_x: number
  target_y: number
  confidence: CalloutConfidence
  match_method: CalloutMatchMethod
  ocr_matched_text: string | null
  gemini_region_hint: string | null
  was_repositioned: boolean
  original_x: number | null
  original_y: number | null
  rotation: number
  created_at: string
  updated_at: string
}

export interface CalloutPatchItem {
  id: string
  target_x: number   // integer 0–100
  target_y: number   // integer 0–100
  was_repositioned: boolean
}

export interface StepClip {
  id: string
  step_id: string
  clip_url: string
  duration_sec: number
  file_size_bytes: number | null
  created_at: string
}

export interface StepDiscussion {
  id: string
  step_id: string
  summary: string
  discussion_type: string | null
  transcript_refs: unknown[]
  transcript_start: number | null
  transcript_end: number | null
  speakers: string[]
  created_at: string
}

export interface SOPStep {
  id: string
  sop_id: string
  sequence: number
  title: string
  description: string | null
  sub_steps: string[]
  timestamp_start: number
  timestamp_end: number | null
  screenshot_url: string | null
  annotated_screenshot_url: string | null
  screenshot_width: number | null
  screenshot_height: number | null
  scene_score: number | null
  frame_classification: string | null
  gemini_description: string | null
  is_approved: boolean
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
  highlight_boxes: HighlightBox[]
  callouts: StepCallout[]
  clips: StepClip[]
  discussions: StepDiscussion[]
}

export interface SOPSection {
  id: string
  sop_id: string
  section_key: string
  section_title: string
  display_order: number
  content_type: SectionContentType
  content_text: string | null
  content_json: Record<string, unknown> | unknown[] | null
  mermaid_syntax: string | null
  diagram_url: string | null
  is_approved: boolean
  was_edited: boolean
  created_at: string
  updated_at: string
}

export interface WatchlistItem {
  id: string
  sop_id: string
  property_name: string
  known_issues: string | null
  status: string
  required_actions: string | null
  created_at: string
  updated_at: string
}

export interface TranscriptLine {
  id: string
  sop_id: string
  sequence: number
  speaker: string
  timestamp_sec: number
  content: string
  linked_step_id: string | null
  original_speaker: string | null
  original_content: string | null
  was_edited: boolean
  created_at: string
  updated_at: string
}

export interface PipelineRun {
  id: string
  sop_id: string
  status: PipelineStatus
  current_stage: string | null
  stage_results: Record<string, unknown>
  total_api_cost: number
  gemini_input_tokens: number
  gemini_output_tokens: number
  processing_time_sec: number | null
  started_at: string
  completed_at: string | null
  error_message: string | null
  error_stage: string | null
  retry_count: number
}

export interface ActivityEvent {
  event_type: 'created' | 'pipeline' | 'approved' | 'export' | 'edit'
  label: string
  detail: string | null
  timestamp: string
  actor_name: string | null
}

export interface ExportHistoryItem {
  id: string
  format: string
  file_size_bytes: number | null
  created_at: string
  file_url: string | null
}

export interface LikerItem {
  id: string
  name: string
  email: string
  liked_at: string
}

export interface SOPMetrics {
  view_count: number
  like_count: number
  user_liked: boolean
  step_count: number
  approved_step_count: number
  export_count: number
  recent_exports: ExportHistoryItem[]
  likers: LikerItem[]
}

export interface LikeResponse {
  liked: boolean
  like_count: number
}

export interface SOPTag {
  name: string
  color: string
}

export interface SOPListItem {
  id: string
  title: string
  status: SOPStatus
  client_name: string | null
  process_name: string | null
  meeting_date: string | null
  created_at: string
  step_count: number
  pipeline_status: string | null
  pipeline_stage: string | null
  pipeline_started_at: string | null
  pipeline_error: string | null
  tags: SOPTag[]
  project_code: string | null
  is_merged: boolean
}

export interface ProcessMapLane {
  id: string
  name: string
  color: string
}

export interface ProcessMapAssignment {
  step_id: string
  lane_id: string
  is_decision: boolean
  no_target_step_id?: string | null
}

export interface ProcessMapConfig {
  lanes: ProcessMapLane[]
  assignments: ProcessMapAssignment[]
  is_confirmed?: boolean
  confirmed_url?: string | null
  confirmed_at?: string | null
}

export interface SOPDetail {
  id: string
  title: string
  status: SOPStatus
  video_url: string | null
  video_duration_sec: number | null
  video_file_size_bytes: number | null
  cropped_video_url: string | null
  screen_share_periods: unknown[]
  template_id: string | null
  meeting_date: string | null
  meeting_participants: string[]
  client_name: string | null
  process_name: string | null
  created_by: string | null
  published_by: string | null
  created_at: string
  updated_at: string
  published_at: string | null
  archived_at: string | null
  process_map_config: ProcessMapConfig | null
  project_code: string | null
  steps: SOPStep[]
  sections: SOPSection[]
  watchlist: WatchlistItem[]
}

export interface CombinePartInput {
  sop_id: string
  label: string
}

export interface CombineExportRequest {
  parts: CombinePartInput[]
  title: string
}

export interface MergeMatch {
  status: 'unchanged' | 'changed' | 'added' | 'removed'
  base_step_id: string | null
  updated_step_id: string | null
  change_summary?: string
}

export interface MergeSession {
  session_id: string
  status: string
  base_sop_id: string
  updated_sop_id: string
  merged_sop_id: string | null
  matches: MergeMatch[]
}

export interface MergeStepDecision {
  step_id: string
  source: 'base' | 'updated'
}

export interface MergeGroupSOP {
  id: string
  title: string
  status: string
  meeting_date: string | null
  client_name: string | null
  is_merged: boolean
}

export interface MergeGroup {
  project_code: string
  name: string | null
  sops: MergeGroupSOP[]
}

export interface ProcessGroupResponse {
  id: string
  name: string
  code: string
  sop_ids: string[]
}

export interface CreateProcessGroupInput {
  name: string
  sop_ids: string[]
}

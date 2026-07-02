# Manual Pipeline Trigger — Design Plan

**Status:** Pending implementation  
**Created:** 2026-05-22  
**Goal:** Video uploaded to SharePoint → admin/editor manually clicks "Initialize" → only then WF0 runs. Remove the 15-min auto-trigger from WF0.

---

## The Problem

WF0 currently runs on a 15-minute schedule: it polls SharePoint, detects new files, and immediately starts processing. There is no human review gate. The new flow requires an explicit "Initialize" action from an admin or editor before any processing begins.

---

## Flow

```
SharePoint upload
      ↓
WF-detect (every 5–10 min)
      ↓
POST /api/pipeline/register-upload
      ↓
SOP created (status = uploaded)
pipeline_run created (status = awaiting_approval)
      ↓
Supabase Realtime → bell notification fires
"[VideoName] — ready to process" + [Initialize] button
      ↓
Admin/Editor clicks Initialize
      ↓
POST /api/sops/{id}/start-pipeline
      ↓
SOP → processing, pipeline_run → queued
POST to n8n WF0 webhook
      ↓
WF0 runs (transcription → frames → annotations → clips → sections)
      ↓
Notification: "SOP ready for review"
```

---

## Implementation Checklist

### 1. Database — `schema/008_uploaded_status.sql`
- [ ] `ALTER TYPE sop_status ADD VALUE IF NOT EXISTS 'uploaded'`
- [ ] `ALTER TYPE pipeline_status ADD VALUE IF NOT EXISTS 'awaiting_approval'`

### 2. API — `app/models.py`
- [ ] Add `uploaded = "uploaded"` to `SOPStatus` enum
- [ ] Add `awaiting_approval = "awaiting_approval"` to `PipelineStatus` enum

### 3. API — `app/config.py`
- [ ] Add `n8n_wf0_webhook_url: str = ""` setting (WF0 webhook URL from n8n)

### 4. API — new endpoint: `POST /api/pipeline/register-upload`
- [ ] Auth: `x-internal-key` header (same secret used by existing pipeline routes)
- [ ] Body: `{ video_url, process_name, sharepoint_file_id }`
- [ ] Creates SOP record (`status = uploaded`)
- [ ] Creates pipeline_run record (`status = awaiting_approval`, linked to SOP)
- [ ] Returns `{ sop_id }`
- [ ] Supabase Realtime fires on pipeline_run INSERT → notification appears in bell

### 5. API — new endpoint: `POST /api/sops/{id}/start-pipeline`
- [ ] Auth: editor or admin role required
- [ ] Validates SOP `status == uploaded` (rejects if already processing/done)
- [ ] Updates SOP status → `processing`
- [ ] Updates pipeline_run status → `queued`
- [ ] POSTs to n8n WF0 webhook: `{ sop_id, video_url }`
- [ ] Returns `{ ok: true }`

### 6. Frontend — `src/contexts/NotificationContext.tsx`
- [ ] Add optional `sop_id?: string` field to `AppNotification` type
- [ ] Pass `sop_id` through `addNotification(type, title, body, sop_id?)`

### 7. Frontend — `src/hooks/useRealtimePipeline.ts`
- [ ] Handle pipeline_run INSERT with `status = awaiting_approval`
  - Notification: type `upload`, body `"Ready to initialize"`, pass `sop_id`
  - Toast: `"New recording ready"` with description = video name
- [ ] No change needed for other statuses

### 8. Frontend — `src/components/Layout.tsx` (NotificationBell)
- [ ] When notification `body === "Ready to initialize"` (or type === `upload` with `sop_id`), show **"Initialize"** button
- [ ] Button calls `POST /api/sops/{sop_id}/start-pipeline`
- [ ] On success: update notification body to `"Processing started"`, disable button

### 9. Frontend — `src/components/SOPCard.tsx`
- [ ] When `pipeline_status === "awaiting_approval"` or SOP `status === "uploaded"`: show **"Start Processing"** button (purple, editor/admin only)
- [ ] Button calls `POST /api/sops/{id}/start-pipeline`
- [ ] On success: invalidate queries so card refreshes

### 10. Frontend — `src/api/client.ts`
- [ ] Add `startPipeline(sopId: string): Promise<void>` function

---

## n8n Changes (manual — done in n8n UI)

### WF-detect (new workflow)
- Schedule trigger: every 5–10 min
- Poll SharePoint folder for new files
- For each new file not already in `processed_sharepoint_files`: call `POST /api/pipeline/register-upload`
- Mark file as processed in `processed_sharepoint_files`

### WF0 (modify existing)
- Remove / disable the schedule trigger node
- Add a **Webhook trigger** at the start: `POST /webhook/wf0-trigger`
- Webhook body receives: `{ sop_id, video_url }`
- Feed `sop_id` and `video_url` into the existing transcription nodes (replace hardcoded SharePoint poll)

---

## API Request / Response Shapes

### `POST /api/pipeline/register-upload`
```json
// Request (from n8n, with x-internal-key header)
{
  "video_url": "https://...",
  "process_name": "YTDown YouTube Java in 100 Seconds",
  "sharepoint_file_id": "abc123"
}

// Response
{ "sop_id": "uuid-here" }
```

### `POST /api/sops/{id}/start-pipeline`
```json
// Request (no body needed, auth via JWT)
// Response
{ "ok": true }
```

---

## Notes

- `uploaded` status is only visible to admin + editor (not viewer) — same as `draft`/`in_review`
- The `sharepoint_file_id` in register-upload is stored so WF-detect doesn't re-register the same file
- WF0 webhook URL is stored in `N8N_WF0_WEBHOOK_URL` env var; API reads it from `settings.n8n_wf0_webhook_url`
- If admin clicks Initialize and the n8n webhook call fails, status is rolled back to `uploaded` so they can retry

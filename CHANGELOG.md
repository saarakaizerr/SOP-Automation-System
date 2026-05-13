# SOP Automation Platform — Changelog

---

## 2026-05-13

### Bug Fix — WF0 502 on probe-video (intermittent, rebuild window)

**Symptom**
WF0 (Smart Ingest & Auto-Split) returns 502 Bad Gateway when calling
`https://soptest.cloudnavision.com/api/probe-video`. Error is intermittent — works for a while, then breaks after a code deployment.

**Root Cause**
`sop-api` and `sop-extractor` containers had no restart policy in `docker-compose.yml`. When containers were stopped during a rebuild (`docker compose up --build sop-api sop-extractor`), the Cloudflare Tunnel could not connect to `sop-api:8000` and returned 502. If WF0 (on its schedule) fired during the 1–2 min rebuild window, n8n saw 502.

**Fix**
Added `restart: unless-stopped` to `sop-api` and `sop-extractor` in `docker-compose.yml`. Containers now auto-restart after crashes. For planned rebuilds, the window is still ~60s — acceptable since WF0 retries on failure.

### Enhancement — DOCX Export Restructure (Template v14)

Restructured DOCX export to match the Aged Debtor Process PDF reference:
- TOC section order: 1 Procedure Description (with 5 sub-items) → 2 Training Prerequisites → 3 Software Applications → 4 Process Map → 5 Detailed Procedure → 6–13 post-sections → 14 SOP Author/Reviewer/Approver Certification
- Removed orange bar under TOC heading
- Auto-crop Windows taskbar (bottom) and application title bar (top) from embedded screenshots — detects dark bands via numpy brightness transitions, only crops within the expected OS-chrome zones (top 8% / bottom 12%)

### Enhancement — Callout Badge Rendering (annotator.py)

Annotated screenshots now match the editor's selected/active callout style exactly:
- Confidence-based fill: blue (repositioned), green (ocr_exact/ocr_fuzzy), amber (gemini default)
- Red #DC2626 highlight border (matches editor's selection indicator)
- Badge scale: `max(1.0, min(w,h)/474)` — correct size on full-resolution 1080p screenshots
- Bug fix: `confidence` and `was_repositioned` were not passed through the API payload (steps.py → extractor)

---

## 2026-05-12

### Bug Fix — Frame Extraction Silent Failure (WF2)

**Symptom**
WF2 (Frame Extraction) ran for 45+ minutes with no frames appearing in Azure Blob Storage. The n8n execution showed as "running" indefinitely.

**Root Cause**
`EXTRACTOR_URL` in the `sop-api` container was set to `http://` instead of `https://`:
```
http://sop-extractor.internal.whitemeadow-cfe4a842.southeastasia.azurecontainerapps.io
```
Azure Container Apps internal ingress only accepts HTTPS. When sop-api received the extraction job from WF2, it spawned a background task that immediately failed trying to connect over HTTP. The background job set its status to `"failed"` and the extractor never ran.

**Why WF2 appeared stuck**
WF2 does not poll the API job status — it polls `pipeline_runs.status` in Supabase directly. The "Mark as Processing" node sets `status = 'deduplicating'`. Since the extractor never ran, `pipeline_runs.status` never advanced to `'classifying_frames'`, so WF2 looped every 5 minutes forever waiting for a status change that never came.

**Why EXTRACTOR_URL kept reverting**
The URL was hardcoded as `http://` directly in `.github/workflows/deploy.yml` line 127 under `--set-env-vars`. Every GitHub Actions deployment overwrote any manual fix with the wrong value.

**Fix**
1. Changed `http://` → `https://` in `.github/workflows/deploy.yml`:
   ```yaml
   'EXTRACTOR_URL=https://sop-extractor.internal.whitemeadow-cfe4a842.southeastasia.azurecontainerapps.io'
   ```
2. Updated the live env var via az CLI:
   ```bash
   az containerapp update \
     --name sop-api \
     --resource-group rg-saara-workspace \
     --container-name sop-api \
     --set-env-vars "EXTRACTOR_URL=https://sop-extractor.internal.whitemeadow-cfe4a842.southeastasia.azurecontainerapps.io"
   ```
3. Reset stuck pipeline run in Supabase:
   ```sql
   UPDATE pipeline_runs
   SET status = 'extracting_frames', current_stage = 'extracting_frames'
   WHERE sop_id = '31e80581-5431-43db-b2dc-a5fd4b9d629a';
   ```

**Verification**
```bash
curl -s -H "x-internal-key: <INTERNAL_API_KEY>" \
  https://soptest.cloudnavision.com/api/test-extractor
# Expected: {"status":"ok","extractor":{"status":"ok","service":"sop-extractor","ffmpeg":true}}
```

---

### Bug Fix — WF3c JSON Double-Encoding

**Symptom**
WF3c (Annotation / Callouts) nodes sent malformed request bodies to Vertex AI Gemini, Google Cloud Vision, and Supabase, causing 422/400 errors.

**Root Cause**
Four HTTP Request nodes used `JSON.stringify()` combined with `specifyBody: "json"` in n8n. This double-encodes the body — n8n receives a string from `JSON.stringify()` and sends it as a JSON-encoded string instead of a JSON object. All receiving APIs rejected the string body.

**Affected nodes**
- Call Gemini Vision: `{{ JSON.stringify($json.geminiBody) }}`
- Call Vision OCR: `{{ JSON.stringify($json.visionOCRBody) }}`
- Update SOP Step: `{{ JSON.stringify({ gemini_description: ... }) }}`
- Insert Step Callouts: `{{ JSON.stringify($('Run Matching Algorithm').first().json.callouts) }}`

**Fix**
Remove `JSON.stringify()` from all four nodes — pass the object/array directly:
- `{{ $json.geminiBody }}`
- `{{ $json.visionOCRBody }}`
- `{{ { gemini_description: $json.gemini_description } }}`
- `{{ $('Run Matching Algorithm').first().json.callouts }}`

**Rule**
Never use `JSON.stringify()` with `specifyBody: "json"` in n8n. Pass objects directly — n8n serializes them automatically.

---

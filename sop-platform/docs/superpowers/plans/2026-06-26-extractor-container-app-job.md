# Plan: Migrate sop-extractor → Azure Container App Job

**Date:** 2026-06-26  
**Goal:** Eliminate the always-on `sop-extractor` Container App service and replace it with an on-demand **Azure Container App Job** that starts only when work is queued. This removes idle compute costs (currently ~24/7 uptime for a service that's only busy during pipeline runs).

---

## Architecture Overview

### Before
```
n8n / Frontend → API (sop-api) → HTTP POST sop-extractor:8001 (always running)
```

### After
```
n8n / Frontend → API (sop-api) → writes to extractor_jobs table → starts Container App Job
                                                                           ↓
                                                              Job reads task → processes → writes result → exits 0
API polling endpoints → reads extractor_jobs table → returns status/result to caller
```

### Key Decisions

| Concern | Decision | Reason |
|---|---|---|
| Task queue | Supabase `extractor_jobs` table | Already have Supabase; no new Azure Queue service needed |
| Job trigger | Azure Management REST API called from `sop-api` | Simple, no extra infrastructure |
| Job trigger type | **Manual** | On-demand per request; no schedule, no event queue |
| Parallelism | Multiple jobs can run simultaneously | Each job is its own container instance |
| `render-annotated` endpoint | Move inline to `sop-api` | Fast interactive op (Pillow); can't tolerate 30-60s cold start |
| `compare-sops` endpoint | Move inline to `sop-api` | Gemini API call; no FFmpeg/LibreOffice needed |
| Same Docker image | Yes — different `CMD` only | No separate Dockerfile needed; job uses `python -m app.job_runner` |

### Endpoints moved to Container App Job
- `POST /extract` — frame extraction (long-running, n8n calls)
- `POST /clip` — MP4 clip cutting (long-running, n8n calls)
- `POST /api/split-video` — video splitting (long-running, n8n/WF0 calls)
- `POST /api/probe-video` — video probing (fast but same image)
- `POST /api/render-doc` — DOCX/PDF export (long-running, user action)

### Endpoints moved inline to sop-api
- `POST /api/render-annotated` — Pillow compositing (interactive, ~2-3s)
- `POST /api/compare-sops` — Gemini semantic diff (interactive, ~30s)

---

## File Map

### New Files
| File | Purpose |
|---|---|
| `extractor/app/job_runner.py` | Job entry point: reads TASK_ID, routes to handler, writes result, exits |
| `api/app/azure_job_client.py` | Azure Management API client to start Container App Job executions |
| `api/app/routes/annotated_render.py` | Inline render-annotated logic (Pillow) moved from extractor |
| `schema/011_extractor_jobs.sql` | New `extractor_jobs` table migration |
| `infra/deploy-extractor-job.sh` | Azure CLI script to create/update the Container App Job |

### Modified Files
| File | Change |
|---|---|
| `api/app/config.py` | Add `azure_subscription_id`, `azure_resource_group`, `azure_job_name`, `azure_tenant_id`, `azure_client_id`, `azure_client_secret` |
| `api/app/main.py` | Replace extractor HTTP call wrappers with job-based equivalents; include new annotated_render router |
| `api/app/routes/exports.py` | `_run_export()` → enqueue job instead of HTTP call to extractor |
| `api/app/routes/steps.py` | `render-annotated` → inline Pillow call instead of extractor HTTP |
| `api/app/routes/merge.py` | `compare-sops` → inline Gemini call instead of extractor HTTP |
| `api/app/requirements.txt` | Add `Pillow`, `google-genai`, `azure-identity`, `azure-mgmt-appcontainers` |
| `extractor/Dockerfile` | Add `CMD ["python", "-m", "app.job_runner"]` as alternative entrypoint note |
| `docker-compose.yml` | Remove `sop-extractor` service (no longer needed locally for prod) |
| `docker-compose.dev.yml` | Keep `sop-extractor` in service mode for local dev only |
| `.env.example` | Add Azure job trigger env vars |

---

## Task 1 — DB Migration: `extractor_jobs` table

**Time:** ~5 min  
**File:** `schema/011_extractor_jobs.sql`

```sql
CREATE TABLE extractor_jobs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_type   TEXT NOT NULL,          -- 'extract' | 'clip' | 'split' | 'probe' | 'render_doc'
    status      TEXT NOT NULL DEFAULT 'queued',  -- queued | running | completed | failed
    input_params JSONB NOT NULL DEFAULT '{}',
    result      JSONB,
    error_message TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at  TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_extractor_jobs_status ON extractor_jobs(status);
CREATE INDEX idx_extractor_jobs_created_at ON extractor_jobs(created_at DESC);
```

Run this migration in Supabase SQL editor.

**Verify:** `SELECT * FROM extractor_jobs LIMIT 0;` returns the columns without error.

---

## Task 2 — Backend Config: Add Azure Job settings

**Time:** ~5 min  
**File:** `api/app/config.py`

Add to the `Settings` class:

```python
# Azure Container App Job trigger
azure_subscription_id: str = ""
azure_resource_group: str = ""
azure_container_app_env: str = ""   # e.g. "sop-env"
azure_extractor_job_name: str = "sop-extractor-job"
azure_tenant_id: str = ""
azure_client_id: str = ""           # Service principal for job trigger
azure_client_secret: str = ""
```

Add to `.env.example`:
```
AZURE_SUBSCRIPTION_ID=
AZURE_RESOURCE_GROUP=
AZURE_CONTAINER_APP_ENV=
AZURE_EXTRACTOR_JOB_NAME=sop-extractor-job
AZURE_TENANT_ID=
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
```

---

## Task 3 — Azure Job Client

**Time:** ~10 min  
**File:** `api/app/azure_job_client.py`

```python
import httpx
from app.config import settings

_token_cache: dict = {}

async def _get_token() -> str:
    """Get Azure Management API bearer token via client credentials."""
    import time
    if _token_cache.get("expires_at", 0) > time.time() + 60:
        return _token_cache["token"]
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"https://login.microsoftonline.com/{settings.azure_tenant_id}/oauth2/v2.0/token",
            data={
                "grant_type": "client_credentials",
                "client_id": settings.azure_client_id,
                "client_secret": settings.azure_client_secret,
                "scope": "https://management.azure.com/.default",
            },
        )
        resp.raise_for_status()
        data = resp.json()
        import time
        _token_cache["token"] = data["access_token"]
        _token_cache["expires_at"] = time.time() + data["expires_in"]
        return _token_cache["token"]


async def start_extractor_job(task_id: str) -> str:
    """
    Trigger a Container App Job execution with TASK_ID env var.
    Returns the Azure execution name.
    """
    token = await _get_token()
    sub = settings.azure_subscription_id
    rg = settings.azure_resource_group
    job = settings.azure_extractor_job_name
    url = (
        f"https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}"
        f"/providers/Microsoft.App/jobs/{job}/start?api-version=2023-05-01"
    )
    body = {
        "template": {
            "containers": [{
                "name": "sop-extractor",
                "env": [{"name": "TASK_ID", "value": task_id}]
            }]
        }
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=body, headers={"Authorization": f"Bearer {token}"})
        resp.raise_for_status()
        return resp.json().get("name", "unknown")
```

---

## Task 4 — Supabase Job Helper

**Time:** ~5 min  
**File:** `api/app/extractor_job_store.py`

```python
from uuid import UUID
import httpx
from app.config import settings

SUPABASE_HEADERS = lambda: {
    "apikey": settings.supabase_service_key,
    "Authorization": f"Bearer {settings.supabase_service_key}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}


async def create_job(task_type: str, input_params: dict) -> str:
    """Insert a new extractor_jobs row, return job id."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{settings.supabase_url}/rest/v1/extractor_jobs",
            json={"task_type": task_type, "input_params": input_params},
            headers=SUPABASE_HEADERS(),
        )
        resp.raise_for_status()
        return resp.json()[0]["id"]


async def get_job(job_id: str) -> dict:
    """Fetch extractor_jobs row by id."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{settings.supabase_url}/rest/v1/extractor_jobs?id=eq.{job_id}&select=*",
            headers=SUPABASE_HEADERS(),
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0] if rows else {}
```

---

## Task 5 — Job Runner Entry Point

**Time:** ~20 min  
**File:** `extractor/app/job_runner.py`

This is the new `CMD` for the Container App Job. It reads `TASK_ID`, fetches params from Supabase, delegates to existing handlers, writes result, exits.

```python
"""
Container App Job entry point.
Env vars: TASK_ID (required), plus all existing extractor env vars.
"""
import os
import sys
import json
import asyncio
import httpx

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TASK_ID = os.environ["TASK_ID"]

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}


async def update_job(status: str, result: dict = None, error: str = None):
    body = {"status": status}
    if status == "running":
        body["started_at"] = "NOW()"
    if status in ("completed", "failed"):
        body["completed_at"] = "NOW()"
    if result:
        body["result"] = result
    if error:
        body["error_message"] = error
    async with httpx.AsyncClient() as client:
        await client.patch(
            f"{SUPABASE_URL}/rest/v1/extractor_jobs?id=eq.{TASK_ID}",
            json=body,
            headers=HEADERS,
        )


async def main():
    # 1. Fetch task
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/extractor_jobs?id=eq.{TASK_ID}&select=*",
            headers=HEADERS,
        )
        resp.raise_for_status()
        rows = resp.json()
    if not rows:
        print(f"[job_runner] Task {TASK_ID} not found", file=sys.stderr)
        sys.exit(1)

    task = rows[0]
    task_type = task["task_type"]
    params = task["input_params"]

    await update_job("running")
    print(f"[job_runner] Starting task_type={task_type} id={TASK_ID}")

    try:
        if task_type == "extract":
            from app.extractor import run_extraction   # existing extraction logic
            result = await asyncio.to_thread(run_extraction, **params)
        elif task_type == "clip":
            from app.clipper import run_clip_job       # existing clip logic
            result = await asyncio.to_thread(run_clip_job, **params)
        elif task_type == "split":
            from app.splitter import run_split         # existing split logic
            result = await asyncio.to_thread(run_split, **params)
        elif task_type == "probe":
            from app.prober import probe_video         # existing probe logic
            result = await asyncio.to_thread(probe_video, **params)
        elif task_type == "render_doc":
            from app.doc_renderer import render_document  # existing render logic
            result = await asyncio.to_thread(render_document, **params)
        else:
            raise ValueError(f"Unknown task_type: {task_type}")

        await update_job("completed", result=result)
        print(f"[job_runner] Task {TASK_ID} completed successfully")
        sys.exit(0)

    except Exception as exc:
        await update_job("failed", error=str(exc))
        print(f"[job_runner] Task {TASK_ID} FAILED: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
```

**Note on existing handler functions:** The extractor's `main.py` currently has all logic inline in endpoint handlers. During implementation, extract the core logic into named functions (`run_extraction`, `run_clip_job`, etc.) in separate modules so `job_runner.py` can import them. The FastAPI routes in `main.py` can call the same functions (avoids code duplication).

---

## Task 6 — Modify API: Replace extractor HTTP calls with job pattern

**Time:** ~25 min  
**Files:** `api/app/main.py`, `api/app/routes/exports.py`

### 6a. Extract endpoint (main.py)

**Before:**
```python
async def _run_extraction_job(job_id, req):
    async with httpx.AsyncClient(timeout=3600) as client:
        resp = await client.post("http://sop-extractor:8001/extract", json=req.dict())
    _jobs[job_id] = {"status": "completed", "result": resp.json()}
```

**After:**
```python
from app.extractor_job_store import create_job, get_job
from app.azure_job_client import start_extractor_job

async def _run_extraction_job(job_id, req):
    # job_id IS the extractor_jobs.id (created before background task is started)
    await start_extractor_job(job_id)
    # No further action — Container App Job will write result to extractor_jobs table

@router.post("/api/extract")
async def start_extract(req: ExtractRequest, background_tasks: BackgroundTasks):
    db_job_id = await create_job("extract", req.dict())
    background_tasks.add_task(_run_extraction_job, db_job_id, req)
    return {"job_id": db_job_id}

@router.get("/api/extract/status/{job_id}")
async def extract_status(job_id: str):
    job = await get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {
        "status": job["status"],
        "result": job.get("result"),
        "error": job.get("error_message"),
    }
```

### 6b. Clip endpoint (main.py) — same pattern
Same as extract but `task_type="clip"`.

### 6c. Render-doc endpoint (exports.py)
Same pattern: `create_job("render_doc", params)` → `start_extractor_job(job_id)` → poll DB.
The frontend already handles async export polling, so this is a drop-in replacement.

---

## Task 7 — Move render-annotated Inline to API

**Time:** ~20 min  
**File:** `api/app/routes/annotated_render.py` (new), `api/app/routes/steps.py` (modify)

The render-annotated endpoint composites callout badges on screenshots using Pillow. Move this logic from `extractor/app/annotator.py` into the API directly.

**Steps:**
1. Copy `extractor/app/annotator.py` → `api/app/annotator.py`
2. Add `Pillow` to `api/requirements.txt`
3. In `steps.py`, replace:
   ```python
   resp = await client.post("http://sop-extractor:8001/api/render-annotated", json=body)
   ```
   With a direct call to `api/app/annotator.py`'s render function.

**Verify:** Existing annotated screenshots still render correctly.

---

## Task 8 — Move compare-sops Inline to API

**Time:** ~15 min  
**File:** `api/app/routes/merge.py`

The compare-sops endpoint calls Gemini API to semantically diff two SOP step lists. This has no FFmpeg/LibreOffice dependency — only `google-genai`.

**Steps:**
1. Add `google-genai` to `api/requirements.txt` (likely already present)
2. Copy `extractor/app/sop_comparator.py` → `api/app/sop_comparator.py`
3. In `merge.py`, replace:
   ```python
   resp = await client.post("http://sop-extractor:8001/api/compare-sops", json=body)
   ```
   With a direct call to the comparator function.

---

## Task 9 — Deploy Container App Job to Azure

**Time:** ~15 min  
**File:** `infra/deploy-extractor-job.sh`

```bash
#!/bin/bash
# Run this once to create the Container App Job in Azure
# Replace placeholders with your actual values

SUBSCRIPTION_ID="<your-subscription-id>"
RESOURCE_GROUP="sop-platform-rg"
ENVIRONMENT="sop-env"
JOB_NAME="sop-extractor-job"
IMAGE="<your-acr>.azurecr.io/sop-extractor:latest"

az containerapp job create \
  --name "$JOB_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$ENVIRONMENT" \
  --trigger-type "Manual" \
  --replica-timeout 3600 \
  --replica-retry-limit 0 \
  --replica-completion-count 1 \
  --parallelism 1 \
  --image "$IMAGE" \
  --cpu 2.0 \
  --memory 4.0Gi \
  --registry-server "<your-acr>.azurecr.io" \
  --registry-identity system \
  --command "python" \
  --args "-m" "app.job_runner" \
  --env-vars \
    "SUPABASE_URL=secretref:supabase-url" \
    "SUPABASE_SERVICE_KEY=secretref:supabase-service-key" \
    "GEMINI_API_KEY=secretref:gemini-api-key" \
    "AZURE_STORAGE_ACCOUNT=<storage-account>" \
    "AZURE_STORAGE_CONTAINER=<container-name>" \
  --secrets \
    "supabase-url=<SUPABASE_URL>" \
    "supabase-service-key=<SUPABASE_SERVICE_KEY>" \
    "gemini-api-key=<GEMINI_API_KEY>"
```

**Key parameters:**
- `--replica-timeout 1800` — kills job if running > 30 minutes (adjust for long extractions)
- `--replica-retry-limit 0` — no automatic retries (API handles retry logic)
- `--cpu 2.0 --memory 4.0Gi` — adequate for FFmpeg + LibreOffice

---

## Task 10 — Service Principal for Job Trigger

**Time:** ~10 min

The API needs permission to call `az containerapp job start` via REST. Create a minimal service principal:

```bash
# Create service principal with scope limited to the job resource
az ad sp create-for-rbac \
  --name "sop-api-job-trigger" \
  --role "Container Apps Contributor" \
  --scopes "/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.App/jobs/sop-extractor-job"

# Outputs: appId (CLIENT_ID), password (CLIENT_SECRET), tenant (TENANT_ID)
```

Add the output values to Azure Container App environment variables for `sop-api`:
- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_RESOURCE_GROUP`
- `AZURE_EXTRACTOR_JOB_NAME=sop-extractor-job`

---

## Task 11 — Update docker-compose for Local Dev

**Time:** ~5 min

Local dev still needs the extractor running as a service (faster iteration):

**`docker-compose.dev.yml`** — keep `sop-extractor` service unchanged.

**`docker-compose.yml`** (prod) — remove `sop-extractor` service entirely (job runs on Azure only).

For local dev, set `EXTRACTOR_URL=http://sop-extractor:8001` so the API falls back to HTTP calls when the Azure job client is not configured (add fallback in azure_job_client.py: if `AZURE_CLIENT_ID` is empty, use direct HTTP to extractor).

---

## Task 12 — Smoke Test

**Time:** ~10 min

1. Upload a short test video
2. Trigger pipeline run → verify `extractor_jobs` row is created with `status=queued`
3. Verify Container App Job starts in Azure Portal → Jobs → Executions
4. Verify `extractor_jobs` row transitions: `queued → running → completed`
5. Verify frames appear in Azure Blob Storage
6. Trigger DOCX export → verify `render_doc` job runs and PDF/DOCX URL is returned

---

## Execution Order

```
Task 1  → Run DB migration (extractor_jobs table)
Task 2  → Add config vars
Task 3  → Write azure_job_client.py
Task 4  → Write extractor_job_store.py
Task 5  → Write job_runner.py (refactor extractor handlers into importable functions)
Task 6  → Modify API routes (extract, clip, split, probe, render-doc)
Task 7  → Move render-annotated inline
Task 8  → Move compare-sops inline
Task 9  → Deploy Container App Job to Azure (one-time CLI)
Task 10 → Create service principal, add env vars to sop-api
Task 11 → Update docker-compose files
Task 12 → Smoke test
```

---

## Cost Impact

| Resource | Before | After |
|---|---|---|
| sop-extractor Container App | Running 24/7, ~0.5 vCPU / 1GB idle | Gone |
| Container App Job | N/A | Pay per execution-second only |
| Typical pipeline run (20 min extract) | Part of 24/7 cost | ~20 min × 2 vCPU × Azure rate |
| Zero-pipeline days | Full cost | ~$0 |

**Estimated savings:** ~60-80% of extractor compute cost on low-usage days.

---

## Settled Decisions

1. **replica-timeout: 3600 sec (60 min)** — 4× worst-case (LibreOffice render ~15 min). Covers Azure Blob upload lag, network variance, and 300+ step SOPs in the future.
2. **CPU/memory: 2 vCPU / 4GB** — Confirmed working for current SOPs in Azure. Same as current Azure Container App allocation.
3. **Render-annotated: inline in API** — Pillow compositing stays fast (~2-3s). No cold start impact.
4. **Local dev fallback** — If `AZURE_CLIENT_ID` env var is empty (i.e. running locally), `azure_job_client.py` falls back to a direct HTTP POST to `EXTRACTOR_URL` (the local Docker extractor at `http://sop-extractor:8001`). Local dev works exactly as before — no Azure credentials needed on your laptop. In Azure, `AZURE_CLIENT_ID` is set → Container App Job is used.

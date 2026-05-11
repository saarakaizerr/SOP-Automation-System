"""
SOP Platform — FastAPI Backend
Phase 1a: health checks + connectivity diagnostics
Phase 1b: CRUD routes — SOPs, steps, sections, transcript, watchlist
Phase 4+: pipeline endpoints, media signed URLs
Phase 5: /api/clip proxy — per-step MP4 clip cutting

Infrastructure: Supabase (PostgreSQL via transaction pooler, port 6543)
"""

import asyncio
import uuid
from typing import Any

import httpx
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import text

from app.config import settings
from app.database import AsyncSessionLocal
from app.dependencies.pipeline_auth import require_internal_key
from app.routes import sops, steps, sections, auth, users, exports, merge

app = FastAPI(
    title="SOP Platform API",
    description="Backend for the SOP Automation Platform — Starboard Hotels",
    version="0.1.0",
)

# ── CORS ─────────────────────────────────────────────────────
# Allow all origins in development; tighten to specific origins in production
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"https://.*\.cloudnavision\.com",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Auth Routes (Phase 1.5a) ──────────────────────────────────
app.include_router(auth.router)

# ── CRUD Routes (Phase 1b) ────────────────────────────────────
app.include_router(sops.router)
app.include_router(steps.router)
app.include_router(sections.router)

# ── Admin Routes (Phase 1.5d) ─────────────────────────────────
app.include_router(users.router)

# ── Export Routes (Phase 7a) ──────────────────────────────────
app.include_router(exports.router)

# ── Merge Routes (SOP Version Merge) — registered before sops to avoid path conflicts ──
app.include_router(merge.router)


# ── Health ───────────────────────────────────────────────────

@app.get("/", tags=["health"])
async def root() -> dict[str, str]:
    return {"service": "sop-api", "status": "ok"}


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    """Docker healthcheck endpoint — direct container access."""
    return {"status": "ok", "service": "sop-api"}


@app.get("/api/health", tags=["health"])
async def api_health() -> dict[str, str]:
    """Health check under /api/ prefix — used by verify script and monitoring."""
    return {"status": "ok", "service": "sop-api"}


# ── Diagnostics ──────────────────────────────────────────────

@app.get("/api/test-db", tags=["diagnostics"], dependencies=[Depends(require_internal_key)])
async def test_db() -> dict[str, Any]:
    """
    Verify Supabase connectivity using the SQLAlchemy async session.
    Returns sop_count from the sops table — confirms schema is applied and
    the transaction pooler connection (port 6543) is working.
    """
    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(text("SELECT COUNT(*) FROM sops"))
            count = result.scalar()
            return {"status": "ok", "sop_count": int(count)}
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}


class _CropRegion(BaseModel):
    x: int
    y: int
    w: int
    h: int


class _ScreenSharePeriod(BaseModel):
    start_time: float
    end_time: float
    crop: _CropRegion


class _ExtractRequest(BaseModel):
    sop_id: str
    video_url: str
    screen_share_periods: list[_ScreenSharePeriod]
    azure_sas_token: str
    azure_account: str
    azure_container: str
    pyscenedetect_threshold: float = 3.0
    min_scene_len_sec: float = 2.0
    dedup_hash_threshold: int = 8
    frame_offset_sec: float = 1.5


# ── Async job store + GC guard ────────────────────────────────
_jobs: dict[str, dict[str, Any]] = {}
_running_tasks: set = set()


def _spawn(coro) -> None:
    task = asyncio.create_task(coro)
    _running_tasks.add(task)
    task.add_done_callback(_running_tasks.discard)


async def _run_extraction_job(job_id: str, body: _ExtractRequest) -> None:
    try:
        async with httpx.AsyncClient(timeout=600.0) as client:
            response = await client.post(
                "http://sop-extractor:8001/extract",
                json=body.model_dump(),
            )
            response.raise_for_status()
            _jobs[job_id] = {"status": "completed", "result": response.json(), "error": None}
    except Exception as exc:
        _jobs[job_id] = {"status": "failed", "result": None, "error": str(exc)}


@app.post("/api/extract", tags=["pipeline"], dependencies=[Depends(require_internal_key)])
async def proxy_extract(body: _ExtractRequest) -> Any:
    """
    Async proxy POST /api/extract → sop-extractor:8001/extract
    Returns immediately with job_id. Poll GET /api/extract/status/{job_id} for result.
    n8n calls this endpoint externally via Cloudflare tunnel.
    """
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "processing", "result": None, "error": None}
    _spawn(_run_extraction_job(job_id, body))
    return {"job_id": job_id, "status": "processing"}


@app.get("/api/extract/status/{job_id}", tags=["pipeline"], dependencies=[Depends(require_internal_key)])
async def get_extraction_status(job_id: str) -> Any:
    """
    Poll extraction job status.
    Returns: {job_id, status: processing|completed|failed, result, error}
    """
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return {"job_id": job_id, **job}


class _ClipDefinition(BaseModel):
    step_id: str
    sequence: int
    start_sec: float
    end_sec: float


class _ClipRequest(BaseModel):
    sop_id: str
    video_url: str
    clips: list[_ClipDefinition]
    azure_sas_token: str
    azure_account: str
    azure_container: str


async def _run_clip_job(job_id: str, body: _ClipRequest) -> None:
    try:
        async with httpx.AsyncClient(timeout=1800.0) as client:
            response = await client.post(
                "http://sop-extractor:8001/clip",
                json=body.model_dump(),
            )
            response.raise_for_status()
            _jobs[job_id] = {"status": "completed", "result": response.json(), "error": None}
    except Exception as exc:
        _jobs[job_id] = {"status": "failed", "result": None, "error": str(exc)}


@app.post("/api/clip", tags=["pipeline"], dependencies=[Depends(require_internal_key)])
async def proxy_clip(body: _ClipRequest) -> Any:
    """
    Async proxy POST /api/clip → sop-extractor:8001/clip
    Returns immediately with job_id. Poll GET /api/clip/status/{job_id} for result.
    n8n calls this endpoint externally via Cloudflare tunnel.
    """
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "processing", "result": None, "error": None}
    _spawn(_run_clip_job(job_id, body))
    return {"job_id": job_id, "status": "processing"}


@app.get("/api/clip/status/{job_id}", tags=["pipeline"], dependencies=[Depends(require_internal_key)])
async def get_clip_status(job_id: str) -> Any:
    """
    Poll clip job status.
    Returns: {job_id, status: processing|completed|failed, result, error}
    """
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return {"job_id": job_id, **job}


# ── /api/probe-video proxy ────────────────────────────────────

class _ProbeVideoRequest(BaseModel):
    video_url: str
    azure_sas_token: str
    azure_account: str
    azure_container: str


@app.post("/api/probe-video", tags=["pipeline"], dependencies=[Depends(require_internal_key)])
async def proxy_probe_video(body: _ProbeVideoRequest) -> Any:
    """Synchronous proxy POST /api/probe-video → sop-extractor:8001/api/probe-video"""
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            "http://sop-extractor:8001/api/probe-video",
            json=body.model_dump(),
        )
        response.raise_for_status()
        return response.json()


# ── /api/split-video proxy ────────────────────────────────────

class _SplitVideoRequest(BaseModel):
    video_url: str
    sop_id: str
    azure_sas_token: str
    azure_account: str
    azure_container: str
    split_target_sec: float | None = None
    search_window_sec: float = 300.0


async def _run_split_job(job_id: str, body: _SplitVideoRequest) -> None:
    try:
        async with httpx.AsyncClient(timeout=3600.0) as client:
            # Submit to extractor (returns 202 + extractor_job_id immediately)
            response = await client.post(
                "http://sop-extractor:8001/api/split-video",
                json=body.model_dump(),
            )
            response.raise_for_status()
            extractor_job_id = response.json()["job_id"]

            # Poll extractor until split finishes (up to ~60 min)
            for _ in range(120):
                await asyncio.sleep(30)
                try:
                    st = await client.get(
                        f"http://sop-extractor:8001/api/split-video/status/{extractor_job_id}",
                        timeout=15.0,
                    )
                    data = st.json()
                except Exception:
                    continue
                if data.get("status") == "done":
                    _jobs[job_id] = {"status": "done", "result": data["result"], "error": None}
                    return
                if data.get("status") == "failed":
                    _jobs[job_id] = {"status": "failed", "result": None, "error": data.get("error", "extractor failed")}
                    return

            _jobs[job_id] = {"status": "failed", "result": None, "error": "timed out waiting for extractor"}
    except Exception as exc:
        _jobs[job_id] = {"status": "failed", "result": None, "error": str(exc)}


@app.post("/api/split-video", tags=["pipeline"], dependencies=[Depends(require_internal_key)])
async def proxy_split_video(body: _SplitVideoRequest) -> Any:
    """Async proxy POST /api/split-video → sop-extractor:8001/api/split-video. Returns job_id immediately."""
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "processing", "result": None, "error": None}
    _spawn(_run_split_job(job_id, body))
    return {"job_id": job_id, "status": "processing"}


@app.get("/api/split-video/status/{job_id}", tags=["pipeline"], dependencies=[Depends(require_internal_key)])
async def get_split_status(job_id: str) -> Any:
    """Poll split job status. Returns {job_id, status, result: {part1_url, part2_url, ...}, error}"""
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return {"job_id": job_id, **job}


class _SeedRequest(BaseModel):
    job_id: str
    result: dict


@app.post("/api/split-video/seed", tags=["pipeline"], dependencies=[Depends(require_internal_key)])
async def seed_split_result(body: _SeedRequest) -> Any:
    """Recovery: inject a known split result into _jobs so a polling workflow can continue."""
    _jobs[body.job_id] = {"status": "done", "result": body.result, "error": None}
    return {"ok": True, "job_id": body.job_id}


@app.get("/api/test-extractor", tags=["diagnostics"], dependencies=[Depends(require_internal_key)])
async def test_extractor() -> dict[str, Any]:
    """
    Verify connectivity to the sop-extractor service.
    Proxies the /health call and returns its full JSON response.
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get("http://sop-extractor:8001/health")
            response.raise_for_status()
            return {"status": "ok", "extractor": response.json()}
    except httpx.TimeoutException:
        return {"status": "error", "detail": "extractor health check timed out after 5s"}
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}

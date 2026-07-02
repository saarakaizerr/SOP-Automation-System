"""
SOP Platform — FastAPI Backend
Phase 1a: health checks + connectivity diagnostics
Phase 1b: CRUD routes — SOPs, steps, sections, transcript, watchlist
Phase 4+: pipeline endpoints, media signed URLs
Phase 5: /api/clip proxy — per-step MP4 clip cutting

Infrastructure: Supabase (PostgreSQL via transaction pooler, port 6543)
"""

import asyncio
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
from app.extractor_job_store import create_job, get_job
from app.azure_job_client import start_extractor_job

app = FastAPI(
    title="SOP Platform API",
    description="Backend for the SOP Automation Platform — Starboard Hotels",
    version="0.1.0",
)

# ── CORS ─────────────────────────────────────────────────────
# Production origins are hardcoded so CORS always works regardless of
# whether CORS_ORIGINS env var is loaded correctly by Docker Compose.
# settings.cors_origins merges in any additional origins from the env var.
_CORS_ORIGINS = list(dict.fromkeys([
    "http://localhost:5173",
    "http://localhost:3000",
    "https://sopapp.cloudnavision.com",
    "https://soptest.cloudnavision.com",
] + settings.cors_origins))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    # Regex covers all current and future *.cloudnavision.com subdomains
    allow_origin_regex=r"https://[a-zA-Z0-9][a-zA-Z0-9\-]*\.cloudnavision\.com",
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


# ── Local-dev fallback: GC-safe in-memory task runner ────────
# Used only when AZURE_CLIENT_ID is not set (no Azure credentials).
# In production the Container App Job handles execution instead.
_running_tasks: set = set()


def _spawn(coro) -> None:
    task = asyncio.create_task(coro)
    _running_tasks.add(task)
    task.add_done_callback(_running_tasks.discard)


async def _run_extraction_local(job_id: str, body: _ExtractRequest) -> None:
    """Local dev: proxy directly to sop-extractor HTTP service."""
    try:
        async with httpx.AsyncClient(timeout=600.0) as client:
            response = await client.post(
                f"{settings.extractor_url}/extract",
                json=body.model_dump(),
            )
            response.raise_for_status()
            result = response.json()
        async with AsyncSessionLocal() as session:
            from sqlalchemy import text as sa_text
            await session.execute(
                sa_text("UPDATE extractor_jobs SET status='completed', result=:r, completed_at=NOW() WHERE id=:id"),
                {"r": __import__("json").dumps(result), "id": job_id},
            )
            await session.commit()
    except Exception as exc:
        async with AsyncSessionLocal() as session:
            from sqlalchemy import text as sa_text
            await session.execute(
                sa_text("UPDATE extractor_jobs SET status='failed', error_message=:e, completed_at=NOW() WHERE id=:id"),
                {"e": str(exc), "id": job_id},
            )
            await session.commit()


@app.post("/api/extract", tags=["pipeline"], dependencies=[Depends(require_internal_key)])
async def proxy_extract(body: _ExtractRequest) -> Any:
    """
    Enqueue extraction task → start Container App Job (prod) or local extractor (dev).
    Returns job_id immediately. Poll GET /api/extract/status/{job_id} for result.
    """
    job_id = await create_job("extract", body.model_dump())
    if settings.azure_subscription_id:
        await start_extractor_job(job_id)
    else:
        _spawn(_run_extraction_local(job_id, body))
    return {"job_id": job_id, "status": "processing"}


@app.get("/api/extract/status/{job_id}", tags=["pipeline"], dependencies=[Depends(require_internal_key)])
async def get_extraction_status(job_id: str) -> Any:
    """Poll extraction job status from extractor_jobs table."""
    job = await get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return {"job_id": job_id, "status": job["status"], "result": job["result"], "error": job["error_message"]}


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


async def _run_clip_local(job_id: str, body: _ClipRequest) -> None:
    """Local dev: proxy directly to sop-extractor HTTP service."""
    try:
        async with httpx.AsyncClient(timeout=1800.0) as client:
            response = await client.post(f"{settings.extractor_url}/clip", json=body.model_dump())
            response.raise_for_status()
            result = response.json()
        async with AsyncSessionLocal() as session:
            from sqlalchemy import text as sa_text
            await session.execute(
                sa_text("UPDATE extractor_jobs SET status='completed', result=:r, completed_at=NOW() WHERE id=:id"),
                {"r": __import__("json").dumps(result), "id": job_id},
            )
            await session.commit()
    except Exception as exc:
        async with AsyncSessionLocal() as session:
            from sqlalchemy import text as sa_text
            await session.execute(
                sa_text("UPDATE extractor_jobs SET status='failed', error_message=:e, completed_at=NOW() WHERE id=:id"),
                {"e": str(exc), "id": job_id},
            )
            await session.commit()


@app.post("/api/clip", tags=["pipeline"], dependencies=[Depends(require_internal_key)])
async def proxy_clip(body: _ClipRequest) -> Any:
    """Enqueue clip task → start Container App Job (prod) or local extractor (dev)."""
    job_id = await create_job("clip", body.model_dump())
    if settings.azure_subscription_id:
        await start_extractor_job(job_id)
    else:
        _spawn(_run_clip_local(job_id, body))
    return {"job_id": job_id, "status": "processing"}


@app.get("/api/clip/status/{job_id}", tags=["pipeline"], dependencies=[Depends(require_internal_key)])
async def get_clip_status(job_id: str) -> Any:
    """Poll clip job status from extractor_jobs table."""
    job = await get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return {"job_id": job_id, "status": job["status"], "result": job["result"], "error": job["error_message"]}


# ── /api/probe-video proxy ────────────────────────────────────

class _ProbeVideoRequest(BaseModel):
    video_url: str
    azure_sas_token: str
    azure_account: str
    azure_container: str


async def _run_probe_local(job_id: str, body: _ProbeVideoRequest) -> None:
    """Local dev: proxy directly to sop-extractor HTTP service."""
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(f"{settings.extractor_url}/api/probe-video", json=body.model_dump())
            response.raise_for_status()
            result = response.json()
        async with AsyncSessionLocal() as session:
            from sqlalchemy import text as sa_text
            await session.execute(
                sa_text("UPDATE extractor_jobs SET status='completed', result=:r, completed_at=NOW() WHERE id=:id"),
                {"r": __import__("json").dumps(result), "id": job_id},
            )
            await session.commit()
    except Exception as exc:
        async with AsyncSessionLocal() as session:
            from sqlalchemy import text as sa_text
            await session.execute(
                sa_text("UPDATE extractor_jobs SET status='failed', error_message=:e, completed_at=NOW() WHERE id=:id"),
                {"e": str(exc), "id": job_id},
            )
            await session.commit()


@app.post("/api/probe-video", tags=["pipeline"], dependencies=[Depends(require_internal_key)])
async def proxy_probe_video(body: _ProbeVideoRequest) -> Any:
    """Enqueue probe-video task → start Container App Job (prod) or local extractor (dev)."""
    job_id = await create_job("probe", body.model_dump())
    if settings.azure_subscription_id:
        await start_extractor_job(job_id)
    else:
        _spawn(_run_probe_local(job_id, body))
    return {"job_id": job_id, "status": "processing"}


@app.get("/api/probe-video/status/{job_id}", tags=["pipeline"], dependencies=[Depends(require_internal_key)])
async def get_probe_status(job_id: str) -> Any:
    """Poll probe-video job status from extractor_jobs table."""
    job = await get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return {"job_id": job_id, "status": job["status"], "result": job["result"], "error": job["error_message"]}


# ── /api/split-video proxy ────────────────────────────────────

class _SplitVideoRequest(BaseModel):
    video_url: str
    sop_id: str
    azure_sas_token: str
    azure_account: str
    azure_container: str
    split_target_sec: float | None = None
    search_window_sec: float = 300.0


async def _run_split_local(job_id: str, body: _SplitVideoRequest) -> None:
    """Local dev: proxy directly to sop-extractor HTTP service (with inner polling)."""
    try:
        async with httpx.AsyncClient(timeout=3600.0) as client:
            response = await client.post(f"{settings.extractor_url}/api/split-video", json=body.model_dump())
            response.raise_for_status()
            extractor_job_id = response.json()["job_id"]
            for _ in range(120):
                await asyncio.sleep(30)
                try:
                    st = await client.get(f"{settings.extractor_url}/api/split-video/status/{extractor_job_id}", timeout=15.0)
                    data = st.json()
                except Exception:
                    continue
                if data.get("status") == "done":
                    result = data["result"]
                    break
                if data.get("status") == "failed":
                    raise RuntimeError(data.get("error", "extractor split failed"))
            else:
                raise RuntimeError("timed out waiting for extractor split")
        async with AsyncSessionLocal() as session:
            from sqlalchemy import text as sa_text
            await session.execute(
                sa_text("UPDATE extractor_jobs SET status='done', result=:r, completed_at=NOW() WHERE id=:id"),
                {"r": __import__("json").dumps(result), "id": job_id},
            )
            await session.commit()
    except Exception as exc:
        async with AsyncSessionLocal() as session:
            from sqlalchemy import text as sa_text
            await session.execute(
                sa_text("UPDATE extractor_jobs SET status='failed', error_message=:e, completed_at=NOW() WHERE id=:id"),
                {"e": str(exc), "id": job_id},
            )
            await session.commit()


@app.post("/api/split-video", tags=["pipeline"], dependencies=[Depends(require_internal_key)])
async def proxy_split_video(body: _SplitVideoRequest) -> Any:
    """Enqueue split-video task → start Container App Job (prod) or local extractor (dev)."""
    job_id = await create_job("split", body.model_dump())
    if settings.azure_subscription_id:
        await start_extractor_job(job_id)
    else:
        _spawn(_run_split_local(job_id, body))
    return {"job_id": job_id, "status": "processing"}


@app.get("/api/split-video/status/{job_id}", tags=["pipeline"], dependencies=[Depends(require_internal_key)])
async def get_split_status(job_id: str) -> Any:
    """Poll split job status from extractor_jobs table."""
    job = await get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return {"job_id": job_id, "status": job["status"], "result": job["result"], "error": job["error_message"]}


class _SeedRequest(BaseModel):
    job_id: str
    result: dict


@app.post("/api/split-video/seed", tags=["pipeline"], dependencies=[Depends(require_internal_key)])
async def seed_split_result(body: _SeedRequest) -> Any:
    """Recovery: inject a known split result into extractor_jobs so a polling workflow can continue."""
    async with AsyncSessionLocal() as session:
        from sqlalchemy import text as sa_text
        import json as _json
        await session.execute(
            sa_text("UPDATE extractor_jobs SET status='done', result=:r WHERE id=:id"),
            {"r": _json.dumps(body.result), "id": body.job_id},
        )
        await session.commit()
    return {"ok": True, "job_id": body.job_id}


@app.get("/api/test-extractor", tags=["diagnostics"], dependencies=[Depends(require_internal_key)])
async def test_extractor() -> dict[str, Any]:
    """
    Verify connectivity to the sop-extractor service.
    Proxies the /health call and returns its full JSON response.
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{settings.extractor_url}/health")
            response.raise_for_status()
            return {"status": "ok", "extractor": response.json()}
    except httpx.TimeoutException:
        return {"status": "error", "detail": "extractor health check timed out after 5s"}
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}

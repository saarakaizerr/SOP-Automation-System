"""
Container App Job entry point.

The job claims the oldest queued row from extractor_jobs and processes it.
No TASK_ID env var needed — the job self-selects its work from the queue.

Required env vars (configured in the job definition, not passed at start):
  SUPABASE_URL         — Supabase project URL
  SUPABASE_SERVICE_KEY — Supabase service role key

Plus all standard extractor env vars (AZURE_*, GEMINI_API_KEY, etc.)
"""

import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

import httpx

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

# Fast tasks: expected to complete in <60s. Stale queued ones block newer requests.
_FAST_TASK_TYPES = ("render_annotated", "render_doc", "probe")
_STALE_MINUTES = 5


async def _expire_stale_fast_tasks(client: httpx.AsyncClient) -> None:
    """Mark queued fast tasks older than 5 minutes as failed so they don't block fresh requests."""
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=_STALE_MINUTES)).isoformat()
    for task_type in _FAST_TASK_TYPES:
        try:
            resp = await client.patch(
                f"{SUPABASE_URL}/rest/v1/extractor_jobs",
                params={"status": "eq.queued", "task_type": f"eq.{task_type}", "created_at": f"lt.{cutoff}"},
                json={"status": "failed", "error_message": "expired: not processed within 5 minutes"},
                headers=_HEADERS,
            )
            expired = resp.json()
            if expired:
                print(f"[job_runner] Expired {len(expired)} stale {task_type} tasks", file=sys.stderr)
        except Exception as exc:
            print(f"[job_runner] Warning: could not expire stale tasks: {exc}", file=sys.stderr)


async def _claim_task(client: httpx.AsyncClient) -> dict | None:
    """
    Claim the oldest queued extractor_jobs row atomically.
    Retries up to 30 times when another concurrent execution wins the race,
    so that 25 simultaneous executions each claim a different task rather
    than 24 of them exiting without processing anything.
    Returns the claimed row dict, or None if the queue is empty.
    """
    for _ in range(30):
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/extractor_jobs",
            params={"status": "eq.queued", "order": "created_at.asc", "limit": "1", "select": "*"},
            headers=_HEADERS,
        )
        resp.raise_for_status()
        rows = resp.json()

        if not rows:
            return None  # Queue is empty

        task_id = rows[0]["id"]

        # Mark as running only if still queued (concurrent-safe)
        patch = await client.patch(
            f"{SUPABASE_URL}/rest/v1/extractor_jobs",
            params={"id": f"eq.{task_id}", "status": "eq.queued"},
            json={"status": "running", "started_at": "NOW()"},
            headers=_HEADERS,
        )
        patch.raise_for_status()
        updated = patch.json()

        if updated:
            return updated[0]

        # Race lost — another execution claimed this task. The queue now has
        # one fewer queued item; retry immediately to claim the next oldest.
        await asyncio.sleep(0.05)

    return None


async def _update(task_id: str, status: str, result: dict = None, error: str = None) -> None:
    body: dict = {"status": status}
    if status in ("completed", "failed"):
        body["completed_at"] = "NOW()"
    if result is not None:
        body["result"] = result
    if error is not None:
        body["error_message"] = error
    async with httpx.AsyncClient(timeout=15.0) as client:
        await client.patch(
            f"{SUPABASE_URL}/rest/v1/extractor_jobs?id=eq.{task_id}",
            json=body,
            headers=_HEADERS,
        )


async def main() -> None:
    async with httpx.AsyncClient(timeout=15.0) as client:
        await _expire_stale_fast_tasks(client)
        task = await _claim_task(client)

    if not task:
        print("[job_runner] No queued tasks found — exiting cleanly", file=sys.stderr)
        sys.exit(0)

    task_id = task["id"]
    task_type = task["task_type"]
    params = task["input_params"]

    print(f"[job_runner] Claimed task_type={task_type} task_id={task_id}")

    try:
        if task_type == "extract":
            from app.handlers.extract import run_extract
            result = await asyncio.to_thread(run_extract, **params)

        elif task_type == "clip":
            from app.handlers.clip import run_clip
            result = await asyncio.to_thread(run_clip, **params)

        elif task_type == "split":
            from app.handlers.split import run_split
            result = await asyncio.to_thread(run_split, **params)

        elif task_type == "probe":
            from app.handlers.probe import run_probe
            result = await asyncio.to_thread(run_probe, **params)

        elif task_type == "render_annotated":
            from app.handlers.render_annotated import run_render_annotated
            result = await asyncio.to_thread(run_render_annotated, **params)

        elif task_type == "render_doc":
            from app.handlers.render_doc import run_render_doc
            result = await asyncio.to_thread(run_render_doc, **params)

        else:
            raise ValueError(f"Unknown task_type: {task_type!r}")

        await _update(task_id, "completed", result=result)
        print(f"[job_runner] Completed successfully")
        sys.exit(0)

    except Exception as exc:
        await _update(task_id, "failed", error=str(exc))
        print(f"[job_runner] FAILED: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())

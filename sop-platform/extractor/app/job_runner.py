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

import httpx

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}


async def _claim_task() -> dict | None:
    """
    Claim the oldest queued extractor_jobs row atomically.
    Returns the row dict, or None if no queued tasks exist.
    """
    async with httpx.AsyncClient(timeout=15.0) as client:
        # Fetch oldest queued row
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/extractor_jobs",
            params={"status": "eq.queued", "order": "created_at.asc", "limit": "1", "select": "*"},
            headers=_HEADERS,
        )
        resp.raise_for_status()
        rows = resp.json()

    if not rows:
        return None

    row = rows[0]
    task_id = row["id"]

    # Mark as running — only succeeds if still queued (concurrent-safe check)
    async with httpx.AsyncClient(timeout=15.0) as client:
        patch = await client.patch(
            f"{SUPABASE_URL}/rest/v1/extractor_jobs",
            params={"id": f"eq.{task_id}", "status": "eq.queued"},
            json={"status": "running", "started_at": "NOW()"},
            headers=_HEADERS,
        )
        patch.raise_for_status()
        updated = patch.json()

    if not updated:
        # Another job instance grabbed this task first
        return None

    return updated[0]


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
    task = await _claim_task()
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

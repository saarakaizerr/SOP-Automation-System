"""Extract handler — full frame extraction pipeline."""

import logging
import os
import tempfile
import time
from pathlib import Path
from typing import Optional

import requests

from app.handlers.helpers import download_file, upload_to_azure_blob
from app.scene_detector import extract_frames

logger = logging.getLogger(__name__)

_ENV_SUPABASE_URL = os.environ.get("SUPABASE_URL")
_ENV_SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")


def run_extract(
    sop_id: str,
    video_url: str,
    screen_share_periods: list,
    azure_sas_token: str,
    azure_account: str,
    azure_container: str,
    pyscenedetect_threshold: float = 3.0,
    min_scene_len_sec: float = 2.0,
    dedup_hash_threshold: int = 8,
    frame_offset_sec: float = 1.5,
    fallback_interval_sec: float = 120.0,
    supabase_url: Optional[str] = None,
    supabase_service_key: Optional[str] = None,
    pipeline_run_id: Optional[str] = None,
    **_: object,
) -> dict:
    """
    Full frame extraction pipeline: download → scene detect → dedup → upload to Azure.
    screen_share_periods: list of {start_time, end_time, crop: {x,y,w,h}} dicts.
    Returns {"sop_id", "frames": [...], "stats": {...}}.
    """
    with tempfile.TemporaryDirectory(prefix=f"sop_{sop_id}_", dir="/data") as tmp_str:
        tmp_dir = Path(tmp_str)
        video_path = tmp_dir / "original.mp4"

        logger.info("Downloading video for sop_id=%s", sop_id)
        download_file(video_url, video_path)
        logger.info("Download complete: %.1f MB", video_path.stat().st_size / 1_048_576)

        all_frames = extract_frames(
            video_path=video_path,
            screen_share_periods=screen_share_periods,
            tmp_dir=tmp_dir,
            pyscenedetect_threshold=pyscenedetect_threshold,
            min_scene_len_sec=min_scene_len_sec,
            dedup_hash_threshold=dedup_hash_threshold,
            frame_offset_sec=frame_offset_sec,
            fallback_interval_sec=fallback_interval_sec,
        )

        raw_scenes = len(all_frames)
        useful_frames = [f for f in all_frames if f.classification == "USEFUL"]
        after_dedup = len(useful_frames)

        logger.info(
            "sop_id=%s  raw=%d  after_dedup=%d  periods=%d",
            sop_id, raw_scenes, after_dedup, len(screen_share_periods),
        )

        frame_results = []
        for frame in useful_frames:
            blob_path = f"{sop_id}/frames/frame_{frame.frame_num:03d}.png"
            azure_base_url = (
                f"https://{azure_account}.blob.core.windows.net"
                f"/{azure_container}/{blob_path}"
            )
            upload_to_azure_blob(frame.local_path, f"{azure_base_url}?{azure_sas_token}")
            logger.info("Uploaded frame %d → %s", frame.frame_num, blob_path)

            frame_results.append({
                "frame_num": frame.frame_num,
                "timestamp_sec": frame.timestamp_sec,
                "scene_score": frame.scene_score,
                "classification": frame.classification,
                "azure_url": azure_base_url,
                "width": frame.width,
                "height": frame.height,
            })

        result = {
            "sop_id": sop_id,
            "frames": frame_results,
            "stats": {
                "raw_scenes": raw_scenes,
                "after_dedup": after_dedup,
                "periods_processed": len(screen_share_periods),
            },
        }

        resolved_supabase_url = supabase_url or _ENV_SUPABASE_URL
        resolved_supabase_key = supabase_service_key or _ENV_SUPABASE_SERVICE_KEY
        if resolved_supabase_url and resolved_supabase_key and frame_results:
            _write_steps_to_supabase(
                sop_id, pipeline_run_id, frame_results, result["stats"],
                resolved_supabase_url, resolved_supabase_key,
            )

        return result


def _write_steps_to_supabase(
    sop_id: str,
    pipeline_run_id: Optional[str],
    frame_results: list,
    stats: dict,
    supabase_url: str,
    supabase_key: str,
) -> None:
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    steps = [
        {
            "sop_id": sop_id,
            "sequence": idx + 1,
            "title": f"Step {idx + 1}",
            "timestamp_start": frame["timestamp_sec"],
            "screenshot_url": frame["azure_url"],
            "screenshot_width": frame["width"],
            "screenshot_height": frame["height"],
            "scene_score": frame["scene_score"],
            "frame_classification": frame["classification"].lower(),
        }
        for idx, frame in enumerate(frame_results)
    ]

    chunk_size = 20
    inserted = 0
    for i in range(0, len(steps), chunk_size):
        chunk = steps[i : i + chunk_size]
        for attempt in range(3):
            try:
                resp = requests.post(
                    f"{supabase_url}/rest/v1/sop_steps",
                    json=chunk,
                    headers=headers,
                    timeout=30,
                )
                if resp.ok:
                    inserted += len(chunk)
                    break
                logger.error("Supabase step insert chunk %d failed (attempt %d): %s",
                             i // chunk_size, attempt + 1, resp.text[:300])
            except Exception as exc:
                logger.error("Supabase step insert chunk %d error (attempt %d): %s",
                             i // chunk_size, attempt + 1, exc)
            if attempt < 2:
                time.sleep(2)
    logger.info("Supabase: inserted %d/%d steps for sop_id=%s", inserted, len(steps), sop_id)

    run_id = pipeline_run_id
    if not run_id:
        try:
            lookup = requests.get(
                f"{supabase_url}/rest/v1/pipeline_runs",
                params={"sop_id": f"eq.{sop_id}", "select": "id", "limit": "1"},
                headers=headers,
                timeout=10,
            )
            if lookup.ok and lookup.json():
                run_id = lookup.json()[0]["id"]
                logger.info("Resolved pipeline_run_id=%s for sop_id=%s", run_id, sop_id)
        except Exception as exc:
            logger.error("pipeline_run_id lookup failed: %s", exc)

    if run_id:
        patch_resp = requests.patch(
            f"{supabase_url}/rest/v1/pipeline_runs",
            params={"id": f"eq.{run_id}"},
            json={
                "status": "classifying_frames",
                "current_stage": "frame_extraction_complete",
                "stage_results": {"frame_extraction": stats},
            },
            headers=headers,
            timeout=15,
        )
        if not patch_resp.ok:
            logger.error("Supabase pipeline_run update failed: %s", patch_resp.text[:300])
        else:
            logger.info("Supabase: pipeline_run %s → classifying_frames", run_id)

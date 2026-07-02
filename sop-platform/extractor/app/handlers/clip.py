"""Clip handler — per-step MP4 clip cutting."""

import logging
import subprocess
import tempfile
from pathlib import Path

from app.handlers.helpers import download_file, upload_to_azure_blob_video

logger = logging.getLogger(__name__)


def run_clip(
    sop_id: str,
    video_url: str,
    clips: list,
    azure_sas_token: str,
    azure_account: str,
    azure_container: str,
    **_: object,
) -> dict:
    """
    Download video once, cut per-step clips, upload to Azure Blob.
    clips: list of {step_id, sequence, start_sec, end_sec} dicts.
    Returns {"sop_id", "clips": [{step_id, sequence, clip_url, duration_sec, file_size_bytes}], "clips_created"}.
    """
    with tempfile.TemporaryDirectory(prefix=f"sop_clips_{sop_id}_", dir="/data") as tmp_str:
        tmp_dir = Path(tmp_str)
        video_path = tmp_dir / "original.mp4"

        logger.info("Downloading video for clip job sop_id=%s (%d clips)", sop_id, len(clips))
        download_file(video_url, video_path)
        logger.info("Download complete: %.1f MB", video_path.stat().st_size / 1_048_576)

        clip_results = []
        for clip_def in clips:
            step_id = clip_def["step_id"]
            sequence = clip_def["sequence"]
            start_sec = clip_def["start_sec"]
            end_sec = clip_def["end_sec"]

            seq_str = f"{sequence:03d}"
            clip_filename = f"clip_{seq_str}.mp4"
            clip_path = tmp_dir / clip_filename

            cmd = [
                "ffmpeg", "-y",
                "-ss", str(start_sec),
                "-to", str(end_sec),
                "-i", str(video_path),
                "-c", "copy",
                "-avoid_negative_ts", "make_zero",
                str(clip_path),
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if result.returncode != 0:
                raise RuntimeError(
                    f"FFmpeg clip failed for step {step_id} "
                    f"(seq={sequence}): {result.stderr[-500:]}"
                )

            blob_path = f"{sop_id}/clips/{clip_filename}"
            azure_base_url = (
                f"https://{azure_account}.blob.core.windows.net"
                f"/{azure_container}/{blob_path}"
            )
            upload_to_azure_blob_video(clip_path, f"{azure_base_url}?{azure_sas_token}")
            logger.info("Uploaded clip_%s → %s", seq_str, blob_path)

            clip_results.append({
                "step_id": step_id,
                "sequence": sequence,
                "clip_url": azure_base_url,
                "duration_sec": round(end_sec - start_sec),
                "file_size_bytes": clip_path.stat().st_size,
            })

        return {
            "sop_id": sop_id,
            "clips": clip_results,
            "clips_created": len(clip_results),
        }

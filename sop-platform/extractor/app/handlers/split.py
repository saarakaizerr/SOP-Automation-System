"""Split handler — video splitting at nearest keyframe."""

import logging
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

from app.handlers.helpers import download_file, upload_to_azure_blob_video

logger = logging.getLogger(__name__)


def _probe_duration(video_path: Path) -> float:
    cmd = ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
           "-of", "csv=p=0", str(video_path)]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    return float(result.stdout.strip())


def _find_split_keyframe(video_path: Path, target_sec: float, window_sec: float) -> float:
    cmd = [
        "ffprobe", "-v", "quiet",
        "-select_streams", "v",
        "-skip_frame", "nokey",
        "-show_entries", "frame=pkt_pts_time",
        "-of", "csv=p=0",
        str(video_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0 or not result.stdout.strip():
        logger.warning("ffprobe keyframe list failed — using exact target_sec")
        return target_sec

    keyframes = []
    for line in result.stdout.strip().split("\n"):
        try:
            keyframes.append(float(line.strip()))
        except ValueError:
            continue

    candidates = [t for t in keyframes if abs(t - target_sec) <= window_sec]
    if not candidates:
        logger.warning("No keyframe within window — using exact target_sec")
        return target_sec
    return min(candidates, key=lambda t: abs(t - target_sec))


def run_split(
    video_url: str,
    sop_id: str,
    azure_sas_token: str,
    azure_account: str,
    azure_container: str,
    split_target_sec: Optional[float] = None,
    search_window_sec: float = 300.0,
    **_: object,
) -> dict:
    """
    Download video, split at nearest keyframe, upload both parts.
    Returns {"part1_url", "part1_duration_sec", "part2_url", "part2_duration_sec", "actual_split_sec"}.
    """
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        video_path = tmp_dir / "full.mp4"
        part1_path = tmp_dir / "part1.mp4"
        part2_path = tmp_dir / "part2.mp4"

        logger.info("Downloading full video for split: sop_id=%s", sop_id)
        download_file(video_url, video_path)

        duration = _probe_duration(video_path)
        target_sec = split_target_sec if split_target_sec is not None else duration / 2
        split_sec = _find_split_keyframe(video_path, target_sec, search_window_sec)
        logger.info("Splitting at %.1fs (target=%.1fs, duration=%.1fs)", split_sec, target_sec, duration)

        r1 = subprocess.run(
            ["ffmpeg", "-y", "-ss", "0", "-to", str(split_sec),
             "-i", str(video_path), "-c", "copy", str(part1_path)],
            capture_output=True, text=True, timeout=600,
        )
        if r1.returncode != 0:
            raise RuntimeError(f"FFmpeg part1 failed: {r1.stderr[-500:]}")

        r2 = subprocess.run(
            ["ffmpeg", "-y", "-ss", str(split_sec),
             "-i", str(video_path), "-c", "copy", str(part2_path)],
            capture_output=True, text=True, timeout=600,
        )
        if r2.returncode != 0:
            raise RuntimeError(f"FFmpeg part2 failed: {r2.stderr[-500:]}")

        part1_dur = int(_probe_duration(part1_path))
        part2_dur = int(_probe_duration(part2_path))

        azure_base = f"https://{azure_account}.blob.core.windows.net/{azure_container}"
        p1_blob = f"{sop_id}/parts/part1.mp4"
        p2_blob = f"{sop_id}/parts/part2.mp4"

        logger.info("Uploading part1 (%ds) → %s", part1_dur, p1_blob)
        upload_to_azure_blob_video(part1_path, f"{azure_base}/{p1_blob}?{azure_sas_token}")
        logger.info("Uploading part2 (%ds) → %s", part2_dur, p2_blob)
        upload_to_azure_blob_video(part2_path, f"{azure_base}/{p2_blob}?{azure_sas_token}")

        return {
            "part1_url": f"{azure_base}/{p1_blob}",
            "part1_duration_sec": part1_dur,
            "part2_url": f"{azure_base}/{p2_blob}",
            "part2_duration_sec": part2_dur,
            "actual_split_sec": split_sec,
        }

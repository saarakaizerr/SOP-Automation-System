"""Probe handler — ffprobe video duration + dimensions."""

import json
import logging
import subprocess
from typing import Optional

logger = logging.getLogger(__name__)


def run_probe(
    video_url: str,
    azure_sas_token: str = "",
    azure_account: str = "",
    azure_container: str = "",
    **_: object,
) -> dict:
    """
    Probe video duration and dimensions via ffprobe HTTP range requests.
    Returns {"duration_sec": int, "width": int|None, "height": int|None}.
    """
    cmd = [
        "ffprobe", "-v", "quiet",
        "-show_entries", "format=duration",
        "-show_entries", "stream=width,height",
        "-of", "json",
        video_url,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr[-300:]}")

    data = json.loads(result.stdout)
    duration = float(data["format"]["duration"])
    streams = data.get("streams", [])
    width: Optional[int] = next((s.get("width") for s in streams if s.get("width")), None)
    height: Optional[int] = next((s.get("height") for s in streams if s.get("height")), None)

    return {
        "duration_sec": int(duration),
        "width": width,
        "height": height,
    }

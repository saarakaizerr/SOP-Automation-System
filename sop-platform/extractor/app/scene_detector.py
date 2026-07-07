"""
Frame extraction pipeline for KT session videos (Phase 3).

Stages per screen-share period:
  1. FFmpeg  — crop video to screen-share bounding box, trim to period window
  2. PySceneDetect — AdaptiveDetector finds scene boundaries
  3. Frame capture — extract one PNG per scene at T + frame_offset_sec
  4. imagehash phash — perceptual dedup, Hamming distance threshold 8
"""

import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path

import imagehash
from PIL import Image
from scenedetect import SceneManager, open_video
from scenedetect.detectors import AdaptiveDetector

logger = logging.getLogger(__name__)


@dataclass
class ExtractedFrame:
    frame_num: int        # Global sequential number across all periods (1-based)
    period_idx: int       # Index into screen_share_periods array
    timestamp_sec: float  # Absolute position in the original (un-cropped) video
    scene_score: float    # Placeholder — Gemini classifies in Phase 4
    classification: str   # 'USEFUL' or 'DUPLICATE'
    local_path: Path      # Absolute path to PNG in temp directory
    width: int
    height: int


def extract_frames(
    video_path: Path,
    screen_share_periods: list[dict],
    tmp_dir: Path,
    pyscenedetect_threshold: float = 3.0,
    min_scene_len_sec: float = 2.0,
    dedup_hash_threshold: int = 8,
    frame_offset_sec: float = 1.5,
    fallback_interval_sec: float = 120.0,
    min_useful_gap_sec: float = 4.0,
) -> list[ExtractedFrame]:
    """
    Run the full frame extraction pipeline across all screen-share periods.

    Returns every attempted frame (USEFUL + DUPLICATE) so the caller can
    report stats. Upload logic should filter for classification == 'USEFUL'.
    """
    all_frames: list[ExtractedFrame] = []
    seen_hashes: list[imagehash.ImageHash] = []
    global_frame_num = 0
    last_useful_ts: float = -999.0

    video_w, video_h = _get_video_dimensions(video_path)
    logger.info("Video dimensions: %dx%d", video_w, video_h)

    for period_idx, period in enumerate(screen_share_periods):
        start_time = float(period["start_time"])
        end_time = float(period["end_time"])
        crop = period["crop"]
        x, y, w, h = int(crop["x"]), int(crop["y"]), int(crop["w"]), int(crop["h"])

        # Clamp crop to actual video bounds (WF1 coords may differ from stored video resolution)
        x = max(0, min(x, video_w - 2))
        y = max(0, min(y, video_h - 2))
        w = max(2, min(w, video_w - x))
        h = max(2, min(h, video_h - y))
        # x264 requires even dimensions
        w = w - (w % 2)
        h = h - (h % 2)

        logger.info(
            "Period %d: %.1fs–%.1fs  crop %dx%d+%d+%d",
            period_idx, start_time, end_time, w, h, x, y,
        )

        # Stage 1 — FFmpeg crop + trim
        segment_path = tmp_dir / f"period_{period_idx}.mp4"
        _ffmpeg_crop_segment(video_path, segment_path, start_time, end_time, x, y, w, h)

        # Stage 2 — PySceneDetect + time-based fallback
        scenes = _detect_scenes(segment_path, pyscenedetect_threshold, min_scene_len_sec)
        logger.info("Period %d: %d scenes detected", period_idx, len(scenes))
        segment_duration = end_time - start_time
        scenes = _fill_time_gaps(scenes, segment_duration, fallback_interval_sec)

        # Stage 3 + 4 — Extract frame per scene, then dedup
        period_frames_before = len(all_frames)
        for scene_start_sec, scene_end_sec in scenes:
            # Clamp T+offset so it stays inside the scene window
            target_sec = min(scene_start_sec + frame_offset_sec, scene_end_sec - 0.05)
            if target_sec < 0:
                target_sec = scene_start_sec

            global_frame_num += 1
            frame_path = tmp_dir / f"frame_{global_frame_num:03d}.png"

            if not _extract_single_frame(segment_path, target_sec, frame_path):
                logger.warning("Frame %d extraction failed — skipping", global_frame_num)
                global_frame_num -= 1
                continue

            img = Image.open(frame_path).convert("RGB")
            width, height = img.size

            # Strip the Teams screen-share name badge (bottom ~40 px overlay)
            _TEAMS_BADGE_PX = 40
            if height > _TEAMS_BADGE_PX * 3:
                img = img.crop((0, 0, width, height - _TEAMS_BADGE_PX))
                img.save(frame_path)
                width, height = img.size

            phash = imagehash.phash(img)
            img.close()

            # Absolute timestamp = period start + offset within segment
            absolute_ts = round(start_time + target_sec, 2)

            # Stage 4 — perceptual dedup
            is_duplicate = any(
                abs(phash - existing) <= dedup_hash_threshold
                for existing in seen_hashes
            )
            # Time-based dedup: skip frames too close to the last useful frame
            # catches typing sequences, loading states, rapid cursor movement
            if not is_duplicate and (absolute_ts - last_useful_ts) < min_useful_gap_sec:
                is_duplicate = True

            classification = "DUPLICATE" if is_duplicate else "USEFUL"
            if not is_duplicate:
                seen_hashes.append(phash)
                last_useful_ts = absolute_ts

            all_frames.append(ExtractedFrame(
                frame_num=global_frame_num,
                period_idx=period_idx,
                timestamp_sec=absolute_ts,
                scene_score=0.0,  # Gemini classification in Phase 4
                classification=classification,
                local_path=frame_path,
                width=width,
                height=height,
            ))

        # Free disk space — segment file is no longer needed after frame extraction
        try:
            segment_path.unlink()
            logger.info("Period %d: deleted segment file, extracted %d frames",
                        period_idx, len(all_frames) - period_frames_before)
        except OSError as exc:
            logger.warning("Could not delete segment file %s: %s", segment_path, exc)

    return all_frames


# ── FFmpeg helpers ────────────────────────────────────────────────────────────

def _ffmpeg_crop_segment(
    input_path: Path,
    output_path: Path,
    start_sec: float,
    end_sec: float,
    x: int, y: int, w: int, h: int,
) -> None:
    """
    Fast-seek to start_sec, then trim and crop to the screen-share bounding box.
    Uses ultrafast preset — output is a temp file, compression quality irrelevant.
    """
    duration = end_sec - start_sec
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start_sec),           # Fast seek (keyframe-accurate, before -i)
        "-i", str(input_path),
        "-t", str(duration),
        "-vf", f"crop={w}:{h}:{x}:{y}",
        "-an",                            # Drop audio
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "23",
        "-avoid_negative_ts", "make_zero",
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
    if result.returncode != 0:
        raise RuntimeError(
            f"FFmpeg crop failed for period {output_path.name}:\n{result.stderr[-800:]}"
        )


def _get_video_dimensions(video_path: Path) -> tuple[int, int]:
    """Return (width, height) of the first video stream via ffprobe."""
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "csv=p=0",
            str(video_path),
        ],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode == 0 and result.stdout.strip():
        parts = result.stdout.strip().split(",")
        if len(parts) >= 2:
            return int(parts[0]), int(parts[1])
    logger.warning("Could not probe video dimensions, assuming 1920x1080")
    return 1920, 1080


def _extract_single_frame(
    video_path: Path,
    timestamp_sec: float,
    output_path: Path,
) -> bool:
    """
    Extract one frame from video_path at timestamp_sec → output_path (PNG).
    Returns True on success, False if FFmpeg fails or output not created.
    """
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(timestamp_sec),
        "-i", str(video_path),
        "-vframes", "1",
        "-q:v", "2",
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    success = result.returncode == 0 and output_path.exists() and output_path.stat().st_size > 0
    if not success:
        logger.error(
            "FFmpeg frame extract failed at %.2fs (rc=%d): %s",
            timestamp_sec, result.returncode, result.stderr[-500:],
        )
    return success


# ── Time-based fallback ───────────────────────────────────────────────────────

def _fill_time_gaps(
    scenes: list[tuple[float, float]],
    segment_duration: float,
    fallback_interval_sec: float,
) -> list[tuple[float, float]]:
    """
    Insert synthetic scenes at regular intervals where PySceneDetect found no change.
    A forced frame is added at every fallback_interval_sec mark that has no existing
    scene start within half an interval. Ensures coverage of long static screens.
    """
    if fallback_interval_sec <= 0 or segment_duration <= 0:
        return scenes

    scene_starts = [start for start, _ in scenes]
    half = fallback_interval_sec / 2.0

    forced = []
    t = fallback_interval_sec
    while t < segment_duration:
        if not any(abs(ts - t) <= half for ts in scene_starts):
            syn_start = max(0.0, t - 1.0)
            syn_end = min(segment_duration, t + 1.0)
            forced.append((syn_start, syn_end))
        t += fallback_interval_sec

    if forced:
        logger.info(
            "Time-based fallback: added %d forced frames across %.0fs segment",
            len(forced), segment_duration,
        )

    return sorted(scenes + forced, key=lambda s: s[0])


# ── PySceneDetect helper ──────────────────────────────────────────────────────

def _detect_scenes(
    video_path: Path,
    adaptive_threshold: float,
    min_scene_len_sec: float,
) -> list[tuple[float, float]]:
    """
    Run AdaptiveDetector on video_path.
    Returns list of (start_sec, end_sec) for each detected scene.
    """
    video = open_video(str(video_path))
    fps = video.frame_rate or 25.0
    min_scene_len_frames = max(1, int(min_scene_len_sec * fps))

    scene_manager = SceneManager()
    scene_manager.add_detector(
        AdaptiveDetector(
            adaptive_threshold=adaptive_threshold,
            min_scene_len=min_scene_len_frames,
        )
    )
    scene_manager.detect_scenes(video, show_progress=False)
    scene_list = scene_manager.get_scene_list()

    return [
        (start_tc.get_seconds(), end_tc.get_seconds())
        for start_tc, end_tc in scene_list
    ]

"""
Phase 8: Re-render annotated screenshot PNG with callout annotations.
Style: pentagon/arrow badge — matches the annotation editor canvas shape.
Uses Pillow — already in requirements.txt (Pillow==10.4.0).
"""

import io
import logging
import math
import tempfile
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

# Badge base dimensions (canvas px — matches the editor's Konva shape exactly)
# Main pentagon:      w=38  h=28  tip=13
# Highlight pentagon: w=46  h=34  tip=16  (white fill, red border; tip=16 preserves same slope as main)
BADGE_TEXT   = (255, 255, 255)
BADGE_HL_CLR = (220, 38, 38)     # red #DC2626 — selection indicator border
FONT_SIZE    = 12                # matches editor fontSize=12

BOX_COLOR_MAP = {
    'yellow': (234, 179, 8),
    'red':    (220, 38, 38),
    'green':  (22, 163, 74),
    'blue':   (37, 99, 235),
}


def _draw_highlight_boxes(img: Image.Image, boxes: list[dict]) -> Image.Image:
    """Draw semi-transparent highlight boxes using an RGBA overlay."""
    if not boxes:
        return img
    img_rgba = img.convert('RGBA')
    overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    iw, ih = img.size
    for box in boxes:
        rgb = BOX_COLOR_MAP.get(box.get('color', 'yellow'), (234, 179, 8))
        x, y, w, h = int(box.get('x', 0)), int(box.get('y', 0)), int(box.get('w', 0)), int(box.get('h', 0))
        x2, y2 = min(x + w, iw), min(y + h, ih)
        if x2 <= x or y2 <= y:
            continue
        draw.rectangle([x, y, x2, y2], fill=None, outline=(*rgb, 240), width=4)
    result = Image.alpha_composite(img_rgba, overlay)
    return result.convert('RGB')


def _rotate_pt(px: float, py: float, cx: float, cy: float, angle_deg: float):
    rad = math.radians(angle_deg)
    cos_a, sin_a = math.cos(rad), math.sin(rad)
    dx, dy = px - cx, py - cy
    return cx + dx * cos_a - dy * sin_a, cy + dx * sin_a + dy * cos_a


def _badge_scale(img_w: int, img_h: int) -> float:
    """
    Scale badge so it appears the same relative size as in the editor.
    The editor renders badges at 38×28 canvas px on a stage that is roughly
    img_width/2.28 wide (for a typical 1920 px screen recording displayed in
    an ~840 px canvas panel).  We reproduce that ratio using image dimensions.
    """
    return max(1.0, min(img_w, img_h) / 474)


def _pentagon_pts(
    cx: float, cy: float,
    w: float, h: float, tip: float,
    scale: float, rotation: float,
) -> list[tuple[float, float]]:
    """Return scaled + rotated pentagon vertices centred at (cx, cy)."""
    hw, hh, t = w * scale / 2, h * scale / 2, tip * scale
    raw = [
        (cx - hw,         cy - hh),
        (cx + hw - t,     cy - hh),
        (cx + hw,         cy),
        (cx + hw - t,     cy + hh),
        (cx - hw,         cy + hh),
    ]
    if rotation:
        return [_rotate_pt(px, py, cx, cy, rotation) for px, py in raw]
    return raw


def _callout_fill(confidence: str | None, was_repositioned: bool) -> tuple[int, int, int]:
    if was_repositioned:
        return (59, 130, 246)    # blue  — repositioned
    if confidence in ('ocr_exact', 'ocr_fuzzy'):
        return (16, 185, 129)    # green — ocr match
    return (245, 158, 11)        # amber — gemini


def _draw_callout(
    img: Image.Image,
    draw: ImageDraw.Draw,
    cx: int,
    cy: int,
    number: int,
    rotation: float = 0.0,
    confidence: str | None = None,
    was_repositioned: bool = False,
) -> None:
    """
    Draw a callout badge matching the editor's visual exactly:
    1. Highlight pentagon (white fill, blue border) — replicates the selected state
    2. Main pentagon on top (colour based on confidence)
    3. White bold number centred in the badge
    Sizes are scaled to match the editor's canvas-to-image ratio.
    """
    iw, ih = img.size
    scale = _badge_scale(iw, ih)

    # Clamp centre so the badge stays inside the image
    margin = int(25 * scale)
    bx = float(min(max(margin, cx), iw - margin))
    by = float(min(max(margin, cy), ih - margin))

    # 1 — Highlight (active selection style): w=46 h=34 tip=16, white fill, red border
    # tip=16 keeps same diagonal slope as main pentagon (hh/tip = 14/13 = 17/16.something ≈ 16)
    hl_pts = _pentagon_pts(bx, by, 46, 34, 16, scale, rotation)
    border_w = max(2, int(3 * scale))
    draw.polygon(hl_pts, fill=(255, 255, 255), outline=BADGE_HL_CLR, width=border_w)

    # 2 — Main pentagon: w=38 h=28 tip=13, confidence-based fill
    fill = _callout_fill(confidence, was_repositioned)
    main_pts = _pentagon_pts(bx, by, 38, 28, 13, scale, rotation)
    draw.polygon(main_pts, fill=fill)

    # 3 — Number text: bold, white, centred
    text = str(number)
    font_size = max(10, int(FONT_SIZE * scale))
    try:
        font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size
        )
    except (IOError, OSError):
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    # Mirror editor: offsetX=7 offsetY=6 (scaled), arrow tip is on the right
    hw_scaled = 19 * scale
    tx = bx - hw_scaled / 2 - tw / 2 + 2 * scale
    ty = by - th / 2
    if rotation:
        tx, ty = _rotate_pt(tx + tw / 2, ty + th / 2, bx, by, rotation)
        tx -= tw / 2
        ty -= th / 2
    draw.text((tx, ty), text, fill=BADGE_TEXT, font=font)


def render_annotated(
    step_id: str,
    screenshot_url: str,
    callouts: list[dict],          # [{"number": 1, "target_x": 23, "target_y": 14}, ...]
    azure_blob_base_url: str,      # e.g. https://cnavinfsop.blob.core.windows.net/infsop
    azure_sas_token: str,
    highlight_boxes: list[dict] | None = None,
) -> str:
    """
    Download screenshot → draw callout circles → upload PNG to Azure.
    Returns the Azure base URL (no SAS) of the uploaded annotated PNG.
    """
    # 1. Download screenshot
    logger.info("Downloading screenshot for step_id=%s", step_id)
    resp = requests.get(screenshot_url, timeout=30)
    resp.raise_for_status()
    img = Image.open(io.BytesIO(resp.content)).convert("RGB")
    w, h = img.size

    # Draw highlight boxes before callouts (so callouts render on top)
    if highlight_boxes:
        img = _draw_highlight_boxes(img, highlight_boxes)

    # 2. Draw callouts
    draw = ImageDraw.Draw(img)
    for c in callouts:
        cx = min(max(0, c["target_x"]), w)
        cy = min(max(0, c["target_y"]), h)
        _draw_callout(
            img, draw, cx, cy, c["number"],
            rotation=float(c.get("rotation", 0.0)),
            confidence=c.get("confidence"),
            was_repositioned=bool(c.get("was_repositioned", False)),
        )
        logger.debug("Drew callout #%d at (%d, %d)", c["number"], cx, cy)

    # 3. Save to temp file
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    img.save(tmp_path, format="PNG")
    logger.info("Annotated PNG saved: %s (%.1f KB)", tmp_path, tmp_path.stat().st_size / 1024)

    # 4. Upload to Azure Blob: {step_id}/annotated.png
    blob_path = f"{step_id}/annotated.png"
    azure_base_url = f"{azure_blob_base_url.rstrip('/')}/{blob_path}"
    upload_url = f"{azure_base_url}?{azure_sas_token}"

    with open(tmp_path, "rb") as f:
        data = f.read()
    put_resp = requests.put(
        upload_url,
        data=data,
        headers={
            "x-ms-blob-type": "BlockBlob",
            "Content-Type": "image/png",
        },
        timeout=30,
    )
    put_resp.raise_for_status()
    tmp_path.unlink(missing_ok=True)

    logger.info("Uploaded annotated PNG → %s", azure_base_url)
    return azure_base_url  # No SAS — safe for Supabase storage

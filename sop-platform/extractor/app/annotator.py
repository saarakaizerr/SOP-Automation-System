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

# Styling — matches the editor's green pentagon badge (ocr_exact default)
BADGE_FILL  = (16, 185, 129)    # green (#10b981) — matches ocr_exact callout colour
BADGE_TEXT  = (255, 255, 255)   # white number
BADGE_W     = 38                # badge width (px at render resolution)
BADGE_H     = 28                # badge height
BADGE_TIP   = 13                # arrow tip extension
FONT_SIZE   = 15

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
    """Rotate point (px, py) around centre (cx, cy) by angle_deg degrees."""
    rad = math.radians(angle_deg)
    cos_a, sin_a = math.cos(rad), math.sin(rad)
    dx, dy = px - cx, py - cy
    return cx + dx * cos_a - dy * sin_a, cy + dx * sin_a + dy * cos_a


def _draw_callout(
    img: Image.Image,
    draw: ImageDraw.Draw,
    cx: int,
    cy: int,
    number: int,
    rotation: float = 0.0,
) -> None:
    """
    Draw a rotated pentagon/arrow badge at (cx, cy) — matches the editor canvas shape.
    rotation is in degrees (0 = arrow points right, 90 = down, 180 = left, 270 = up).
    """
    iw, ih = img.size
    hw = BADGE_W // 2
    hh = BADGE_H // 2
    tip = BADGE_TIP

    # Clamp centre so badge stays inside image
    bx = float(min(max(hw + 2, cx), iw - hw - 2))
    by = float(min(max(hh + 2, cy), ih - hh - 2))

    # Pentagon vertices centred on (bx, by), arrow tip points right at 0°
    raw_pts = [
        (bx - hw,         by - hh),
        (bx + hw - tip,   by - hh),
        (bx + hw,         by),
        (bx + hw - tip,   by + hh),
        (bx - hw,         by + hh),
    ]
    pts = [_rotate_pt(px, py, bx, by, rotation) for px, py in raw_pts]
    draw.polygon(pts, fill=BADGE_FILL)

    # Number centred at (bx, by), also rotated — use a small sub-image for text rotation
    text = str(number)
    try:
        font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", FONT_SIZE
        )
    except (IOError, OSError):
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    # Draw text at unrotated position — for 0° rotation just centre it
    tx, ty = bx - hw // 2 - tw // 2 + 2, by - th // 2
    if rotation:
        tx_r, ty_r = _rotate_pt(tx + tw / 2, ty + th / 2, bx, by, rotation)
        tx, ty = tx_r - tw / 2, ty_r - th / 2
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
        # target_x/y are raw pixel coordinates from the pipeline
        cx = min(max(0, c["target_x"]), w)
        cy = min(max(0, c["target_y"]), h)
        rotation = float(c.get("rotation", 0.0))
        _draw_callout(img, draw, cx, cy, c["number"], rotation)
        logger.debug("Drew callout #%d at (%d, %d) rot=%.1f°", c["number"], cx, cy, rotation)

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

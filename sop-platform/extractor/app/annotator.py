"""
Phase 8: Re-render annotated screenshot PNG with callout annotations.
Style: pentagon/arrow badge — matches the annotation editor canvas shape.
Uses Pillow — already in requirements.txt (Pillow==10.4.0).
"""

import io
import logging
import tempfile
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

# Callout badge styling — red-bordered rectangle with white fill
BADGE_FILL    = (255, 255, 255)   # white background
BADGE_BORDER  = (220, 38, 38)     # red border  (#DC2626)
BADGE_TEXT_C  = (220, 38, 38)     # red number
BADGE_PAD_X   = 7                 # horizontal padding inside box
BADGE_PAD_Y   = 5                 # vertical padding inside box
BADGE_BORDER_W = 3                # border thickness
FONT_SIZE     = 15

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


def _draw_callout(
    img: Image.Image,
    draw: ImageDraw.Draw,
    cx: int,
    cy: int,
    number: int,
    rotation: float = 0.0,
) -> None:
    """Draw a red-bordered rectangle callout label centred at (cx, cy)."""
    iw, ih = img.size
    text = str(number)

    try:
        font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", FONT_SIZE
        )
    except (IOError, OSError):
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

    rw = tw + BADGE_PAD_X * 2
    rh = th + BADGE_PAD_Y * 2

    # Clamp so badge stays within image bounds
    rx = min(max(0, cx - rw // 2), iw - rw)
    ry = min(max(0, cy - rh // 2), ih - rh)

    # White fill + red border
    draw.rectangle(
        [rx, ry, rx + rw, ry + rh],
        fill=BADGE_FILL,
        outline=BADGE_BORDER,
        width=BADGE_BORDER_W,
    )

    # Red number centred inside the box
    tx = rx + BADGE_PAD_X - bbox[0]
    ty = ry + BADGE_PAD_Y - bbox[1]
    draw.text((tx, ty), text, fill=BADGE_TEXT_C, font=font)


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

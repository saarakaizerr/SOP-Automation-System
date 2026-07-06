"""Render-annotated handler — draws callouts on a step screenshot."""

import asyncio


def run_render_annotated(
    step_id: str,
    screenshot_url: str,
    callouts: list,
    azure_blob_base_url: str,
    azure_sas_token: str,
    highlight_boxes: list = None,
    **_: object,
) -> dict:
    """
    Download screenshot, draw callout circles, upload annotated PNG to Azure.
    Returns {"annotated_screenshot_url": str}.
    """
    from app.annotator import render_annotated

    url = render_annotated(
        step_id=step_id,
        screenshot_url=screenshot_url,
        callouts=callouts,
        azure_blob_base_url=azure_blob_base_url,
        azure_sas_token=azure_sas_token,
        highlight_boxes=highlight_boxes or [],
    )
    return {"annotated_screenshot_url": url}

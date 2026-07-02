"""Render-doc handler — DOCX/PDF generation from Word template."""

import logging

logger = logging.getLogger(__name__)


def run_render_doc(
    sop_id: str,
    format: str = "docx",
    template: str = "standard",
    azure_blob_base_url: str = "",
    azure_sas_token: str = "",
    sop_data: dict = None,
    **_: object,
) -> dict:
    """
    Render a SOP DOCX (and optionally PDF) from the Word template.
    Returns {"docx_url": str, "pdf_url": str|None}.
    """
    from app.doc_renderer import render_sop  # local import — avoids startup failure if template missing

    result = render_sop(
        sop_id=sop_id,
        fmt=format,
        sop_data=sop_data or {},
        azure_blob_base_url=azure_blob_base_url,
        azure_sas_token=azure_sas_token,
        template=template,
    )
    return {"docx_url": result["docx_url"], "pdf_url": result.get("pdf_url")}

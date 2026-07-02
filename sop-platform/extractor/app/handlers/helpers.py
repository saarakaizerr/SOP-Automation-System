"""Shared HTTP helpers for Azure Blob upload/download."""

import logging
import time
from pathlib import Path

import requests

logger = logging.getLogger(__name__)


def download_file(url: str, dest: Path, max_retries: int = 5) -> None:
    """Stream-download a file from url to dest with retry on incomplete read."""
    for attempt in range(max_retries):
        try:
            downloaded = dest.stat().st_size if dest.exists() else 0
            headers = {"Range": f"bytes={downloaded}-"} if downloaded > 0 else {}
            with requests.get(url, stream=True, timeout=600, headers=headers) as resp:
                if resp.status_code == 416:
                    return  # Range not satisfiable — file already complete
                resp.raise_for_status()
                mode = "ab" if downloaded > 0 else "wb"
                with open(dest, mode) as f:
                    for chunk in resp.iter_content(chunk_size=8 * 1024 * 1024):
                        f.write(chunk)
            return
        except (requests.exceptions.ChunkedEncodingError, requests.exceptions.ConnectionError) as e:
            if attempt < max_retries - 1:
                logger.warning("Download interrupted (attempt %d/%d): %s — retrying", attempt + 1, max_retries, e)
            else:
                raise


def upload_to_azure_blob(local_path: Path, sas_url: str, max_retries: int = 3) -> None:
    """PUT a PNG frame to Azure Blob Storage with retry on connection errors."""
    with open(local_path, "rb") as f:
        data = f.read()
    for attempt in range(max_retries):
        try:
            resp = requests.put(
                sas_url,
                data=data,
                headers={
                    "x-ms-blob-type": "BlockBlob",
                    "Content-Type": "image/png",
                },
                timeout=60,
            )
            resp.raise_for_status()
            return
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            if attempt < max_retries - 1:
                logger.warning("Frame upload failed (attempt %d/%d): %s — retrying", attempt + 1, max_retries, e)
                time.sleep(3 * (attempt + 1))
            else:
                raise


def upload_to_azure_blob_video(local_path: Path, sas_url: str, max_retries: int = 3) -> None:
    """Stream-upload an MP4 to Azure Blob Storage with retry on connection errors."""
    file_size = local_path.stat().st_size
    for attempt in range(max_retries):
        try:
            with open(local_path, "rb") as f:
                resp = requests.put(
                    sas_url,
                    data=f,
                    headers={
                        "x-ms-blob-type": "BlockBlob",
                        "Content-Type": "video/mp4",
                        "Content-Length": str(file_size),
                    },
                    timeout=300,
                )
            resp.raise_for_status()
            return
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            if attempt < max_retries - 1:
                logger.warning("Video upload failed (attempt %d/%d): %s — retrying", attempt + 1, max_retries, e)
                time.sleep(5 * (attempt + 1))
            else:
                raise

"""
Azure Container App Job trigger client.

Production (AZURE_SUBSCRIPTION_ID set): uses DefaultAzureCredential —
  managed identity in Azure, local `az login` for dev.

Local dev (AZURE_SUBSCRIPTION_ID empty): no-op; caller falls back to
  direct HTTP against the sop-extractor container.
"""

import asyncio

import httpx
from azure.identity import DefaultAzureCredential

from app.config import settings

_credential: DefaultAzureCredential | None = None


def _get_credential() -> DefaultAzureCredential:
    global _credential
    if _credential is None:
        _credential = DefaultAzureCredential()
    return _credential


async def start_extractor_job(task_id: str) -> str:
    """
    Trigger the sop-extractor-job Container App Job execution.
    Returns the Azure execution name, or 'local-dev-noop' when not in Azure.
    """
    if not settings.azure_subscription_id:
        return "local-dev-noop"

    token_result = await asyncio.to_thread(
        _get_credential().get_token,
        "https://management.azure.com/.default",
    )

    url = (
        f"https://management.azure.com"
        f"/subscriptions/{settings.azure_subscription_id}"
        f"/resourceGroups/{settings.azure_resource_group}"
        f"/providers/Microsoft.App/jobs/{settings.azure_extractor_job_name}"
        f"/start?api-version=2023-05-01"
    )
    # Start with empty body — job uses its configured env vars (SUPABASE_URL etc.
    # from secrets). The job claims its task by querying extractor_jobs directly.
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            url, json={},
            headers={"Authorization": f"Bearer {token_result.token}"},
        )
        resp.raise_for_status()
    return resp.json().get("name", "unknown")

import json

from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    database_url: str = ""
    # CORS — accepts JSON array or comma-separated string
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: object) -> object:
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("["):
                return json.loads(v)
            return [o.strip() for o in v.split(",") if o.strip()]
        return v
    # Azure
    azure_blob_base_url: str = ""
    azure_blob_sas_token: str = ""
    # Services
    extractor_url: str = "http://sop-extractor:8001"  # override with EXTRACTOR_URL env var on Azure: http://sop-extractor
    n8n_webhook_base_url: str = ""
    n8n_wf0_webhook_url: str = ""  # full URL to WF0 webhook trigger, e.g. https://n8n.../webhook/wf0-trigger
    # Supabase auth — URL used to derive JWKS endpoint
    supabase_url: str = ""
    supabase_jwt_secret: str = ""
    # Pipeline security — shared secret between n8n and this API
    # n8n sends header: x-internal-key: <this value>
    # Generate: python -c "import secrets; print(secrets.token_hex(32))"
    internal_api_key: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


settings = Settings()

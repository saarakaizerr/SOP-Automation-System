# Azure Container Apps Deployment Guide
**Project:** SOP Automation Platform (Starboard Hotels)
**Repo:** cloudnavision/Infomate_SOP
**Last Updated:** 2026-05-07

---

## Azure Resources

| Resource | Name | Region | Details |
|---|---|---|---|
| Resource Group | `rg-saara-workspace` | Southeast Asia | Existing group |
| Container Registry | `sopacr` | Southeast Asia | `sopacr.azurecr.io`, Basic SKU, admin enabled |
| Container Apps Env | `sop-env` | Southeast Asia | Log Analytics auto-created |
| Container App | `sop-extractor` | Southeast Asia | Internal ingress only, port 8001 |
| Container App | `sop-api` | Southeast Asia | Ingress disabled, port 8000, Cloudflare Tunnel sidecar |
| Container App | `sop-frontend` | Southeast Asia | Ingress disabled, port 5173, Cloudflare Tunnel sidecar |

---

## Public URLs

All external traffic routes through Cloudflare Tunnel — Azure ingress is disabled on sop-api and sop-frontend.

| Service | URL |
|---|---|
| **Frontend** | `https://sopapp.cloudnavision.com` |
| **API** | `https://soptest.cloudnavision.com` |
| **Extractor (internal)** | `http://sop-extractor.internal.whitemeadow-cfe4a842.southeastasia.azurecontainerapps.io` |

---

## Cloudflare Tunnel Architecture

Each app with external traffic has a `cloudflared` sidecar container. Sidecars connect to `localhost` within the pod — no Azure ingress needed.

| Container App | Tunnel Token Secret | Cloudflare Route |
|---|---|---|
| `sop-api` | `tunnel-token` (Container App secret) | `soptest.cloudnavision.com` → `http://localhost:8000` |
| `sop-frontend` | `tunnel-token` (Container App secret) | `sopapp.cloudnavision.com` → `http://localhost:5173` |

**Token source:** `.env` file → `CLOUDFLARE_TUNNEL_TOKEN` (sop-api) and the frontend tunnel token.

To update a tunnel token:
```bash
az containerapp secret set \
  --name sop-api \
  --resource-group rg-saara-workspace \
  --secrets tunnel-token="<new-token>"

az containerapp revision restart \
  --name sop-api \
  --resource-group rg-saara-workspace \
  --revision $(az containerapp revision list \
    --name sop-api --resource-group rg-saara-workspace \
    --query "[0].name" -o tsv)
```

---

## GitHub Secrets

Go to: `https://github.com/cloudnavision/Infomate_SOP/settings/secrets/actions`

| Secret Name | Value / Description |
|---|---|
| `AZURE_CREDENTIALS` | Service principal JSON for GitHub Actions Azure login |
| `ACR_LOGIN_SERVER` | `sopacr.azurecr.io` |
| `ACR_USERNAME` | `sopacr` |
| `ACR_PASSWORD` | ACR admin password (password, not password2) |
| `VITE_SUPABASE_URL` | Supabase project URL (build-time baked into frontend bundle) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (build-time baked into frontend bundle) |
| `VITE_API_URL` | `https://soptest.cloudnavision.com` |

---

## CI/CD Pipeline

**File:** `.github/workflows/deploy.yml`
**Trigger:** Push to `main`

| Job | What it does |
|---|---|
| `check` | TypeScript check (`npm run typecheck`) + Python lint (`ruff check`) |
| `build-push` | Builds 3 Docker images, tags with `${GITHUB_SHA::8}` + `latest`, pushes to ACR |
| `deploy` | Runs `az containerapp update --container-name <name>` for all 3 apps + health check on sop-api |

Health check hits `https://soptest.cloudnavision.com/health` (through Cloudflare Tunnel).

**Note:** `--container-name` is required for sop-api and sop-frontend because they have multiple containers (app + cloudflared sidecar).

---

## Container Apps — Env Vars & Secrets

### sop-extractor (internal ingress, 2 CPU / 4Gi)
| Variable | Source |
|---|---|
| `SUPABASE_URL` | Container App secret |
| `SUPABASE_SERVICE_KEY` | Container App secret |
| `GEMINI_API_KEY` | Container App secret |

### sop-api (ingress disabled, 0.5 CPU / 1Gi + 0.25 CPU cloudflared sidecar)
| Variable | Source |
|---|---|
| `DATABASE_URL` | Container App secret |
| `SUPABASE_URL` | Container App secret |
| `SUPABASE_JWT_SECRET` | Container App secret |
| `AZURE_BLOB_BASE_URL` | Plain env var: `https://cnavinfsop.blob.core.windows.net/infsop` |
| `AZURE_BLOB_SAS_TOKEN` | Container App secret |
| `N8N_WEBHOOK_BASE_URL` | Plain env var: `https://azuren8n.cloudnavision.com` |
| `GEMINI_API_KEY` | Container App secret |
| `INTERNAL_API_KEY` | Container App secret |
| `EXTRACTOR_BASE_URL` | Plain env var: `http://sop-extractor.internal.whitemeadow-cfe4a842.southeastasia.azurecontainerapps.io` |
| `CORS_ORIGINS` | Plain env var: `["https://sopapp.cloudnavision.com","https://soptest.cloudnavision.com"]` |
| `TUNNEL_TOKEN` | secretRef: `tunnel-token` (cloudflared sidecar only) |

**CORS_ORIGINS format:** JSON array string — pydantic-settings requires this for `list[str]` fields. Comma-separated strings also accepted (validator added in `app/config.py`).

### sop-frontend (ingress disabled, 0.5 CPU / 1Gi + 0.25 CPU cloudflared sidecar)
No runtime env vars — all config baked into the React bundle at build time via Docker `--build-arg`.

| Build ARG | Value |
|---|---|
| `VITE_API_URL` | `https://soptest.cloudnavision.com` (GitHub Secret) |
| `VITE_SUPABASE_URL` | Supabase project URL (GitHub Secret) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (GitHub Secret) |

**To update VITE_API_URL:** Update the GitHub Secret, then push an empty commit to trigger a rebuild — the new value is baked into the JS bundle at build time.

---

## Service Principal

**Name:** `sop-github-actions`
**Role:** Contributor on `rg-saara-workspace` + AcrPush on `sopacr`
**Client ID:** `c51c96b1-957f-41d3-a78a-cb30de59696e`
**Tenant ID:** `7729c609-7477-493b-9acc-528e95b56ad1`
**Subscription:** `3117a2ba-8530-4eec-a7b0-83cfefcc184d`

---

## Day-to-Day Operations (WSL)

```bash
# View live logs (app container)
az containerapp logs show --name sop-api --resource-group rg-saara-workspace --container sop-api --follow

# View cloudflared tunnel logs
az containerapp logs show --name sop-api --resource-group rg-saara-workspace --container cloudflared --tail 20

# List all Container Apps
az containerapp list --resource-group rg-saara-workspace --output table

# Manual redeploy (force pull latest) — must specify container-name for apps with sidecars
az containerapp update --name sop-api --resource-group rg-saara-workspace \
  --container-name sop-api --image sopacr.azurecr.io/sop-api:latest

# Shell into a running container
az containerapp exec --name sop-api --resource-group rg-saara-workspace --command /bin/bash

# Scale replicas
az containerapp update --name sop-api --resource-group rg-saara-workspace \
  --min-replicas 2 --max-replicas 4

# Verify all env vars on sop-api
az containerapp show --name sop-api --resource-group rg-saara-workspace \
  --query "properties.template.containers[?name=='sop-api'].env[]" -o json
```

---

## Rollback

```bash
# List available image tags
az acr repository show-tags --name sopacr --repository sop-api --output table

# Roll back to a previous SHA (visible in GitHub Actions run history)
az containerapp update --name sop-api --resource-group rg-saara-workspace \
  --container-name sop-api --image sopacr.azurecr.io/sop-api:abc12345
# Repeat for sop-frontend (--container-name sop-frontend) and sop-extractor if needed
```

---

## Known Pitfalls

| Issue | Cause | Fix |
|---|---|---|
| `--container-name is required` | App has multiple containers (sidecar) | Always pass `--container-name <app-name>` for sop-api and sop-frontend |
| `Invalid tunnel secret` | Wrong Cloudflare token set as secret | Read token from `.env` → `CLOUDFLARE_TUNNEL_TOKEN`, reset secret, restart revision |
| `pydantic SettingsError: cors_origins` | CORS_ORIGINS set as comma-separated string | Use JSON array format: `["url1","url2"]` or rely on the validator in `app/config.py` |
| Env vars dropped after YAML update | `az containerapp update --yaml` replaces container env entirely | Always include all env vars in the YAML, or use `--set-env-vars` for single-value updates |
| VITE_API_URL baked in as old URL | GitHub Secret not updated before build | Update secret in GitHub → push empty commit to rebuild |

---

## Changelog

### 2026-05-07 — Initial Deployment

| # | Change | Details |
|---|---|---|
| 1 | Created ACR | `sopacr` in Southeast Asia, Basic SKU, admin enabled |
| 2 | Created Container Apps Env | `sop-env` in Southeast Asia with auto Log Analytics |
| 3 | Created service principal | `sop-github-actions` with Contributor + AcrPush roles |
| 4 | Added GitHub Secrets | All 7 secrets wired (AZURE_CREDENTIALS, ACR_*, VITE_*) |
| 5 | Created GitHub Actions workflow | `.github/workflows/deploy.yml` — 3-job pipeline |
| 6 | Fixed ruff lint errors | Removed unused imports + fixed E712 boolean comparisons in 7 API files |
| 7 | First successful build-push | All 3 images pushed to ACR (`sop-frontend`, `sop-api`, `sop-extractor`) |
| 8 | Bootstrapped sop-extractor | Internal Container App, 2 CPU / 4Gi, port 8001 |
| 9 | Bootstrapped sop-api | Container App, port 8000, all secrets set |
| 10 | Bootstrapped sop-frontend | Container App, port 5173 |
| 11 | Updated CORS_ORIGINS | Set to Cloudflare frontend domain on sop-api |
| 12 | Added Cloudflare Tunnel sidecars | `cloudflared` sidecar on sop-api (soptest.cloudnavision.com) and sop-frontend (sopapp.cloudnavision.com) |
| 13 | Disabled Azure ingress | sop-api and sop-frontend ingress disabled — all traffic via Cloudflare Tunnel |
| 14 | Fixed deploy.yml | Added `--container-name` to all 3 deploy steps (required when sidecar present) |
| 15 | Fixed config.py cors_origins | Added `field_validator` to accept both JSON array and comma-separated string |
| 16 | Updated VITE_API_URL secret | Changed from Azure FQDN to `https://soptest.cloudnavision.com` |

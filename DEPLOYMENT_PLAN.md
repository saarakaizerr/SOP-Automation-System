# Full Deployment Plan — SOP Platform to Azure Container Apps

## Context

The SOP Automation Platform (Starboard Hotels) currently runs via Docker Compose on a local/VM setup with Cloudflare Tunnel for external access. The goal is to migrate to a proper cloud deployment on Azure Container Apps with a fully automated CI/CD pipeline via GitHub Actions. This plan synthesises the design spec and implementation plan into a single ordered, executable guide.

**Outcome:** Push to `main` → checks pass → 3 Docker images pushed to ACR → 3 Container Apps updated automatically. WSL2 is used for all Azure CLI management from Windows.

---

## Critical Files

| Action | Path |
|---|---|
| **Create** | `.github/workflows/deploy.yml` |
| Reference | `sop-platform/frontend/Dockerfile` (multi-stage, build ARGs: VITE_API_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) |
| Reference | `sop-platform/api/Dockerfile` (python:3.11-slim, port 8000) |
| Reference | `sop-platform/extractor/Dockerfile` (python:3.11-slim + ffmpeg, port 8001) |
| Reference | `sop-platform/docker-compose.yml` (env var names to replicate in Container Apps) |

---

## Phase 1 — WSL2 + Azure CLI Setup (run once, on your Windows machine)

### Step 1.1 — Install WSL2

Run in **PowerShell as Administrator**:
```powershell
wsl --install
wsl --set-default-version 2
```
Reboot when prompted. Open Ubuntu from Start menu, set a username/password.

### Step 1.2 — Install Azure CLI + Container Apps extension inside WSL

```bash
sudo apt-get update && sudo apt-get upgrade -y
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
az --version                                    # verify install
az extension add --name containerapp --upgrade  # required for Container Apps commands
```

### Step 1.3 — Authenticate and set subscription

```bash
az login                                        # opens browser on Windows
az account list --output table
az account set --subscription "<your-subscription-id>"
az account show --query name -o tsv             # confirm correct subscription
```

---

## Phase 2 — Azure One-Time Infrastructure Setup (WSL)

### Step 2.1 — Create resource group

```bash
az group create --name rg-saara-workspace --location southeastasia
# Use your existing region if Azure resources are already elsewhere (e.g. australiaeast)
```

### Step 2.2 — Create Azure Container Registry (ACR)

```bash
az acr create \
  --resource-group rg-saara-workspace \
  --name sopacr \
  --sku Basic \
  --admin-enabled true
# ACR names are globally unique — if sopacr is taken, use sopplatformacr or similar
```

### Step 2.3 — Save ACR credentials (needed for GitHub Secrets)

```bash
az acr credential show --name sopacr --resource-group rg-saara-workspace
```
Copy `username` (= `sopacr`) and `passwords[0].value` — you'll add these to GitHub in Phase 4.

### Step 2.4 — Register Azure providers (first-time only)

```bash
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights
# Wait ~60s, then verify:
az provider show --namespace Microsoft.App --query registrationState -o tsv        # → Registered
az provider show --namespace Microsoft.OperationalInsights --query registrationState -o tsv
```

### Step 2.5 — Create Container Apps Environment

```bash
az containerapp env create \
  --name sop-env \
  --resource-group rg-saara-workspace \
  --location southeastasia
# Takes 1–2 minutes. Expected: "provisioningState": "Succeeded"
```

### Step 2.6 — Create GitHub Actions service principal

```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)

az ad sp create-for-rbac \
  --name "sop-github-actions" \
  --role Contributor \
  --scopes /subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-saara-workspace \
  --sdk-auth
```
**Save the entire JSON output** — this becomes `AZURE_CREDENTIALS` in GitHub Secrets.

### Step 2.7 — Grant service principal AcrPush role

```bash
ACR_ID=$(az acr show --name sopacr --resource-group rg-saara-workspace --query id -o tsv)
SP_APP_ID=$(az ad sp list --display-name "sop-github-actions" --query "[0].appId" -o tsv)

az role assignment create \
  --assignee $SP_APP_ID \
  --role AcrPush \
  --scope $ACR_ID
# Expected: "roleDefinitionName": "AcrPush"
```

---

## Phase 3 — GitHub Actions Workflow

File already created at `.github/workflows/deploy.yml`. Contains 3 jobs:

- **check** — `npm run typecheck` (frontend) + `ruff check` (API)
- **build-push** — builds all 3 images, tags with 8-char git SHA, pushes to ACR
- **deploy** — `az containerapp update` for all 3 services + health check on sop-api

Commit and push to `main` after Phase 4 secrets are in place:
```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add GitHub Actions CI/CD workflow for Azure Container Apps"
git push origin main
```

---

## Phase 4 — GitHub Secrets

Go to: `https://github.com/cloudnavision/Infomate_SOP/settings/secrets/actions`

Add all secrets below. **Do not skip any** — missing secrets cause silent build failures.

| Secret Name | Value | Source |
|---|---|---|
| `AZURE_CREDENTIALS` | Full JSON from Phase 2 Step 2.6 | Service principal |
| `ACR_LOGIN_SERVER` | `sopacr.azurecr.io` | Fixed |
| `ACR_USERNAME` | `sopacr` | From Phase 2 Step 2.3 |
| `ACR_PASSWORD` | ACR password value | From Phase 2 Step 2.3 |
| `VITE_SUPABASE_URL` | `https://xxxx.supabase.co` | Supabase dashboard |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key | Supabase dashboard |
| `VITE_API_URL` | *(leave blank now — fill after Phase 5 Step 5.5)* | From sop-api FQDN |

---

## Phase 5 — First Manual Container Apps Bootstrap (WSL)

This creates the 3 Container Apps with all env vars. Run **once only** — subsequent deploys via GitHub Actions update the image tag automatically.

### Step 5.1 — Push initial images (trigger CI first)

Push the workflow commit to `main` (Phase 3) to run the build-push job. Wait for it to complete, then verify images exist:
```bash
az acr repository list --name sopacr --output table
# Should show: sop-frontend, sop-api, sop-extractor
```

### Step 5.2 — Create sop-extractor (internal only, 4GB)

```bash
az containerapp create \
  --name sop-extractor \
  --resource-group rg-saara-workspace \
  --environment sop-env \
  --image sopacr.azurecr.io/sop-extractor:latest \
  --registry-server sopacr.azurecr.io \
  --registry-username sopacr \
  --registry-password "<ACR_PASSWORD>" \
  --ingress internal \
  --target-port 8001 \
  --min-replicas 1 --max-replicas 1 \
  --cpu 2 --memory 4Gi \
  --secrets \
    supabase-url="<SUPABASE_URL>" \
    supabase-service-key="<SUPABASE_SERVICE_KEY>" \
    gemini-api-key="<GEMINI_API_KEY>" \
  --env-vars \
    SUPABASE_URL=secretref:supabase-url \
    SUPABASE_SERVICE_KEY=secretref:supabase-service-key \
    GEMINI_API_KEY=secretref:gemini-api-key
```

### Step 5.3 — Get extractor internal FQDN

```bash
EXTRACTOR_FQDN=$(az containerapp show \
  --name sop-extractor --resource-group rg-saara-workspace \
  --query "properties.configuration.ingress.fqdn" -o tsv)
echo $EXTRACTOR_FQDN
# Example: sop-extractor.internal.southeastasia.azurecontainerapps.io
```

### Step 5.4 — Create sop-api (public, port 8000)

```bash
az containerapp create \
  --name sop-api \
  --resource-group rg-saara-workspace \
  --environment sop-env \
  --image sopacr.azurecr.io/sop-api:latest \
  --registry-server sopacr.azurecr.io \
  --registry-username sopacr \
  --registry-password "<ACR_PASSWORD>" \
  --ingress external \
  --target-port 8000 \
  --min-replicas 1 --max-replicas 2 \
  --secrets \
    database-url="<DATABASE_URL>" \
    supabase-url="<SUPABASE_URL>" \
    supabase-jwt-secret="<SUPABASE_JWT_SECRET>" \
    azure-blob-sas-token="<AZURE_BLOB_SAS_TOKEN>" \
    gemini-api-key="<GEMINI_API_KEY>" \
    google-vision-api-key="<GOOGLE_VISION_API_KEY>" \
    internal-api-key="<INTERNAL_API_KEY>" \
  --env-vars \
    DATABASE_URL=secretref:database-url \
    SUPABASE_URL=secretref:supabase-url \
    SUPABASE_JWT_SECRET=secretref:supabase-jwt-secret \
    AZURE_BLOB_BASE_URL="<AZURE_BLOB_BASE_URL>" \
    AZURE_BLOB_SAS_TOKEN=secretref:azure-blob-sas-token \
    N8N_WEBHOOK_BASE_URL="https://azuren8n.cloudnavision.com" \
    GEMINI_API_KEY=secretref:gemini-api-key \
    GOOGLE_VISION_API_KEY=secretref:google-vision-api-key \
    INTERNAL_API_KEY=secretref:internal-api-key \
    EXTRACTOR_BASE_URL="http://$EXTRACTOR_FQDN" \
    CORS_ORIGINS="placeholder"
```

### Step 5.5 — Get sop-api public FQDN

```bash
API_FQDN=$(az containerapp show \
  --name sop-api --resource-group rg-saara-workspace \
  --query "properties.configuration.ingress.fqdn" -o tsv)
echo "https://$API_FQDN"
```
**Now go back to GitHub Secrets and set `VITE_API_URL` = `https://$API_FQDN`**

### Step 5.6 — Create sop-frontend (public, port 5173)

```bash
az containerapp create \
  --name sop-frontend \
  --resource-group rg-saara-workspace \
  --environment sop-env \
  --image sopacr.azurecr.io/sop-frontend:latest \
  --registry-server sopacr.azurecr.io \
  --registry-username sopacr \
  --registry-password "<ACR_PASSWORD>" \
  --ingress external \
  --target-port 5173 \
  --min-replicas 1 --max-replicas 2
# No runtime env vars — all config baked into image at build time via --build-arg
```

### Step 5.7 — Get sop-frontend FQDN and update CORS

```bash
FRONTEND_FQDN=$(az containerapp show \
  --name sop-frontend --resource-group rg-saara-workspace \
  --query "properties.configuration.ingress.fqdn" -o tsv)
echo "https://$FRONTEND_FQDN"

# Update CORS_ORIGINS in sop-api with the real frontend URL
az containerapp update \
  --name sop-api --resource-group rg-saara-workspace \
  --set-env-vars CORS_ORIGINS="https://$FRONTEND_FQDN"
```

### Step 5.8 — Rebuild sop-frontend with correct VITE_API_URL

Since `VITE_API_URL` is baked into the JS bundle at build time, push an empty commit to trigger a fresh build:
```bash
git commit --allow-empty -m "ci: rebuild frontend with correct VITE_API_URL"
git push origin main
```

---

## Phase 6 — Verification

```bash
# 1. All 3 Container Apps running
az containerapp list --resource-group rg-saara-workspace --output table

# 2. API health check
curl -f https://$API_FQDN/health
# Expected: {"status":"ok"} or 200 OK

# 3. Open frontend in browser
echo "https://$FRONTEND_FQDN"
# Log in, navigate to dashboard — confirm API calls succeed

# 4. Verify image tags in ACR
az acr repository show-tags --name sopacr --repository sop-api --output table
# Should show both :latest and the 8-char git SHA
```

Go to `https://github.com/cloudnavision/Infomate_SOP/actions` — confirm all 3 jobs green.

---

## Phase 7 — Cloudflare Custom Domain (optional)

To point `soptest.cloudnavision.com` at sop-api instead of the old Cloudflare Tunnel:

1. Azure Portal → Container Apps → `sop-api` → Custom domains → Add `soptest.cloudnavision.com`
2. Azure shows a TXT record and CNAME — add both in Cloudflare DNS for `cloudnavision.com`
3. Set Cloudflare proxy to **DNS only** (grey cloud) — Azure manages TLS; orange cloud breaks it
4. Validate in Azure Portal — certificate auto-provisions in ~2 minutes
5. Update CORS:
```bash
az containerapp update \
  --name sop-api --resource-group rg-saara-workspace \
  --set-env-vars CORS_ORIGINS="https://soptest.cloudnavision.com,https://$FRONTEND_FQDN"
```

---

## Rollback

```bash
# List available image tags
az acr repository show-tags --name sopacr --repository sop-api --output table

# Roll back to a previous SHA (visible in GitHub Actions run history)
az containerapp update \
  --name sop-api --resource-group rg-saara-workspace \
  --image sopacr.azurecr.io/sop-api:abc12345

# Repeat for sop-frontend and sop-extractor if needed
```

---

## Day-to-Day WSL Management

```bash
# Live logs
az containerapp logs show --name sop-api --resource-group rg-saara-workspace --follow

# Shell into a running container
az containerapp exec --name sop-api --resource-group rg-saara-workspace --command /bin/bash

# Scale replicas
az containerapp update --name sop-api --resource-group rg-saara-workspace \
  --min-replicas 2 --max-replicas 4

# Force restart
az containerapp revision restart --name sop-api --resource-group rg-saara-workspace \
  --revision $(az containerapp revision list \
    --name sop-api --resource-group rg-saara-workspace \
    --query "[0].name" -o tsv)
```

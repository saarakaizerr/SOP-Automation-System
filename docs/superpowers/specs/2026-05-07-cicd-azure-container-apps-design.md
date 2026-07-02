# CI/CD Pipeline — Azure Container Apps Design Spec
**Date:** 2026-05-07
**Project:** SOP Automation Platform (Starboard Hotels)
**Repo:** cloudnavision/Infomate_SOP

---

## 1. Goal

Automate deployment of all three SOP platform containers to Azure Container Apps whenever code is merged to `main`. Pre-deploy checks must pass before any image is built or pushed.

---

## 2. Scope

| In scope | Out of scope |
|---|---|
| GitHub Actions workflow (check → build → deploy) | n8n workflow changes |
| Azure Container Registry (ACR) setup | Supabase / database migrations |
| Azure Container Apps environment + 3 apps | Cloudflare DNS reconfiguration (manual step) |
| WSL2 + Azure CLI local management guide | Azure VM teardown |
| GitHub Secrets wiring | Secrets rotation policy |

---

## 3. Architecture Overview

```
Developer pushes to main
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  GitHub Actions                                     │
│                                                     │
│  Job 1: check                                       │
│    ├── tsc --noEmit          (sop-frontend)         │
│    └── ruff check ./api      (sop-api)              │
│                                                     │
│  Job 2: build-push  (needs: check)                  │
│    ├── docker build sop-frontend → ACR              │
│    ├── docker build sop-api      → ACR              │
│    └── docker build sop-extractor → ACR             │
│    (all tagged with git SHA + latest)               │
│                                                     │
│  Job 3: deploy  (needs: build-push)                 │
│    ├── az containerapp update sop-frontend          │
│    ├── az containerapp update sop-api               │
│    └── az containerapp update sop-extractor         │
└─────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  Azure                                              │
│                                                     │
│  ACR: sopacr.azurecr.io                             │
│    ├── sop-frontend:<sha>                           │
│    ├── sop-api:<sha>                                │
│    └── sop-extractor:<sha>                          │
│                                                     │
│  Container Apps Environment: sop-env                │
│    ├── sop-frontend   (public ingress :5173)        │
│    ├── sop-api        (public ingress :8000)        │
│    └── sop-extractor  (internal only  :8001)        │
└─────────────────────────────────────────────────────┘
```

---

## 4. Azure Resources

### 4.1 Azure Container Registry (ACR)
- **Name:** `sopacr` (adjust if taken — must be globally unique)
- **SKU:** Basic (sufficient for 3 images, ~$5/month)
- **Admin credentials enabled:** yes (used by GitHub Actions)
- **Images stored:**
  - `sopacr.azurecr.io/sop-frontend`
  - `sopacr.azurecr.io/sop-api`
  - `sopacr.azurecr.io/sop-extractor`
- **Tag strategy:** `<git-sha>` on every push + `latest` alias

### 4.2 Container Apps Environment
- **Name:** `sop-env`
- **Region:** `eastus` (adjust to match your existing Azure resource group region)
- **Log Analytics workspace:** auto-created by Azure (free tier sufficient)
- **Virtual network:** default (no custom VNET required)

### 4.3 Container Apps

| App | Image | Ingress | Port | Scale |
|---|---|---|---|---|
| `sop-frontend` | `sopacr.azurecr.io/sop-frontend` | External (public) | 5173 | 1–2 replicas |
| `sop-api` | `sopacr.azurecr.io/sop-api` | External (public) | 8000 | 1–2 replicas |
| `sop-extractor` | `sopacr.azurecr.io/sop-extractor` | Internal only | 8001 | 1 replica |

`sop-extractor` is internal-only — only `sop-api` calls it within the environment via its internal FQDN.

---

## 5. Environment Variables

All env vars are stored as **Container Apps secrets** (not plain env vars), injected at runtime. They never pass through GitHub Actions.

| Variable | Used by |
|---|---|
| `DATABASE_URL` | sop-api |
| `SUPABASE_URL` | sop-api, sop-frontend |
| `SUPABASE_ANON_KEY` | sop-frontend |
| `SUPABASE_JWT_SECRET` | sop-api |
| `CORS_ORIGINS` | sop-api |
| `AZURE_BLOB_BASE_URL` | sop-api |
| `AZURE_BLOB_SAS_TOKEN` | sop-api |
| `N8N_WEBHOOK_BASE_URL` | sop-api |
| `VITE_API_URL` | sop-frontend (build-time ARG) |
| `CLOUDFLARE_TUNNEL_TOKEN` | **Not needed** — tunnel container removed |

`VITE_API_URL` is a Docker build ARG (baked into the React bundle at build time). It must be passed as `--build-arg` in the GitHub Actions build step.

---

## 6. GitHub Actions Workflow

**File:** `.github/workflows/deploy.yml`
**Trigger:** push to `main`

### Job 1 — `check`
```
- Checkout repo
- Setup Node 20, run: cd sop-platform/frontend && npm ci && npx tsc --noEmit
- Setup Python 3.11, run: pip install ruff && ruff check sop-platform/api
```
Fails fast — deploy never starts if checks fail.

### Job 2 — `build-push` (needs: check)
```
- Checkout repo
- az acr login --name sopacr
- docker build + push sop-frontend  (with --build-arg VITE_API_URL)
- docker build + push sop-api
- docker build + push sop-extractor
- Tag each image: sopacr.azurecr.io/<name>:${{ github.sha }} and :latest
```

### Job 3 — `deploy` (needs: build-push)
```
- az login (service principal via AZURE_CREDENTIALS secret)
- az containerapp update --name sop-frontend  --image sopacr.../sop-frontend:$sha
- az containerapp update --name sop-api       --image sopacr.../sop-api:$sha
- az containerapp update --name sop-extractor --image sopacr.../sop-extractor:$sha
```

---

## 7. GitHub Secrets Required

| Secret name | What it holds |
|---|---|
| `AZURE_CREDENTIALS` | Service principal JSON (`az ad sp create-for-rbac` output) |
| `ACR_LOGIN_SERVER` | `sopacr.azurecr.io` |
| `ACR_USERNAME` | ACR admin username |
| `ACR_PASSWORD` | ACR admin password |
| `VITE_API_URL` | Public URL of sop-api Container App (set after first deploy) |

All other env vars (DATABASE_URL etc.) live in Container Apps directly — not in GitHub Secrets.

---

## 8. Cloudflare Custom Domain (Post-Deploy)

The `sop-tunnel` container is removed. Container Apps provides native HTTPS URLs:
- `https://sop-frontend.<hash>.<region>.azurecontainerapps.io`
- `https://sop-api.<hash>.<region>.azurecontainerapps.io`

To restore custom domains (e.g. `soptest.cloudnavision.com`):
1. Add custom domain to Container App via Azure portal
2. Azure auto-provisions a managed TLS certificate
3. Update Cloudflare DNS: CNAME `soptest` → Container Apps FQDN
4. Set Cloudflare proxy mode to **DNS only** (orange → grey cloud) for Container Apps TLS to work

---

## 9. WSL2 + Azure CLI Local Management Guide

### 9.1 Install WSL2 (Windows 11)
```powershell
# Run in PowerShell as Administrator
wsl --install
# Reboot, then set up Ubuntu username/password
wsl --set-default-version 2
```

### 9.2 Install Azure CLI inside WSL (Ubuntu)
```bash
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
az --version   # verify
```

### 9.3 Authenticate
```bash
az login
# Opens browser on Windows — complete auth there
# Or for headless: az login --use-device-code
```

### 9.4 Set Subscription
```bash
az account list --output table
az account set --subscription "<your-subscription-id>"
```

### 9.5 Day-to-Day Commands
```bash
# List Container Apps
az containerapp list --resource-group sop-rg --output table

# View live logs
az containerapp logs show --name sop-api --resource-group sop-rg --follow

# Manual redeploy (force pull latest image)
az containerapp update --name sop-api --resource-group sop-rg \
  --image sopacr.azurecr.io/sop-api:latest

# Restart a container app
az containerapp revision restart --name sop-api --resource-group sop-rg \
  --revision $(az containerapp revision list -n sop-api -g sop-rg --query "[0].name" -o tsv)

# SSH-style exec into a running container
az containerapp exec --name sop-api --resource-group sop-rg
```

---

## 10. One-Time Azure Setup Order

The following must be done **once manually** before the GitHub Actions pipeline can run:

1. Create Resource Group: `az group create -n sop-rg -l eastus`
2. Create ACR: `az acr create -n sopacr -g sop-rg --sku Basic --admin-enabled true`
3. Get ACR credentials → save to GitHub Secrets
4. Create Container Apps Environment: `az containerapp env create -n sop-env -g sop-rg -l eastus`
5. Create service principal for GitHub Actions → save JSON to `AZURE_CREDENTIALS` secret
6. Do first manual deploy (creates the Container Apps with initial config + env vars)
7. Copy Container App FQDNs → update `VITE_API_URL` in GitHub Secrets + Cloudflare DNS
8. All subsequent deploys are fully automated via push to `main`

---

## 11. Rollback Strategy

Each deploy tags images with `${{ github.sha }}`. To roll back:

```bash
# In WSL — roll back sop-api to a previous known-good SHA
# Replace abc1234 with the SHA from GitHub Actions run history or ACR tag list
az containerapp update --name sop-api --resource-group sop-rg \
  --image sopacr.azurecr.io/sop-api:abc1234
```

Previous SHAs are visible in ACR and in the GitHub Actions run history.

# CI/CD Azure Container Apps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate deployment of sop-frontend, sop-api, and sop-extractor to Azure Container Apps on every push to `main`, with pre-deploy type/lint checks gating all builds.

**Architecture:** GitHub Actions runs three sequential jobs — `check` (tsc + ruff), `build-push` (builds 3 Docker images and pushes to ACR), and `deploy` (updates 3 Container Apps to the new image SHA). Azure Container Registry stores all images. Azure Container Apps Environment hosts all three services with sop-extractor as internal-only.

**Tech Stack:** GitHub Actions, Azure CLI (`az`), Azure Container Registry, Azure Container Apps, WSL2 (Ubuntu), Docker, Node 20, Python 3.11, ruff

---

## File Map

| Action | Path |
|---|---|
| Create | `.github/workflows/deploy.yml` |
| Reference (no change) | `sop-platform/frontend/Dockerfile` |
| Reference (no change) | `sop-platform/api/Dockerfile` |
| Reference (no change) | `sop-platform/extractor/Dockerfile` |

All work in Tasks 1–4 is run in WSL terminal (Azure CLI). Tasks 5–7 create the GitHub Actions file. Tasks 8–9 wire GitHub Secrets. Task 10 does the first manual Container Apps bootstrap. Task 11 verifies end-to-end.

---

## Task 1: Install WSL2 and Azure CLI

**Where:** Windows PowerShell (Admin) + WSL Ubuntu terminal

- [ ] **Step 1: Enable WSL2 in PowerShell (run as Administrator)**

```powershell
wsl --install
wsl --set-default-version 2
```

Expected output: `Installing: Ubuntu` — then reboot when prompted.

- [ ] **Step 2: Open Ubuntu (WSL) and update packages**

```bash
sudo apt-get update && sudo apt-get upgrade -y
```

- [ ] **Step 3: Install Azure CLI in WSL**

```bash
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
az --version
```

Expected: version line like `azure-cli 2.x.x`

- [ ] **Step 4: Install the Container Apps CLI extension**

```bash
az extension add --name containerapp --upgrade
az extension show --name containerapp --query version
```

- [ ] **Step 5: Log in to Azure**

```bash
az login
# A browser window opens on Windows — complete sign-in there.
# If browser does not open: az login --use-device-code
```

Expected: JSON list of your subscriptions printed to terminal.

- [ ] **Step 6: Set your active subscription**

```bash
az account list --output table
# Find your subscription Name or ID from the table, then:
az account set --subscription "<your-subscription-id-or-name>"
az account show --query name -o tsv   # confirm
```

---

## Task 2: Create Azure Resource Group and Container Registry

**Where:** WSL terminal

- [ ] **Step 1: Create the resource group**

```bash
az group create --name sop-rg --location eastus
```

Expected: `"provisioningState": "Succeeded"`

> If your other Azure resources are in a different region (e.g. `australiaeast`), use that instead of `eastus` for lower latency.

- [ ] **Step 2: Create Azure Container Registry**

```bash
az acr create \
  --resource-group sop-rg \
  --name sopacr \
  --sku Basic \
  --admin-enabled true
```

Expected: JSON with `"loginServer": "sopacr.azurecr.io"`. If `sopacr` is taken (ACR names are globally unique), use `sopplatformacr` or similar and update all subsequent steps.

- [ ] **Step 3: Retrieve ACR credentials — save these now**

```bash
az acr credential show --name sopacr --resource-group sop-rg
```

Output format:
```json
{
  "passwords": [
    { "name": "password",  "value": "XXXX" },
    { "name": "password2", "value": "YYYY" }
  ],
  "username": "sopacr"
}
```

Copy `username` and `passwords[0].value` — you will add these to GitHub Secrets in Task 8.

- [ ] **Step 4: Verify you can log in to ACR**

```bash
az acr login --name sopacr
```

Expected: `Login Succeeded`

---

## Task 3: Create Container Apps Environment

**Where:** WSL terminal

- [ ] **Step 1: Register required Azure providers (first-time only)**

```bash
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights
# Wait ~60 seconds, then verify:
az provider show --namespace Microsoft.App --query registrationState -o tsv
az provider show --namespace Microsoft.OperationalInsights --query registrationState -o tsv
```

Expected: `Registered` for both.

- [ ] **Step 2: Create the Container Apps environment**

```bash
az containerapp env create \
  --name sop-env \
  --resource-group sop-rg \
  --location eastus
```

Expected: `"provisioningState": "Succeeded"` — takes 1–2 minutes.

- [ ] **Step 3: Verify the environment exists**

```bash
az containerapp env show \
  --name sop-env \
  --resource-group sop-rg \
  --query "properties.provisioningState" -o tsv
```

Expected: `Succeeded`

---

## Task 4: Create GitHub Actions Service Principal

**Where:** WSL terminal

This creates an Azure identity that GitHub Actions will use to push images and update Container Apps.

- [ ] **Step 1: Get your subscription ID**

```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
echo $SUBSCRIPTION_ID
```

- [ ] **Step 2: Create the service principal with Contributor role**

```bash
az ad sp create-for-rbac \
  --name "sop-github-actions" \
  --role Contributor \
  --scopes /subscriptions/$SUBSCRIPTION_ID/resourceGroups/sop-rg \
  --sdk-auth
```

The output is a JSON block. **Copy the entire JSON** — you will paste it as the `AZURE_CREDENTIALS` GitHub Secret in Task 8. It looks like:

```json
{
  "clientId": "...",
  "clientSecret": "...",
  "subscriptionId": "...",
  "tenantId": "...",
  "activeDirectoryEndpointUrl": "...",
  ...
}
```

- [ ] **Step 3: Grant the service principal AcrPush role on ACR**

```bash
ACR_ID=$(az acr show --name sopacr --resource-group sop-rg --query id -o tsv)
SP_APP_ID=$(az ad sp list --display-name "sop-github-actions" --query "[0].appId" -o tsv)

az role assignment create \
  --assignee $SP_APP_ID \
  --role AcrPush \
  --scope $ACR_ID
```

Expected: JSON with `"roleDefinitionName": "AcrPush"`

---

## Task 5: Create GitHub Actions Workflow — `check` Job

**Where:** Repo root on your Windows machine (VSCode or file explorer)

- [ ] **Step 1: Create the workflows directory**

```powershell
mkdir "d:\CloudNavision\1. Projects\SOP\SOP Automation System\.github\workflows"
```

- [ ] **Step 2: Create `.github/workflows/deploy.yml` with the `check` job**

Create the file at `.github/workflows/deploy.yml` with this content:

```yaml
name: CI/CD — Build & Deploy to Azure Container Apps

on:
  push:
    branches: [main]

env:
  ACR_LOGIN_SERVER: ${{ secrets.ACR_LOGIN_SERVER }}
  RESOURCE_GROUP: sop-rg
  ENVIRONMENT: sop-env

jobs:
  check:
    name: Type-check & Lint
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node 20
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: sop-platform/frontend/package-lock.json

      - name: Install frontend dependencies
        run: npm ci
        working-directory: sop-platform/frontend

      - name: TypeScript type-check
        run: npm run typecheck
        working-directory: sop-platform/frontend

      - name: Setup Python 3.11
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install ruff
        run: pip install ruff

      - name: Lint API (ruff)
        run: ruff check sop-platform/api
```

- [ ] **Step 3: Verify the typecheck script exists in package.json**

Open `sop-platform/frontend/package.json` and confirm `"typecheck"` is in `scripts`. It should already read:
```json
"typecheck": "tsc --noEmit"
```
If it's named differently, update the workflow step to match.

- [ ] **Step 4: Commit the workflow skeleton**

```bash
cd "d:\CloudNavision\1. Projects\SOP\SOP Automation System"
git add .github/workflows/deploy.yml
git commit -m "ci: add GitHub Actions workflow with check job"
```

---

## Task 6: Add `build-push` Job to Workflow

**Where:** `.github/workflows/deploy.yml`

- [ ] **Step 1: Append the `build-push` job after the `check` job**

Add this block to `.github/workflows/deploy.yml` (after the `check` job, inside the same `jobs:` key):

```yaml
  build-push:
    name: Build & Push Images to ACR
    runs-on: ubuntu-latest
    needs: check
    outputs:
      image-tag: ${{ steps.meta.outputs.tag }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set image tag
        id: meta
        run: echo "tag=${GITHUB_SHA::8}" >> $GITHUB_OUTPUT

      - name: Log in to Azure
        uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Log in to ACR
        run: az acr login --name sopacr

      - name: Build & push sop-frontend
        run: |
          docker build \
            --build-arg VITE_API_URL=${{ secrets.VITE_API_URL }} \
            --build-arg VITE_SUPABASE_URL=${{ secrets.VITE_SUPABASE_URL }} \
            --build-arg VITE_SUPABASE_ANON_KEY=${{ secrets.VITE_SUPABASE_ANON_KEY }} \
            --target prod \
            -t ${{ env.ACR_LOGIN_SERVER }}/sop-frontend:${{ steps.meta.outputs.tag }} \
            -t ${{ env.ACR_LOGIN_SERVER }}/sop-frontend:latest \
            sop-platform/frontend
          docker push ${{ env.ACR_LOGIN_SERVER }}/sop-frontend:${{ steps.meta.outputs.tag }}
          docker push ${{ env.ACR_LOGIN_SERVER }}/sop-frontend:latest

      - name: Build & push sop-api
        run: |
          docker build \
            -t ${{ env.ACR_LOGIN_SERVER }}/sop-api:${{ steps.meta.outputs.tag }} \
            -t ${{ env.ACR_LOGIN_SERVER }}/sop-api:latest \
            sop-platform/api
          docker push ${{ env.ACR_LOGIN_SERVER }}/sop-api:${{ steps.meta.outputs.tag }}
          docker push ${{ env.ACR_LOGIN_SERVER }}/sop-api:latest

      - name: Build & push sop-extractor
        run: |
          docker build \
            -t ${{ env.ACR_LOGIN_SERVER }}/sop-extractor:${{ steps.meta.outputs.tag }} \
            -t ${{ env.ACR_LOGIN_SERVER }}/sop-extractor:latest \
            sop-platform/extractor
          docker push ${{ env.ACR_LOGIN_SERVER }}/sop-extractor:${{ steps.meta.outputs.tag }}
          docker push ${{ env.ACR_LOGIN_SERVER }}/sop-extractor:latest
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add build-push job — ACR image build for all 3 services"
```

---

## Task 7: Add `deploy` Job to Workflow

**Where:** `.github/workflows/deploy.yml`

- [ ] **Step 1: Append the `deploy` job**

Add this block to `.github/workflows/deploy.yml` (after `build-push`, inside `jobs:`):

```yaml
  deploy:
    name: Deploy to Azure Container Apps
    runs-on: ubuntu-latest
    needs: build-push
    steps:
      - name: Log in to Azure
        uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Deploy sop-frontend
        run: |
          az containerapp update \
            --name sop-frontend \
            --resource-group ${{ env.RESOURCE_GROUP }} \
            --image ${{ env.ACR_LOGIN_SERVER }}/sop-frontend:${{ needs.build-push.outputs.image-tag }}

      - name: Deploy sop-api
        run: |
          az containerapp update \
            --name sop-api \
            --resource-group ${{ env.RESOURCE_GROUP }} \
            --image ${{ env.ACR_LOGIN_SERVER }}/sop-api:${{ needs.build-push.outputs.image-tag }}

      - name: Deploy sop-extractor
        run: |
          az containerapp update \
            --name sop-extractor \
            --resource-group ${{ env.RESOURCE_GROUP }} \
            --image ${{ env.ACR_LOGIN_SERVER }}/sop-extractor:${{ needs.build-push.outputs.image-tag }}

      - name: Verify sop-api health
        run: |
          API_URL=$(az containerapp show \
            --name sop-api \
            --resource-group ${{ env.RESOURCE_GROUP }} \
            --query "properties.configuration.ingress.fqdn" -o tsv)
          curl --retry 5 --retry-delay 10 --fail https://$API_URL/health
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add deploy job — az containerapp update for all 3 services"
```

---

## Task 8: Add GitHub Secrets

**Where:** GitHub web UI → `cloudnavision/Infomate_SOP` → Settings → Secrets and variables → Actions

Add each secret exactly as named below. Go to: `https://github.com/cloudnavision/Infomate_SOP/settings/secrets/actions`

- [ ] **Step 1: Add Azure credentials secret**

| Secret name | Value |
|---|---|
| `AZURE_CREDENTIALS` | The full JSON from Task 4 Step 2 |

- [ ] **Step 2: Add ACR secrets**

| Secret name | Value |
|---|---|
| `ACR_LOGIN_SERVER` | `sopacr.azurecr.io` |
| `ACR_USERNAME` | `sopacr` (from Task 2 Step 3) |
| `ACR_PASSWORD` | password value from Task 2 Step 3 |

- [ ] **Step 3: Add frontend build secrets**

These are baked into the React bundle at build time:

| Secret name | Value |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL (e.g. `https://xxxx.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon/public key |
| `VITE_API_URL` | Leave blank for now — fill in after Task 10 Step 4 |

- [ ] **Step 4: Verify all secrets are listed**

In GitHub → Settings → Secrets → Actions, you should see:
`AZURE_CREDENTIALS`, `ACR_LOGIN_SERVER`, `ACR_USERNAME`, `ACR_PASSWORD`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`

---

## Task 9: First Manual Container Apps Bootstrap

**Where:** WSL terminal

This one-time step creates the 3 Container Apps with all env vars configured. Subsequent deploys via GitHub Actions only update the image tag.

- [ ] **Step 1: Log in to ACR and verify images exist**

First push a test image by triggering a manual build, or just verify the `latest` tags exist:
```bash
az acr repository list --name sopacr --output table
```

If no images yet, push to `main` after Task 7 to trigger the first build-push, then return here.

- [ ] **Step 2: Create `sop-extractor` Container App (internal only)**

```bash
az containerapp create \
  --name sop-extractor \
  --resource-group sop-rg \
  --environment sop-env \
  --image sopacr.azurecr.io/sop-extractor:latest \
  --registry-server sopacr.azurecr.io \
  --registry-username sopacr \
  --registry-password "<ACR_PASSWORD from Task 2>" \
  --ingress internal \
  --target-port 8001 \
  --min-replicas 1 \
  --max-replicas 1 \
  --memory 4Gi \
  --cpu 2 \
  --secrets \
    supabase-url="<SUPABASE_URL>" \
    supabase-service-key="<SUPABASE_SERVICE_KEY>" \
    gemini-api-key="<GEMINI_API_KEY>" \
  --env-vars \
    SUPABASE_URL=secretref:supabase-url \
    SUPABASE_SERVICE_KEY=secretref:supabase-service-key \
    GEMINI_API_KEY=secretref:gemini-api-key
```

- [ ] **Step 3: Get the internal FQDN of sop-extractor**

```bash
EXTRACTOR_FQDN=$(az containerapp show \
  --name sop-extractor \
  --resource-group sop-rg \
  --query "properties.configuration.ingress.fqdn" -o tsv)
echo $EXTRACTOR_FQDN
# Example: sop-extractor.internal.eastus.azurecontainerapps.io
```

Save this value — you will pass it to `sop-api` as `EXTRACTOR_BASE_URL`.

- [ ] **Step 4: Create `sop-api` Container App**

```bash
az containerapp create \
  --name sop-api \
  --resource-group sop-rg \
  --environment sop-env \
  --image sopacr.azurecr.io/sop-api:latest \
  --registry-server sopacr.azurecr.io \
  --registry-username sopacr \
  --registry-password "<ACR_PASSWORD>" \
  --ingress external \
  --target-port 8000 \
  --min-replicas 1 \
  --max-replicas 2 \
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
    CORS_ORIGINS="<your-frontend-url>" \
    N8N_WEBHOOK_BASE_URL="https://azuren8n.cloudnavision.com" \
    GEMINI_API_KEY=secretref:gemini-api-key \
    GOOGLE_VISION_API_KEY=secretref:google-vision-api-key \
    INTERNAL_API_KEY=secretref:internal-api-key \
    EXTRACTOR_BASE_URL="http://$EXTRACTOR_FQDN"
```

- [ ] **Step 5: Get the public FQDN of sop-api**

```bash
API_FQDN=$(az containerapp show \
  --name sop-api \
  --resource-group sop-rg \
  --query "properties.configuration.ingress.fqdn" -o tsv)
echo "https://$API_FQDN"
```

Save this — it becomes `VITE_API_URL` in GitHub Secrets (Task 8 Step 3) and `CORS_ORIGINS` in sop-api.

- [ ] **Step 6: Update sop-api CORS_ORIGINS with the actual frontend URL (do after Step 8)**

```bash
az containerapp update \
  --name sop-api \
  --resource-group sop-rg \
  --set-env-vars CORS_ORIGINS="https://<sop-frontend-fqdn>"
```

- [ ] **Step 7: Create `sop-frontend` Container App**

```bash
az containerapp create \
  --name sop-frontend \
  --resource-group sop-rg \
  --environment sop-env \
  --image sopacr.azurecr.io/sop-frontend:latest \
  --registry-server sopacr.azurecr.io \
  --registry-username sopacr \
  --registry-password "<ACR_PASSWORD>" \
  --ingress external \
  --target-port 5173 \
  --min-replicas 1 \
  --max-replicas 2
```

Note: sop-frontend has no runtime env vars — all config is baked into the build via `--build-arg` in GitHub Actions.

- [ ] **Step 8: Get the public FQDN of sop-frontend**

```bash
FRONTEND_FQDN=$(az containerapp show \
  --name sop-frontend \
  --resource-group sop-rg \
  --query "properties.configuration.ingress.fqdn" -o tsv)
echo "https://$FRONTEND_FQDN"
```

Now go back and complete Task 8 Step 3: set `VITE_API_URL` = `https://$API_FQDN` in GitHub Secrets.
Then run Step 6 above to update `CORS_ORIGINS` in sop-api.

---

## Task 10: Verify End-to-End Pipeline

**Where:** WSL terminal + GitHub UI + browser

- [ ] **Step 1: Check all 3 Container Apps are running**

```bash
az containerapp list --resource-group sop-rg --output table
```

Expected: 3 rows, all with `Running` status.

- [ ] **Step 2: Verify sop-api health endpoint**

```bash
curl -f https://$API_FQDN/health
```

Expected: `{"status": "ok"}` or similar.

- [ ] **Step 3: Trigger a full pipeline run**

Push a trivial change to `main` (e.g. add a blank line to README):

```bash
cd "d:\CloudNavision\1. Projects\SOP\SOP Automation System"
git commit --allow-empty -m "ci: trigger first full pipeline run"
git push origin main
```

- [ ] **Step 4: Monitor GitHub Actions**

Go to `https://github.com/cloudnavision/Infomate_SOP/actions`

Watch three jobs complete in sequence:
1. `Type-check & Lint` → green
2. `Build & Push Images to ACR` → green (takes 3–5 min first run)
3. `Deploy to Azure Container Apps` → green

- [ ] **Step 5: Verify new image tags in ACR**

```bash
az acr repository show-tags --name sopacr --repository sop-api --output table
```

Expected: both `latest` and the 8-char git SHA tag listed.

- [ ] **Step 6: Open the frontend in browser**

Navigate to `https://$FRONTEND_FQDN` — confirm the SOP platform loads and can reach the API.

---

## Task 11: Cloudflare Custom Domain (Optional — replace soptest.cloudnavision.com)

**Where:** Azure Portal + Cloudflare DNS dashboard

- [ ] **Step 1: Add custom domain to sop-api Container App**

In Azure Portal → Container Apps → `sop-api` → Custom domains → Add:
- Domain: `soptest.cloudnavision.com`
- Azure will show you a TXT record and CNAME to add — copy them.

- [ ] **Step 2: Add DNS records in Cloudflare**

In Cloudflare DNS for `cloudnavision.com`:
- Add TXT record: as given by Azure (for domain verification)
- Add CNAME: `soptest` → `<sop-api Container App FQDN>`
- Set proxy mode to **DNS only** (grey cloud) — Azure manages TLS, Cloudflare proxy breaks it

- [ ] **Step 3: Validate in Azure Portal**

Click Validate in the Custom Domains pane — both TXT and CNAME checks should go green. Azure auto-provisions a managed TLS certificate (takes ~2 minutes).

- [ ] **Step 4: Update CORS_ORIGINS in sop-api**

```bash
az containerapp update \
  --name sop-api \
  --resource-group sop-rg \
  --set-env-vars CORS_ORIGINS="https://soptest.cloudnavision.com,https://$FRONTEND_FQDN"
```

---

## Task 12: WSL Day-to-Day Management Reference

This task is reference-only — no commits. Run these commands from WSL whenever you need to manage the platform.

- [ ] **Rollback sop-api to a previous deploy**

```bash
# List available image tags
az acr repository show-tags --name sopacr --repository sop-api --output table

# Roll back to a specific SHA (replace abc12345 with the target tag)
az containerapp update \
  --name sop-api \
  --resource-group sop-rg \
  --image sopacr.azurecr.io/sop-api:abc12345
```

- [ ] **View live logs from any container**

```bash
az containerapp logs show --name sop-api --resource-group sop-rg --follow
az containerapp logs show --name sop-extractor --resource-group sop-rg --follow
```

- [ ] **Open an interactive shell inside a running container**

```bash
az containerapp exec --name sop-api --resource-group sop-rg --command /bin/bash
```

- [ ] **Force a restart (new revision)**

```bash
az containerapp revision restart \
  --name sop-api \
  --resource-group sop-rg \
  --revision $(az containerapp revision list \
    --name sop-api \
    --resource-group sop-rg \
    --query "[0].name" -o tsv)
```

- [ ] **Scale replicas manually**

```bash
az containerapp update \
  --name sop-api \
  --resource-group sop-rg \
  --min-replicas 2 \
  --max-replicas 4
```

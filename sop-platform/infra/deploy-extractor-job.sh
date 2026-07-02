#!/bin/bash
# Deploy sop-extractor-job as an Azure Container App Job
# Run once from your local machine (requires az CLI + login)
#
# Fill in: SUBSCRIPTION_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY, GEMINI_API_KEY
# Everything else is already filled in from your Azure setup.

set -e

SUBSCRIPTION_ID="3117a2ba-8530-4eec-a7b0-83cfefcc184d"
RESOURCE_GROUP="rg-saara-workspace"
ENVIRONMENT="sop-env"
JOB_NAME="sop-extractor-job"
REGISTRY="sopacr.azurecr.io"
IMAGE="${REGISTRY}/sop-extractor:latest"

# Supabase + AI credentials (fill these in before running)
SUPABASE_URL="https://<your-project>.supabase.co"
SUPABASE_SERVICE_KEY="<your-supabase-service-role-key>"
GEMINI_API_KEY="<your-gemini-api-key>"

az account set --subscription "$SUBSCRIPTION_ID"

az containerapp job create \
  --name "$JOB_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$ENVIRONMENT" \
  --trigger-type "Manual" \
  --replica-timeout 3600 \
  --replica-retry-limit 0 \
  --replica-completion-count 1 \
  --parallelism 1 \
  --image "$IMAGE" \
  --cpu 2.0 \
  --memory 4.0Gi \
  --registry-server "$REGISTRY" \
  --mi-system-assigned \
  --command "python" "run_job.py" \
  --secrets \
    "supabase-url=${SUPABASE_URL}" \
    "supabase-service-key=${SUPABASE_SERVICE_KEY}" \
    "gemini-api-key=${GEMINI_API_KEY}" \
  --env-vars \
    "SUPABASE_URL=secretref:supabase-url" \
    "SUPABASE_SERVICE_KEY=secretref:supabase-service-key" \
    "GEMINI_API_KEY=secretref:gemini-api-key"

echo ""
echo "Job created: $JOB_NAME"
echo "Next: create service principal and add env vars to sop-api (see Step 5 in plan)"

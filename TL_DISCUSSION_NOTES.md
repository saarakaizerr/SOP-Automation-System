# TL Discussion Notes — SOP Platform Infrastructure

## Current Problem

`sopapp.cloudnavision.com` (Azure frontend) cannot reach `soptest.cloudnavision.com` (API) because the Cloudflare Tunnel is misconfigured.

**Error in tunnel logs:**
```
originService=http://localhost:8000
dial tcp [::1]:8000: connect: connection refused
```

The tunnel is trying to connect to `localhost:8000` inside its own Docker container, but the API runs at `http://sop-api:8000` on the Docker network. This causes a 502 from Cloudflare, which the browser reports as a CORS error.

---

## Fix Option 1 — Quick Fix (5 minutes)

Update the Cloudflare Zero Trust dashboard:

1. Go to one.dash.cloudflare.com → Networks → Tunnels
2. Find the tunnel → Configure
3. Public Hostnames → `soptest.cloudnavision.com`
4. Change **Service URL**: `http://localhost:8000` → `http://sop-api:8000`
5. Save

This fixes the routing so the tunnel can reach the API container via Docker DNS.

**Downside:** Still depends on the laptop being on and Docker running 24/7.

---

## Fix Option 2 — Permanent Fix (Phase 7, ~15 minutes)

Point `soptest.cloudnavision.com` directly at the Azure Container App instead of the Cloudflare Tunnel.

**Steps:**
1. Get the Azure Container App FQDN:
   ```bash
   az containerapp show --name sop-api --resource-group rg-saara-workspace \
     --query "properties.configuration.ingress.fqdn" -o tsv
   ```
2. In Azure Portal → Container Apps → `sop-api` → Custom domains → Add `soptest.cloudnavision.com`
3. Azure gives a TXT + CNAME record — add both in Cloudflare DNS for `cloudnavision.com`
4. Set Cloudflare proxy to **DNS only (grey cloud)** — Azure manages TLS
5. Validate in Azure Portal (cert auto-provisions ~2 min)
6. Update CORS in deploy.yml (already done — `soptest.cloudnavision.com` is in `CORS_ORIGINS`)
7. Cloudflare Tunnel for `soptest` can then be removed

**Benefit:** No laptop/Docker dependency. Push to GitHub → pipeline deploys everything automatically.

---

## Current Architecture (as-is)

```
sopapp.cloudnavision.com  →  Azure Container App (sop-frontend)
                                      │
                                      ▼ VITE_API_URL
soptest.cloudnavision.com →  Cloudflare Tunnel → local Docker (sop-api:8000)
                                                        │
                                                        └─ sop-extractor:8001 (internal)
```

## Target Architecture (after Phase 7)

```
sopapp.cloudnavision.com  →  Azure Container App (sop-frontend)
                                      │
                                      ▼
soptest.cloudnavision.com →  Azure Container App (sop-api)
                                      │
                                      └─ Azure Container App (sop-extractor, internal)
```

---

## Other Notes

- All code changes go through GitHub Actions pipeline (push to `main` → build → deploy to Azure)
- Local Docker (`docker compose --profile tunnel up --build`) is only needed while Cloudflare Tunnel is still in use
- Export (DOCX/PDF) is async — frontend polls every 4s, max 10 min — already deployed and working on Azure side

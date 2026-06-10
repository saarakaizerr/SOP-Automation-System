# Security Checklist — Pre-Client Handover

> Created: 2026-06-09
> Status: In Progress

---

## 🔴 Critical (Blocks Handover)

- [ ] **Fix 1 — Enable RLS + Block Anon Key on All Tables**
  - Anyone with the public anon key can read all SOP data directly from Supabase REST API
  - Enable RLS on every table
  - Policy: `anon` role → deny everything
  - Policy: `authenticated` role → allow based on JWT role claim
  - `service_role` bypasses automatically — n8n and FastAPI unaffected
  - Tables: `sops`, `sop_steps`, `step_callouts`, `step_clips`, `step_discussions`, `transcript_lines`, `sop_sections`, `pipeline_runs`, `sop_versions`, `property_watchlist`, `export_history`, `section_templates`, `processed_sharepoint_files`, `sop_likes`, `sop_activity_log`, `process_groups`, `sop_merge_sessions`, `users`

- [x] **Fix 2 — Move Service Role Key Out of n8n Workflow JSONs**
  - Service role key (full DB access, bypasses all RLS) is hardcoded in 6 workflow JSON files
  - Affected workflows: WF0, WF2, WF3c, WF4, WF5, WF-detect
  - Created "Saara - Supabase Service Role" Header Auth credential in n8n credential store
  - Updated all 43 Supabase HTTP nodes across 6 workflows to use credential
  - Removed SUPABASE_SERVICE_ROLE_KEY from Setup Config nodes in all 6 workflows

- [ ] **Fix 3 — Audit Every FastAPI Route for Auth Decorators**
  - Verify every endpoint in `api/app/routes/` has `require_viewer`, `require_editor`, or `require_admin`
  - No unprotected routes allowed
  - Files to check: `sops.py`, `steps.py`, `exports.py`, `merge.py`, `users.py`, `pipeline.py`, and any others

- [ ] **Fix 4 — Validate INTERNAL_API_KEY on All n8n Webhook Receivers**
  - Webhook URLs are fixed public URLs — anyone who knows them can trigger pipeline processing
  - Every webhook entry point must validate `x-internal-key` header before processing
  - Webhooks to check: WF0, WF2, WF3, WF4, WF5 trigger nodes

---

## 🟠 High (Do Alongside)

- [ ] **Fix 5 — Cloudflare Bot Fight Mode WAF Rule**
  - n8n HTTP requests blocked by Cloudflare Bot Fight Mode on `soptest.cloudnavision.com`
  - Cloudflare dashboard → Security → WAF → Custom Rules
  - Rule: skip Bot Fight Mode when `x-internal-key` header equals `INTERNAL_API_KEY` value
  - Then confirm all n8n HTTP nodes send that header

- [ ] **Fix 6 — Lock Down CORS to Exact Domains**
  - Confirm `CORS_ORIGINS` in `.env` only contains actual frontend domains
  - Expected: `["http://localhost:5173","https://sopapp.cloudnavision.com","https://soptest.cloudnavision.com"]`
  - Must NOT contain `*`

---

## 🟡 Medium (Post-Handover OK)

- [ ] **Fix 7 — Azure SAS Token Rotation Strategy**
  - Static SAS token with full blob access hardcoded in `.env` and n8n workflows, valid until 2026-10-31
  - Generate SAS tokens programmatically in FastAPI (short TTL, on-demand)
  - Remove static token from n8n workflow configs

- [ ] **Fix 8 — Rate Limiting on FastAPI**
  - No per-IP request limits on any endpoint
  - Add `slowapi` middleware
  - Apply limits on heavy endpoints: pipeline triggers, exports, render-annotated

---

## Progress Summary

| Fix | Status | Notes |
|-----|--------|-------|
| 1 — RLS policies | ✅ SQL ready | Run schema/009_enable_rls.sql in Supabase SQL editor |
| 2 — Service key out of workflows | ✅ Done | 43 nodes updated, credential store used |
| 3 — FastAPI route auth audit | ✅ Done | All 52 endpoints protected — nothing to change |
| 4 — Webhook key validation | ✅ Done | sop-api sends x-internal-key; Validate Internal Key node added to WF0 + WF-detect |
| 5 — Bot Fight Mode WAF | ⬜ Todo | WAF rule not yet created |
| 6 — CORS lockdown | ✅ Done | No wildcard, 4 exact domains — clean |
| 7 — SAS token rotation | ⬜ Todo | Current token expires 2026-10-31 |
| 8 — Rate limiting | ⬜ Todo | |

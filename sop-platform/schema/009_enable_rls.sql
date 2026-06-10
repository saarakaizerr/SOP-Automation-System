-- ================================================================
-- Migration 009: Enable Row Level Security on all tables
-- Date: 2026-06-09
--
-- PURPOSE:
--   Blocks direct Supabase REST API access using the public anon key.
--   Without this, anyone with the anon key (visible in the frontend
--   JS bundle) can read/write all data via REST.
--
-- DOES NOT AFFECT:
--   - n8n workflows (use service_role key → bypasses RLS automatically)
--   - FastAPI backend (uses direct PostgreSQL via SQLAlchemy → bypasses RLS)
--
-- POLICY DESIGN:
--   No explicit policies for anon or authenticated roles.
--   When RLS is enabled with no matching policy, access is DENIED by default.
--   service_role always bypasses RLS — this is Supabase built-in behaviour.
-- ================================================================

-- Core SOP tables
ALTER TABLE public.sops                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sop_steps                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sop_sections              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sop_versions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sop_merge_sessions        ENABLE ROW LEVEL SECURITY;

-- Step detail tables
ALTER TABLE public.step_callouts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.step_clips                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.step_discussions          ENABLE ROW LEVEL SECURITY;

-- User & access tables
ALTER TABLE public.users                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sop_likes                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sop_activity_log          ENABLE ROW LEVEL SECURITY;

-- Pipeline & workflow tables
ALTER TABLE public.pipeline_runs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_lines          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_sharepoint_files ENABLE ROW LEVEL SECURITY;

-- Config & reference tables
ALTER TABLE public.property_watchlist        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_history            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.section_templates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.process_groups            ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- VERIFICATION: After running, confirm in Supabase dashboard that
-- all tables show "RLS enabled" (green lock icon, not red "RLS disabled").
-- Test: curl with anon key should return 0 rows or 401, not data.
-- ================================================================

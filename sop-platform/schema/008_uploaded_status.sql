-- Phase: Manual Pipeline Trigger
-- Adds 'uploaded' SOP status (video registered, awaiting admin initialization)
-- Adds 'awaiting_approval' pipeline status (placeholder run before WF0 fires)

ALTER TYPE sop_status ADD VALUE IF NOT EXISTS 'uploaded';
ALTER TYPE pipeline_status ADD VALUE IF NOT EXISTS 'awaiting_approval';

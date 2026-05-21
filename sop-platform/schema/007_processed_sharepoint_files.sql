-- Migration 007: Track SharePoint files that have been ingested
-- Prevents the same video from being processed more than once.
-- WF0 checks this table before creating a new SOP; marks files here after processing.
CREATE TABLE IF NOT EXISTS processed_sharepoint_files (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id          TEXT NOT NULL,
    file_name        TEXT,
    file_size_bytes  BIGINT,
    sop_id           UUID REFERENCES sops(id) ON DELETE SET NULL,
    processed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_processed_sharepoint_file_id UNIQUE (file_id)
);

CREATE INDEX IF NOT EXISTS idx_processed_sharepoint_files_file_id ON processed_sharepoint_files (file_id);

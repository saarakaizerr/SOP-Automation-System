-- Extractor jobs queue — tracks Container App Job executions
-- task_type: 'extract' | 'clip' | 'split' | 'probe' | 'render_doc'
-- status:    'queued'  | 'running' | 'completed' | 'failed'
CREATE TABLE IF NOT EXISTS extractor_jobs (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    task_type     TEXT        NOT NULL,
    status        TEXT        NOT NULL DEFAULT 'queued',
    input_params  JSONB       NOT NULL DEFAULT '{}',
    result        JSONB,
    error_message TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at    TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_extractor_jobs_status     ON extractor_jobs(status);
CREATE INDEX IF NOT EXISTS idx_extractor_jobs_created_at ON extractor_jobs(created_at DESC);

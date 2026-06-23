-- Add 'paused' value to pipeline_status enum for pause/resume support
ALTER TYPE pipeline_status ADD VALUE IF NOT EXISTS 'paused';

-- Stage 3 (autopilot): execution time limit, autonomy level per feature, and the autopilot's runs and decision log.
ALTER TABLE autonomy_policies ADD COLUMN max_execution_minutes INTEGER NOT NULL DEFAULT 30;

CREATE TABLE IF NOT EXISTS feature_autonomy (
    feature_id TEXT PRIMARY KEY REFERENCES knowledge_entities(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    level TEXT NOT NULL DEFAULT 'MANUAL' CHECK(level IN ('MANUAL', 'AUTO_ACCEPT', 'PILOT')),
    execution_model TEXT,
    escalation_model TEXT,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    usage_pause_threshold REAL NOT NULL DEFAULT 0.85,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pilot_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    feature_id TEXT NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('RUNNING', 'PAUSED', 'WAITING_USER', 'COMPLETED', 'STOPPED', 'FAILED')),
    reason TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pilot_runs_feature ON pilot_runs(feature_id, started_at);

CREATE TABLE IF NOT EXISTS pilot_events (
    id TEXT PRIMARY KEY,
    pilot_run_id TEXT NOT NULL REFERENCES pilot_runs(id) ON DELETE CASCADE,
    sequence_no INTEGER NOT NULL,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    work_item_id TEXT,
    execution_id TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pilot_events_run ON pilot_events(pilot_run_id, sequence_no);

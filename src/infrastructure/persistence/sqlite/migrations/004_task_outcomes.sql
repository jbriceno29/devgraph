-- Stage 2 (memory that flows): what an accepted task left behind, read by the tasks that depend on it.
CREATE TABLE IF NOT EXISTS task_outcomes (
    work_item_id TEXT PRIMARY KEY REFERENCES knowledge_entities(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    execution_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    files_json TEXT NOT NULL,
    checks_json TEXT NOT NULL,
    merged_commit TEXT,
    integration_branch TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_outcomes_project ON task_outcomes(project_id);
CREATE INDEX IF NOT EXISTS idx_code_references_path ON code_references(file_path);

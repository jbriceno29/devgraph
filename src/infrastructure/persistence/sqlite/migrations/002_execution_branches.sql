-- Stage 1 (close the loop): record where each execution starts from and the integration branch of each feature.
ALTER TABLE agent_executions ADD COLUMN base_branch TEXT;

CREATE TABLE IF NOT EXISTS feature_branches (
    feature_id TEXT PRIMARY KEY REFERENCES knowledge_entities(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    branch_name TEXT NOT NULL,
    source_branch TEXT NOT NULL,
    created_at TEXT NOT NULL
);

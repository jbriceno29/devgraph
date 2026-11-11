-- Orquestador de inicio: estado de la fase por proyecto (preguntas, respuestas, propuesta) y lo que queda fuera del alcance.
CREATE TABLE IF NOT EXISTS project_inception (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    stage TEXT NOT NULL CHECK(stage IN ('ASK_GOALS', 'PROPOSAL', 'APPLIED')),
    status TEXT NOT NULL CHECK(status IN ('WORKING', 'WAITING_USER', 'FAILED', 'DONE')),
    brief TEXT NOT NULL DEFAULT '',
    questions_json TEXT NOT NULL DEFAULT '[]',
    answers_json TEXT NOT NULL DEFAULT '[]',
    assumptions_json TEXT NOT NULL DEFAULT '[]',
    change_set_id TEXT REFERENCES change_sets(id) ON DELETE SET NULL,
    model TEXT,
    usage_json TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
ALTER TABLE projects ADD COLUMN out_of_scope_json TEXT NOT NULL DEFAULT '[]';

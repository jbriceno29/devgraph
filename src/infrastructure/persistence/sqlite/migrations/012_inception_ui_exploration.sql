-- Inicio del proyecto, exploración visual: nueva etapa EXPLORE_UI entre las preguntas y la propuesta, y las direcciones visuales con su
-- prototipo HTML (generadas o importadas), la que aprobó el usuario y si quiso explorar el diseño, en un solo JSON (ui_json).
-- SQLite no permite cambiar un CHECK, así que la tabla se reconstruye copiando las filas (las tablas que la referencian no existen:
-- nada apunta a project_inception).
CREATE TABLE project_inception_new (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    stage TEXT NOT NULL CHECK(stage IN ('ASK_GOALS', 'EXPLORE_UI', 'PROPOSAL', 'APPLIED')),
    status TEXT NOT NULL CHECK(status IN ('WORKING', 'WAITING_USER', 'FAILED', 'DONE')),
    brief TEXT NOT NULL DEFAULT '',
    questions_json TEXT NOT NULL DEFAULT '[]',
    answers_json TEXT NOT NULL DEFAULT '[]',
    assumptions_json TEXT NOT NULL DEFAULT '[]',
    change_set_id TEXT REFERENCES change_sets(id) ON DELETE SET NULL,
    model TEXT,
    usage_json TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    notes_json TEXT NOT NULL DEFAULT '[]',
    scaffold_task_id TEXT,
    references_json TEXT NOT NULL DEFAULT '[]',
    ui_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
INSERT INTO project_inception_new(project_id, stage, status, brief, questions_json, answers_json, assumptions_json, change_set_id, model, usage_json, error, notes_json, scaffold_task_id, references_json, created_at, updated_at)
    SELECT project_id, stage, status, brief, questions_json, answers_json, assumptions_json, change_set_id, model, usage_json, error, notes_json, scaffold_task_id, references_json, created_at, updated_at FROM project_inception;
DROP TABLE project_inception;
ALTER TABLE project_inception_new RENAME TO project_inception;

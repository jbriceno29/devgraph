-- Inicio del proyecto: indicaciones de cambio para regenerar la propuesta y la tarea de preparación ya creada.
ALTER TABLE project_inception ADD COLUMN notes_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE project_inception ADD COLUMN scaffold_task_id TEXT;
-- Cuándo se integró la rama de la feature en su rama base (se borra si la feature recibe trabajo nuevo).
ALTER TABLE feature_branches ADD COLUMN integrated_at TEXT;

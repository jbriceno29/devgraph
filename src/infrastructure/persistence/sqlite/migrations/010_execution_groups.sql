-- Etapa 0 (agrupación de tareas): una ejecución puede cubrir varias tareas de la misma feature.
-- `agent_executions.work_item_id` sigue siendo la tarea líder; aquí van todas las cubiertas (la líder en posición 0).
-- Las ejecuciones anteriores a esta migración no tienen filas: cubren solo su tarea líder.
CREATE TABLE IF NOT EXISTS execution_work_items (
    execution_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
    work_item_id TEXT NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (execution_id, work_item_id)
);
CREATE INDEX IF NOT EXISTS idx_execution_work_items_task ON execution_work_items(work_item_id);

-- Opción del piloto por feature: agrupar tareas pequeñas (desactivada por defecto) y tamaño máximo del grupo.
ALTER TABLE feature_autonomy ADD COLUMN group_tasks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feature_autonomy ADD COLUMN max_group_size INTEGER NOT NULL DEFAULT 3;

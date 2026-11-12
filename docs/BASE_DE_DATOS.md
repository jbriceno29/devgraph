# Base de datos

Fuente: `src/infrastructure/persistence/sqlite/migrations/*.sql` y `database.ts`.

## Cómo se organiza

- **Una base SQLite por proyecto:** `<datos de la app>/projects/<id>/workspace.sqlite` (`ProjectWorkspaceStore`). Modo WAL, claves foráneas activadas.
- **Migraciones ordenadas** (`MIGRATIONS` en `database.ts`): `PRAGMA user_version` guarda la última aplicada; cada una se aplica una sola vez y en su propia transacción. Abrir un proyecto antiguo lo actualiza.
- SQLite guarda el **estado estructurado**; los documentos Markdown viven en el repositorio Git del usuario y la base guarda su ruta, hash y estado de sincronización.

## Migraciones

| # | Archivo | Qué añade |
| :--- | :--- | :--- |
| 001 | `001_initial_workspace_schema.sql` | Esquema base: proyectos, repositorios, grafo (entidades, subtipos y aristas), agentes y proveedores, sesiones, snapshots de contexto, ejecuciones, eventos, diffs, ChangeSets, política de autonomía, aprobaciones e índice de texto completo (FTS5) con sus triggers. |
| 002 | `002_execution_branches.sql` | `agent_executions.base_branch` y la tabla `feature_branches` (rama de integración de cada feature). |
| 003 | `003_execution_review.sql` | Resultado de la revisión de cada ejecución: `execution_branch`, `revision_of`, `review_status` (`ACCEPTED`, `CHANGES_REQUESTED`, `MERGE_CONFLICT`), `review_note`, `merged_commit`, `reviewed_at`. |
| 004 | `004_task_outcomes.sql` | Tabla `task_outcomes` (lo que dejó una tarea aceptada) e índice sobre `code_references.file_path`. |
| 005 | `005_autonomy.sql` | `autonomy_policies.max_execution_minutes` (30 por defecto) y las tablas `feature_autonomy`, `pilot_runs` y `pilot_events`. |
| 006 | `006_decision_policy.sql` | `autonomy_policies.decision_policy_json` (nulo = valores por defecto). |
| 007 | `007_max_turns.sql` | `autonomy_policies.max_turns` (nulo o 0 = sin límite). |
| 008 | `008_project_inception.sql` | Tabla `project_inception` y `projects.out_of_scope_json`. |
| 009 | `009_inception_notes_and_integration.sql` | `project_inception.notes_json` y `scaffold_task_id`; `feature_branches.integrated_at`. |
| 010 | `010_execution_groups.sql` | Tabla `execution_work_items` (tareas que cubre una ejecución agrupada, con posición) y `feature_autonomy.group_tasks` (0 por defecto) y `max_group_size` (3). |
| 012 | `012_inception_ui_exploration.sql` | Reconstruye `project_inception` para admitir la etapa `EXPLORE_UI` (SQLite no permite cambiar un `CHECK`; las filas se copian) y añade `ui_json`: las direcciones de diseño con su prototipo HTML, la elegida y si se pidió explorar el diseño. |
| 011 | `011_inception_references.sql` | `project_inception.references_json`: las referencias adjuntas (tipo, nota, estado y traducción a texto de cada una). Los archivos viven en `projects/<id>/inception/references/`. |
| 013 | `013_inception_repository_scan.sql` | `project_inception.repository_json` (`null` por defecto): en modo brownfield, lo leído del repositorio al empezar (manifiestos, estructura y estilos, como mucho 48 KB), las inferencias con su evidencia y las correcciones del usuario. |

## Tablas principales

### Proyecto y repositorio

- `projects`: nombre, slug, descripción, `objectives_json`, `tech_stack_json`, `rules_json` (las reglas son contexto de nivel 1), `out_of_scope_json` (008), `current_revision` (la revisión del grafo).
- `repositories`: ruta local, rama por defecto, `is_primary`.

### Grafo de conocimiento

- `knowledge_entities`: tabla polimórfica con `entity_type` (`PROJECT_ROOT`, `MODULE`, `FEATURE`, `REQUIREMENT`, `WORK_ITEM`, `MILESTONE`, `DECISION_RECORD`, `ARTIFACT`, `CODE_REFERENCE`), `display_key` (`FEAT-001`, `TASK-012`, `ADR-001`…), título, resumen, estado, padre y revisiones de creación y actualización.
- Subtipos (uno por entidad): `modules`, `features`, `requirements`, `work_items` (tipo, prioridad, criterios de aceptación), `milestones`, `decision_records` (alternativas, decisión, consecuencias, ruta y hash), `artifacts` (tipo, ruta, hash, `sync_status`), `code_references` (archivo, símbolo, commit).
- `graph_edges`: aristas tipadas (`DEPENDS_ON`, `IMPLEMENTS`, `SATISFIES`, `AFFECTS`, `SUPERSEDES`, `DOCUMENTED_BY`, `VERIFIED_BY`, `TOUCHES_CODE`, `MODIFIES`, `GENERATED_BY`, `SCOPED_IN`) con procedencia `USER`, `CHANGESET` o `EXECUTION`.
- `change_sets`: propuestas de cambio (`PENDING_APPROVAL`, `VALIDATED`, `CONFLICTED`, `APPLIED`, `REJECTED`), con su origen (`AI_CHAT`, `AGENT_EXECUTION`, `USER_BULK_ACTION`), operaciones y errores de validación.
- `fts_knowledge_index`: índice FTS5 mantenido por triggers sobre `knowledge_entities`.

### Agentes y ejecuciones

- `agent_profiles` (roles `PLANNER`, `ARCHITECT`, `DEVELOPER`, `REVIEWER`, `KNOWLEDGE_MANAGER`), `agent_providers` (`codex`, `claude-code`, `opencode`), `provider_connections`, `agent_sessions`.
- `context_snapshots`: qué fuentes entraron al contexto de una ejecución, con el commit de partida y la revisión del grafo.
- `agent_executions`: estado (`QUEUED`, `PREPARING_CONTEXT`, `RUNNING`, `AWAITING_APPROVAL`, `VALIDATING`, `COMPLETED`, `FAILED`, `CANCELLED`), modelo usado, commits inicial y final, worktree; más `base_branch` (002) y los campos de revisión (003). `work_item_id` es la tarea líder; una ejecución agrupada (Etapa 0) lista todas las tareas que cubre en `execution_work_items` (010), la líder en posición 0. Las ejecuciones sin filas ahí cubren solo su tarea.
- `agent_events`: eventos del motor por ejecución, en orden.
- `execution_file_diffs`: diff por archivo de cada ejecución.
- `approval_requests`: acciones que el agente pidió y la política no permitía.
- `feature_branches` (002, 009): rama de integración de cada feature, rama de origen y `integrated_at`.

### Memoria

- `task_outcomes` (004): una fila por tarea aceptada con el resumen de cierre, los archivos y comprobaciones (JSON), el commit integrado y la rama de integración. Las convenciones del resumen se extraen de aquí y pasan a reglas de nivel 1.

### Autonomía y piloto

- `autonomy_policies`: rutas escribibles, solo lectura y denegadas, comandos permitidos, aislamiento por worktree, `max_execution_minutes` (005), `decision_policy_json` (006) y `max_turns` (007).
- `feature_autonomy` (005, 010): nivel por feature (`MANUAL`, `AUTO_ACCEPT`, `PILOT`), modelo de ejecución y de escalamiento, intentos máximos (3 por defecto), umbral de pausa por uso (0,85 por defecto), y si el piloto agrupa tareas pequeñas (`group_tasks`; la columna nace en 0 para las filas ya guardadas, y una feature sin fila usa el valor por defecto del dominio, activo) con el tamaño máximo del grupo (`max_group_size`, 3).
- `pilot_runs` (005): corridas del piloto (`RUNNING`, `PAUSED`, `WAITING_USER`, `COMPLETED`, `STOPPED`, `FAILED`) con su razón.
- `pilot_events` (005): registro de cada decisión del piloto (inicio, tarea iniciada o aceptada, reintento, escalamiento, pausa, espera del usuario, cambios al plan…).

### Inicio de proyecto y actividad

- `project_inception` (008, 009, 011, 012, 013): una fila por proyecto con fase (`ASK_GOALS`, `EXPLORE_UI`, `PROPOSAL`, `APPLIED`), estado (`WORKING`, `WAITING_USER`, `FAILED`, `DONE`), descripción, preguntas, respuestas, suposiciones, el ChangeSet de la propuesta, modelo, uso, error, notas de regeneración, el id de la tarea de scaffold, las referencias, la exploración visual y, en modo brownfield, el escaneo del repositorio.
- **La bandeja de actividad no tiene tabla propia:** `activity:list` la deriva de tareas, ejecuciones, aprobaciones, ChangeSets, corridas del piloto, ramas de feature y el estado de `project_inception`.

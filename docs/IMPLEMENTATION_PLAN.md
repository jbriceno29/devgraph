# Technical Implementation Plan v1 (`IMPLEMENTATION_PLAN.md`)

**Estado del Documento:** Consolidado y Alineado · Versión 1.1  
**Paradigma Arquitectónico:** Modular Monolith · Desktop-First · Local-First  
**Dependencias Documentales:** `docs/domain/DOMAIN.md` (Domain Model v1.1), `docs/architecture/ARCHITECTURE.md` (Technical Architecture v1.1)  
**Propósito:** Definir la hoja de ruta detallada en 8 etapas progresivas para la construcción del MVP del Workspace, incluyendo el esquema físico SQL inicial de SQLite 100% alineado con el dominio, sus triggers de indexación FTS5, entregables por etapa y criterios de verificación.

---

## 1. Visión General de la Hoja de Ruta

El desarrollo del MVP se estructura en 8 etapas secuenciales basadas en dependencias de dominio e infraestructura. Desde la Etapa 2 el proyecto ya es navegable visualmente en el grafo, y cada etapa posterior añade una capacidad completa hasta cerrar el ciclo de desarrollo con agentes en la Etapa 8.

```mermaid
gantt
    title Hoja de Ruta de Implementación del MVP
    dateFormat  X
    axisFormat Etapa %s
    
    section Núcleo Estructural
    Etapa 1: Domain Model & SQLite DDL       :done, e1, 0, 1
    Etapa 2: Graph Engine & Canvas UI        :active, e2, 1, 3
    section Conocimiento y Planificación
    Etapa 3: Artifact & Markdown Sync        :e3, 2, 4
    Etapa 4: AI Planning & ChangeSets        :e4, 3, 5
    Etapa 5: Context Engine Pipeline         :e5, 4, 6
    section Ejecución y Gobernanza
    Etapa 6: Agent Integration Layer         :e6, 5, 7
    Etapa 7: Governance & Git Worktrees      :e7, 6, 8
    Etapa 8: Feedback Loop & E2E Scenario    :e8, 7, 9
```

---

## 2. Esquema Físico SQL Inicial Alineado (SQLite DDL + FTS5 + Triggers)

Este script SQL (`001_initial_workspace_schema.sql`) implementa el modelo relacional con grafo superpuesto alineado con todas las invariantes de `DOMAIN.md` v1.1:
* Incluye `'PROJECT_ROOT'` en `knowledge_entities.entity_type` para anclar documentos de nivel proyecto (`PRD.md`, `ARCHITECTURE.md`).
* Incluye `'MODIFIES'` y `'GENERATED_BY'` en `graph_edges.edge_type` junto con `execution_id` para trazabilidad forense.
* Unifica las columnas de `change_sets` (`base_graph_revision`, `applied_graph_revision`, `origin_type`, `status`).
* Define el orden referencial correcto entre `context_snapshots` y `agent_executions`.
* Incorpora los triggers automáticos de sincronización para `fts_knowledge_index`.

```sql
-- ============================================================================
-- WORKSPACE INITIAL SQLITE DDL SCHEMA (v1.1 - Aligned with DOMAIN.md v1.1)
-- ============================================================================

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;

-- 1. PROYECTOS Y REPOSITORIOS
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    objectives_json TEXT NOT NULL DEFAULT '[]',   -- JSON array de objetivos
    tech_stack_json TEXT NOT NULL DEFAULT '{}',   -- JSON con lenguajes, frameworks y comandos test/build
    rules_json TEXT NOT NULL DEFAULT '[]',        -- JSON con restricciones innegociables (Nivel 1 de contexto)
    current_revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repositories (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    local_path TEXT NOT NULL,
    git_provider TEXT NOT NULL DEFAULT 'local',
    default_branch TEXT NOT NULL DEFAULT 'main',
    head_commit TEXT,
    is_primary INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

-- 2. NÚCLEO POLIMÓRFICO DEL GRAFO Y ESTRUCTURA DE ENTIDADES
CREATE TABLE IF NOT EXISTS knowledge_entities (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK(entity_type IN (
        'PROJECT_ROOT', 'MODULE', 'FEATURE', 'REQUIREMENT', 'WORK_ITEM', 
        'MILESTONE', 'DECISION_RECORD', 'ARTIFACT', 'CODE_REFERENCE'
    )),
    display_key TEXT NOT NULL,     -- Ej. PROJ-01, MOD-01, FEAT-03, TASK-12, ADR-001
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'DRAFT',
    parent_id TEXT REFERENCES knowledge_entities(id) ON DELETE CASCADE,
    created_revision INTEGER NOT NULL,
    updated_revision INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, display_key),
    CHECK (id != parent_id)
);

CREATE INDEX IF NOT EXISTS idx_entities_project ON knowledge_entities(project_id);
CREATE INDEX IF NOT EXISTS idx_entities_type ON knowledge_entities(project_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_parent ON knowledge_entities(parent_id);

-- Subtipos especializados (Class Table Inheritance)
CREATE TABLE IF NOT EXISTS modules (
    entity_id TEXT PRIMARY KEY REFERENCES knowledge_entities(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL,
    domain_boundary TEXT,
    module_kind TEXT NOT NULL DEFAULT 'FUNCTIONAL' CHECK(module_kind IN ('FUNCTIONAL', 'TECHNICAL', 'SHARED'))
);

CREATE TABLE IF NOT EXISTS features (
    entity_id TEXT PRIMARY KEY REFERENCES knowledge_entities(id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK(priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    business_value TEXT,
    complexity_estimate INTEGER
);

CREATE TABLE IF NOT EXISTS requirements (
    entity_id TEXT PRIMARY KEY REFERENCES knowledge_entities(id) ON DELETE CASCADE,
    req_type TEXT NOT NULL DEFAULT 'FUNCTIONAL' CHECK(req_type IN ('FUNCTIONAL', 'NON_FUNCTIONAL', 'CONSTRAINT')),
    priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK(priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
    verification_method TEXT
);

CREATE TABLE IF NOT EXISTS work_items (
    entity_id TEXT PRIMARY KEY REFERENCES knowledge_entities(id) ON DELETE CASCADE,
    work_type TEXT NOT NULL DEFAULT 'TASK' CHECK(work_type IN ('TASK', 'BUG', 'SPIKE', 'IMPROVEMENT')),
    priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK(priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    scope_notes TEXT,
    acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
    recommended_profile_role TEXT CHECK(recommended_profile_role IS NULL OR recommended_profile_role IN (
        'PLANNER', 'ARCHITECT', 'DEVELOPER', 'REVIEWER', 'KNOWLEDGE_MANAGER'
    ))
);

CREATE TABLE IF NOT EXISTS milestones (
    entity_id TEXT PRIMARY KEY REFERENCES knowledge_entities(id) ON DELETE CASCADE,
    version_tag TEXT NOT NULL,
    objectives_json TEXT NOT NULL DEFAULT '[]',
    target_date TEXT,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS decision_records (
    entity_id TEXT PRIMARY KEY REFERENCES knowledge_entities(id) ON DELETE CASCADE,
    adr_number INTEGER NOT NULL,
    context_md TEXT NOT NULL,
    alternatives_md TEXT NOT NULL,
    decision_md TEXT NOT NULL,
    consequences_md TEXT NOT NULL,
    relative_path TEXT NOT NULL,     -- Ej. docs/architecture/ADR/ADR-001.md
    content_hash TEXT NOT NULL,      -- SHA-256 del archivo en disco
    sync_status TEXT NOT NULL DEFAULT 'SYNCED' CHECK(sync_status IN ('SYNCED', 'DRIFTED', 'MISSING', 'UNTRACKED')),
    decided_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
    entity_id TEXT PRIMARY KEY REFERENCES knowledge_entities(id) ON DELETE CASCADE,
    repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    artifact_type TEXT NOT NULL CHECK(artifact_type IN (
        'PRD', 'ARCHITECTURE', 'SPEC', 'IMPLEMENTATION_PLAN', 'DOMAIN_DOC', 'OTHER'
    )),
    relative_path TEXT NOT NULL,     -- Ej. docs/features/auth/specification.md
    version INTEGER NOT NULL DEFAULT 1,
    content_hash TEXT NOT NULL,      -- SHA-256 del contenido
    sync_status TEXT NOT NULL DEFAULT 'SYNCED' CHECK(sync_status IN ('SYNCED', 'DRIFTED', 'MISSING', 'UNTRACKED'))
);

CREATE TABLE IF NOT EXISTS code_references (
    entity_id TEXT PRIMARY KEY REFERENCES knowledge_entities(id) ON DELETE CASCADE,
    repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,         -- Ej. src/services/AuthService.ts
    symbol_name TEXT,
    symbol_kind TEXT,
    line_start INTEGER,
    line_end INTEGER,
    commit_sha TEXT NOT NULL
);

-- 3. SISTEMA DE AGENTES, CONTEXT SNAPSHOTS Y EJECUCIONES
CREATE TABLE IF NOT EXISTS agent_profiles (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    role_key TEXT NOT NULL CHECK(role_key IN ('PLANNER', 'ARCHITECT', 'DEVELOPER', 'REVIEWER', 'KNOWLEDGE_MANAGER')),
    name TEXT NOT NULL,
    system_instructions TEXT NOT NULL,
    default_provider_id TEXT,
    default_policy_id TEXT
);

CREATE TABLE IF NOT EXISTS agent_providers (
    id TEXT PRIMARY KEY,
    provider_key TEXT NOT NULL UNIQUE CHECK(provider_key IN ('codex', 'claude-code', 'opencode')),
    display_name TEXT NOT NULL,
    adapter_version TEXT NOT NULL,
    capabilities_json TEXT NOT NULL  -- 6 boolean flags de AgentCapabilities
);

CREATE TABLE IF NOT EXISTS provider_connections (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL REFERENCES agent_providers(id) ON DELETE CASCADE,
    executable_path TEXT,
    server_url TEXT,
    config_json TEXT,
    health_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(health_status IN ('UNKNOWN', 'HEALTHY', 'UNHEALTHY')),
    last_checked_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL REFERENCES agent_providers(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
    external_session_id TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'PAUSED', 'CLOSED', 'FAILED')),
    created_at TEXT NOT NULL,
    last_active_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS context_snapshots (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    execution_id TEXT,               -- Opcional si se generó en sesión de Chat; indexado abajo
    focus_entity_id TEXT NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
    repository_commit TEXT NOT NULL,
    graph_revision INTEGER NOT NULL,
    constraints_json TEXT NOT NULL DEFAULT '[]',
    included_sources_json TEXT NOT NULL DEFAULT '[]',
    excluded_sources_json TEXT NOT NULL DEFAULT '[]',
    token_usage_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_execution ON context_snapshots(execution_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_focus ON context_snapshots(focus_entity_id);

CREATE TABLE IF NOT EXISTS agent_executions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    work_item_id TEXT REFERENCES knowledge_entities(id) ON DELETE SET NULL,
    profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL REFERENCES agent_providers(id) ON DELETE CASCADE,
    session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,
    context_snapshot_id TEXT REFERENCES context_snapshots(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'QUEUED' CHECK(status IN (
        'QUEUED', 'PREPARING_CONTEXT', 'RUNNING', 'AWAITING_APPROVAL', 
        'VALIDATING', 'COMPLETED', 'FAILED', 'CANCELLED'
    )),
    model_used TEXT,
    initial_commit TEXT NOT NULL,
    final_commit TEXT,
    branch_or_worktree TEXT,
    test_summary_json TEXT,
    result_summary TEXT,
    started_at TEXT,
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_executions_work_item ON agent_executions(work_item_id);
CREATE INDEX IF NOT EXISTS idx_executions_status ON agent_executions(project_id, status);

CREATE TABLE IF NOT EXISTS agent_events (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
    sequence_no INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(execution_id, sequence_no)
);

CREATE INDEX IF NOT EXISTS idx_agent_events_exec ON agent_events(execution_id, sequence_no);

CREATE TABLE IF NOT EXISTS execution_file_diffs (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
    repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    change_type TEXT NOT NULL CHECK(change_type IN ('ADDED', 'MODIFIED', 'DELETED', 'RENAMED')),
    additions INTEGER NOT NULL DEFAULT 0,
    deletions INTEGER NOT NULL DEFAULT 0,
    diff_patch TEXT
);

-- 4. CHANGESETS (PROPUESTAS TRANSACCIONALES DE CAMBIO)
CREATE TABLE IF NOT EXISTS change_sets (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    base_graph_revision INTEGER NOT NULL,
    applied_graph_revision INTEGER,
    origin_type TEXT NOT NULL CHECK(origin_type IN ('AI_CHAT', 'AGENT_EXECUTION', 'USER_BULK_ACTION')),
    origin_ref_id TEXT,
    title TEXT NOT NULL,
    rationale TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK(status IN (
        'PENDING_APPROVAL', 'VALIDATED', 'CONFLICTED', 'APPLIED', 'REJECTED'
    )),
    operations_json TEXT NOT NULL,
    validation_errors_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    applied_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_changesets_project_status ON change_sets(project_id, status);

-- 5. ARISTAS Y RELACIONES CRUZADAS DEL GRAFO
CREATE TABLE IF NOT EXISTS graph_edges (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
    edge_type TEXT NOT NULL CHECK(edge_type IN (
        'DEPENDS_ON', 'IMPLEMENTS', 'SATISFIES', 'AFFECTS', 
        'SUPERSEDES', 'DOCUMENTED_BY', 'VERIFIED_BY', 'TOUCHES_CODE',
        'MODIFIES', 'GENERATED_BY', 'SCOPED_IN'
    )),
    provenance TEXT NOT NULL DEFAULT 'USER' CHECK(provenance IN ('USER', 'CHANGESET', 'EXECUTION')),
    changeset_id TEXT REFERENCES change_sets(id) ON DELETE SET NULL,
    execution_id TEXT REFERENCES agent_executions(id) ON DELETE SET NULL,
    metadata_json TEXT,
    created_revision INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (source_id != target_id),
    UNIQUE(project_id, source_id, target_id, edge_type)
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON graph_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON graph_edges(target_id);
CREATE INDEX IF NOT EXISTS idx_edges_type ON graph_edges(project_id, edge_type);

-- 6. GOBERNANZA, POLÍTICAS Y APROBACIONES
CREATE TABLE IF NOT EXISTS autonomy_policies (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    writable_paths_json TEXT NOT NULL DEFAULT '["src/**", "tests/**", "docs/**"]',
    readonly_paths_json TEXT NOT NULL DEFAULT '["docs/architecture/ADR/**"]',
    denied_paths_json TEXT NOT NULL DEFAULT '[".env*", ".git/config"]',
    allowed_commands_json TEXT NOT NULL DEFAULT '[]',
    auto_approve_scopes_json TEXT NOT NULL DEFAULT '[]',
    require_worktree_isolation INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS approval_requests (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    requested_action TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
    resolved_by TEXT,
    resolution_note TEXT,
    requested_at TEXT NOT NULL,
    resolved_at TEXT
);

-- 7. FULL-TEXT SEARCH (FTS5) Y TRIGGERS AUTOMÁTICOS DE SINCRONIZACIÓN
CREATE VIRTUAL TABLE IF NOT EXISTS fts_knowledge_index USING fts5(
    entity_id UNINDEXED,
    project_id UNINDEXED,
    display_key,
    title,
    summary,
    body_content,
    tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS trg_knowledge_entities_ai
AFTER INSERT ON knowledge_entities
BEGIN
    INSERT INTO fts_knowledge_index (entity_id, project_id, display_key, title, summary, body_content)
    VALUES (NEW.id, NEW.project_id, NEW.display_key, NEW.title, NEW.summary, '');
END;

CREATE TRIGGER IF NOT EXISTS trg_knowledge_entities_au
AFTER UPDATE OF display_key, title, summary ON knowledge_entities
BEGIN
    UPDATE fts_knowledge_index
    SET display_key = NEW.display_key,
        title = NEW.title,
        summary = NEW.summary
    WHERE entity_id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_knowledge_entities_ad
AFTER DELETE ON knowledge_entities
BEGIN
    DELETE FROM fts_knowledge_index WHERE entity_id = OLD.id;
END;
```

---

## 3. Desglose de las 8 Etapas del Plan de Implementación

Cada etapa cuenta con objetivos específicos, entregables técnicos concretos y criterios de cierre obligatorios antes de avanzar a la siguiente fase.

### Etapa 1: Domain Model + SQLite Persistence Core
* **Objetivo:** Construir los cimientos del modelo de dominio tipado y la persistencia relacional en SQLite sin dependencias de UI ni de motores de IA.
* **Entregables Técnicos:**
  * Migrador automático y conexión SQLite en modo `WAL` (`src/infrastructure/persistence/sqlite/`).
  * Entidades y Raíces de Agregado puras en `src/domain/`: `Project`, `ProjectRoot`, `Module`, `Feature`, `Requirement`, `WorkItem`, `Milestone`, `DecisionRecord`, `Artifact`, `CodeReference`.
  * Implementación de `GraphTopologyService` en `src/domain/graph/` con detección de ciclos (DFS sobre `parent_id`, `DEPENDS_ON` y `SUPERSEDES`) y validador de la Matriz de Compatibilidad de Aristas.
  * Repositorios SQLite y `UnitOfWork` transaccional con pruebas unitarias sobre base de datos `:memory:`.
* **Criterios de Cierre:**
  1. Crear un proyecto instancia automáticamente su nodo `PROJECT_ROOT` (`PROJ-01`) con `current_revision = 1`.
  2. El dominio rechaza cualquier intento de insertar una arista incompatible o un ciclo `DEPENDS_ON` ($A \to B \to A$).
  3. Los triggers de `fts_knowledge_index` indexan automáticamente toda entidad creada o actualizada.

### Etapa 2: Graph Engine + Graph Canvas UI + Inspector
* **Objetivo:** Hacer visible y navegable el proyecto desde el segundo hito mediante el shell de escritorio, el lienzo del grafo y el inspector contextual.
* **Entregables Técnicos:**
  * Puente **Typed IPC** (`src/infrastructure/ipc/` y `src/shared/contracts/ipc-contracts.ts`).
  * Proyectores de consulta (`GetGraphViewUseCase`, `GetEntityInspectorDetailsUseCase`) que transforman entidades en `GraphNodeView` y `GraphEdgeView`.
  * Estado compartido `WorkspaceNavigationContext` en `src/desktop/state/`.
  * Componentes `GraphCanvas` (con layout jerárquico y filtros por tipo de nodo/arista) y `ContextualInspector` (propiedades, relaciones entrantes/salientes, estado e historial).
* **Criterios de Cierre:**
  1. El usuario puede abrir un proyecto, explorar visualmente la jerarquía (`ProjectRoot` $\rightarrow$ `Module` $\rightarrow$ `Feature` $\rightarrow$ `WorkItem`) y distinguir aristas cruzadas (`SATISFIES`, `AFFECTS`, `DEPENDS_ON`).
  2. Seleccionar cualquier nodo actualiza inmediatamente el `ContextualInspector` y el foco de navegación.

### Etapa 3: Artifact Management & Markdown Synchronization
* **Objetivo:** Conectar el estado estructurado de SQLite con los documentos Markdown vivos en el directorio `docs/` del repositorio Git.
* **Entregables Técnicos:**
  * Servicio de escritura atómica con swap de archivos `.tmp` y cálculo de hash SHA-256 (`src/infrastructure/filesystem/`).
  * `ArtifactWatcherService` para detectar modificaciones externas en `docs/` y actualizar `sync_status` (`SYNCED` vs `DRIFTED`) y el campo `body_content` en `fts_knowledge_index`.
  * Generadores de plantillas estándar para `PRD.md`, `ARCHITECTURE.md`, `ADR-xxx.md`, `specification.md` e `implementation-plan.md`.
  * Visor y editor de documentos Markdown integrado en `src/desktop/presentation/documents/`.
* **Criterios de Cierre:**
  1. Crear un `DecisionRecord` o `Artifact` genera su archivo `.md` en el repositorio Git y lo vincula mediante `DOCUMENTED_BY` o `AFFECTS`.
  2. Editar y guardar un archivo `.md` desde un editor externo dispara la detección de cambio, recalcula `content_hash` y actualiza el índice FTS5 en menos de 1 segundo.

### Etapa 4: AI Planning + Transactional ChangeSets + Ghost Preview
* **Objetivo:** Permitir que el chat contextual proponga modificaciones completas al proyecto (`ChangeSet`) y que el usuario las previsualice en el grafo antes de aplicarlas transaccionalmente.
* **Entregables Técnicos:**
  * `ChangeSetValidator` y `ChangeSetApplier` (`src/application/planning/`) con resolución topológica de identificadores temporales (`tempId` como `"$feat_2fa"`) y candado optimista (`base_graph_revision === current_revision`).
  * Protocolo de **Two-Phase Commit Local** (staging de archivos `.md` + transacción `BEGIN IMMEDIATE` en SQLite + incremento de `current_revision`).
  * Tarjetas interactivas de propuesta en el panel de Chat (`Aplicar cambios`, `Editar propuesta`, `Rechazar`) y modo **Ghost Preview** en el `GraphCanvas`.
* **Criterios de Cierre:**
  1. Una instrucción en el chat produce un `ChangeSet` con múltiples operaciones (`CREATE_FEATURE`, `CREATE_REQUIREMENT`, `UPSERT_ARTIFACT`, `CREATE_WORK_ITEM`, `CREATE_RELATIONSHIP`).
  2. Los nodos propuestos se visualizan como nodos fantasma en el grafo antes de confirmarse.
  3. Al aplicar el `ChangeSet`, se crean los archivos Markdown y los registros en SQLite de forma atómica; si ocurre un error intermedio, no queda ningún archivo huérfano ni nodo parcial.

### Etapa 5: Context Engine Pipeline (5 Etapas) + ContextSnapshot
* **Objetivo:** Implementar el motor que construye paquetes de contexto reproducibles, priorizados por autoridad (Niveles 1 a 6) y acotados por presupuesto de tokens.
* **Entregables Técnicos:**
  * Implementación de las 5 etapas en `src/application/context/`: `ContextResolver`, `GraphTraversal`, `HybridRetrieval`, `ContextRanking` y `ContextPackager`.
  * Regla de exclusión automática de ADRs `SUPERSEDED` e inyección obligatoria de Nivel 1 (políticas) y Nivel 2 (ADRs `ACCEPTED` vía `AFFECTS`).
  * Persistencia inmutable en `context_snapshots` y visualización de **Context Pills** en la barra superior del Chat (mostrando fuentes incluidas y excluidas).
* **Criterios de Cierre:**
  1. Seleccionar una tarea o feature en el grafo muestra inmediatamente qué ADRs, especificaciones y archivos de código conforman su paquete de contexto.
  2. Si se reduce el presupuesto de tokens, el motor descarta primero notas de nivel 6 y documentos generales de nivel 5, conservando intactos los niveles 1, 2 y 3, y registrando los descartes en `excluded_sources_json`.

### Etapa 6: Agent Integration Layer (First Real Engine Execution)
* **Objetivo:** Integrar el primer motor externo real (ej. Claude Code o Codex) mediante el contrato `AgentAdapter` y ejecutar tareas reales sobre el repositorio.
* **Entregables Técnicos:**
  * Implementación de `AgentOrchestrator` (`src/application/execution/`) y la máquina de estados de `AgentExecution`.
  * Primer adaptador productivo (`ClaudeCodeAdapter` o `CodexAdapter`) implementando los 6 indicadores de `AgentCapabilities` y emitiendo `AsyncIterable<AgentEvent>`.
  * Persistencia de eventos en tiempo real en `agent_events` y `events.jsonl`.
  * Panel de monitoreo de ejecuciones en vivo (`src/desktop/presentation/agents/`).
* **Criterios de Cierre:**
  1. El usuario selecciona un `WorkItem` en estado `READY`, elige el perfil `DEVELOPER` e inicia la ejecución.
  2. El motor externo recibe el `ContextSnapshot` sellado, ejecuta modificaciones sobre el código y transmite eventos de herramientas en vivo hacia la interfaz.

### Etapa 7: Execution Governance, Git Worktrees & Sandbox Audit
* **Objetivo:** Garantizar que ningún agente comprometa la rama principal ni modifique rutas no autorizadas, incorporando aislamiento en Git worktrees, aprobaciones y validación post-ejecución.
* **Entregables Técnicos:**
  * `GitIsolationService` (`src/infrastructure/git/`) para aprovisionar ramas y directorios aislados en `<Workspace-Local-Dir>/projects/<id>/worktrees/<execution-id>/`.
  * `GovernanceInterceptor` para pausar la ejecución en estado `AWAITING_APPROVAL` cuando el motor solicita un comando o escritura sensible, conectando el modal de autorización de la UI con `adapter.respondToApproval(executionId, requestId, decision)`.
  * `ExecutionValidator` para auditar el `git diff` en la fase `VALIDATING` contra `writable_paths_json` y `denied_paths_json`, ejecutar los tests del proyecto y generar `changes.patch` + `test-output.log`.
* **Criterios de Cierre:**
  1. Toda ejecución con escritura ocurre en su propio Git worktree sin ensuciar el árbol de trabajo principal del usuario.
  2. Si un agente intenta tocar un archivo en `denied_paths_json` (ej. `.env` o un ADR en solo lectura), la auditoría marca la ejecución como `FAILED` o exige aprobación explícita.

### Etapa 8: Feedback Loop, Traceability & End-to-End MVP Verification
* **Objetivo:** Cerrar el ciclo de retroalimentación posterior a la ejecución para que el conocimiento del proyecto se actualice automáticamente y superar la prueba de fuego End-to-End del MVP.
* **Entregables Técnicos:**
  * Registro automático de aristas de evidencia `MODIFIES` y `GENERATED_BY` (`provenance = 'EXECUTION'`, `execution_id`) al completarse una ejecución.
  * Transición coordinada de `WorkItem` a `IN_REVIEW` y flujo de aprobación/fusión (`Merge worktree & mark DONE`) que desbloquea automáticamente las tareas dependientes (`DEPENDS_ON`).
  * Generador opcional de `ChangeSet` post-ejecución cuando los cambios realizados requieren actualizar documentación técnica.
  * Exportador/Importador versionado de la base de conocimiento del proyecto.
* **Criterios de Cierre (Prueba de Fuego Superada):**
  1. Completar de principio a fin el escenario del MVP: **Creación del proyecto $\rightarrow$ Análisis inicial con IA $\rightarrow$ Generación de PRD, Arquitectura y Grafo $\rightarrow$ Planificación de Feature en Tareas con dependencias $\rightarrow$ Ejecución aislada con un motor externo $\rightarrow$ Validación de diff y tests $\rightarrow$ Actualización de estado y evidencia en el grafo**.
  2. Cambiar de motor externo en la siguiente tarea (ej. de Codex a Claude Code) demuestra continuidad total sin pérdida de contexto ni de memoria arquitectónica.
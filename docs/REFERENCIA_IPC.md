# Referencia IPC

Cada módulo responde sus canales en `src/modules/<módulo>/ipc.ts` (los que cruzan módulos, en `src/bootstrap/handlers/`). Fuente: `src/shared/contracts/ipc-contracts.ts` (tipos `WorkspaceIpcCommands`, `WorkspaceIpcQueries` y `WorkspaceIpcEvents`) y `src/bootstrap/request-dispatcher.ts`. Los DTO están en `src/shared/contracts/*.ts`. El cliente de la interfaz (`WorkspaceIpcClient`) envuelve estos canales en métodos tipados (`commands`, `queries`, `events`, el grupo opcional `inception` y `platform.pickFolder`, que abre el selector de carpetas del sistema con el plugin de diálogo de Tauri y no pasa por el núcleo); la implementación real es `src/desktop/platform/tauri-ipc-client.ts`.

Transporte: la interfaz invoca el comando Tauri `workspace_request`; el host lo reenvía al sidecar como una línea JSON y devuelve la respuesta (ver `docs/ARQUITECTURA_ACTUAL.md`). Tiempo de espera: 60 s; 330 s para `changeset:propose_from_chat` y `planning:translate_references`.

**Orden de ejecución.** Los comandos marcados con ⛓ se ejecutan uno a uno y en orden de llegada (`SERIALIZED_CHANNELS`). Las consultas, `changeset:propose_from_chat` y `planning:translate_references` corren en paralelo.

## Comandos (modifican estado)

### Proyecto y repositorio

| Canal | Descripción |
| :--- | :--- |
| `project:create` ⛓ | Crea un proyecto (nombre, slug y, opcionalmente, descripción, objetivos, stack y reglas). Con `location` deja su código listo en el mismo paso: `NEW_FOLDER` crea la carpeta (inexistente o vacía) con `git init` y un primer commit; `EXISTING_REPOSITORY` conecta una carpeta que ya tiene `.git`. La carpeta se comprueba antes de crear nada y, si ese paso falla, el proyecto no se crea. |
| `settings:set_projects_folder` ⛓ | Guarda la carpeta de proyectos (ajuste de la app, no del proyecto, en `<datos>/settings.json`): ruta absoluta, sin `..`; la crea si falta y comprueba que se puede escribir. No acepta la carpeta personal ni la raíz. |
| `project:open` ⛓ | Abre un proyecto y devuelve su estado: resumen, grafo y entidad seleccionada. |
| `repository:configure` ⛓ | Conecta un repositorio Git existente (ruta absoluta). |
| `repository:initialize` ⛓ | Crea un repositorio Git nuevo (carpeta inexistente o vacía, ruta absoluta sin `..`) y lo hace el repositorio principal del proyecto. |
| `provider:set_auth_mode` ⛓ | Elige la autenticación del proveedor: `subscription` o `api_key`. |

### Documentos y plan

| Canal | Descripción |
| :--- | :--- |
| `artifact:create` ⛓ | Crea un documento Markdown (con plantilla) y lo vincula al grafo. |
| `artifact:save` ⛓ | Guarda un documento de forma atómica comprobando el hash esperado del contenido. |
| `changeset:propose_from_chat` | Pide al motor una propuesta de cambios (ChangeSet) a partir de un texto, con foco, snapshot de contexto y modelo opcionales. Sexto argumento opcional `options` (`ProposeChangesOptions`): `references` (las ya traducidas por `planning:translate_references`: `{name, kind, note, translation}`; el núcleo las vuelve a normalizar por tipo y entran al prompt como datos inertes) y `updateUiSpec` (actualizar `docs/UI_SPEC.md`, o crearla si no existe). Con una especificación existente, las features nuevas se enlazan a ella (`DOCUMENTED_BY`) aunque no se pida actualizarla; si se pidió y la propuesta no la incluye, queda sin validar (`UI_SPEC_MISSING`). Cualquier escritura de `docs/UI_SPEC.md` sin sus 8 secciones se rechaza en la validación (`UI_SPEC_SECTIONS`). |
| `planning:translate_references` | Traduce a texto las referencias adjuntas al planificar (`InceptionReferenceInput[]`, mismas reglas y límites que en el inicio) con el traductor de V1; devuelve un `InceptionReferenceDto` por archivo (`TRANSLATED` o `FAILED` con el motivo). Los archivos se guardan solo durante la llamada, en `projects/<id>/planning/references/`, y se borran al terminar. |
| `changeset:edit` ⛓ | Edita las operaciones de un ChangeSet pendiente y lo revalida. |
| `changeset:apply` ⛓ | Aplica un ChangeSet validado (transaccional: SQLite y Markdown). |
| `changeset:reject` ⛓ | Rechaza un ChangeSet. |
| `workitem:set_status` ⛓ | Cambia a mano el estado de una tarea (los estados que dependen de una ejecución no se pueden fijar; `READY` exige dependencias en `DONE`). |
| `policy:update` ⛓ | Actualiza la política de ejecución y de decisiones del proyecto. |
| `commands:start` ⛓ | Corre un script de `package.json` (`{ ref, script }`) en un worktree propio de esa rama con las dependencias instaladas. Eventos `command:updated` (estado, URL detectada) y `command:output` (cada trozo de salida). |
| `commands:stop` ⛓ | Detiene un comando (todo su grupo de procesos) y borra su worktree. |
| `environment:set_skills` ⛓ | Activa o apaga (booleano) las skills incluidas en las tareas de interfaz del proyecto. Devuelve el entorno. |
| `environment:approve_dependencies` ⛓ | Aprueba paquetes fuera del perfil de stack (nombres válidos de npm); la app los instalará en las ejecuciones siguientes. Devuelve el entorno. |

### Ejecuciones

| Canal | Descripción |
| :--- | :--- |
| `execution:start` ⛓ | Inicia una ejecución de una tarea `READY` (o una revisión con ajustes). Con `workItemIds`, una sola ejecución cubre varias tareas de la misma feature (listas, o bloqueadas solo por tareas del grupo); todas cambian de estado juntas. |
| `execution:cancel` ⛓ | Cancela una ejecución en curso. |
| `execution:resolve_approval` ⛓ | Resuelve una aprobación pendiente (por ejemplo «Permitir y reintentar»). |
| `execution:accept` ⛓ | Acepta una ejecución completada: squash a la rama de la feature, memoria y desbloqueo. |
| `execution:request_changes` ⛓ | Pide ajustes: nueva ejecución sobre la misma tarea con el motivo como contexto. |

### Piloto, features e informes

| Canal | Descripción |
| :--- | :--- |
| `provider:get_auth` | Cómo se autentica el motor en el proyecto (suscripción o clave de API) y si hay `ANTHROPIC_API_KEY` disponible; funciona aunque el proyecto no tenga features. |
| `pilot:set_autonomy` ⛓ | Fija el nivel de autonomía de una feature (`MANUAL`, `AUTO_ACCEPT`, `PILOT`) y sus modelos, intentos, umbral de pausa, y si el piloto agrupa tareas pequeñas (`groupTasks`, `maxGroupSize` de 1 a 5). |
| `pilot:start` ⛓ | Inicia el piloto de una feature (exige `acknowledgeCost: true`). |
| `pilot:stop` ⛓ | Detiene el piloto. |
| `pilot:resume` ⛓ | Reanuda un piloto pausado o en espera del usuario. |
| `feature:integrate` ⛓ | Fusiona en la rama base una feature con todas sus tareas en `DONE` (commit de merge en un worktree temporal; rechaza un checkout con cambios sin commitear y una rama con marcadores de conflicto). Un conflicto nombra los archivos y remite a «Resolver con un agente». |
| `repository:git_status` | Rama base, ramas locales, rama abierta por el usuario, operación de Git a medias, `index.lock`, identidad y por qué no se pueden guardar documentos ahora (`RepositoryGitStatusDto`). |
| `repository:set_base_branch` ⛓ | Cambia la rama base del proyecto (debe existir). |
| `project:docs` | Documentación en línea de los agentes (C1): si está activada, los dominios que recibe cada ejecución, los que salen del stack y los que añadió el usuario (`ProjectDocsDto`). |
| `project:set_docs` ⛓ | Activa o desactiva la documentación en línea y guarda los dominios del usuario (`{ enabled, extraDomains }`); rechaza lo que no sea un nombre de dominio. |
| `feature:checks` | Comprobaciones de integración de una feature (C6): `NONE` si el proyecto no tiene, `NOT_RUN`, `RUNNING`, `PASSED`, `FAILED` o `STALE` si la feature o la rama base se movieron desde la última comprobación; comandos, resultado de cada uno y final de la salida del que falló (`FeatureChecksDto`). |
| `feature:run_checks` ⛓ | Lanza en segundo plano las comprobaciones de integración (por ejemplo `next build`) sobre una copia de la rama base con la feature fusionada y responde al momento con `RUNNING`; la interfaz consulta `feature:checks` hasta el resultado. |
| `feature:check_conflicts` | Con `git merge-tree`, sin tocar nada: archivos que chocan con la rama base, con otras features sin integrar y marcadores sin resolver (`FeatureConflictsDto`). |
| `feature:resolve_conflicts` ⛓ | Junta la rama base en la feature, commitea los marcadores y crea una tarea `READY` de la feature que los resuelve (`ResolveFeatureConflictsResultDto`). |
| `metrics:export_report` | Exporta el informe de métricas de una feature a `reports/` y devuelve su ruta. |

### Asistente de inicio

| Canal | Descripción |
| :--- | :--- |
| `inception:start` ⛓ | Si el proyecto tiene un repositorio con código, primero lo escanea (ver `repository:scan`), guarda lo leído en `project_inception.repository_json` y el asistente devuelve, junto a las preguntas, inferencias con evidencia (rutas que existen en el escaneo; las demás se descartan). Inicia el asistente con una descripción y, opcionalmente, hasta 5 `references` (`{name, kind: VISUAL\|FUNCTIONAL\|CONCEPTUAL, note?, dataBase64}`); responde al instante con estado `WORKING`. Un modelo aparte traduce las referencias a texto antes de preguntar. Sin `references` en un reintento tras un fallo, reutiliza las ya guardadas. |
| `inception:answer` ⛓ | Guarda las respuestas y pide la propuesta (o, con `options: {exploreUi: true}`, 2 o 3 direcciones de diseño con prototipo); en la fase de propuesta la regenera, con `notes` opcionales (hasta 2000 caracteres) que indican qué cambiar. En modo brownfield, `options.corrections` (`[{inferenceId, correction}]`, hasta 500 caracteres cada una) corrige lo inferido del repositorio y sustituye a las correcciones anteriores; una vacía significa «es correcto». |
| `inception:import_prototype` ⛓ | Añade un prototipo HTML hecho en otra herramienta (`{name, html}`, hasta 120.000 caracteres) como una dirección más (máximo 5); solo mientras se elige una dirección. Responde al instante. |
| `inception:import_design` ⛓ | Añade un diseño terminado hecho en otra herramienta: una imagen (`kind: 'IMAGE'`, `content` en base64; un modelo la describe en texto y queda como dirección sin prototipo) o código React (`kind: 'REACT'`, `content` es el texto; el asistente lo convierte en un prototipo HTML autocontenido). Cuenta para el máximo de 5 direcciones y solo funciona mientras se elige. Responde al instante con estado `WORKING`. |
| `inception:reopen_design` ⛓ | Desde la propuesta, vuelve a las direcciones de diseño ya generadas (con la elección conservada) o, si el diseño nunca se pidió, las genera ahora con las mismas respuestas; la propuesta pendiente se rechaza. |
| `inception:revise_ui` ⛓ | Regenera una dirección con las indicaciones del usuario (`optionId`, `notes` ≤ 2000); las demás no se tocan. Responde al instante con estado `WORKING`. |
| `inception:choose_ui` ⛓ | Aprueba una dirección y pide la propuesta sobre ella; con `null` salta el diseño. Responde al instante con estado `WORKING`. |
| `inception:approve` ⛓ | Aplica el ChangeSet de la propuesta (exige un repositorio principal). Si hay una dirección visual aprobada con prototipo, lo guarda antes en `docs/design/prototype.html` del repositorio (si no se puede guardar, no se aplica nada). |
| `inception:restart` ⛓ | Olvida preguntas, respuestas, referencias (borra sus archivos) y propuesta pendiente, y detiene la llamada en curso; se rechaza una vez aplicada. |

## Consultas (solo lectura)

| Canal | Descripción |
| :--- | :--- |
| `project:list` | Lista los proyectos. |
| `settings:get` | Ajustes de la app: `projectsFolder` (null hasta que el usuario la elige) y la carpeta sugerida, que es la primera de las habituales (`~/Documents/repos`, `~/Documentos/repos`, `~/repos`, `~/Projects`, `~/code`…) que ya contenga repositorios Git, con su número. |
| `folder:inspect` | Qué hay en una ruta absoluta: si existe, si es carpeta, si está vacía, si es un repositorio Git y si existe su carpeta padre. Solo lectura. |
| `graph:get_view` | Grafo del proyecto (nodos y aristas), con filtro opcional por tipos de entidad y de arista. |
| `graph:context_flow` | Entidades que formaron el contexto de la última ejecución de una tarea (para dibujar el flujo de contexto). |
| `entity:get_inspector_details` | Detalle de una entidad: atributos, relaciones, resultado de cierre, integración de la feature, historial de ejecuciones y cambios de estado permitidos. |
| `repository:get_path` | Ruta del repositorio principal, o `null`. |
| `artifact:list` / `artifact:read` | Lista los documentos / lee uno con su contenido y hash. |
| `changeset:list` | Lista los ChangeSets del proyecto. |
| `context:get_snapshot` | Lee un `ContextSnapshot` guardado. |
| `context:preview_package` | Previsualiza el paquete de contexto de una entidad con un presupuesto de tokens. |
| `agent:list_profiles` | Perfiles de agente del proyecto, con proveedor y modelos disponibles. |
| `execution:list` / `execution:list_events` / `execution:get_detail` | Lista las ejecuciones / los eventos de una / el detalle forense (diff por archivo, salida de las pruebas, acciones denegadas). |
| `policy:get` | Política de ejecución y de decisiones del proyecto. |
| `commands:refs` | Ramas del usuario y de las features (nunca las `graphdev/` de los agentes), la actual primero. |
| `commands:scripts` | Scripts de `package.json` en una rama y el gestor que indica su lockfile (`npm` o `pnpm`). |
| `commands:list` | Comandos lanzados en esta sesión de la app, con estado, URL y el final de la salida. |
| `environment:get` | Perfil de stack del proyecto (id, título, paquetes, fecha de revisión), si la app instala dependencias para él, los paquetes aprobados, si las skills están activas y cuáles vienen con la app. |
| `pilot:get` | Estado del piloto de una feature: autonomía, última corrida, eventos, tareas y uso. |
| `metrics:feature_report` | Métricas de una feature. |
| `activity:list` | Bandeja de actividad del proyecto (derivada, sin IA); admite un límite. |
| `inception:get` | Estado del asistente de inicio (incluye las direcciones de diseño sin su HTML y, en modo brownfield, `repository`: el resumen del escaneo sin contenidos, las inferencias con su evidencia y las correcciones). |
| `inception:get_ui_prototype` | El HTML del prototipo de una dirección (`optionId`). |
| `repository:scan` | Modo brownfield: qué leería el asistente del repositorio principal del proyecto (`RepositoryScanSummaryDto`: nombre, archivos por lenguaje, carpetas, archivos leídos con su tipo y tamaño, exclusiones por motivo y tamaño serializado; sin contenidos). Usa `git ls-files` con git aislado (respeta `.gitignore`), no sigue enlaces simbólicos, no abre posibles secretos, no sale del repositorio y el escaneo completo no supera 48 KB. Falla si el proyecto no tiene repositorio. |

## Eventos (del núcleo a la interfaz)

| Canal | Carga | Cuándo |
| :--- | :--- | :--- |
| `graph:revision_updated` | `{projectId, revision}` | El grafo cambió de revisión. |
| `artifact:sync_status_changed` | estado de sincronización de un documento | Cambio externo o sincronización de un documento observado. |
| `execution:status_changed` | `{executionId, workItemId, status}` | Una ejecución cambió de estado. |
| `execution:event_received` | `{executionId, event}` | Llegó un evento del motor durante una ejecución. |
| `pilot:updated` | `{projectId, featureId, status}` | Cambió el estado o la configuración del piloto. |
| `inception:updated` | `{projectId, stage, status}` | Terminó una llamada del asistente de inicio o cambió su estado. |

Nota: `feature:integrate`, `feature:check_conflicts`, `feature:resolve_conflicts` y el grupo `inception` son opcionales en `WorkspaceIpcClient` para que los dobles de prueba existentes sigan siendo válidos; el cliente Tauri los implementa.

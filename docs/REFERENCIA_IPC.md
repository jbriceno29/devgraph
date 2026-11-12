# Referencia IPC

Fuente: `src/shared/contracts/ipc-contracts.ts` (tipos `WorkspaceIpcCommands`, `WorkspaceIpcQueries` y `WorkspaceIpcEvents`) y `src/infrastructure/ipc/sidecar/request-dispatcher.ts`. Los DTO están en `src/shared/contracts/*.ts`. El cliente de la interfaz (`WorkspaceIpcClient`) envuelve estos canales en métodos tipados (`commands`, `queries`, `events` y el grupo opcional `inception`); la implementación real es `src/desktop/platform/tauri-ipc-client.ts`.

Transporte: la interfaz invoca el comando Tauri `workspace_request`; el host lo reenvía al sidecar como una línea JSON y devuelve la respuesta (ver `docs/ARQUITECTURA_ACTUAL.md`). Tiempo de espera: 60 s; 330 s para `changeset:propose_from_chat`.

**Orden de ejecución.** Los comandos marcados con ⛓ se ejecutan uno a uno y en orden de llegada (`SERIALIZED_CHANNELS`). Las consultas y `changeset:propose_from_chat` corren en paralelo.

## Comandos (modifican estado)

### Proyecto y repositorio

| Canal | Descripción |
| :--- | :--- |
| `project:create` ⛓ | Crea un proyecto (nombre, slug y, opcionalmente, descripción, objetivos, stack y reglas). |
| `project:open` ⛓ | Abre un proyecto y devuelve su estado: resumen, grafo y entidad seleccionada. |
| `repository:configure` ⛓ | Conecta un repositorio Git existente (ruta absoluta). |
| `repository:initialize` ⛓ | Crea un repositorio Git nuevo (carpeta inexistente o vacía, ruta absoluta sin `..`) y lo hace el repositorio principal del proyecto. |
| `provider:set_auth_mode` ⛓ | Elige la autenticación del proveedor: `subscription` o `api_key`. |

### Documentos y plan

| Canal | Descripción |
| :--- | :--- |
| `artifact:create` ⛓ | Crea un documento Markdown (con plantilla) y lo vincula al grafo. |
| `artifact:save` ⛓ | Guarda un documento de forma atómica comprobando el hash esperado del contenido. |
| `changeset:propose_from_chat` | Pide al motor una propuesta de cambios (ChangeSet) a partir de un texto, con foco, snapshot de contexto y modelo opcionales. |
| `changeset:edit` ⛓ | Edita las operaciones de un ChangeSet pendiente y lo revalida. |
| `changeset:apply` ⛓ | Aplica un ChangeSet validado (transaccional: SQLite y Markdown). |
| `changeset:reject` ⛓ | Rechaza un ChangeSet. |
| `workitem:set_status` ⛓ | Cambia a mano el estado de una tarea (los estados que dependen de una ejecución no se pueden fijar; `READY` exige dependencias en `DONE`). |
| `policy:update` ⛓ | Actualiza la política de ejecución y de decisiones del proyecto. |

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
| `feature:integrate` ⛓ | Fusiona en la rama base una feature con todas sus tareas en `DONE` (commit de merge en un worktree temporal; rechaza un checkout con cambios sin commitear). |
| `metrics:export_report` | Exporta el informe de métricas de una feature a `reports/` y devuelve su ruta. |

### Asistente de inicio

| Canal | Descripción |
| :--- | :--- |
| `inception:start` ⛓ | Inicia el asistente con una descripción y, opcionalmente, hasta 5 `references` (`{name, kind: VISUAL\|FUNCTIONAL\|CONCEPTUAL, note?, dataBase64}`); responde al instante con estado `WORKING`. Un modelo aparte traduce las referencias a texto antes de preguntar. Sin `references` en un reintento tras un fallo, reutiliza las ya guardadas. |
| `inception:answer` ⛓ | Guarda las respuestas y pide la propuesta (o, con `options: {exploreUi: true}`, 2 o 3 direcciones de diseño con prototipo); en la fase de propuesta la regenera, con `notes` opcionales (hasta 2000 caracteres) que indican qué cambiar. |
| `inception:import_prototype` ⛓ | Añade un prototipo HTML hecho en otra herramienta (`{name, html}`, hasta 120.000 caracteres) como una dirección más (máximo 5); solo mientras se elige una dirección. Responde al instante. |
| `inception:import_design` ⛓ | Añade un diseño terminado hecho en otra herramienta: una imagen (`kind: 'IMAGE'`, `content` en base64; un modelo la describe en texto y queda como dirección sin prototipo) o código React (`kind: 'REACT'`, `content` es el texto; el asistente lo convierte en un prototipo HTML autocontenido). Cuenta para el máximo de 5 direcciones y solo funciona mientras se elige. Responde al instante con estado `WORKING`. |
| `inception:reopen_design` ⛓ | Desde la propuesta, vuelve a las direcciones de diseño ya generadas (con la elección conservada) o, si el diseño nunca se pidió, las genera ahora con las mismas respuestas; la propuesta pendiente se rechaza. |
| `inception:revise_ui` ⛓ | Regenera una dirección con las indicaciones del usuario (`optionId`, `notes` ≤ 2000); las demás no se tocan. Responde al instante con estado `WORKING`. |
| `inception:choose_ui` ⛓ | Aprueba una dirección y pide la propuesta sobre ella; con `null` salta el diseño. Responde al instante con estado `WORKING`. |
| `inception:approve` ⛓ | Aplica el ChangeSet de la propuesta (exige un repositorio principal). |
| `inception:restart` ⛓ | Olvida preguntas, respuestas, referencias (borra sus archivos) y propuesta pendiente, y detiene la llamada en curso; se rechaza una vez aplicada. |

## Consultas (solo lectura)

| Canal | Descripción |
| :--- | :--- |
| `project:list` | Lista los proyectos. |
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
| `pilot:get` | Estado del piloto de una feature: autonomía, última corrida, eventos, tareas y uso. |
| `metrics:feature_report` | Métricas de una feature. |
| `activity:list` | Bandeja de actividad del proyecto (derivada, sin IA); admite un límite. |
| `inception:get` | Estado del asistente de inicio (incluye las direcciones de diseño sin su HTML). |
| `inception:get_ui_prototype` | El HTML del prototipo de una dirección (`optionId`). |

## Eventos (del núcleo a la interfaz)

| Canal | Carga | Cuándo |
| :--- | :--- | :--- |
| `graph:revision_updated` | `{projectId, revision}` | El grafo cambió de revisión. |
| `artifact:sync_status_changed` | estado de sincronización de un documento | Cambio externo o sincronización de un documento observado. |
| `execution:status_changed` | `{executionId, workItemId, status}` | Una ejecución cambió de estado. |
| `execution:event_received` | `{executionId, event}` | Llegó un evento del motor durante una ejecución. |
| `pilot:updated` | `{projectId, featureId, status}` | Cambió el estado o la configuración del piloto. |
| `inception:updated` | `{projectId, stage, status}` | Terminó una llamada del asistente de inicio o cambió su estado. |

Nota: `feature:integrate` y el grupo `inception` son opcionales en `WorkspaceIpcClient` para que los dobles de prueba existentes sigan siendo válidos; el cliente Tauri los implementa.

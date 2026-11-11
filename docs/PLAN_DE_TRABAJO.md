# Plan de trabajo: contexto en el workspace y desarrollo autónomo

Fecha: 2026-11-10 · Rama: `feat/claude-code`
Sustituye como plan vigente a `docs/PLAN_MIGRACION_CLAUDE.md`, que queda como registro de las Fases 0 a 3 y de lo confirmado sobre el CLI de Claude Code.

## 1. Visión

Graph Workspace sigue **una línea de trabajo, no una conversación**. El proyecto vive como un grafo (módulos, features, requisitos, tareas, decisiones, documentos y código) dentro del workspace: SQLite más Markdown versionado en el repositorio. Cada tarea se abre con el contexto justo para cerrarla, se cierra con evidencia verificable y deja lo aprendido en el grafo para las tareas que dependen de ella.

Tres consecuencias guían todo el plan:

1. **El contexto vive en el workspace, no en el motor.** Las sesiones del motor son desechables. Nada importante depende del historial de un chat, así que la siguiente tarea puede hacerla Claude Code, Codex u otro motor con el mismo resultado.
2. **El objetivo es cerrar tareas solo.** El usuario deja de ser orquestador: el sistema recorre el plan, ejecuta, verifica, acepta y avanza, y solo pide intervención cuando hace falta una decisión humana.
3. **El grafo se mantiene solo.** Si el usuario tuviera que actualizarlo a mano, se desincronizaría y el proyecto fracasaría. Cada ejecución y cada propuesta actualizan el grafo.

## 2. Lo que hay que demostrar

El proyecto tiene sentido solo si resuelve algo que hoy le duele a trabajar con un agente por chat. Son cuatro hipótesis, cada una con su medida:

| # | Hipótesis | Cómo se mide |
| :--- | :--- | :--- |
| H1 | **Contexto justo.** Una tarea con un `ContextSnapshot` curado se resuelve igual o mejor que en una sesión de chat del mismo motor, con menos tokens y sin arrastrar temas ajenos. La ventaja crece a medida que el proyecto crece. | Criterios de aceptación cumplidos a la primera, reintentos, tokens de entrada y salida, y "deriva": cambios fuera del alcance de la tarea. |
| H2 | **Continuidad sin historial.** Lo aprendido en una tarea cerrada llega a las que dependen de ella mediante el grafo, sin conversación previa. | En tareas dependientes: errores por desconocer el trabajo previo (archivos, nombres o decisiones repetidos o contradichos). |
| H3 | **Portabilidad.** Con el mismo workspace, cambiar de motor en la siguiente tarea no pierde contexto ni calidad. | Una misma feature, mitad con Claude Code y mitad con Codex: mismas métricas que H1 y cero contexto reconstruido a mano. |
| H4 | **Autonomía.** El piloto automático cierra una feature completa con pocas intervenciones. | Tareas cerradas sin intervención / total, intervenciones por motivo y tiempo del usuario dedicado a orquestar. |

**Criterio de corte (fijado de antemano).** Tras la Etapa 5: si H1 no muestra una mejora clara en al menos una de las métricas sin empeorar las demás, o si H4 no reduce de forma clara el tiempo de orquestación frente a usar el motor a mano, se replantea el enfoque antes de seguir construyendo.

## 3. Principios de diseño

- **El workspace es la fuente de verdad.** Prompts, contexto, decisiones y evidencia salen del grafo y del repositorio. No se usa `--resume` para dar continuidad entre tareas; la continuidad es el resumen de cierre guardado en el grafo.
- **Motores intercambiables.** Todo pasa por `AgentAdapterPort` y `ChangeSetPlannerPort`, con un registro de adaptadores por `providerKey`. Ningún dato del dominio depende de un motor concreto.
- **El validador es la autoridad.** Las reglas de permisos del motor son la primera barrera; la auditoría del diff y las pruebas deciden.
- **Las pruebas son la puerta de la autonomía.** Sin comandos de verificación configurados, nada se acepta automáticamente.
- **Presupuesto consciente.** Modelos baratos para ejecutar, capaces para planificar y decidir; pausa automática al acercarse a un límite de uso; una ejecución a la vez.

## 4. Estado actual

Hecho en la rama `feat/claude-code` (detalle en `docs/PLAN_MIGRACION_CLAUDE.md`):

- Etapa 7 (worktrees, auditoría de sandbox, aprobaciones) commiteada.
- Validador endurecido (Git fijado al directorio de administración, symlinks, secretos fuera del parche) y D2, D3.
- Orquestador: D4 (ejecuciones interrumpidas), D5 (cancelación), limpieza de worktrees sin trabajo.
- `ClaudeCodeAdapter` con entorno limpio, comprobación de sesión, permisos desde la política, SIGINT y selección de modelo. Probado con Claude real sobre una copia de `todo-app`.
- La política de ejecución viaja en el prompt.
- `ClaudeChangeSetPlanner` y D1 (IPC concurrente, timeouts por canal, log del sidecar).

Lo que falta para que la app aporte algo que el motor solo no aporta: el ciclo no se cierra (los resultados se quedan en el worktree), el grafo no aprende de las ejecuciones, la operación requiere tocar la base de datos y no hay autonomía.

## 5. Etapas

Tamaños: S = horas, M = ~1 día, L = varios días.

### Etapa 1: Cerrar el ciclo (L)

> **Estado (2026-11-10): hecha a nivel del núcleo y de la UI**, en cuatro entregas (`6d65cb4`, `2dda1c0`, `6298377` y la de D6). Prueba real con Claude `haiku` sobre una copia de `todo-app`, usando solo los canales de la app: propuesta de ChangeSet validada y aplicada, documento commiteado en `main`, el agente leyó la especificación en su worktree, TASK-001 ejecutada, aceptada con squash en `feature/feat-001-crear-y-consultar-tareas` y en `DONE`, y TASK-002 desbloqueada sola. Pendiente: recorrerlo haciendo clic en la ventana de la app.
>
> Ajustes respecto a lo previsto: se permite `DRAFT → BLOCKED` (una tarea planificada que espera a otra) e `IN_PROGRESS → READY` (una ejecución que falla devuelve la tarea). La rama de una feature se pone al día con la rama del usuario (merge) cuando le faltan documentos. Los documentos que escribe la app (ChangeSets y documentos creados o guardados desde la app) se commitean solos; los editados fuera de la app sin commitear bloquean la ejecución con un mensaje claro.

Objetivo: una tarea pasa de `READY` a `DONE` desde la app, con el código en la rama del usuario.

- Estados coordinados: `READY → IN_PROGRESS` al iniciar, `→ IN_REVIEW` al completar, `→ DONE` al aceptar; al pasar a `DONE`, recalcular `BLOCKED`/`READY` de las tareas con `DEPENDS_ON`. `start()` exige que las dependencias estén en `DONE`.
- Commit de los cambios en la rama de la ejecución al validar (hoy `finalCommit` = `initialCommit`). Migración `002`: `base_branch` en `agent_executions` y la rama de integración de cada feature.
- Revisión mínima: canal `execution:get_forensic_detail` y vista con el diff por archivo, `test-output.log` y acciones denegadas.
- Rama por feature: al empezar a ejecutar tareas de una feature se crea `feature/<slug>` desde la rama activa (decisión 4); las ejecuciones parten de esa rama.
- Aceptar: squash hacia la rama de la feature con `TASK-012: título` y el id de ejecución; limpieza de worktree y rama de la ejecución. Conflicto de merge → la tarea queda en `IN_REVIEW` con aviso. La fusión de la feature a la rama principal la hace el usuario.
- Pedir ajustes: nueva ejecución sobre la misma tarea con el motivo del rechazo como contexto.
- Operación sin base de datos: cambiar el estado de una tarea desde el inspector y configurar `allowedCommands` y `writablePaths` del proyecto.
- **D6**: commit automático de los documentos que escribe un ChangeSet, rechazo si esas rutas tenían cambios sin commitear, y bloqueo de `execution:start` mientras algún documento de artefacto no esté en `HEAD`. Junto con la atomicidad del applier (limpieza de `.tmp`/`.bak` y reconciliación al abrir el proyecto).

**Cierre:** en `todo-app`, desde la app y sin tocar SQLite: tarea a `READY`, ejecutar, revisar, aceptar, ver el código en la rama base y la siguiente tarea desbloqueada.

### Etapa 2: Memoria que fluye (M)

> **Estado (2026-11-10): hecha.** Al aceptar una tarea se guarda su resumen de cierre (`task_outcomes`: resumen final del agente con apartados Hecho / Decisiones / Pendiente, archivos del commit integrado y comprobaciones) y la evidencia en el grafo (`CODE_REFERENCE` por archivo con aristas `MODIFIES`, `GENERATED_BY` para documentos, procedencia `EXECUTION`). El contexto de una tarea incluye ese resumen para sus dependencias y para las tareas terminadas de la misma feature, y punteros (nivel 4) a los archivos que tocaron; el inspector muestra el resultado al cerrar; el contexto avisa cuando el bloque obligatorio supera el presupuesto; el prompt del planificador explica las reglas del grafo. **H2 demostrada en real** (Claude `haiku`, copia de `todo-app`): TASK-002 recibió el resumen de TASK-001, editó el módulo existente en lugar de crear otro, respetó sus decisiones y la feature quedó con 12/12 pruebas.
>
> Desviaciones: las referencias de código se pasan como punteros (el agente lee el archivo en su worktree) y no por búsqueda de texto; la lectura de fuentes desde `HEAD` no hizo falta porque D6 exige documentos commiteados antes de ejecutar. El ChangeSet posterior a la ejecución (`AGENT_EXECUTION`) queda para la Etapa 3, donde el piloto lo necesita.

Objetivo: H2. Lo que se aprende al cerrar una tarea llega a las siguientes sin historial.

- **Resumen de cierre** (`TaskOutcome`) al aceptar: qué se hizo (resumen final del agente), archivos tocados, pruebas que pasaron, decisiones tomadas y pendientes detectados. Se guarda en el grafo, ligado a la tarea.
- Evidencia: `CodeReference` por archivo modificado y aristas `MODIFIES` (y `GENERATED_BY` para documentos) con `provenance = 'EXECUTION'`. Esto llena el nivel 4 del Context Engine, hoy siempre vacío.
- El Context Engine incluye los `TaskOutcome` de las dependencias directas y las `CodeReference` relevantes, dentro del presupuesto de tokens, con aviso cuando el bloque obligatorio lo supera.
- Snapshot reproducible: leer las fuentes desde `HEAD` (con D6 resuelto, los documentos siempre están ahí).
- ChangeSet posterior a la ejecución (`originType: 'AGENT_EXECUTION'`) cuando el agente detecta que hay que actualizar documentación o el plan.

**Cierre:** la segunda tarea de una feature recibe en su contexto el resumen y los archivos de la primera, y no repite ni contradice su trabajo.

### Etapa 3: Piloto automático (L)

> **Estado (2026-11-10): hecha, salvo las decisiones automáticas sobre ChangeSets.** Robustez (`a95ec03`): tiempo máximo por ejecución configurable en la política, D7 (el motor se detiene si falla el consumo o al cerrar la app), aprobaciones pendientes cerradas al reconciliar, y el host reinicia el núcleo si muere. Autonomía por feature (manual, auto-aceptar, piloto) con aviso de costo obligatorio, autenticación por proveedor (suscripción primero, clave de API como segunda opción) y un piloto que recorre las tareas READY, acepta solo con auditoría y comprobaciones en verde, reintenta con el error como contexto (el último intento con el modelo de escalado), se pausa al acercarse al límite de uso y avisa con el motivo cuando necesita al usuario. **H4 probada en real** sobre el proyecto `todo-app` de la app (Claude `haiku`): el piloto cerró la feature FEAT-001 (TASK-001 y TASK-002, con dependencia) sin intervención en 41 s, con 13/13 pruebas en la rama de la feature.
>
> Pendiente: ChangeSets propuestos por el propio agente tras una ejecución y su clasificación según la política de decisiones del proyecto. Hoy ninguna ejecución propone cambios al plan, así que no hay decisiones que automatizar; se abordará cuando el agente pueda declararlos (por ejemplo, a partir del apartado "Pendiente" de su resumen de cierre).

Objetivo: H4. El usuario deja de ser orquestador.

- **Niveles de autonomía por feature:** `manual` (como hoy, valor por defecto), `auto-aceptar` (acepta solo si la auditoría y las pruebas pasan) y `piloto` (además elige y lanza la siguiente tarea). Se elige al iniciar el trabajo de cada feature, no para todo el proyecto.
- **Aviso de costo antes de activar `piloto`:** la app explica que el piloto encadena muchas ejecuciones, muestra el uso actual de la ventana de límite y cuántas tareas quedan en la feature, y recuerda que con suscripción se pausará al acercarse al límite. Recomienda clave de API del proveedor para uso intensivo.
- **Autenticación por proveedor:** primera opción, la suscripción del usuario (con pausas por límite); segunda opción, clave de API del proveedor para la autonomía. Se configura por proveedor (Claude Code, Codex) y la app indica cuál está activa en cada ejecución.
- **Ejecutor de feature:** recorre las tareas de una feature en orden de dependencias; ejecuta la siguiente `READY`; si las puertas pasan, acepta y continúa.
- **Reintentos con contexto:** si falla, reintenta con el error, el diff y la salida de las pruebas como contexto, hasta un máximo (por defecto 2); el último reintento puede usar un modelo más capaz.
- **Escalado al usuario** solo cuando: fallos repetidos, una acción que la política no permite (con "Permitir y reintentar"), una decisión de arquitectura propuesta por el agente, un conflicto de merge o un límite de uso.
- **Decisiones automáticas según la política del proyecto:** cada proyecto define qué decisiones son importantes y deben esperar al usuario. Valores por defecto, derivados del grafo y de los niveles de autoridad: crear o cambiar un ADR, cambiar reglas del proyecto, tocar lo que una decisión aceptada fija, salirse del alcance de la feature en curso, borrar entidades o archivos, y cambiar dependencias del proyecto (`package.json` y similares). El resto (nuevas tareas o requisitos dentro de la feature, documentación de lo hecho) se aplica solo en nivel `piloto`. El agente puede además marcar una propuesta como importante, pero nunca puede rebajar una que la política marca como tal.
- **Presupuesto:** pausa automática cuando `rate_limit_event` supera un umbral configurable (por defecto 85 %) y reanudación al renovarse la ventana; tope de ejecuciones por sesión de piloto.
- **Robustez necesaria para correr sin vigilancia:** D7 (detener el motor si falla el consumo y al cerrar la app), tiempo máximo por ejecución, cerrar las aprobaciones pendientes de ejecuciones interrumpidas y reinicio automático del sidecar.
- Botón de parada y registro de cada decisión tomada por el piloto.

**Cierre:** una feature de `todo-app` con 3 a 5 tareas se cierra de punta a punta en nivel `piloto`, y cada intervención humana queda registrada con su motivo.

### Etapa 4: Portabilidad entre motores (M)

Objetivo: H3. El mismo workspace funciona con Claude Code y con Codex.

- Registro de adaptadores por `providerKey`; el orquestador y el planificador eligen el motor según el perfil o la tarea, no por cableado fijo.
- Volver a cablear `CodexAgentAdapter` y `CodexChangeSetPlanner` con el contrato actual: política de ejecución (rutas y comandos traducidos al sandbox de Codex), configuración del proveedor, modelos, eventos de acción denegada y entorno limpio.
- Elegir motor y modelo por tarea en la vista de Agentes y por propuesta en Planificar.
- Mismos fixtures y tests de contrato para los dos adaptadores.

**Cierre:** una feature con la mitad de las tareas en Claude Code y la otra mitad en Codex, sin reconstruir contexto a mano.

### Etapa 5: Demostración y medición (M, continuo)

Objetivo: decidir con datos, según el criterio de corte de la sección 2.

- **Protocolo:** el mismo conjunto de tareas resuelto de tres formas: (a) Claude Code a mano en una conversación, (b) Graph Workspace con el contexto curado y (c) Graph Workspace en piloto automático. Primero en `todo-app`, después en `graphdev2` mismo.
- **Métricas automáticas por ejecución:** tokens, tiempo, reintentos, criterios cumplidos, acciones denegadas, cambios fuera de alcance e intervenciones humanas. Se guardan en el workspace y se exportan a un informe.
- Repetir H3 con Codex.
- Informe con la conclusión y la decisión: seguir, ajustar o replantear.

### Etapa 6: Grafo vivo (M)

Objetivo: ver el proyecto como una red que trabaja.

- Estado en vivo en el lienzo: la tarea en ejecución se ilumina, al cerrarse se activan las que desbloquea.
- Aristas que muestran qué contexto pasó de una tarea a otra (`TaskOutcome`, documentos, código).
- Camino crítico de la feature y progreso del piloto sobre el grafo.

Va al final a propósito: ayuda a entender el proyecto, pero no es lo que demuestra las hipótesis.

## 6. Orden y dependencias

Etapa 1 → Etapa 2 → Etapa 3 → Etapa 5 (primera medición con Claude) → Etapa 4 → Etapa 5 (medición con Codex) → Etapa 6.

El protocolo de medición (Etapa 5) se define al empezar la Etapa 1 para registrar métricas desde la primera tarea real. Todo cambio se prueba primero con el motor simulado y después, una vez por etapa, con el motor real sobre una copia del proyecto.

## 7. Fuera de alcance por ahora

Exportar e importar el workspace, búsqueda semántica, un tercer motor (OpenCode), aprobaciones interactivas por MCP y la mayor parte de la configuración avanzada de la UI.

## 8. Riesgos

| Riesgo | Mitigación |
| :--- | :--- |
| Los fabricantes de los motores incorporan planificación, memoria y tareas en segundo plano, y la orquestación pierde valor. | El valor diferencial está en la memoria estructurada del proyecto, independiente del motor y persistente; la portabilidad (H3) lo protege. |
| H1 no se cumple: el agente explorando el repositorio rinde igual que con contexto curado. | Se mide pronto (Etapa 5) y hay criterio de corte. |
| El grafo se desincroniza del código. | Se actualiza solo con cada ejecución y propuesta (Etapa 2); el usuario no lo mantiene a mano. |
| Costo y límites: el piloto encadena muchas ejecuciones. | Modelos por rol, pausa por límite, tope por sesión; modo `api_key` para uso intensivo. |
| Términos de la suscripción: automatizar el CLI de forma prolongada es zona gris. | Cada persona con su propia suscripción y CLI sin modificar; para el piloto automático intensivo, clave de API. |
| La autonomía acepta código incorrecto. | Las pruebas son la puerta; sin comandos de verificación no hay aceptación automática; auditoría de rutas siempre activa. |

## 9. Decisiones

Tomadas (2026-11-10):

1. **Autonomía por feature**, con `manual` por defecto y aviso de costo antes de activar `piloto`.
2. **Autenticación:** suscripción como primera opción; clave de API del proveedor como segunda opción, recomendada para la autonomía intensiva.
3. **Decisiones importantes:** las define la política de cada proyecto, con valores por defecto derivados del grafo (ver Etapa 3). El agente puede marcar más, nunca menos.

4. **Rama que recibe el trabajo aceptado: una rama por feature** (por ejemplo `feature/gestion-tareas`), creada desde la rama activa al empezar la feature. Cada tarea aceptada se integra ahí con squash; al terminar la feature, el usuario la revisa completa y la fusiona a su rama principal. Así el trabajo autónomo queda separado hasta su revisión y descartarlo es borrar una rama.

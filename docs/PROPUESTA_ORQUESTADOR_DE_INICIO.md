# Propuesta: orquestador de inicio («asistente de proyecto»)

Fecha: 2026-11-11 · Rama: `feat/claude-code` · Estado: propuesta, sin implementar.

## 1. Problema

La app ejecuta bien un plan (piloto, memoria entre tareas, aislamiento, bandeja), pero no ayuda a **definirlo**. Nadie decide el objetivo, el stack ni las convenciones, y el usuario vuelve a orquestar justo donde más importa.

Diagnóstico de `todo-app` (SQLite en solo lectura y `git log`):

- El proyecto solo tiene nombre: `description` nula, y `objectives`, `techStack` y `rules` vacíos. No hay documentos (`docs/` vacío), ni ADR.
- Toda la «arquitectura» es el README: «código en `src/`, pruebas con `node --test`». Sin interfaz, persistencia ni CLI: un módulo en memoria.
- No hay `DEPENDS_ON` entre features, así que cada rama salió de `main`, que solo tiene el scaffold. TASK-003 encontró `src/` vacío y reimplementó con otra API y en otro idioma: `createTaskList().add/list` frente a `crearTarea/listarTareas`. Ninguna regla fijaba el idioma ni el diseño.
- Hay un cuarto ChangeSet pendiente que duplica la feature de tareas.

Las tareas se cerraron bien; lo que faltó fue anterior a ellas.

## 2. Qué existe

| Pieza | Estado verificado | Uso |
| :--- | :--- | :--- |
| `project:create` | Acepta `description`, `objectives`, `techStack` y `rules`, pero la UI solo envía `name` y `slug`. No hay canal para editarlos después. | Perfil del proyecto |
| `project.rules` | Contexto de nivel 1 y llegan al planificador. `objectives` y `techStack` no se usan en ningún sitio. | Convenciones iniciales |
| `## Convenciones` al cerrar | Pasa a nivel 1 (`extractConventions`). | Complemento |
| `repository:configure` | Exige una ruta absoluta con `.git`; no inicializa repositorios. | Falta crear el repo |
| Planificador | `claude -p --tools '' --json-schema` (y Codex). Tiene `CREATE_DECISION_RECORD` (con `alternativesMd`), `UPSERT_ARTIFACT` (PRD, ARCHITECTURE), requisitos, features y tareas; validación, nodos fantasma y commit automático de documentos. | Motor de cada etapa |
| Política de decisiones | Cinco categorías; ADR y `SCOPE_CHANGE` piden revisión por defecto. | Se añade una categoría |
| Política de ejecución | Rutas escribibles, comandos de verificación y ADR en solo lectura para los agentes. | El stack fija los comandos |
| Roles | El enum tiene 5 roles, pero solo se siembra DEVELOPER; PLANNER solo elige el modelo (`opus`). | Rol de planificación |
| Bandeja y `next-step.ts` | `EmptyProject` lleva a un chat libre. | Punto de entrada |
| `graphdev`, `repository_scan.rs` | Escaneo solo de metadatos: respeta `.gitignore`, sin secretos ni symlinks, con topes (16 KB por archivo, 48 KB en total) y la observación separada de la interpretación. | Modo brownfield |
| `PROPUESTA_TASK_CONTEXT_MANAGEMENT.md` | Profundidad L1–L4 y modelo según profundidad. | El inicio es L4 |

## 3. Diseño

**Qué es.** Un `ProjectInceptionService` que lleva el proyecto por etapas con puertas humanas. En cada etapa el motor devuelve **preguntas cerradas** o una **propuesta** (un ChangeSet), y el usuario responde o aprueba. No es un chat libre. Es la primera encarnación del orquestador principal, que avisa, pregunta y propone desde la bandeja.

**Etapas:**

0. **Origen.** Repo nuevo (`git init` seguro) o existente (escaneo de metadatos y manifiestos, sin ejecutar nada).
1. **Objetivo y alcance.** Como mucho 5 preguntas con opciones y valor por defecto: usuario, problema, plataforma, qué queda fuera y cuándo está «terminado». Produce `docs/VISION.md` (PRD), requisitos y `objectives`. *Puerta.*
2. **Stack y arquitectura.** Dos o tres alternativas con compromisos y una recomendación. Produce el ADR-001 (con las alternativas consideradas), `ARCHITECTURE.md` y `techStack`. *Puerta.*
3. **Convenciones.** Produce las reglas de nivel 1 (idioma de identificadores, estructura, estilo de API, cómo se prueba) y la política de ejecución (rutas y comandos de verificación). *Puerta.*
4. **Plan inicial.** Produce módulos y features con `DEPENDS_ON` entre ellas. La primera feature es «Fundación», y su primera tarea hace el scaffold con el agente DEVELOPER en su worktree, bajo el validador. *Puerta.*
5. **Listo.** La bandeja propone «Activar piloto en FEAT-001».

**La conversación vive en el workspace.** Cada etapa guarda preguntas, respuestas y su ChangeSet. Cada llamada es independiente (`--no-session-persistence`) y su prompt se reconstruye con el perfil, las respuestas y el grafo, así que una etapa puede hacerla Claude y la siguiente Codex. Los productos son artefactos normales del grafo y Markdown versionado.

**Contrato.** Un solo esquema JSON: `{questions:[{id,text,options,default,why}], draft: ChangeSetDraft|null, assumptions:[]}`. Las suposiciones se muestran, no se esconden.

**Decisiones.** Nueva categoría `PROJECT_FOUNDATION` (objetivo, alcance, stack, reglas, política de ejecución), siempre en ASK y no configurable. Cuando un agente proponga después cambiar una regla o el stack, también pregunta. Archivar trabajo sigue pidiendo revisión. Las tareas del plan inicial se aceptan al aprobar la propuesta completa.

**Repo seguro (`repository:initialize`).** El usuario elige la carpeta padre y el nombre; la ruta se rechaza si existe y no está vacía. Se crea con `git init --template= -b main` (sin hooks) y git fijado. Se escriben `README.md`, `.gitignore` y `docs/`, y se hace el commit inicial. Si falta `user.name`, el error lo explica y la app no toca la configuración. Sin remotos, sin borrar nada y sin generadores (`create-*`, `npm init`).

**Brownfield.** Se portan las reglas de `repository_scan.rs`. El escaneo devuelve un conteo por extensión y manifiestos (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, CI, README) hasta 48 KB. Las etapas pasan a «confirma lo inferido», cada inferencia con su evidencia.

**Datos mínimos:**

- Migración 008 con `project_inception` (`project_id`, `stage`, `status`, `questions_json`, `answers_json`, `change_set_id`, `model`, `updated_at`).
- Operación `SET_PROJECT_PROFILE`, para que el perfil pase por validación y revisión como todo lo demás.
- `techStack` y `objectives` en el contexto de nivel 1.

**IPC.** `inception:get`, `inception:start`, `inception:answer`, `inception:approve`, `inception:redo`, `repository:initialize` y `repository:scan`.

**UI.** Un asistente paso a paso en la vista Actividad (`InceptionWizard.tsx`) con barra de etapas y tarjetas de pregunta; la propuesta se ve en la revisión que ya existe. `EmptyProject` y `nextStep` llevan a «Empezar proyecto» o «Continuar inicio».

**Costo.** De 4 a 6 llamadas sin herramientas, unos 60 K tokens de entrada en total, menos que una ejecución. Las etapas 1–2 usan `opus` y las 3–4 `sonnet`.

## 4. Etapas de implementación

| # | Entrega | Tamaño | Archivos | Pruebas |
| :--- | :--- | :--- | :--- | :--- |
| A | `SET_PROJECT_PROFILE`, `PROJECT_FOUNDATION`, stack y objetivos en el contexto | S | `change-set.ts`, `changeset-validator.ts`, aplicador, `change-set-planning-contract.ts`, `decision-policy.ts`, `context-resolver.ts` | Validador, política, regla presente en el snapshot |
| B | Servicio, migración 008, contrato preguntas/propuesta (Claude y Codex), IPC | M | `application/inception/`, planificadores, `workspace-core.ts`, `ipc-contracts.ts`, `request-dispatcher.ts` | Planificador falso que pregunta y luego propone; reanudar; cambiar de motor entre etapas |
| C | Asistente, bandeja y `nextStep` | M | `presentation/inception/`, `next-step.ts`, `EmptyProject.tsx`, `activity-service.ts` | UI con un IPC falso |
| D | `repository:initialize` | S | `infrastructure/git/` | Ruta no vacía rechazada, sin hooks ni remoto |
| E | `repository:scan` (brownfield) | M | `infrastructure/filesystem/` | `.gitignore`, secretos, symlinks, topes |

**MVP: A + B + C, con dos puertas.** «Empezar proyecto» sobre un repo vacío:

1. Primera puerta: hasta 5 preguntas de objetivo y alcance.
2. Segunda puerta: una sola propuesta con la visión, el ADR-001 con alternativas, las reglas, la verificación y el plan con Fundación y dependencias entre features.

Con eso, `todo-app` habría tenido objetivo, stack e idioma fijos, y FEAT-002 habría dependido de FEAT-001.

**Prueba real barata.** Sobre una copia vacía de `todo-app` con `sonnet` (y `opus` una vez, en el stack), se comprueba que:

- el ADR tiene al menos 2 alternativas;
- las reglas fijan el idioma y las pruebas;
- hay dependencias entre features;
- el piloto cierra la Fundación y una feature sin duplicar APIs.

## 5. Riesgos

| Riesgo | Mitigación |
| :--- | :--- |
| Stack alucinado o desproporcionado | Alternativas obligatorias, inferencias con evidencia y aprobación humana. Por defecto, el stack más simple. |
| Preguntar demasiado | Tope de 5 preguntas con valores por defecto y la opción «decide tú»; el MVP tiene 2 puertas. |
| Sobrediseñar | Visión de 1 página; como mucho 3 features de 3 a 6 tareas; lo excluido queda escrito. |
| Divergencia entre motores | Un esquema único que valida la app y el estado en SQLite. Se prueba con Codex cuando haya cuota. |
| Scaffold peligroso | Sin generadores; es una tarea normal con la política y el validador. |

**Qué NO hacer todavía:** remotos, plantillas con scripts, re-planificar solo un proyecto existente, agentes ARCHITECT o REVIEWER separados, escanear código fuente y un chat libre en la capa 3.

## 6. Decisiones que necesito del usuario

1. **Puertas:** ¿el MVP con 2 puertas (recomendado) o las 4 etapas separadas?
2. **Estado:** ¿una tabla `project_inception` (recomendado) o deducido solo de los artefactos?
3. **`PROJECT_FOUNDATION`:** ¿siempre en ASK, sin poder configurarlo?
4. **Scaffold:** ¿lo hace el agente como primera tarea (recomendado) o una plantilla mínima de la app?
5. **Dependencias:** ¿puede el scaffold ejecutar `npm install`? Si no, el MVP se limita a stacks sin dependencias.
6. **Modelo:** ¿`opus` para el objetivo y el stack, o `sonnet`?
7. **`todo-app`:** ¿se reinicia con el asistente o se usa como primer caso brownfield (unificando las dos ramas)?
8. **Prioridad:** ¿va antes que la Etapa 4 (Codex)?

# Plan: stacks recomendados, reglas verificables y skills incluidas

Fecha: 2026-11-11 · Rama: `feat/claude-code`
Complementa a `docs/PLAN_DE_TRABAJO.md` (plan vigente del núcleo). Nace de la auditoría del 2026-11-11 (sección 1).

## 0. Estado de un vistazo

| Etapa | Estado |
| :--- | :--- |
| S1. Catálogo de perfiles de stack y reglas en capas | Hecha (núcleo, inicio y vista de la propuesta) |
| S2. Dependencias gestionadas por la app (entorno del worktree) | Hecha con npm (Python con dependencias, pendiente) |
| S3. Prueba a escala real con un proyecto con dependencias | Primera corrida hecha (2 features, 5 tareas); falta la medición comparada |
| S4. Skills incluidas en la app | Hecha la infraestructura con Impeccable; falta medir su efecto |
| S5. Puertas de calidad que no escribe el agente | Pendiente |
| S6. Higiene del repositorio (CI, formato, documentación) | CI e índice de documentación hechos; formateador pendiente |

Mientras dure este plan, **la exploración visual (V1–V4) queda congelada**: no se le añade alcance hasta cerrar S3.

## 1. Auditoría (2026-11-11)

### 1.1 ¿Se cumple el objetivo?

| Hipótesis | Estado | Comentario |
| :--- | :--- | :--- |
| H1 Contexto justo, más barato | No se cumple | ~1,5× el costo ponderado del chat largo; agrupar tareas lo baja, pero es una optimización. Ya se decidió pivotar. |
| H2 Continuidad sin historial | Demostrada | Lo más sólido del proyecto. |
| H3 Portabilidad | Sin probar | Es la defensa frente al riesgo nº 1 (los fabricantes integran memoria y tareas) y Codex no está cableado. |
| H4 Autonomía | Demostrada en pequeño | Solo `todo-app` con `haiku`, 2–13 tareas, sin dependencias externas. |

La propuesta de valor vigente («el proyecto avanza solo, con trazabilidad y convenciones entre features») solo se distingue de un chat en proyectos largos y con dependencias reales. **No hay evidencia en ese terreno todavía**, y hoy la app no puede generarlo (1.2, puntos 1 y 2).

### 1.2 Huecos

1. **Los proyectos nuevos no pueden tener dependencias.** La regla 2 del prompt de inicio (`src/infrastructure/ai/inception-contract.ts`) exige stack sin dependencias externas y `NO_INSTALL_RULE` (`src/application/inception/foundation-plan.ts`) prohíbe instalar. Solo salen proyectos con biblioteca estándar.
2. **Aunque el usuario instale, el agente no puede usarlas.** Cada ejecución corre en un worktree nuevo, sin `node_modules`; y el validador (`src/infrastructure/execution/execution-validator.ts`) trata como violación cualquier ruta ignorada nueva. Las comprobaciones de un proyecto React fallarían siempre.
3. **No hay categoría de decisión para dependencias.** El plan del núcleo lo prevé («cambiar dependencias del proyecto» pregunta), pero `DecisionCategory` no lo tiene: un agente con `package.json` escribible añade paquetes sin preguntar (aunque no pueda instalarlos).
4. **La puerta de calidad la escribe el agente.** Las pruebas que deciden la aceptación automática son las del propio agente; puede además tocar el script `test` de `package.json`. Sin oráculo independiente en uso real.
5. **Las reglas del proyecto no se verifican.** Son texto de nivel 1 en el prompt; nada comprueba que se cumplan.
6. **Las skills están apagadas por diseño** (`--disable-slash-commands` en `CLAUDE_ISOLATION_ARGS`), sin camino para dar a una tarea una skill elegida por la app.
7. **Mantenibilidad:** líneas de más de 400 caracteres en archivos centrales (`AgentsWorkspace.tsx`, `graph-traversal.ts`, `agent-orchestrator.ts`…), sin linter, formateador ni CI.
8. **Documentación desviada:** 13 documentos (~3.100 líneas), varios superados; el plan del núcleo da como pendiente el aislamiento del planificador, que ya está hecho.
9. **Desvío de foco:** los últimos cinco commits son de exploración visual mientras siguen pendientes Codex, el recorte del prompt de contexto y una prueba a escala.

Estado comprobado: `tsc --noEmit` limpio y 452/452 pruebas en verde.

## 2. Principios

- **Una regla sin verificación es una sugerencia.** Cada regla que pueda comprobarse lleva el comando que la comprueba, y ese comando entra en la verificación.
- **La app instala; el agente no.** Instalar ejecuta código de terceros y toca la red: lo hace la app, en un paso propio, con `--ignore-scripts`, a partir de una lista aprobada. El agente solo declara qué necesita.
- **El catálogo vive en la app y se copia al workspace.** Perfiles de stack y skills se distribuyen con la app (versionados, revisados, sin red al instalar). Lo que un proyecto adopta queda en SQLite y en su repositorio: cualquier motor lo puede usar.
- **Sin versiones memorizadas.** El catálogo nombra paquetes, no versiones; la versión la fija el lockfile al instalar, y el catálogo lleva su fecha de revisión.
- **Medir lo que cueste tokens** con `scripts/benchmark/` (lección de H1).

## 3. Etapas

Tamaños: S = horas, M = ~1 día, L = varios días.

### S1. Catálogo de perfiles de stack y reglas en capas (M)

Objetivo: el inicio de proyecto recomienda un stack probado para el tipo de proyecto, con reglas y verificación que no dependen de lo que el modelo recuerde.

- `src/domain/projects/stack-catalog.ts`: perfiles tipados. Cada uno tiene `id`, tipo de proyecto, cuándo usarlo, `techStack`, paquetes de ejecución y de desarrollo (sin versión), estructura de carpetas, reglas de nivel 1, comandos de verificación, gestor de paquetes y comando de instalación, y `reviewedAt`.
- Perfiles iniciales:
  - `minimo-node`: Node, sin dependencias, `node --test` (el comportamiento actual).
  - `web-spa-react`: TypeScript, React, Vite, Vitest, Testing Library, jsdom.
  - `api-node`: TypeScript, Fastify, Zod, Vitest.
  - `cli-node`: TypeScript, Vitest, sin framework.
  - `minimo-python`: Python con biblioteca estándar y `unittest`.
- **Verificación a prueba de manipulación:** los comandos llaman a los binarios instalados (`node_modules/.bin/vitest run`, `node_modules/.bin/tsc --noEmit`), no a scripts de `package.json` que el agente puede editar.
- **Reglas en capas:** app (buenas prácticas generales, comunes a todos) → perfil → proyecto (lo que propone el inicio) → convenciones de feature (ya existen). El inicio recibe el catálogo, elige `stackProfileId` y justifica en el ADR; `buildFoundationPlan` fusiona de forma determinista las reglas y la verificación del perfil en `SET_PROJECT_PROFILE`, y valida que el perfil exista.
- La regla 2 del prompt pasa a ser: «elige el perfil más simple que cubra el proyecto; sin dependencias solo si el proyecto no las necesita». `NO_INSTALL_RULE` se mantiene: el agente sigue sin instalar (lo hace la app, S2).
- Migración `014`: `projects.stack_profile_id` y `projects.approved_dependencies_json`.
- La vista de la propuesta muestra el perfil elegido y sus paquetes.

> **Estado (2026-11-11): hecha.** `src/domain/projects/stack-catalog.ts` (5 perfiles, `APP_RULES`, `applyStackProfile`); el esquema del inicio solo admite ids del catálogo y el prompt lo recibe como datos; `buildFoundationPlan` fusiona el perfil (sus claves de stack y su verificación mandan; reglas app → perfil → proyecto) y avisa si falta o no existe; en brownfield se descarta. Migración `014` (`stack_profile_id`, `approved_dependencies_json`). La propuesta muestra el perfil, los paquetes y la fecha de revisión del catálogo.

**Cierre:** el inicio con «una SPA de notas» propone `web-spa-react` con reglas y verificación del perfil, y uno con «un script que cuente palabras» sigue proponiendo `minimo-node`. Pruebas de contrato y una ejecución real con `haiku`.

### S2. Dependencias gestionadas por la app (L)

Objetivo: el agente trabaja con las dependencias instaladas y no puede añadir ninguna sin aprobación.

- **Entorno del worktree:** después de crear el worktree y antes de lanzar el motor, si el proyecto tiene perfil con gestor de paquetes, la app instala en el worktree (`npm ci --ignore-scripts --no-audit --no-fund`, o `npm install --ignore-scripts` si aún no hay lockfile), con la caché de npm del usuario. La salida se guarda en el log de la ejecución; si falla, la ejecución falla con motivo `ENVIRONMENT`.
- **Rutas aprovisionadas:** `node_modules/` se registra como ruta del entorno: el validador la excluye de la auditoría de rutas ignoradas, y los permisos del motor la niegan para escritura.
- **Detección de cambios de dependencias:** el validador compara las dependencias del manifiesto con las del commit de partida.
  - Paquetes de la lista aprobada (perfil y aprobaciones del usuario): la app reinstala y actualiza el lockfile antes de las comprobaciones.
  - Paquetes nuevos fuera de la lista: la ejecución falla con motivo `DEPENDENCY_APPROVAL` y la lista de paquetes. El piloto queda esperando al usuario, que puede **aprobar y reintentar** (los paquetes pasan a `approved_dependencies_json`) o rechazar.
- Nueva categoría de decisión `DEPENDENCY_CHANGE`, siempre «preguntar» por defecto.
- El scaffold escribe `package.json` con los paquetes del perfil; la app genera el lockfile y lo incluye en el commit de la ejecución.
- Python con dependencias (venv y `pip`) queda para después de S3.

> **Estado (2026-11-11): hecha con npm.** `WorkspaceEnvironmentPort` (`forProject`, `provision`, `reconcile`) con `NpmEnvironment` (`src/infrastructure/execution/npm-environment.ts`). Antes del agente: crea `package.json` si falta, añade los paquetes del perfil o hace `npm ci`, siempre con `--ignore-scripts`, y commitea el manifiesto aparte (la ejecución parte de ese commit; log en `executions/<id>/environment.log`). El agente ve `node_modules/` como solo lectura y una sección «Entorno del proyecto» en el prompt. El validador excluye `node_modules/` de la auditoría y del commit (aunque el `.gitignore` lo olvide), trata `.npmrc` como violación y, antes de las comprobaciones, reconcilia: paquetes nuevos o cambiados fuera de la lista → fallo `DEPENDENCY_APPROVAL` con los nombres; dentro → la app reinstala. El piloto no reintenta ese fallo: espera al usuario. Canales `environment:get` y `environment:approve_dependencies`; botón «Aprobar paquetes» en la revisión de Agentes.
>
> Desviación: no se añadió `DEPENDENCY_CHANGE` a la política de decisiones (que clasifica operaciones del grafo, no archivos); la aprobación de paquetes vive en la puerta del entorno y siempre pregunta.

**Cierre:** en un proyecto `web-spa-react`, el piloto cierra el scaffold y una tarea con componente y prueba, con `vitest` y `tsc` en verde dentro del worktree; un intento de añadir un paquete no aprobado se detiene con el motivo y se reanuda al aprobarlo.

### S3. Prueba a escala real (M)

> **Primera corrida real (2026-11-11, `haiku` en todo, incluido el inicio):** brief «SPA de notas en localStorage» → el inicio eligió `web-spa-react` sin avisos → piloto en «Fundación» (2 tareas) y «Gestión de notas» (3 tareas, una pareja agrupada) → **5/5 tareas cerradas sin intervención**, una ejecución agrupada falló en `vitest` y pasó en el reintento. La rama final tiene `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `index.html` y el código en `src/`, sin `node_modules/` ni `.claude/`. Una corrida anterior encontró el hueco que las pruebas simuladas no veían: la política por defecto no dejaba escribir la configuración de la raíz (`tsconfig.json`, `vite.config.ts`…), y el scaffold fallaba siempre; ahora cada perfil aporta sus rutas escribibles. Falta lo que pide esta etapa: un proyecto más grande, métricas y la comparación con un chat.

Objetivo: la evidencia que falta. Un proyecto nuevo con dependencias (por ejemplo, SPA de React con 3–4 features y dependencias entre ellas), del inicio a la integración en `main`, en piloto, con `haiku` para ejecutar.

- Métricas de la Etapa 5 del plan del núcleo: tareas cerradas sin intervención, intervenciones por motivo, costo ponderado, convenciones respetadas.
- Comparación con el mismo proyecto hecho a mano en un chat, si la cuota lo permite.
- Informe en `docs/benchmarks/`.

**Cierre:** informe con la decisión: seguir, ajustar o replantear.

### S4. Skills incluidas en la app (M)

Objetivo: las tareas que lo necesitan reciben skills especializadas (diseño de interfaz, primero), sin depender de lo que el usuario tenga instalado y sin red.

- **Catálogo vendorizado:** `skills/<id>/` en el repositorio, con el contenido de la skill fijado a un commit de su repositorio de origen, su licencia y un `skill.json` (origen, commit, hash del contenido, licencia, requisitos del equipo, a qué tareas aplica). Se empaqueta en los recursos de Tauri como el sidecar de Node. Se revisa el contenido antes de incluirlo: una skill tiene los mismos permisos que el agente.
- Primeras candidatas: **Impeccable** (`pbakaus/impeccable`, Apache-2.0) para tareas de interfaz; después **UI/UX Pro Max** (`nextlevelbuilder/ui-ux-pro-max-skill`, MIT), que necesita Python en el equipo (la app comprueba el requisito y la omite si falta).
- **Selección por tarea:** la app decide qué skills recibe cada ejecución (por ejemplo, las tareas de una feature documentada por `docs/UI_SPEC.md` o con `recommendedProfileRole` de interfaz) y queda registrado en el snapshot de la ejecución.
- **Materialización:** se copian al worktree en `.claude/skills/<id>/` y se excluyen con `.git/info/exclude` del worktree; el validador las trata como rutas del entorno (como `node_modules/`).
- **CLI:** se sustituye `--disable-slash-commands` solo cuando la ejecución lleva skills; `--setting-sources project,local` se mantiene, así que las skills y plugins personales siguen fuera. Hay que comprobar con el CLI real qué carga exactamente (skills del repositorio del proyecto incluidas).
- Los hooks de las skills no se activan (el aislamiento los deja fuera); el inicio y los prototipos, que corren sin herramientas, reciben una guía destilada en el prompt en lugar de la skill.
- Portabilidad: el formato `SKILL.md` lo usan Claude Code y Codex; el adaptador de Codex lo copiaría a su carpeta cuando se cablee.
- **Medición:** misma tarea de interfaz con y sin skill: tokens, tiempo y una revisión visual.

> **Estado (2026-11-11): infraestructura hecha.** `skills/impeccable/` (commit `b4bff16` de `pbakaus/impeccable`, Apache-2.0 con `LICENSE` y `NOTICE.md`): solo el Markdown de la skill; sin `scripts/` (el agente no podría ejecutarlos y el lanzador descarga un binario) ni las referencias del modo live y de hooks. `skill.json` con origen, licencia, hash del contenido y la nota para el agente (mapea PRODUCT.md/DESIGN.md a `docs/VISION.md`/`docs/UI_SPEC.md` y le indica el camino «Launcher unavailable»). `build:core` copia `skills/` junto al núcleo, así que viaja en los recursos de Tauri. `SkillProvisionPort`: una ejecución recibe la skill si el proyecto tiene interfaz (stack o perfil) y la tarea es de interfaz (feature documentada por `docs/UI_SPEC.md` o palabras de interfaz en el título o el resumen); la copia en `.claude/skills/impeccable/`, de solo lectura para el agente, fuera de la auditoría y del commit; el prompt lo dice en «# Skills de la app». Un paquete cuyo hash no coincide no se usa.
>
> Comprobado con el CLI real (2.1.318, `haiku`): con `--setting-sources project,local` y sin `--disable-slash-commands` carga las skills de `.claude/skills/` del worktree y **no** las personales del usuario (`~/.claude/skills`), pero sí las integradas del propio CLI (`dataviz`, `code-review`, `loop`…), que añaden su descripción al prompt. Por eso solo se quita `--disable-slash-commands` en las ejecuciones que llevan skills. Prueba real (2026-11-11, `haiku`, SPA de notas desde el inicio): la skill llegó a los worktrees de las tareas de interfaz y a ninguno de las demás, nunca se commiteó, pero el agente **no la leyó ni invocó `Skill`** (solo la vio en un `Glob`). Se cambió la nota del prompt por una instrucción explícita (leer `SKILL.md` y `reference/craft-floor.md` antes de tocar la interfaz), aún sin verificar en real. Pendiente: verificar esa nota, interruptor por proyecto en la interfaz, UI/UX Pro Max (necesita Python) y la medición.

**Cierre:** una tarea de interfaz de S3 se repite con Impeccable incluida; el snapshot muestra la skill, el CLI la carga y el informe compara costo y resultado.

### S5. Puertas de calidad que no escribe el agente (M)

- Cada criterio de aceptación de una tarea debe quedar ligado a una prueba nombrada en el resumen de cierre; la app comprueba que esas pruebas existen y pasan.
- Archivos de configuración de verificación (`vitest.config.*`, `tsconfig*.json`, scripts de prueba) de solo lectura para el agente salvo en el scaffold.
- Revisión opcional por un segundo modelo (capaz) antes de aceptar en `piloto`, con el diff y los criterios; su veredicto queda en la traza.
- Comandos de lint y tipos del perfil como parte de la verificación (ya en S1).

### S6. Higiene del repositorio (S–M)

> **Estado (2026-11-11):** `.github/workflows/ci.yml` (Node 22: `npm ci`, `typecheck`, `test`) y `docs/README.md` (índice vigente / referencia / histórico; no se movió ningún documento para no romper enlaces). Referencias IPC y de base de datos al día. Pendiente: formateador.

- CI (GitHub Actions) con `npm run typecheck` y `npm test`.
- Formateador para código nuevo o tocado, sin reformatear todo de golpe; empezar por partir las líneas de más de 400 caracteres en los archivos que se toquen.
- Documentación: un índice en `docs/README.md`, los planes superados movidos a `docs/archivo/`, y corregir lo que el plan del núcleo da por pendiente y ya está hecho.

## 4. Orden

S1 → S2 → S3 → S4 → S5; S6 en paralelo, a ratos. S4 va después de S3 a propósito: hace falta un proyecto con interfaz real para medir si la skill aporta.

## 5. Riesgos

| Riesgo | Mitigación |
| :--- | :--- |
| Instalar ejecuta código de terceros. | `--ignore-scripts`, lista aprobada, lockfile, la instalación la hace la app y no el agente. |
| Instalar en cada worktree es lento. | Caché de npm; medir; si pesa, compartir `node_modules` por lockfile (enlace de solo lectura). |
| El catálogo envejece. | Paquetes sin versión, `reviewedAt` por perfil, revisión periódica. |
| Una skill de terceros contiene instrucciones dañinas. | Vendorizada, revisada, fijada por hash; nunca se descarga en tiempo de ejecución. |
| Las skills encarecen cada ejecución. | Solo las tareas que las necesitan; medición en S4. |
| Licencias. | Solo licencias permisivas (MIT, Apache-2.0), con su texto y la atribución dentro de `skills/<id>/`. |

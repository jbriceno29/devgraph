# Graph Workspace

Aplicación de escritorio _local-first_ para llevar un proyecto de software de la idea al código con agentes de IA, sin que el usuario tenga que hacer de orquestador. Shell Tauri 2 (Rust), interfaz React/Tailwind y un núcleo Node/TypeScript con SQLite y Markdown versionado en Git.

## Qué es

- **El proyecto es una línea de trabajo, no una conversación.** Vive como un grafo (módulos, features, requisitos, tareas, decisiones, documentos y código) dentro del workspace: SQLite más Markdown en el repositorio.
- **El contexto vive en el workspace, no en el motor.** Cada tarea se abre con el contexto justo, se cierra con evidencia verificable (auditoría del diff y comprobaciones) y deja lo aprendido en el grafo para las tareas siguientes. Las sesiones del motor son desechables, así que el contexto es portable entre motores.
- **El usuario no es el orquestador.** Un asistente de inicio define contigo el objetivo, el stack y el plan; después un piloto automático por feature ejecuta, verifica, acepta y avanza, y solo se detiene a preguntar cuando hace falta una decisión humana.
- **El trabajo queda aislado en Git.** Cada ejecución corre en un worktree temporal, se integra en una rama por feature (`feature/…`) y `main` no se toca hasta pulsar «Integrar en main».
- **Motor actual: Claude Code** (CLI con tu sesión iniciada). Codex tiene código en el repositorio pero está desconectado (ver «Estado actual»).

La visión, las hipótesis y las decisiones están en [docs/PLAN_DE_TRABAJO.md](docs/PLAN_DE_TRABAJO.md).

## Instalación y ejecución

Requisitos:

- Node.js 22 o posterior y npm (`engines` en `package.json`).
- Rust/Cargo y las dependencias nativas de Tauri para tu plataforma (en Ubuntu: WebKitGTK/GTK y herramientas de compilación; ver la [guía oficial](https://v2.tauri.app/start/prerequisites/)).
- Git.
- El CLI de [Claude Code](https://docs.claude.com/en/docs/claude-code) instalado y con la sesión iniciada (`claude` debe funcionar en tu terminal). El núcleo lo busca en el `PATH` y en ubicaciones habituales; si está en otro sitio, define `GRAPHDEV_CLAUDE_PATH` con su ruta absoluta antes de abrir la app.

```bash
npm install
npm run desktop
```

`npm run desktop` ejecuta `tauri dev`: compila el núcleo TypeScript (`build:core`), prepara los recursos y levanta Vite en `127.0.0.1:1420`. La primera vez compila el host Rust y tarda. **El núcleo no se recarga en vivo:** si cambias código de `src/` fuera de la interfaz, reinicia `npm run desktop`.

Otros scripts (`package.json`):

| Script                  | Qué hace                                                                                                        |
| :---------------------- | :-------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`     | `tsc --noEmit`                                                                                                  |
| `npm test`              | Pruebas con Vitest (unitarias, integración y UI)                                                                |
| `npm run build`         | Compila núcleo y renderer y prepara los recursos de Tauri                                                       |
| `npm run desktop:build` | Empaqueta la aplicación con `tauri build` (runtime Node, núcleo y `better-sqlite3` para la plataforma de build) |

## Recorrido de uso

Guía detallada, con lenguaje llano, en [docs/GUIA_DE_USO.md](docs/GUIA_DE_USO.md). En resumen:

1. **Crear el proyecto** (nombre y slug) desde la pantalla inicial.
2. **Vista «Inicio»:** describe qué quieres construir. El asistente (modelo `opus` por defecto) te hace hasta 5 preguntas; las respondes (o dejas «decide tú»).
3. **Conectar o crear el repositorio** (`repository:configure` con una ruta existente, o `repository:initialize` para crear uno nuevo con commit inicial).
4. **Aprobar el plan:** revisas la propuesta única (visión, ADR del stack con alternativas, reglas, verificación y plan con la feature «Fundación»). Puedes pedir cambios con notas y regenerar. Nada se crea hasta que apruebas.
5. **Ejecutar una tarea** (vista «Agentes») o **activar el piloto** en una feature (aviso de costo obligatorio). La primera tarea es el scaffold de «Fundación».
6. **Revisar y aceptar:** ves el diff, las comprobaciones y las acciones denegadas; aceptas (squash a la rama de la feature) o pides ajustes. En auto-aceptar y piloto, esto lo hace el sistema si las puertas pasan.
7. **Atender la bandeja de actividad** cuando el piloto espera una decisión (propuestas del agente al plan, fallos repetidos, conflictos).
8. **Integrar la feature:** cuando todas sus tareas están en `DONE`, «Integrar en main» la fusiona en la rama base.

## Mapa de la documentación

| Documento                                                                                                                                                                        | Para qué                                                                                                                           |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| [docs/GUIA_DE_USO.md](docs/GUIA_DE_USO.md)                                                                                                                                       | Guía de usuario: conceptos, recorrido, dónde queda el código, costos, problemas comunes                                            |
| [docs/PLAN_DE_TRABAJO.md](docs/PLAN_DE_TRABAJO.md)                                                                                                                               | Plan vigente: visión, hipótesis, etapas con su estado, decisiones                                                                  |
| [docs/PROPUESTA_ORQUESTADOR_DE_INICIO.md](docs/PROPUESTA_ORQUESTADOR_DE_INICIO.md)                                                                                               | Asistente de inicio de proyecto: diseño original y estado implementado                                                             |
| [docs/AUDITORIA_UX.md](docs/AUDITORIA_UX.md)                                                                                                                                     | Auditoría de la interfaz (2026-11-12): errores, problemas de uso y propuesta de reorganización                                     |
| [docs/PROPUESTA_ARQUITECTURA.md](docs/PROPUESTA_ARQUITECTURA.md)                                                                                                                 | Propuesta de arquitectura (2026-11-12): diagnóstico, monolito modular + MVVM, reglas y plan de migración                           |
| [docs/ARQUITECTURA_ACTUAL.md](docs/ARQUITECTURA_ACTUAL.md)                                                                                                                       | Capas, flujo de una ejecución, sidecar y host Rust (estado real)                                                                   |
| [docs/REFERENCIA_IPC.md](docs/REFERENCIA_IPC.md)                                                                                                                                 | Canales IPC: comandos, consultas y eventos                                                                                         |
| [docs/BASE_DE_DATOS.md](docs/BASE_DE_DATOS.md)                                                                                                                                   | Migraciones 001–009 y tablas principales                                                                                           |
| [docs/benchmarks/](docs/benchmarks/)                                                                                                                                             | Informes de las mediciones 1–6                                                                                                     |
| [docs/DOMAIN.md](docs/DOMAIN.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md), [docs/PROGRESS.md](docs/PROGRESS.md) | Especificaciones originales (en inglés, anteriores a la migración a Claude Code; úsalos como referencia de diseño, no como estado) |
| [docs/ANALISIS_PROYECTO.md](docs/ANALISIS_PROYECTO.md), [docs/PLAN_MIGRACION_CLAUDE.md](docs/PLAN_MIGRACION_CLAUDE.md)                                                           | Históricos                                                                                                                         |
| [src/desktop/theme/MIGRACION.md](src/desktop/theme/MIGRACION.md)                                                                                                                 | Tokens del tema claro/oscuro y su migración                                                                                        |

## Estado actual

Funciona (verificado en el código y en las pruebas; las pruebas reales con `haiku` están en el plan y en `docs/benchmarks/`):

- Ciclo completo con Claude Code: contexto curado, worktree por tarea, validación, aceptación con squash en la rama de la feature, memoria entre tareas (resumen de cierre y convenciones como reglas de nivel 1), integración de la feature en la rama base.
- Piloto automático por feature con reintentos, escalamiento de modelo, pausa por uso y política de decisiones del proyecto.
- Asistente de inicio de proyecto (con referencias visuales, funcionales y conceptuales que un modelo aparte traduce a texto, una exploración de diseño opcional con prototipos interactivos que se prueban en un visor aislado y sin red, y un modo para repositorios con código que lee manifiestos, estructura y estilos para partir de lo que existe), referencias y actualización de `docs/UI_SPEC.md` al planificar una feature, bandeja de actividad, grafo con estado vivo y flujo de contexto, tema claro/oscuro.
- Mediciones: el workspace iguala la calidad del mejor chat sin intervención humana, a ~1,5× el costo ponderado del chat largo; con la agrupación de tareas del piloto activa, ~19 % menos con la misma calidad (octava medición; detalle en `docs/benchmarks/`).

Pendiente o con límites:

- **Codex:** `CodexAgentAdapter` y `CodexChangeSetPlanner` siguen en el repositorio pero no están cableados; reconectarlos es la Etapa 4. Hoy solo funciona Claude Code.
- **Avisos de escritorio:** usan la API web `Notification` (no hay plugin de Tauri); en un webview sin esa API o sin permiso no se muestra nada. La bandeja de actividad dentro de la app sí es fiable.
- **Agrupación de tareas:** el piloto agrupa 2–3 tareas pequeñas de una feature en una ejecución (opción «Agrupar tareas pequeñas» de la feature, activa por defecto en features nuevas; las configuradas antes de la opción la tienen apagada). Medido con el piloto agrupando solo (octava medición): −17 % a −20 % de costo ponderado con 33/33 pruebas ocultas y la convención intacta; con grupos de 4 el ahorro sube pero la convención se pierde, así que el tamaño por defecto es 3 y no conviene subirlo sin medir. Un solo escenario y un solo modelo: si en tu proyecto baja la calidad, apágala en la feature.
- **Recorte del prompt de contexto** y **camino crítico en el grafo:** sin hacer.
- **Inicio de proyecto:** solo con Claude Code; en un proyecto con plan ya creado no se usa; cancelar una llamada envía SIGINT y luego SIGTERM, y si el sidecar muere por SIGKILL el proceso del motor puede quedar huérfano (por verificar en detalle).

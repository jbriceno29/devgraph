# Graph Workspace — instrucciones para agentes

App de escritorio local-first que lleva un proyecto de la idea al código con agentes de IA sin que el usuario
orqueste: el proyecto vive como un grafo (SQLite + Markdown en Git), cada tarea corre en un worktree aislado con el
contexto justo, se verifica, se acepta y deja su resultado en el grafo. Host Tauri (Rust), interfaz React/Tailwind y
núcleo Node/TypeScript (el _sidecar_). Visión: `docs/PLAN_DE_TRABAJO.md`. Orden de trabajo: `docs/HOJA_DE_RUTA.md`.

## Comandos

| Comando              | Qué hace                                                           |
| -------------------- | ------------------------------------------------------------------ |
| `npm test`           | Vitest: unitarias, integración, UI y las reglas de arquitectura    |
| `npm run typecheck`  | `tsc --noEmit`                                                     |
| `npm run check:arch` | Reglas de arquitectura con detalle (`--update` baja la línea base) |
| `npm run format`     | Biome (CI usa `format:check`)                                      |
| `npm run build:core` | Compila el núcleo en `dist/main` (entrada `dist/main/sidecar.js`)  |
| `npm run desktop`    | La app con Tauri; el núcleo no se recarga en vivo                  |

## Arquitectura

Monolito modular hexagonal en el núcleo y MVVM en la interfaz (`docs/PROPUESTA_ARQUITECTURA.md`). La migración está en
curso: el código viejo sigue en `src/domain`, `src/application`, `src/infrastructure` hasta que la hoja de ruta lo mueva
a `src/modules/<módulo>/{domain,application,infrastructure}`. **Lo nuevo se escribe ya con las reglas de abajo.**

- `src/sidecar.ts` es la entrada estable del núcleo: Rust y los recursos empaquetados apuntan a `sidecar.js`.
- `src/shared/contracts` son los DTO e IPC que comparten núcleo e interfaz; `src/shared/kernel` el vocabulario común.
- La interfaz solo habla con el núcleo por IPC (`window.workspaceIpc`); nunca toca disco ni SQLite.

## Reglas

Las marcadas **[auto]** las comprueba `npm test` (y CI) con `scripts/check-architecture.mjs`. Lo que ya las rompía
está en `scripts/architecture-baseline.json`: **un archivo de la línea base no puede empeorar y lo nuevo debe
cumplir**. Al partir o mover código, ejecuta `npm run check:arch -- --update` para fijar lo que bajó. Nunca subas un
número de la línea base a mano.

Dependencias:

1. **[auto]** `domain` solo importa `domain`, `shared/kernel` y `shared/types`. `application` importa `domain`,
   `application`, `shared/*` y la API pública (`index.ts`) de otros módulos. Nunca infraestructura ni interfaz.
2. **[auto]** Un módulo usa otro solo por su `index.ts`.
3. **[auto]** `domain`, `application`, `shared` y `desktop` no importan `node:*`, `better-sqlite3` ni `child_process`:
   reciben un puerto (`Clock`, `IdGenerator`…).
4. **[auto]** SQL solo en la persistencia (`src/infrastructure/persistence`, `src/platform/sqlite`,
   `src/modules/*/infrastructure/sqlite-*.ts`).
5. Los adaptadores (`new ClaudeCodeAdapter()`, repositorios SQLite…) se crean solo en la composición del núcleo.
6. **[auto]** `shared/contracts` solo importa `shared/*`; `desktop` solo importa `desktop` y `shared/*`.

Tamaño y forma:

7. **[auto]** Archivo `.ts` ≤ 300 líneas, `.tsx` ≤ 250; función ≤ 60. Si no cabe, se parte **antes** de añadir.
8. Un caso de uso por archivo (`accept-execution.ts`, verbo-sustantivo) con un método público `execute`. Nada de
   `*Service`/`*Manager` que agrupen acciones.
9. Constructor ≤ 6 dependencias; puerto ≤ 8 métodos.
10. **[auto]** Prompts y textos de más de 400 caracteres en `prompts/*.md` (no en cadenas de código).
11. Un handler IPC solo parsea argumentos, llama a un caso de uso y devuelve un DTO.

Interfaz (MVVM):

12. **[auto]** `window.workspaceIpc` solo en `desktop/core/ipc`, `desktop/platform` y `*.api.ts`.
13. Una View no tiene `useEffect` ni IPC: todo viene de su ViewModel (`use-*.vm.ts`). La lógica sin React va en
    `*.logic.ts` con pruebas unitarias.
14. Lo que sobrevive a cambiar de vista (grafo, selección, filtros, borradores) vive en el shell o en el store de
    `desktop/core`; filtrar una vista nunca modifica el estado compartido. Los borradores se registran con
    `useUnsavedChanges` para que el shell pregunte antes de salir.
15. Textos de la interfaz en español (`labels.ts`); el usuario nunca ve códigos crudos (`TASK`, `MEDIUM`). Identificadores
    y comentarios del código en inglés. Un botón promete exactamente lo que hace.

Pruebas y documentación:

16. Pruebas en `tests/{unit,integration,ui}`; al mover a módulos, reflejan los módulos. Dominio y casos de uso con
    puertos falsos; adaptadores con integración; ViewModels y Views con Testing Library.
17. Si cambian los límites de un módulo, `docs/ARQUITECTURA_ACTUAL.md` se actualiza en el mismo commit.
18. Sin dependencias nuevas (librerías) sin una decisión explícita del usuario.

## Cómo se cierra un paso

1. `npm run format`, `npm run typecheck` y `npm test` en verde.
2. Una corrida real con un modelo barato (`haiku`) del flujo tocado, sobre una copia o un proyecto de prueba; nunca sobre
   los datos reales del usuario sin permiso.
3. Commit en inglés con prefijo convencional (`fix(ui): …`), nota en el plan del paso y estado en
   `docs/HOJA_DE_RUTA.md`.

## Cuidados

- Las referencias que adjunta el usuario (imágenes, archivos) las traduce a texto un modelo aparte
  (`ReferenceTranslatorPort`); el asistente de inicio y el planificador no reciben herramientas de lectura.
- El visor de prototipos necesita las tres capas (sandbox, CSP de `hardenPrototype` y conteo de cargas); jsdom no las
  prueba: cualquier cambio se verifica en un navegador real.
- No borres ramas ni cambies remotos; Codex está en el repo pero desconectado (Etapa 4).

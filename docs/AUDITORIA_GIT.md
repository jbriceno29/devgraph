# Auditoría del manejo de Git desde la app

Revisión del 2026-11-12, a raíz de la validación de F0. En `todo-app`, el checkout del usuario estaba en
`feature/feat-002-…` y dos features en paralelo crearon el mismo archivo. La pregunta es qué puede salir mal cuando
otra persona use la app sobre **su** repositorio, con sus ramas, sus cambios a medias y sus costumbres.

## 1. Qué toca la app en el repositorio del usuario

| Operación | Dónde | Qué hace con Git |
| --- | --- | --- |
| Crear la rama de una feature | `GitIsolationService.createIntegrationBranch` | `git branch feature/<clave>-<título>` desde el `HEAD` del usuario. Guarda como «rama base» la rama que el usuario tenga abierta en ese momento. |
| Preparar una tarea | `prepare` | `git worktree add -b graphdev/<tarea>-<id>` en la carpeta de datos de la app, desde la rama de la feature. |
| Aceptar una tarea | `squashMerge` | Squash en la rama de la feature, en un worktree desechable. Se rechaza si esa rama está abierta en algún checkout. |
| Poner al día una feature | `mergeInto` (dependencias y `syncDocuments`) | Commit de merge en la rama de la feature, en un worktree desechable. |
| Integrar una feature | `mergeIntoBase` | Merge `--no-ff` en un worktree desechable. Luego avanza la rama base con `--ff-only` en el checkout del usuario (solo si está limpio) o con `update-ref` y compare-and-swap. |
| Resolver conflictos (F0b) | `GitFeatureConflicts.mergeWithConflicts` | Commit con marcadores en la rama de la feature, con compare-and-swap. Se rechaza si la rama está abierta. |
| Guardar un documento | `GitDocumentCommitter.commit` | `git add` y `git commit -- <rutas>` **en el checkout del usuario**, sobre la rama que tenga abierta. |
| Descartar una ejecución | `discard` | Borra el worktree y la rama `graphdev/…`. Valida que los creó la app. |

**Lo que ya está bien:**

- Nunca hace `push` ni fuerza nada.
- Las fusiones ocurren en worktrees desechables y sin hooks.
- La rama base avanza con compare-and-swap, nunca sobre un checkout sucio.
- `discard` solo borra lo que la app creó.
- Los commits de documentos se limitan a las rutas dadas (no arrastran lo que el usuario tenga en el área de preparación).

## 2. Riesgos encontrados

Ordenados por gravedad. Los marcados **(visto)** ya pasaron en `todo-app`.

| # | Riesgo | Por qué pasa | Efecto para el usuario |
| --- | --- | --- | --- |
| G1 | **La rama base depende de lo que el usuario tenga abierto.** | `integrationBranchFor` crea la rama de la feature desde `HEAD` y guarda `currentBranch()` como destino. | Si el usuario está en `feature/feat-002` (o en su rama de trabajo) cuando arranca la primera tarea de otra feature, esa feature sale de ahí y luego **se integra en esa rama**, no en `main`. Mezcla trabajo sin que nadie lo pida. |
| G2 | **`syncDocuments` fusiona todo el `HEAD` del usuario en la rama de la feature.** | Si los documentos del grafo difieren entre la rama de la feature y `HEAD`, hace `mergeInto(feature, 'HEAD')`: trae **todos** los commits de `HEAD`, no solo los documentos. | Los commits de una rama personal del usuario acaban dentro de la feature y después en `main`. |
| G3 | **Los documentos se commitean en la rama que el usuario tenga abierta.** | `GitDocumentCommitter` hace `commit` en el checkout del usuario. **(visto)**: con `todo-app` en `feature/feat-002`, un guardado habría ido a esa rama. | Commits de la app en ramas ajenas. Si hay un merge o un rebase a medias, el commit falla con un error crudo de Git o se mezcla con la operación del usuario. |
| G4 | **Features en paralelo sobre los mismos archivos.** **(visto)** | No había dependencia entre ellas. | Mitigado con F0b: regla del planificador, aviso previo y «Resolver con un agente». |
| G5 | **Ramas abiertas por el usuario bloquean a la app.** **(visto)** | Por seguridad, la app no mueve una rama abierta. | Ahora el mensaje nombra la carpeta. Pero el usuario no sabe por qué no debe abrir ramas `feature/…`, y nada se lo indica antes. |
| G6 | **El prefijo `feature/` choca con convenciones del usuario.** | git-flow y muchos equipos usan `feature/`. La app evita reutilizar un nombre existente, pero mezcla sus ramas con las del usuario. | Confusión al listar ramas. Una rama del usuario y otra de la app se distinguen solo por el sufijo `-2`. |
| G7 | **No se detectan operaciones de Git a medias.** | Nadie revisa `MERGE_HEAD`, `rebase-merge/`, `CHERRY_PICK_HEAD` ni `BISECT_LOG`. | Si el usuario está a mitad de un rebase, guardar un documento o integrar falla con un error crudo, o deja el repositorio en un estado raro. |
| G8 | **Choques con Git del usuario en el mismo momento.** | No hay un candado por repositorio. Entre procesos (terminal o IDE del usuario y la app), Git solo protege con `index.lock`. | Errores crudos («Unable to create '…/index.lock'») en lugar de «tu repositorio está ocupado, reintenta». |
| G9 | **Restos tras un cierre inesperado.** | Los worktrees de `merges/` solo se borran en `finally`. Si la app muere a mitad, quedan worktrees registrados en el repositorio del usuario. | `git worktree list` muestra carpetas de la app. Una rama puede quedar «abierta» en un worktree huérfano y bloquear la integración (como G5). |
| G10 | **HEAD separado y rama base renombrada o borrada.** | La rama base se guarda una vez, al crear la rama de la feature. | Integrar falla con «salió de la rama X, que ya no existe», sin forma de elegir otra en la interfaz. |
| G11 | **Commits a nombre de «Graph Workspace».** | Si el repositorio no tiene identidad, la app firma con `graph-workspace@localhost`. | Aceptable, pero el usuario no lo sabe. Conviene avisar al conectar el repositorio. |

## 3. Propuesta

El principio es que **la app solo escribe en ramas suyas y en una rama base elegida explícitamente; nunca depende de
lo que el usuario tenga abierto**.

1. **Rama base explícita** (G1, G10). Al conectar o crear el repositorio se fija la «rama base del proyecto»
   (por defecto la rama por omisión: `main` o `master`). Se puede cambiar en Ajustes. Toda feature sale de ella y se
   integra en ella; nunca se usa `HEAD`. Si la rama desaparece, la app lo dice y pide elegir otra. Los proyectos
   existentes toman la `sourceBranch` ya guardada y, si no hay, la rama por omisión.
2. **Documentos sin tocar el checkout** (G2, G3). Los documentos se commitean en la rama base desde un worktree
   desechable, con compare-and-swap, como `mergeIntoBase`. El checkout del usuario solo avanza con `--ff-only` si está
   en la rama base y limpio. `syncDocuments` trae a la feature **solo los documentos** de la rama base (un commit con
   esas rutas), nunca todo `HEAD`.
3. **Ramas de la app en su propio espacio de nombres** (G5, G6). Las ramas nuevas pasan a ser `graphdev/feature/…`;
   las que ya existen se conservan (no se renombran ramas del usuario). La interfaz explica que esas ramas son de la
   app y que no hay que abrirlas.
4. **Chequeo previo del repositorio** (G7, G8, G9). Antes de cada escritura, un `repositoryHealth`:
   - operación a medias (merge, rebase, cherry-pick, bisect);
   - candado `index.lock` presente;
   - worktrees huérfanos de la app (se limpian solos al abrir el proyecto);
   - rama base inexistente.

   Cada caso da un mensaje en español con la salida. Además, un candado en el proceso por repositorio serializa las
   escrituras de la app.
5. **Avisos al conectar** (G11). Si no hay identidad de Git, se avisa de que los commits irán firmados por
   «Graph Workspace» y se ofrece configurarla.
6. **Pruebas de seguridad de Git.** Una suite de integración que ejecute el flujo completo (crear feature, aceptar,
   guardar documento, integrar, resolver conflicto) con el usuario:
   - en otra rama;
   - con cambios sin commitear;
   - con un rebase a medias;
   - con `index.lock`;
   - tras matar el proceso a mitad de una fusión.

   En cada caso, ni la rama del usuario ni su carpeta cambian sin su permiso.

**Tamaño estimado:** 2–3 días. **Orden:** antes de que otra persona use la app; idealmente antes del paso 4, porque
C6 y C7 añaden más escrituras de la app en el repositorio.

## Estado del paso 3d (2026-11-12): hecho

| Riesgo | Qué se hizo |
| --- | --- |
| G1, G10 | Rama base explícita (`repositories.default_branch`). Se detecta al conectar el repositorio y al abrir el proyecto si la guardada ya no existe, y se cambia en Ajustes › Repositorio y ramas. Las features salen de ella y se integran en ella. |
| G2 | `syncDocuments` copia solo los documentos desfasados desde la rama base (`SafeGitIsolation.copyPaths`), en un commit, sin traer otros commits. |
| G3, G7, G12 | Los documentos se escriben y commitean solo con el checkout en la rama base y sin operación a medias ni `index.lock`; si no, se rechaza con la salida. Con el usuario en otra rama, el vigilante no marca los documentos como modificados. |
| G5, G6 | Las ramas nuevas son `graphdev/feature/…` (las `feature/…` existentes se conservan). Ajustes explica que esas ramas son de la app y no hay que abrirlas. El mensaje de rama abierta nombra la carpeta. |
| G8 | Candado por repositorio para las escrituras de la app (`withRepositoryLock`); errores de `index.lock` y de rama abierta en otra carpeta, traducidos. |
| G9 | Al abrir el proyecto se borran los worktrees huérfanos de `merges/` (nunca los de ejecuciones, que se conservan para revisión). |
| G11 | Ajustes avisa si el repositorio no tiene identidad de Git y explica cómo configurarla. |

**Pruebas:** `tests/integration/git-safety.test.ts` cubre:

- usuario en su propia rama;
- documentos solo en la rama base;
- `index.lock`;
- merge a medias;
- worktrees huérfanos;
- cambio de rama base.

`tests/ui/repository-git.test.tsx` cubre la sección de Ajustes.

**Corrida real con `haiku`.** El usuario trabajaba en `mi-trabajo` con un commit propio.

1. Guardar un documento se rechazó con el mensaje nuevo.
2. TASK-001 salió de `main` en `graphdev/feature/feat-001-notas`.
3. Con el usuario en `main`, el documento se guardó ahí. El usuario hizo además otro commit en `main` y volvió a su rama.
4. TASK-002 recibió `docs/PRD.md`, pero no el otro commit ni `personal.txt`.
5. La integración llegó a `main` (14 pruebas en verde). La rama del usuario y su carpeta quedaron intactas.

**Lo que cambia para el usuario:** no puede guardar documentos desde la app mientras tenga abierta otra rama. Es a
propósito, porque los documentos viven en el checkout. Si molesta en el uso real, el siguiente paso es guardarlos
desde un worktree de la rama base, con un almacén de documentos que no lea el checkout.

## 4. Fuera de alcance

- `push`, remotos y pull requests: la app sigue sin tocarlos.
- Repositorios con submódulos o Git LFS: los worktrees funcionan, pero no se han probado. Quedan anotados para C7
  (ecommerce real).

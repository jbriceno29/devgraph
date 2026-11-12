---

name: avanzar-hoja-de-ruta
description: Ejecuta un paso de docs/HOJA_DE_RUTA.md de punta a punta, etapa por etapa y sin pausas entre ellas. En cada etapa diseña, implementa y prueba, hace una corrida real con haiku, actualiza los documentos y hace commit y push. Úsala cuando el usuario diga «adelante con el paso X», «continúa la hoja de ruta» o «/avanzar-hoja-de-ruta 4b».
---

# Avanzar un paso de la hoja de ruta

El argumento es el paso (por ejemplo `4b`). Si no hay argumento, toma la primera fila pendiente de `docs/HOJA_DE_RUTA.md` y di cuál tomaste.

## 1. Preparar

1. Lee la fila del paso en `docs/HOJA_DE_RUTA.md` y su sección en el plan que enlaza (`PLAN_CAPACIDADES_DEL_AGENTE.md`, `PLAN_REPOSITORIO_EXISTENTE.md`, `AUDITORIA_*.md`…).
2. Parte el paso en etapas, en el orden del plan (por ejemplo, el paso 4 fue C1, luego C7a y luego C6). Cada etapa se cierra por separado.
3. Trabaja en el worktree `~/Documents/repos/graphdev2-roadmap`, nunca en el checkout principal. Para cada etapa, crea una rama `roadmap/<paso>-<etapa>-<tema>` desde `feat/claude-code`.

## 2. Ciclo de cada etapa

1. **Lee antes de diseñar.** Busca el código que toca y mira `scripts/architecture-baseline.json`. Si un archivo está en su tope, parte o extrae código **antes** de añadir (decoradores, archivos `*.logic.ts`, nuevos casos de uso). Nunca subas la línea base a mano.
2. **Comprueba las suposiciones externas con poco gasto** antes de construir sobre ellas. Ejemplo: probar directamente con la CLI de Claude que `WebFetch(domain:…)` niega otros dominios.
3. **Implementa con las reglas de `CLAUDE.md`:**
   - Hexagonal en el núcleo y MVVM en la interfaz.
   - Contratos nuevos en `src/shared/contracts/<tema>.ts`, que se suman en `ipc-extensions.ts`.
   - Los handlers que mutan van con `serial(...)`.
   - Textos al usuario en español.
4. **Pruebas:** unitarias, de integración y de interfaz en `tests/`. Actualiza la lista de canales serializados de `request-dispatcher.test.ts` y la de migraciones si cambian.
5. **En verde:** `npm run format`, `npm run typecheck`, `npm test` y `npm run check:arch -- --update`, este último cuando algo bajó.
6. **Corrida real con `haiku`:**
   1. Ejecuta `npm run build:core`.
   2. Escribe un script en `~/.cache/graphdev2-real-runs/scripts/<etapa>.mjs` que maneje `dist/main/sidecar.js` por stdin/stdout. Parte del más parecido que ya exista.
   3. Úsalo sobre un repositorio de prueba en `~/.cache/graphdev2-real-runs/<etapa>/`, nunca sobre datos reales del usuario.
   4. Si la corrida revela un fallo, corrígelo, añade su prueba y repite la corrida.
7. **Documentos, en el mismo commit:**
   - Un bloque «Estado (fecha): hecho» en la sección del plan, con lo hecho, la evidencia de la corrida y lo pendiente.
   - El estado de la fila en `HOJA_DE_RUTA.md`.
   - `ARQUITECTURA_ACTUAL.md` si cambian los límites de un módulo.
   - `REFERENCIA_IPC.md` si hay canales nuevos.
8. **Commit y push:**
   1. Commit en inglés con prefijo convencional y el cuerpo con el porqué, terminado en `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
   2. Desde `~/Documents/repos/graphdev2`, ejecuta `git merge --ff-only roadmap/<rama>`.
   3. Luego `git push origin feat/claude-code`.
9. **Avisa en una línea** («C1 hecho y subido (`hash`). Sigo con C7a.») y pasa a la siguiente etapa **sin preguntar**.

## 3. Cuándo parar y preguntar

Para y pregunta, en frases completas, solo en estos casos:

- Hace falta una dependencia nueva (librería).
- Hay que tocar datos reales del usuario, o un repositorio que no es de prueba.
- Habría que borrar ramas, cambiar remotos o borrar archivos que no sean carpetas vacías.
- Una decisión de diseño cambia la experiencia más allá de lo que dice el plan, o el plan se contradice con el código.
- La corrida real falla por algo fuera del alcance del paso.

Una decisión con un valor razonable por defecto no es motivo para parar. Tómala y explícala en el informe.

## 4. Al terminar el paso

Escribe un informe corto en español con:

- **Por etapa:** el commit, lo que hace y la evidencia de la corrida real.
- **Lo que hay que saber:** las concesiones (por ejemplo, un estado que vive solo en memoria) y lo que queda pendiente o se movió a otro paso.
- **Recordatorio:** reiniciar `npm run desktop` para que tome el núcleo nuevo.

No empieces el siguiente paso de la hoja de ruta sin el visto bueno del usuario.

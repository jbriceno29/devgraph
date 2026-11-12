# Capacidades del agente: qué necesita para desarrollar una app real

Fecha: 2026-11-12. Origen: la migración del ecommerce a Next.js + Postgres mostró que la herramienta
aísla bien al agente, pero no le da lo que un desarrollador usa a diario. El objetivo de este plan es que
el agente no tenga que «batallar»: todo lo que necesite para construir y verificar una app debe estar
disponible, y la app debe dárselo de forma controlada. No basta con prohibir.

## 1. Qué tiene hoy el agente

Datos tomados del código: `claude-code-adapter.ts`, `child-environment.ts`, `execution-validator.ts`,
`npm-environment.ts` y `project-commands.ts`.

| Necesidad | Hoy | Consecuencia |
| --- | --- | --- |
| Leer y escribir código | `Read`, `Write`, `Edit`, `Glob`, `Grep`, limitados a las rutas de la política | Bien. |
| Shell | Solo los comandos de la lista, sin tuberías ni `&&`; con el entorno instalado, también `npm run <script>` | Bien para pruebas; intenta `mkdir`/`cat >` y le niegan la acción (ya corregido en el prompt). |
| Dependencias | Las instala la app (`--ignore-scripts`); un paquete nuevo pide tu aprobación | Bien. |
| Base de datos y servicios (Postgres, Redis, correo) | **No hay.** El agente no puede arrancar Docker y las comprobaciones no tienen servicios | Solo se pueden probar apps sin servicios, o con bases embebidas. |
| Variables y secretos (`DATABASE_URL`, claves de prueba de Stripe, Supabase) | **No hay.** Entorno limpio (`HOME`, `PATH`, `LANG`…), y `.env*` está prohibido | Nada que dependa de configuración puede correr ni verificarse. |
| Documentación actual (Next 15/16, Tailwind 4, Drizzle, Supabase) | **No hay.** Sin `WebFetch` ni `WebSearch`; sin MCP (`--strict-mcp-config`) | El modelo escribe APIs de memoria: es la causa principal de errores con frameworks que cambian rápido. |
| Ver la interfaz (servidor de desarrollo, navegador, capturas) | **No hay.** `dev` se corta por tiempo y no hay navegador | Las tareas de UI se aceptan sin que nadie las haya visto funcionar. |
| Verificación | Comandos del perfil, 120 s cada uno | `next build` y las pruebas e2e pueden pasar de 120 s. |
| Conectores (Supabase, Stripe, GitHub) | **No hay** | Sin acceso a los servicios reales del proyecto, ni siquiera en modo de prueba. |

Lo que uso yo (Claude Code) cuando desarrollo y al agente le falta, por orden de impacto:

1. Leer la documentación actual de lo que uso.
2. Tener una base de datos y servicios reales donde probar.
3. Tener la configuración: variables y claves de prueba.
4. Levantar la app y verla en un navegador.
5. Hablar con los servicios del proyecto: Supabase, Stripe en modo de prueba.

## 2. Principio de diseño

**El agente no recibe poder, recibe servicios.** La app es quien:

- arranca y apaga los contenedores,
- guarda los secretos,
- decide a qué dominios se puede consultar,
- y entrega al agente solo lo que necesita para su tarea.

Cada capacidad se activa por proyecto, se ve en Ajustes y queda en el registro de la ejecución. Hay tres
reglas fijas:

- **Nunca producción.** El agente trabaja con bases efímeras o de desarrollo. Las credenciales de
  producción, si existen, solo las usan tus comandos.
- **Los secretos no viajan en el prompt.** Llegan como variables de entorno al proceso, y la app los
  oculta en los registros, en el diff y en la salida que ves.
- **Todo lo que la app arranca, la app lo apaga.** Esto aplica al terminar, al cancelar y al cerrar la app.

## 3. Etapas

### C1. Documentación en línea (lectura)
- Activar `WebFetch` con una lista de dominios permitidos por perfil de stack, mediante reglas
  `WebFetch(domain:…)`. Ejemplos: nextjs.org, react.dev, tailwindcss.com, orm.drizzle.team, supabase.com,
  docs.stripe.com, developer.mozilla.org y npmjs.com.
- Tú puedes añadir dominios por proyecto. `WebSearch` es opcional, porque no se puede limitar por dominio.
- Prompt: «Antes de usar una API de un framework, comprueba su documentación actual».
- Riesgo: bajo, porque solo es lectura. Una página podría traer instrucciones maliciosas. La política sigue
  mandando, y el prompt ya trata las fuentes como datos.

**Estado (2026-11-12): hecho.**

- Encendida por defecto en cada proyecto. Ajustes › Documentación en línea permite apagarla y añadir dominios.
- **Dominios:**
  - una base: `developer.mozilla.org` y `www.npmjs.com`;
  - los que la app deduce del stack: React, Next.js, Vite, Vitest, Node, Tailwind, Drizzle, Supabase, Stripe, Python…;
  - los del usuario.
- La CLI recibe una regla `WebFetch(domain:…)` por dominio. Con `dontAsk` niega cualquier otro (comprobado con la CLI 2.1.318), y sin dominios no se ofrece `WebFetch`.
- `WebSearch` sigue apagado.
- **Corrida real con `haiku`:** una tarea con `util.styleText` leyó `https://nodejs.org/api/util.html` antes de escribir el código. La URL quedó en el registro, la validación pasó y las 3 pruebas pasan.

### C2. Variables y secretos del proyecto
- Un almacén por proyecto: el llavero del sistema si está disponible y, si no, un archivo cifrado en el
  workspace. Nunca va en el repositorio.
- Cada variable tiene un alcance:
  - **Mis comandos:** la pestaña Comandos, `npm run dev` y las migraciones.
  - **Agentes y verificación:** solo claves de prueba o de desarrollo.
- La app los inyecta como entorno del proceso y los oculta en eventos, `test-output.log` y la salida de
  Comandos.
- El validador falla si algún valor aparece escrito en el diff.
- La app genera `.env.example` con los nombres, nunca con los valores.
- **Pendiente de R1 (plan REP):** al leer un repositorio existente, R1 debe detectar las variables que el código
  espera (`.env.example`, `process.env.*`) y pedirlas aquí. Sin ellas, `build` y las pruebas que tocan servicios
  fallan en el worktree aunque el código esté bien.

### C3. Servicios del proyecto (Docker gestionado por la app)
- El proyecto declara sus servicios: Postgres, Redis, Mailpit, MinIO o Supabase local. Pueden venir del
  perfil de stack o de un `compose` del repo que tú apruebas.
- Por cada ejecución y cada comando, la app arranca los servicios con un nombre de proyecto único, puertos
  libres y datos efímeros. Inyecta `DATABASE_URL`, `REDIS_URL`… y los apaga al terminar.
- El agente nunca ejecuta `docker`. Solo recibe los servicios ya listos.
- Si Docker no está instalado:
  - Ajustes lo indica.
  - Los perfiles que lo admiten usan la alternativa embebida: PGlite para Postgres y SQLite.
  - Si el proyecto no tiene alternativa, la ejecución no arranca y explica qué falta.
- Las migraciones corren con el script del proyecto (`npm run db:migrate`) contra la base efímera, antes
  de las comprobaciones.

### C4. Conectores de servicios externos (Supabase, Stripe y otros)
- **Supabase**, en dos modos:
  - **Local:** Supabase CLI como servicio de C3. Es lo recomendado para que los agentes trabajen.
  - **Nube:** la URL y la clave de un proyecto o rama de *desarrollo* se guardan como secretos de C2. El
    agente solo los recibe si los marcas con ese alcance. La base de producción nunca.
- **Stripe:** claves `sk_test_…`, con alcance de agentes. La app rechaza claves `sk_live_…` para ese alcance.
- **MCP por proyecto (opcional, más adelante):** el MCP de Supabase en modo de solo lectura y el de
  GitHub. Tienen tokens con alcance mínimo, se activan uno a uno y siempre en un entorno de desarrollo.

### C5. Ver la app funcionando
- La app gestiona el servidor de desarrollo dentro de la ejecución:
  - lo arranca con el script `dev` y los servicios de C3,
  - espera a que esté disponible la URL,
  - corre las pruebas e2e,
  - y lo apaga.
- Playwright con su navegador lo instala la app, como las dependencias.
- El agente puede correr `npm run test:e2e` y pedir capturas (`npm run screenshot -- /ruta`). Las capturas
  quedan como evidencia en Revisión.
- Las tareas de interfaz incluyen una comprobación e2e mínima en sus criterios.

### C6. Verificación a la medida del stack
- Comandos por perfil: tipos (`tsc --noEmit`), lint, pruebas unitarias, `build` y e2e. Cada uno tiene su
  propio límite de tiempo (`next build` necesita más de 120 s).
- El resumen de Revisión muestra cada comprobación por separado.
- **Pendiente de R1 (plan REP):** hoy R1 propone `npm run build` entre las comprobaciones de cada tarea cuando el
  proyecto lo tiene. Aquí se separan las comprobaciones por tarea (pruebas, tipos y lint) de las que corren al
  integrar una feature (`build`). R1 propone `build` solo para la integración, salvo que sea la única comprobación del
  proyecto. Con C2 en marcha, `build` recibe las variables de alcance «Agentes y verificación».

**Estado (2026-11-12): hecho.**

- **Límites de tiempo:** cada comprobación tiene el suyo: 10 minutos para `build`, e2e y Playwright, y 2 para el resto. Si se agota, se dice «Tiempo agotado» y no «Falló».
- **Revisión** muestra cada comprobación con su resultado y su duración; el log completo queda plegado.
- **Comprobaciones al integrar:**
  - `web-nextjs` usa `next build`, `web-spa-react` usa `vite build`, y un repositorio sin perfil usa su script `build`. R1 ya no lo propone en cada tarea, salvo que sea la única comprobación.
  - «Comprobar antes de integrar» las ejecuta en segundo plano sobre una copia de la rama base con la feature fusionada, y no mueve ninguna rama.
  - «Integrar» espera a que hayan pasado con las ramas actuales. Si la feature o la base cambian, pide volver a comprobar.
- **Corrida real con `haiku`**, sobre la base Next.js de C7a:
  1. Integrar sin comprobar se rechazó.
  2. «Comprobar» respondió al momento, y `next build` pasó en 9 s (instalación incluida).
  3. La feature se integró en `main` sin dejar worktrees.
  4. `next build` sobre `main`, a mano, compila y prerenderiza `/`.
- **Pendiente:** con C2, `build` recibirá las variables con alcance «Agentes y verificación».

### C7. Perfil «Web Next.js» y migración del ecommerce
- Perfil de catálogo:
  - Next.js (App Router), TypeScript y Tailwind CSS 4.
  - Drizzle con Postgres: PGlite en las pruebas y el Postgres de C3 o Supabase en desarrollo.
  - Vitest y Playwright.
  - Rutas de escritura propias de Next, reglas de nivel 1, verificación de C6 y dominios de C1.
- El planificador podrá proponer el cambio de perfil, reglas y verificación de un proyecto ya iniciado
  (`SET_PROJECT_PROFILE`), siempre como propuesta que tú apruebas.
- Ecommerce:
  - una propuesta que archiva las 14 tareas de Node,
  - crea las de Next.js,
  - marca que ADR-003 reemplaza a ADR-001,
  - y adapta `docs/UI_SPEC.md`: los tokens pasan a `@theme` de Tailwind.

**Estado de C7a (2026-11-12): hecho.** La migración del ecommerce (C7b) se descartó porque era un proyecto de prueba. El cambio de un proyecto Node a Next.js ya quedó probado en las corridas reales de C7a y C6.

- **Perfil `web-nextjs` en el catálogo:**
  - Next.js (App Router), React, Tailwind CSS 4, Drizzle con `postgres`, PGlite en las pruebas, Zod y Vitest con Testing Library.
  - Verificación por tarea: `tsc --noEmit` y `vitest run`. `next build` llega con C6.
  - Puede escribir sus archivos de configuración, `public/**` y las salidas `.next/**` y `*.tsbuildinfo`.
  - Playwright queda para C5, porque necesita su navegador.
- **Cambio de perfil en un proyecto ya iniciado:**
  - El planificador conoce el catálogo, y su esquema de salida ya admite `SET_PROJECT_PROFILE`. Antes solo lo admitía el asistente de inicio, y por eso la primera corrida real propuso un ADR en su lugar.
  - Antes de que veas la propuesta, la app la completa con el perfil (`withCatalogProfile`): stack, reglas y verificación del catálogo, y quita las reglas que traía el perfil anterior.
  - El planificador muestra el stack y las comprobaciones junto a «Definir el perfil del proyecto».
  - Siempre pide aprobación (`PROJECT_FOUNDATION`).
- **Corrida real con `haiku`:**
  1. Un proyecto Node pidió «migrar a Next.js con Postgres» y el planificador propuso `web-nextjs`.
  2. Al aplicarlo cambiaron los comandos, las rutas y los dominios de documentación.
  3. La app instaló 128 paquetes reales.
  4. `haiku` montó la base con una migración SQL, una prueba con PGlite y una prueba de componente. `tsc` y `vitest` pasaron, y la ejecución se aceptó.
  5. Un primer intento falló porque `.next` y `tsconfig.tsbuildinfo` no estaban permitidos; ya lo están, y van al `.gitignore`.

## 4. Orden propuesto

| Paso | Por qué en este orden |
| --- | --- |
| C1 Documentación | El mayor beneficio con el menor riesgo; ayuda desde la primera tarea de Next. |
| C7a Perfil Next (con PGlite) y cambio de perfil por el planificador | Desbloquea tu migración sin depender de Docker. |
| C6 Verificación por perfil | Hace falta para aceptar con confianza tareas de Next (`tsc`, `build`). |
| C2 Secretos | Requisito de C3, C4 y de tu `npm run dev` con Supabase. |
| C3 Servicios Docker | Postgres real en las ejecuciones; la base para Supabase local. |
| C5 Ver la app | Necesita C3 (servicios) y C6 (tiempos). |
| C4 Conectores | Necesita C2. Se hace al final porque es la parte con más riesgo. |

Cada etapa se cierra igual que las anteriores: pruebas completas, una corrida real con `haiku`, commit y
push, y una nota en este documento.

## 5. Qué necesito de tu máquina

- **Docker:** Docker Engine o Desktop instalado, con tu usuario en el grupo `docker`. Solo para C3.
- **Supabase:** el CLI de Supabase para el modo local; para la nube, un proyecto de desarrollo.
- **Stripe:** claves de prueba.
- Nada de esto hace falta para C1, C7a y C6.

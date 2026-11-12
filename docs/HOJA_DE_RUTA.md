# Hoja de ruta

Orden único de los planes vigentes. Aquí solo se ordena y se marca el estado; el detalle de cada paso
está en su plan.

Si el orden cambia, se cambia aquí. Cada paso se cierra con las pruebas completas, una corrida real
con `haiku`, commit y push, y una nota en su plan.

**Planes:**

| Plan | Contenido |
| --- | --- |
| **UX** | [AUDITORIA_UX.md](AUDITORIA_UX.md): errores de la interfaz y reorganización de pantallas. |
| **ARQ** | [PROPUESTA_ARQUITECTURA.md](PROPUESTA_ARQUITECTURA.md): monolito modular y MVVM en la interfaz. |
| **CAP** | [PLAN_CAPACIDADES_DEL_AGENTE.md](PLAN_CAPACIDADES_DEL_AGENTE.md): lo que el agente necesita para desarrollar apps reales. |
| **REP** | [PLAN_REPOSITORIO_EXISTENTE.md](PLAN_REPOSITORIO_EXISTENTE.md): incorporar un repositorio con historia (rutas, línea base, mapa de lo existente y grafo al día). |

Ya cerrados: [PLAN_STACKS_REGLAS_Y_SKILLS.md](PLAN_STACKS_REGLAS_Y_SKILLS.md) (S1–S6) y
[PLAN_EXPLORACION_VISUAL_Y_OBJETIVO.md](PLAN_EXPLORACION_VISUAL_Y_OBJETIVO.md) (V1–V4).

## Orden

| # | Paso | Plan | Tamaño | Estado | Por qué en este lugar |
| --- | --- | --- | --- | --- | --- |
| 1 | **F0** · errores de la interfaz (B1, B2, B4, B5, B6, C1 y C6 de la auditoría) | UX | ~1 día | Con errores encontrados (validación manual, ver [VALIDACION_F0.md](VALIDACION_F0.md#resultados-de-la-validación)) | Hoy dan información falsa o pierden trabajo, y no dependen de nada. |
| 2 | **A0** · guardarraíles: `CLAUDE.md`, `check:arch` con línea base y entrada estable del sidecar | ARQ | ½ día | Hecho | Es barato y hace que todo lo nuevo nazca en su sitio. |
| 2b | **R1** · rutas escribibles y comandos derivados del repositorio | REP | ½ día | Hecho | Hoy un proyecto con código fuera de `src/` ve revertido el trabajo del agente sin causa visible, y «Ya tengo el código» hace fácil llegar ahí. Es puro y pequeño: A2 lo mueve sin costo. |
| 3 | **A1 + A2** · composición, IPC por módulo y traslado a `modules/` | ARQ | ~2 días | Hecho | Son pasos mecánicos. Así las capacidades se escriben ya en su módulo y no se mueven dos veces. |
| 4 | **C1 → C7a → C6** · documentación en línea, perfil Next.js con cambio de stack y verificación por stack | CAP | ~2–3 días | Pendiente | Desbloquean la migración del ecommerce a Next.js. |
| 4b | **R2** · línea base de verificación | REP | ~1 día | Pendiente | Reutiliza la ejecución por comando de C6. Evita el piloto que nunca puede aceptar porque las pruebas ya fallaban. |
| 5 | **A3** · partir los gigantes del núcleo (orquestador, repositorio de ejecuciones, piloto, inicio) | ARQ | 2–3 días | Pendiente | Va antes de C2 y C3, que añaden lógica a la ejecución. |
| 5b | **R3 + R4** · mapa de lo existente en el grafo y preguntas del siguiente hito | REP | ~3 días | Pendiente | Añaden lógica al inicio y al contexto: van con el núcleo ya partido. Pueden ir antes que el 6 si el proyecto real que se va a llevar es un repositorio existente. |
| 6 | **C2 → C3** · secretos del proyecto y servicios Docker gestionados por la app | CAP | ~3 días | Pendiente | Dan Postgres real y preparan Supabase. |
| 7 | **A4** · interfaz MVVM | ARQ | 2–3 días | Pendiente | Es requisito de la reorganización de pantallas. |
| 8 | **F1 → F3** · reorganización: Proyecto, Plan, Ejecuciones, Configuración y acabado | UX | ~8–10 días | Pendiente | Con ViewModels, mover pantallas es mover Views. |
| 8b | **R5** · trabajo hecho fuera de la app y «Poner al día el proyecto» | REP | 1–2 días | Pendiente | Necesita la Bandeja con acciones en línea y la vista «Proyecto» (F1). |
| 9 | **C5 → C4** · ver la app funcionando y conectores (Supabase, Stripe) | CAP | — | Pendiente | Necesitan C2, C3 y la vista de Configuración. |
| 10 | **A5** · documentación de arquitectura al día y línea base vacía | ARQ | ½ día | Pendiente | Cierra la migración. |

**Alternativa:** el paso 4 puede ir antes que el 2 y el 3 si urge Next.js. Se gana unos 2–3 días y el
costo es mover después el código nuevo.

## Hecho fuera de los planes

- B3 de la auditoría UX: las decisiones aprobadas no llegaban a los agentes. Cerrado en `a369749`, con
  los botones para aceptar, rechazar, reemplazar y reabrir ADR. En `7c52177` se añadió la confirmación al
  salir de «aceptada».
- Carpeta de proyectos y selector de carpetas del sistema (`399d0b8`): al abrir la app por primera vez,
  «¿En qué carpeta guardas tus proyectos?»; cada proyecto nuevo es una carpeta con `git init`, o se conecta
  uno existente. Es lo que motivó el plan REP.

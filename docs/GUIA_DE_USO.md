# Guía de uso

Para quien usa Graph Workspace, no para quien lo desarrolla. Cómo instalarlo está en el [README](../README.md); cómo funciona por dentro, en [ARQUITECTURA_ACTUAL.md](ARQUITECTURA_ACTUAL.md).

## La idea en una frase

Tú dices qué quieres construir y apruebas el plan; la aplicación se encarga de ir tarea por tarea con un agente (hoy, Claude Code), comprobar el resultado y guardar lo aprendido para la tarea siguiente. Solo te llama cuando hace falta una decisión tuya.

## Conceptos

| Concepto | Qué es, en llano |
| :--- | :--- |
| **Proyecto** | Tu trabajo completo. Tiene un repositorio Git, un grafo con su plan y sus reglas. |
| **Grafo** | El mapa del proyecto: módulos, features, requisitos, tareas, decisiones, documentos y código, y cómo se relacionan. Lo mantiene la aplicación; tú no tienes que actualizarlo. |
| **Feature** | Una capacidad del producto (por ejemplo «Gestión de tareas»). Agrupa tareas y tiene su propia rama de Git. La primera suele ser «Fundación». |
| **Tarea** | Un trabajo pequeño y verificable que un agente puede cerrar, con criterios de aceptación. Estados: `DRAFT`, `BLOCKED` (espera a otra tarea), `READY` (lista), `IN_PROGRESS`, `IN_REVIEW` (esperando tu revisión) y `DONE`. |
| **Ejecución** | Un intento de un agente de hacer una tarea. Corre aislado y termina en «completada» o «fallida». |
| **Contexto** | Lo que se le entrega al agente al empezar: reglas del proyecto, especificaciones, decisiones y lo que dejaron las tareas anteriores. El agente no depende de ninguna conversación previa. |
| **Propuesta** | Un cambio al plan sugerido por el motor o por un agente (tareas nuevas, decisiones, cambios de alcance). Se valida y tú la apruebas, salvo que tu política permita aplicarla sola. |
| **Piloto automático** | Un modo de la feature en el que la aplicación elige la siguiente tarea, la ejecuta, la acepta si pasa las comprobaciones y sigue. Niveles de autonomía: `MANUAL` (tú haces todo; es el valor por defecto), `AUTO_ACCEPT` (acepta sola lo que pasa las comprobaciones) y `PILOT` (además lanza la siguiente tarea). |
| **Política de decisiones** | Tus reglas sobre qué puede cambiar un agente sin preguntarte. Hay cinco categorías configurables (agregar tareas a la feature, agregar dependencias, cambiar el estado de tareas, registrar decisiones de arquitectura y cambiar el alcance) y un tope de tareas automáticas por feature (5 por defecto). Cambiar los cimientos del proyecto (objetivo, alcance, stack, reglas, comandos de verificación) **siempre** te pregunta. |
| **Política de ejecución** | Qué carpetas puede escribir un agente, cuáles solo leer, cuáles tiene prohibidas y qué comandos de verificación (pruebas) se ejecutan al final. Sin comandos de verificación, nada se acepta automáticamente. |

## Recorrido completo

1. **Crea el proyecto** con un nombre.
2. **Abre la vista «Inicio».** Describe en pocas líneas qué quieres construir (hasta 4000 caracteres). El asistente te hará como mucho 5 preguntas con opciones sugeridas; puedes contestar o dejar «decide tú». Las suposiciones del asistente se muestran.
3. **Conecta una carpeta Git** o crea una nueva desde la propia vista (la ruta debe ser absoluta, y la carpeta no existir o estar vacía). La aprobación necesita un repositorio.
4. **Revisa la propuesta.** Verás: objetivo, alcance, stack, reglas, comandos de verificación, un ADR con las alternativas consideradas, documentos, requisitos y el plan inicial (una feature «Fundación» con una primera tarea de preparación y el resto de features). ¿Algo no te gusta? Escribe una nota con lo que quieres cambiar y regenera; las notas se acumulan. Si todo está bien, aprueba. Hasta entonces no se crea nada en tu proyecto. Puedes reiniciar el asistente si aún no aprobaste.
5. **Ejecuta.** En la vista «Agentes», elige una tarea `READY` y pulsa iniciar (puedes elegir el modelo). O abre una feature, sube su autonomía a `PILOT` y actívalo: la aplicación te mostrará un aviso de costo que debes aceptar.
6. **Revisa y acepta.** Una ejecución completada deja la tarea en `IN_REVIEW`. Ves el diff por archivo, la salida de las pruebas y las acciones que se denegaron. Aceptas o pides ajustes con un motivo. Con `AUTO_ACCEPT` o `PILOT`, esto ocurre solo si la ejecución terminó bien y al menos un comando de verificación pasó.
7. **Atiende la bandeja de actividad** (vista «Actividad» o el banner de «siguiente paso»): muestra qué necesita tu decisión, qué está en curso y qué pasó. Si la ventana no tiene foco, la aplicación intenta avisarte con una notificación del sistema (puede no mostrarse según tu entorno).
8. **Integra la feature.** Cuando todas sus tareas están en `DONE`, aparece «Integrar en main» (en la rama base de tu repositorio). Ahí tu código llega a la rama principal.

## Dónde queda el código

- Cada ejecución trabaja en un **worktree temporal** (una copia aislada del repositorio en otra carpeta, dentro de los datos de la aplicación) y en una rama `graphdev/…`. Tu carpeta de trabajo no se toca mientras el agente trabaja.
- Al aceptar, el resultado se integra (un único commit por tarea, `TASK-n: título`) en la rama de la feature, `feature/<clave>-<título>` (por ejemplo `feature/feat-001-crear-y-consultar-tareas`). El worktree y la rama temporal se borran.
- **Tu rama principal no se modifica hasta que pulsas «Integrar en main».** Descartar el trabajo de una feature es borrar su rama.
- Una feature que depende de otra empieza con el trabajo de las ramas de las que depende; no puede empezar mientras esas features tengan tareas abiertas.
- Los documentos que la aplicación escribe (ChangeSets, documentos creados o guardados desde ella) se commitean solos en tu repositorio. Si editas un documento fuera de la aplicación y no lo commiteas, la ejecución se bloquea con un mensaje claro.

## Qué pasa cuando el piloto se detiene

El piloto nunca se queda mudo: pasa a uno de estos estados y lo registra con su motivo.

- **Pausado:** se acercó al límite de uso de tu suscripción (umbral del 85 % por defecto). Se reanuda solo cuando se renueva la ventana, o tú lo reanudas.
- **Esperando al usuario:** necesita una decisión tuya. Casos: una tarea falló tras todos los intentos permitidos (3 por defecto; el último puede usar un modelo más capaz si lo configuraste), la ejecución terminó pero no se acepta sola (por ejemplo, sin comandos de verificación o con una violación de la política), un conflicto de merge, una acción que la política no permite («Permitir y reintentar»), o una propuesta del agente que tu política manda revisar (queda pendiente en «Planificar» con la razón).
- **Detenido:** lo detuviste tú, o bajaste la feature de nivel `PILOT`.
- **Completado:** no quedan tareas por hacer en la feature.

Solo corre un piloto a la vez por proyecto. Si una ejecución supera el tiempo máximo (30 minutos por defecto, configurable en la política), se detiene y la tarea vuelve a estar lista.

## Costos y modelos

- **Autenticación.** La primera opción es tu suscripción de Claude Code (con pausas por límite de uso). La segunda es una clave de API: define `ANTHROPIC_API_KEY` antes de abrir la aplicación y elígela en el formulario del motor; es la recomendada para uso intensivo del piloto, que encadena muchas ejecuciones.
- **Modelos.** Para planificar y para el asistente de inicio, la aplicación usa `opus` por defecto; para ejecutar, `sonnet`. Están disponibles `haiku`, `sonnet` y `opus`. Puedes elegir otro por tarea o por feature, y un modelo de escalamiento para el último reintento. Las pruebas de medición del proyecto se hicieron con `haiku`.
- **Orden de magnitud medido.** Con `haiku`, el workspace igualó la calidad del mejor chat con un costo ponderado de aproximadamente 1,5 veces el de un chat largo (~603 k frente a 414 k en la tercera medición), sin intervención humana; con «Agrupar tareas pequeñas» activo, alrededor de un 19 % menos con la misma calidad (octava medición); ver `docs/benchmarks/`. Una propuesta de inicio costó ~0,035 USD en una prueba real. Estas cifras son orientativas: agrupar tareas pequeñas bajó el costo en una corrida, pero esa medición se está repitiendo y no es una garantía.
- El piloto avisa del costo antes de activarse y muestra el uso actual.
- **Agrupar tareas pequeñas.** En la autonomía de una feature, con nivel «Piloto», puedes activar «Agrupar tareas pequeñas»: el piloto junta 2 o 3 tareas listas de la feature en una sola ejecución (como máximo las que indiques, hasta 5), y el aviso de costo te dice en cuántas ejecuciones cerraría lo que queda. La tarea que fija una convención y la primera tarea del proyecto siempre van solas. Un grupo se acepta con un solo commit que nombra todas sus tareas, cada tarea conserva su propio resumen de cierre, y si el grupo falla se reintenta entero. Medido con el piloto en `todo-v2` (octava medición): entre un 17 % y un 20 % menos de costo con la misma calidad y la convención intacta usando grupos de 3; con grupos de 4 ahorró más pero perdió la convención, así que no subas de 3 sin medirlo en tu proyecto. Viene activo en las features nuevas (las que configuraste antes de existir la opción lo tienen apagado); si en tu proyecto notas que la calidad baja, apágalo en esa feature.

## Solución de problemas

| Síntoma | Qué hacer |
| :--- | :--- |
| Cambié código del núcleo y no se nota | El núcleo (Node) no se recarga en vivo: cierra y vuelve a ejecutar `npm run desktop`. |
| «El núcleo no respondió a … en N s» | La petición tardó más que el tiempo permitido (60 s, 330 s para proponer cambios). Revisa el registro `logs/sidecar.log` en la carpeta de datos de la aplicación; si el núcleo murió, la siguiente petición lo reinicia. |
| El agente falla al empezar o dice que no hay sesión | Abre una terminal, ejecuta `claude` y inicia sesión; vuelve a intentar. Si el CLI está en una ruta poco habitual, define `GRAPHDEV_CLAUDE_PATH` antes de abrir la aplicación. |
| «Integrar en main» se rechaza por cambios sin commitear | Tu repositorio tiene la rama base abierta con cambios sin guardar. Commitéalos o guárdalos (`git stash`) y vuelve a integrar. Si la rama base está abierta en otro worktree, cambia de rama allí. |
| «Integrar en main» da conflicto | La rama de la feature choca con cambios nuevos en la rama base. Resuélvelo en Git y vuelve a intentarlo. |
| La ejecución se bloquea por un documento | Hay un documento del proyecto con cambios sin commitear hechos fuera de la aplicación; commitéalo. |
| El piloto no acepta una tarea | Comprueba que la política tenga comandos de verificación; sin ellos nada se acepta solo. |
| La aprobación del inicio no avanza | Falta el repositorio: conecta uno o crea uno nuevo. |
| «El inicio del proyecto ya empezó» | Continúa donde lo dejaste, o reinícialo con el botón de reinicio (solo antes de aprobar). El asistente es solo para proyectos sin plan. |
| No llegan avisos del sistema | Las notificaciones de escritorio dependen de la API web del webview y del permiso; la bandeja de actividad dentro de la aplicación es la vía fiable. |

## Lo que todavía no hace

- Trabajar con Codex (el código existe pero está desconectado; solo funciona Claude Code).
- Analizar un repositorio existente para proponer el plan (el asistente de inicio es para proyectos vacíos).
- Mostrar el camino crítico de una feature en el grafo.

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

1. **La primera vez, elige tu carpeta de proyectos.** La app pregunta «¿En qué carpeta guardas tus proyectos?» y propone la que ya tiene tus repositorios (por ejemplo `~/Documents/repos`). Puedes elegir otra con «Elegir…» o escribir la ruta. Cada proyecto será una carpeta nueva dentro de ella. Se cambia después con «Cambiar», debajo del formulario; los proyectos ya creados no se mueven.
2. **Crea el proyecto** con un nombre. Con **«Proyecto nuevo»** la app crea `<tu carpeta>/<identificador>` (por ejemplo `~/Documents/repos/mi-tienda`) con `git init` y un primer commit, y te dice antes de crear si ese nombre ya está ocupado. Con **«Ya tengo el código»** eliges la carpeta de un repositorio que ya existe (debe tener `.git`) y el proyecto toma su nombre; el asistente partirá de lo que existe.
3. **Abre la vista «Inicio».** El proyecto ya tiene su repositorio; si lo creaste con «Ya tengo el código», el asistente partirá de lo que existe (ver «Proyecto con código existente» más abajo). Describe en pocas líneas qué quieres construir (hasta 4000 caracteres). El asistente te hará como mucho 5 preguntas con opciones sugeridas; puedes contestar o dejar «decide tú». Las suposiciones del asistente se muestran. Si tienes capturas, bocetos, un prototipo HTML, un PDF o un documento, adjúntalos en «Referencias (opcional)» y di para qué sirve cada uno: **cómo debe verse**, **qué debe hacer** o **solo inspiración** (ver «Referencias» más abajo).
4. **Revisa la propuesta.** Verás: objetivo, alcance, stack, reglas, comandos de verificación, un ADR con las alternativas consideradas, documentos, requisitos y el plan inicial (una feature «Fundación» con una primera tarea de preparación y el resto de features). ¿Algo no te gusta? Escribe una nota con lo que quieres cambiar y regenera; las notas se acumulan. Si todo está bien, aprueba. Hasta entonces no se crea nada en tu proyecto. Puedes reiniciar el asistente si aún no aprobaste.
5. **Ejecuta.** En la vista «Agentes», elige una tarea `READY` y pulsa iniciar (puedes elegir el modelo). O abre una feature, sube su autonomía a `PILOT` y actívalo: la aplicación te mostrará un aviso de costo que debes aceptar.
6. **Revisa y acepta.** Una ejecución completada deja la tarea en `IN_REVIEW`. Ves el diff por archivo, la salida de las pruebas y las acciones que se denegaron. Aceptas o pides ajustes con un motivo. Con `AUTO_ACCEPT` o `PILOT`, esto ocurre solo si la ejecución terminó bien y al menos un comando de verificación pasó.
7. **Atiende la bandeja de actividad** (vista «Actividad» o el banner de «siguiente paso»): muestra qué necesita tu decisión, qué está en curso y qué pasó. Si la ventana no tiene foco, la aplicación intenta avisarte con una notificación del sistema (puede no mostrarse según tu entorno).
8. **Integra la feature.** Cuando todas sus tareas están en `DONE`, aparece «Integrar en main» (en la rama base de tu repositorio). Ahí tu código llega a la rama principal.

## Referencias

En el paso de la idea puedes adjuntar hasta 5 archivos (png, jpg, webp, gif, pdf, md, txt o html; 3 MB cada uno). El asistente no ve tus archivos: un modelo aparte los describe en texto y el asistente trabaja con esa descripción. Por eso cada archivo necesita su propósito:

| Propósito | Qué hace el asistente con él |
| :--- | :--- |
| **Cómo debe verse** | Toma colores, estilo y orden de la pantalla. Las funciones que aparezcan en la imagen **no** se toman como requisitos. |
| **Qué debe hacer** | Extrae pantallas, acciones y recorridos como posibles requisitos y te pregunta lo que no queda claro. |
| **Solo inspiración** | Toma la idea general; no copia la interfaz ni todas sus funciones. |

La nota («qué conservar o evitar») ayuda a afinarlo. Después de analizarlas, la pantalla de preguntas muestra «Cómo se entendieron tus referencias» para que compruebes lo que entendió el modelo; si algo no es así, corrígelo en tus respuestas o en las notas de la propuesta. El análisis cuesta unos centavos y tarda unos segundos. El contenido de los archivos se trata como datos: las instrucciones que contengan se ignoran. Los PDF necesitan `pdftoppm` (paquete `poppler-utils`) instalado; sin él, ese archivo no se podrá analizar y el asistente te lo dirá. Solo funciona con Claude Code.

## Proyecto con código existente

Si conectas un repositorio que ya tiene código **antes** de pulsar «Empezar», el asistente lo lee primero y parte de lo que existe en lugar de proponer un proyecto desde cero. Con «Ver qué se leerá» puedes ver la lista antes de empezar.

- **Qué lee:** los manifiestos (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `tsconfig.json`, configuraciones de Vite/Next…), el README, la estructura de carpetas, el número de archivos por lenguaje y los estilos (`tailwind.config.*`, archivos de tokens o de tema, hojas de estilo globales; de una hoja grande, solo sus variables y tokens). No lee tu código fuente.
- **Qué no lee nunca:** lo que excluye tu `.gitignore` (también lo que está versionado pero ignorado), carpetas generadas (`node_modules`, `dist`, `build`…), enlaces simbólicos (no los sigue, ni a archivos ni a carpetas) y cualquier archivo que parezca un secreto (`.env*`, claves `.pem`/`.key`, `id_rsa`, `.npmrc`, `credentials*`, `secrets*`…). No sale de la carpeta del repositorio, no ejecuta nada y no escribe nada. Si un archivo permitido contiene algo con forma de secreto (una clave de API, una URL con contraseña), se sustituye por `[REDACTADO]`.
- **Tope:** como mucho 48 KB en total, que es lo que puede llegar al modelo, siempre como datos (las instrucciones que contenga un archivo o un comentario se ignoran).
- **Lo que se detectó:** en la pantalla de preguntas verás «Lo que se detectó en tu repositorio»: el stack, el sistema de diseño, la estructura y cómo se prueba, **cada cosa con su evidencia** (los archivos en los que se basa; la aplicación descarta lo que el modelo diga sin un archivo real que lo respalde). Si algo no es así, corrígelo en su campo: tu corrección manda sobre lo detectado en todos los pasos siguientes, y puedes cambiarla después con «Cambiar mis respuestas».
- **La propuesta** mantiene el stack existente (sin añadir dependencias), registra en las reglas las convenciones y los estilos que ya sigue el código, usa el comando de pruebas que ya defines (por ejemplo `npm test`) y su primera tarea revisa y documenta la base existente en lugar de crear un scaffold. Al aprobar solo se escribe en `docs/`.
- Un repositorio recién creado (solo README, `.gitignore` y `docs/`) cuenta como proyecto nuevo.

## Diseño del proyecto (opcional)

Si tu proyecto tiene una interfaz gráfica, al responder las preguntas marca «Mi proyecto tiene una interfaz gráfica: quiero ver propuestas de diseño antes del plan» (viene marcada si adjuntaste una referencia visual). Un modelo diseña 2 o 3 direcciones distintas, cada una con un prototipo que puedes **probar** (filtrar, añadir, navegar). Los prototipos son completos (varias pantallas, datos de ejemplo, edición, atajos de teclado y los estados vacío, de carga, de error y de éxito), así que tarda de 5 a 7 minutos y cuesta entre medio dólar y un dólar; un ajuste a una sola dirección, un tercio de eso. Después puedes:

- **Aprobar esta dirección visual y preparar el plan:** la propuesta se apoya en ella (estilo, pantallas y reglas visuales). Aprobar fija el estilo, no el plan: el plan lo apruebas en el paso siguiente.
- **Qué queda del diseño aprobado:** la propuesta incluye `docs/UI_SPEC.md`, la especificación de la interfaz (pantallas, navegación, componentes, interacciones, estados de UI, flujos, sistema de diseño y decisiones visuales), enlazada a cada feature para que entre en el contexto de sus tareas, y las reglas visuales (tokens, estados obligatorios, estructura de componentes). En la revisión verás la sección «Interfaz y experiencia acordadas» con las pantallas, la navegación y el prototipo. Al aprobar la propuesta, el prototipo se guarda también como `docs/design/prototype.html` en tu repositorio. Como el resto de `docs/`, quedan en tu carpeta de trabajo: haz commit para que viajen con la rama. Una dirección importada como imagen no tiene prototipo que guardar.
- **Pedir ajustes a este prototipo:** cuéntale qué cambiar; solo se regenera ese.
- **Importar un diseño** hecho en otra herramienta (por ejemplo, de Claude Artifacts o Claude Design) y sumarlo a las demás direcciones (hasta 5): un **HTML** se muestra tal cual; una **imagen** (.png, .jpg, .webp, .gif) la describe un modelo en texto y queda como dirección sin prototipo, que puedes aprobar así o convertir en un prototipo interactivo con «Convertir en prototipo»; el **código React** (.jsx, .tsx) lo convierte el asistente en un prototipo HTML autocontenido.
- **Saltar el diseño** e ir directo al plan.

Si ya estás viendo la propuesta y no te convence el aspecto, pulsa **«Volver a las direcciones de diseño»**: vuelves a las mismas direcciones, con tu elección marcada, sin perder lo que generaste (la propuesta pendiente se descarta y se prepara una nueva al elegir). Si no habías pedido el diseño, el mismo botón dice **«Ver propuestas de diseño»** y las genera en ese momento con tus respuestas.

Los prototipos se muestran aislados: funcionan sin Internet y no tienen acceso a tus datos ni al resto de la app. Si uno intenta cargar recursos de fuera, no se cargan y se te avisa; si intenta salir de su página o recargarse, la vista previa se detiene y puedes reiniciarla. Si tu proyecto es un programa de terminal, una librería o un servicio, déjalo sin marcar: no hace falta.

## Cambiar la interfaz al planificar una feature

En «Planificar», al pedir una feature nueva sobre un proyecto en marcha, puedes:

- **Adjuntar referencias** (las mismas que en el inicio: hasta 5 archivos, cada uno con su propósito: cómo debe verse, qué debe hacer o solo inspiración). El mismo modelo traductor del inicio las describe en texto antes de proponer, el planificador trabaja solo con esa descripción y verás «Cómo se entendieron tus referencias». Los archivos se borran al terminar el análisis; si cambias la propuesta sin cambiar los archivos, no se vuelven a analizar.
- **Actualizar `docs/UI_SPEC.md` con este cambio** (o **crearla**, si el proyecto aún no tiene especificación). El planificador recibe la especificación actual y devuelve el documento completo con lo nuevo (pantallas, componentes, estados y decisiones) sin quitar lo que ya tiene. La propuesta no se puede aplicar si a la especificación le falta alguna de sus 8 secciones, o si pediste actualizarla y no la incluye; esa comprobación vale para cualquier propuesta que la toque, venga del planificador, de un agente o de una edición a mano.
- Las features nuevas quedan enlazadas a `docs/UI_SPEC.md` cuando existe (lo marques o no), así sus agentes la reciben en su contexto.

## Dónde queda el código

- Cada ejecución trabaja en un **worktree temporal** (una copia aislada del repositorio en otra carpeta, dentro de los datos de la aplicación) y en una rama `graphdev/…`. Tu carpeta de trabajo no se toca mientras el agente trabaja.
- Al aceptar, el resultado se integra (un único commit por tarea, `TASK-n: título`) en la rama de la feature, `feature/<clave>-<título>` (por ejemplo `feature/feat-001-crear-y-consultar-tareas`). El worktree y la rama temporal se borran.
- **Tu rama principal no se modifica hasta que pulsas «Integrar en main».** Descartar el trabajo de una feature es borrar su rama.
- Una feature que depende de otra empieza con el trabajo de las ramas de las que depende; no puede empezar mientras esas features tengan tareas abiertas.
- Los documentos que la aplicación escribe (ChangeSets, documentos creados o guardados desde ella) se commitean solos en tu repositorio. Si editas un documento fuera de la aplicación y no lo commiteas, la ejecución se bloquea con un mensaje claro.

## Stack, dependencias y skills

- **Perfil de stack.** En un proyecto nuevo, el asistente de inicio elige uno de los perfiles que trae la aplicación (Node mínimo, SPA con React, API con Node, herramienta de terminal, Python mínimo). El perfil fija el stack, las reglas que siguen los agentes, los comandos de verificación y los archivos de configuración que pueden escribir; la propuesta te muestra cuál eligió y qué paquetes instala. Si quieres otro, pídelo en las notas de la propuesta. En un proyecto con código existente se respeta su stack y no se usa ningún perfil.
- **Dependencias.** Las instala la aplicación, nunca el agente: antes de cada ejecución instala los paquetes del perfil en la copia de trabajo de esa ejecución (`npm`, sin ejecutar scripts de los paquetes). Necesitas Node.js con `npm` y conexión la primera vez; después tira de la caché de npm. `node_modules/` nunca se commitea.
- **Proyectos con código existente.** No siguen un perfil: la aplicación instala en cada ejecución lo que declara su `package.json`, con `npm` o `pnpm` según su lockfile (sin ejecutar scripts). Yarn todavía no está soportado.
- **Paquetes nuevos.** Si el agente añade a `package.json` un paquete fuera del perfil, la ejecución se detiene con la lista; el piloto te espera. En «Agentes», en la revisión de esa ejecución, pulsa «Aprobar» para que la aplicación lo instale en adelante y reanuda; si no lo apruebas, relanza la tarea y el agente buscará otra forma.
- **Skills.** La aplicación trae la skill de diseño «Impeccable» (no se descarga nada). Está **apagada por defecto**: actívala en «Agentes» → «Configuración» → «Stack y skills». Con ella activa, solo las tareas de interfaz la reciben. En la medición multiplicó por 3–4,5 el costo de cada tarea de interfaz, así que úsala cuando el aspecto visual importe más que el costo. Tus skills personales de Claude Code nunca se usan en las ejecuciones.

## Correr los comandos del proyecto

- **Tú, desde la app.** En «Agentes» → «Comandos» eliges una rama (la tuya o la de una feature) y uno de los scripts de su `package.json` (`dev`, `test`, `build`…). La app hace una copia de esa rama, instala sus dependencias (la primera vez tarda un poco; después usa la caché) y corre el script: ves la salida en vivo, puedes detenerlo y, si es un servidor de desarrollo, la app muestra su dirección (por ejemplo `http://localhost:5173/`) con un botón para copiarla y abrirla en tu navegador. Tu carpeta no se toca y la copia se borra al terminar. Hasta 4 comandos a la vez; al cerrar la app se detienen todos.
- **El agente, mientras trabaja.** Cuando el proyecto tiene dependencias instaladas, el agente también puede correr los scripts (`npm run <script>`, `npm test`, o con `pnpm`), uno por comando. Un servidor de desarrollo se corta por tiempo, así que solo le sirve para comprobar que arranca. Lo que decide si una tarea se acepta siguen siendo los comandos de verificación del proyecto.

## Comprobaciones que no dependen del agente

- Si una ejecución borra pruebas, las salta (`skip`, `only`) o cambia una configuración de verificación existente (`tsconfig.json`, `vite.config.ts`…), termina igual pero **no se acepta sola**: la revisión en «Agentes» te dice por qué y la aceptas tú si es legítimo.
- **Revisión independiente (opcional).** En el panel del piloto, «Revisión independiente antes de aceptar» elige un modelo que lee el cambio contra los criterios de cada tarea. Si encuentra algo, el piloto pide ajustes con esos hallazgos; si sigue sin pasar tras los intentos, te espera. Añade una llamada por ejecución (con `haiku`, alrededor de medio centavo de dólar en las pruebas). Es una segunda opinión, no una garantía.

## Qué pasa cuando el piloto se detiene

El piloto nunca se queda mudo: pasa a uno de estos estados y lo registra con su motivo.

- **Pausado:** se acercó al límite de uso de tu suscripción (umbral del 85 % por defecto). Se reanuda solo cuando se renueva la ventana, o tú lo reanudas.
- **Esperando al usuario:** necesita una decisión tuya. Casos: una tarea necesita paquetes sin aprobar (ver «Stack, dependencias y skills»), una tarea falló tras todos los intentos permitidos (3 por defecto; el último puede usar un modelo más capaz si lo configuraste), la ejecución terminó pero no se acepta sola (por ejemplo, sin comandos de verificación o con una violación de la política), un conflicto de merge, una acción que la política no permite («Permitir y reintentar»), o una propuesta del agente que tu política manda revisar (queda pendiente en «Planificar» con la razón).
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
| «El núcleo no respondió a … en N s» | La petición tardó más que el tiempo permitido (60 s; 330 s para proponer cambios y para analizar referencias en Planificar). Revisa el registro `logs/sidecar.log` en la carpeta de datos de la aplicación; si el núcleo murió, la siguiente petición lo reinicia. |
| El agente falla al empezar o dice que no hay sesión | Abre una terminal, ejecuta `claude` y inicia sesión; vuelve a intentar. Si el CLI está en una ruta poco habitual, define `GRAPHDEV_CLAUDE_PATH` antes de abrir la aplicación. |
| «Integrar en main» se rechaza por cambios sin commitear | Tu repositorio tiene la rama base abierta con cambios sin guardar. Commitéalos o guárdalos (`git stash`) y vuelve a integrar. Si la rama base está abierta en otro worktree, cambia de rama allí. |
| «Integrar en main» da conflicto | La rama de la feature choca con cambios nuevos en la rama base. Resuélvelo en Git y vuelve a intentarlo. |
| La ejecución se bloquea por un documento | Hay un documento del proyecto con cambios sin commitear hechos fuera de la aplicación; commitéalo. |
| El piloto no acepta una tarea | Comprueba que la política tenga comandos de verificación; sin ellos nada se acepta solo. |
| La aprobación del inicio no avanza | Falta el repositorio (proyectos creados antes de elegir la carpeta de proyectos): conéctalo o créalo desde «Inicio» o «Documentos», con «Elegir…» o escribiendo la ruta. |
| «Ya existe una carpeta con ese nombre…» al crear un proyecto | En tu carpeta de proyectos ya hay una carpeta con ese identificador. Usa otro nombre o, si es un repositorio con el código de este proyecto, pulsa «Es el código de este proyecto: usarlo». |
| El asistente dice «La llamada se interrumpió» | La app se cerró mientras trabajaba. Pulsa «Reintentar» (conserva lo que ya estaba hecho) o «Empezar de nuevo». |
| «No se pudo analizar «archivo»…» al empezar | El modelo no pudo leer esa referencia (vacía, dañada o un PDF sin `pdftoppm`). Pulsa «Reintentar» o «Empezar de nuevo» sin ese archivo. |
| «No se pudo leer el repositorio…» al empezar | La lectura del repositorio usa `git ls-files`; comprueba que la carpeta conectada sea un repositorio Git y que `git` esté instalado. Pulsa «Reintentar las preguntas». |
| «Pediste actualizar docs/UI_SPEC.md, pero la propuesta no la incluye» o «debe conservar sus 8 secciones» | La propuesta no se puede aplicar tal cual: pide otra o corrige las operaciones en «Avanzado». |
| «El inicio del proyecto ya empezó» | Continúa donde lo dejaste, o reinícialo con el botón de reinicio (solo antes de aprobar). El asistente es solo para proyectos sin plan. |
| No llegan avisos del sistema | Las notificaciones de escritorio dependen de la API web del webview y del permiso; la bandeja de actividad dentro de la aplicación es la vía fiable. |

## Lo que todavía no hace

- Trabajar con Codex (el código existe pero está desconectado; solo funciona Claude Code).
- Replanificar un proyecto que ya tiene plan en el grafo: el asistente de inicio parte del código existente, pero solo en proyectos sin features ni tareas.
- Leer código fuente o capturas de pantalla del repositorio en el modo de código existente (solo manifiestos, estructura y estilos).
- Mostrar el camino crítico de una feature en el grafo.

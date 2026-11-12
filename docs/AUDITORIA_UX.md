# Auditoría de la interfaz: ¿sirve para lo que promete?

Fecha: 2026-11-12 · Rama: `feat/claude-code` (commit `97004b1`)

## 1. Qué se auditó y cómo

**Contra qué se mide.** La promesa del producto (README, `PLAN_DE_TRABAJO.md`): _el usuario no es el orquestador_. Define el objetivo y aprueba el plan; la app recorre las tareas sola, verifica, acepta, guarda lo aprendido y **solo lo llama cuando hace falta una decisión humana**. La apuesta vigente es **autonomía + trazabilidad** (H4). Por tanto, la interfaz se evalúa con tres preguntas:

1. **¿Funciona?** Cada pantalla carga datos reales y sus acciones hacen lo que dicen.
2. **¿Se entiende?** Un usuario nuevo sabe dónde está, qué significa cada cosa y qué hacer después.
3. **¿Reduce la orquestación?** Cuando la app necesita al usuario, la decisión se toma en pocos clics y en un solo lugar.

**Método.**

- Lectura completa de `src/desktop/` (shell, 6 vistas, 5 pestañas de Agentes, inspector, asistente de inicio).
- `npx vitest run tests/ui`: **15 archivos, 104 pruebas, todas pasan.**
- **La app real en un navegador con datos reales.** Un arnés (puente HTTP → el núcleo compilado `dist/main/sidecar.js`) sobre una **copia** de la carpeta de datos (`~/.local/share/dev.graphdev2.workspace/projects`, sin tocar el original), Vite con `@tauri-apps/api` sustituido por el puente, y Chrome sin ventana controlado por CDP para hacer clic y capturar. Se recorrieron `todo-app` (2 features cerradas con el piloto) y `ecommerce` (creado con el asistente, 30 nodos). Las capturas están en [`docs/auditoria-ux/`](auditoria-ux/).

## 2. Veredicto

| Pregunta | Respuesta | Por qué |
| :--- | :--- | :--- |
| ¿Funciona? | **Sí, con 3 errores que dan información falsa** | Todas las vistas cargan datos reales y el ciclo completo existe (en `todo-app`, 5 tareas cerradas por el piloto e integradas). Pero un filtro del grafo vacía el árbol y cambia el «Siguiente paso», un botón «Integrar» no integra y las decisiones (ADR) aprobadas en el inicio no llegan a los agentes (§3). |
| ¿Se entiende? | **A medias** | Los textos son claros y la accesibilidad es buena (roles de pestañas, foco, `aria`, tema claro/oscuro). Pero el flujo está repartido en 6 vistas y 5 subpestañas que siguen a los componentes técnicos y no al trabajo del usuario. Hay textos en inglés, valores crudos (`TASK`, `MEDIUM`, `allowed_warning`) y pantallas sin salida («Inicio» con plan). |
| ¿Reduce la orquestación? | **Todavía no lo suficiente** | La bandeja y el «Siguiente paso» van en la dirección correcta, pero cada decisión obliga a saltar a otra vista, elegir de nuevo en un desplegable y buscar el botón. La configuración que decide si el piloto puede trabajar solo (comandos de verificación, política, autenticación) está escondida en «Agentes › Ajustes». |

**Fortalezas que conviene conservar:** el motor de «Siguiente paso» (`next-step.ts`, puro y probado), la bandeja de actividad con sus avisos, la traducción de errores a español (`errors.tsx`), los tokens de tema, la revisión de ejecuciones con diff, log y acciones denegadas, el aviso de costo del piloto y la accesibilidad por teclado. La propuesta de abajo **reorganiza** estas piezas, no las reescribe.

> **Actualización (2026-11-12):** hecho fuera de las fases de abajo, a pedido del usuario: asistente de bienvenida «¿En qué carpeta guardas tus proyectos?» (propone la carpeta que ya tiene repositorios, p. ej. `~/Documents/repos`), cada proyecto nuevo se crea como carpeta propia con `git init`, o se conecta un repositorio existente, y selector de carpetas del sistema («Elegir…», plugin de diálogo de Tauri) en todos los campos de ruta. Ya no hace falta escribir rutas a mano ni conectar el repositorio en Inicio o Documentos para los proyectos nuevos.

## 3. Errores encontrados (P0: dan información falsa o hacen perder trabajo)

Todos se reprodujeron en la app real salvo donde dice «código».

| # | Error | Evidencia | Arreglo propuesto |
| :--- | :--- | :--- | :--- |
| B1 | **Los filtros del grafo reemplazan el grafo de toda la app.** `onFilter` llama a `state.refreshGraph({entityTypes, edgeTypes})`, que guarda el grafo filtrado en el estado global. Al ocultar «Tarea»: el árbol lateral se queda sin tareas, el banner dice «Desglosa tus features en tareas» y Agentes no ve tareas listas. Al volver al grafo los filtros aparecen todos activos (el lienzo se remontó) pero el grafo sigue filtrado hasta el siguiente evento. | [02](auditoria-ux/02-filtro-rompe-actividad.png); `WorkspaceShell.tsx:154`, `PlanningWorkspace.tsx` (mismo `onFilter`) | Filtrar **en el cliente**, dentro de `GraphCanvas` (ya tiene `nodes`/`edges`), y no tocar `workspace.graph`. Guardar el filtro en el estado de la vista para que sobreviva a cambiar de pestaña. |
| B2 | **«Integrar FEAT-002» no integra.** El botón del banner solo navega al grafo con la feature seleccionada; ahí hay que encontrar el otro botón. | [01](auditoria-ux/01-actividad.png); `next-step.ts` `pendingIntegration` → `target: {view:'graph'}`; ninguna llamada a `feature:integrate` en el registro del puente | Que el banner ejecute la acción (con confirmación en línea: «Juntar 3 tareas en `main`»), o renombrarlo «Ver FEAT-002 para integrarla». Regla general: **el texto del botón promete exactamente lo que hace**. |
| B3 | **Las decisiones aprobadas en el inicio quedan en «Borrador» y no llegan a los agentes.** En `ecommerce`, ADR-001 (el stack), ADR-002 y ADR-003 siguen en `DRAFT` después de aprobar la propuesta. El contexto solo incluye ADR `ACCEPTED` (`graph-traversal.ts:66`). Ninguna pantalla lo avisa y el «Siguiente paso» propone ejecutar TASK-001. | [03](auditoria-ux/03-grafo-30-nodos.png) (ADR en rojo, «BORRADOR»); `decision-status.ts:2` | **Verificar si es intencional.** Si no lo es: que aprobar el inicio acepte su ADR del stack. En cualquier caso, que `nextStep` avise «Tienes N decisiones sin aceptar: los agentes no las siguen» antes de ejecutar. |
| B4 | **Cambiar de vista pierde lo escrito sin avisar.** Las vistas se montan de forma condicional; solo Documentos pregunta, y solo al cambiar de documento. Se pierden: el Markdown sin guardar, el borrador de política, el borrador de autonomía y el texto de «¿Qué quieres cambiar?». | código: `WorkspaceShell.tsx` `content = view === …` | Registrar un «tiene cambios» por vista (un `useDirtyGuard` en el shell) y confirmar al salir. Más simple aún: conservar el borrador del planificador en el estado del shell. |
| B5 | **El estado preseleccionado puede bloquear una tarea por accidente.** En una tarea «Lista», el desplegable aparece con «Bloqueada» elegido junto al botón «Cambiar estado». | [04](auditoria-ux/04-inspector-tarea.png); `StatusControl` usa `options[0]` | Usar botones con nombre de acción («Volver a borrador», «Archivar») en lugar de desplegable + botón, como ya hace `DecisionControl` con los ADR. |
| B6 | **La aprobación de permisos solo aparece si estás mirando esa ejecución.** El `<dialog>` vive en `AgentsWorkspace` y depende de `selectedExecution`. Con Escape se **rechaza**. | código: `AgentsWorkspace.tsx` `pendingApproval` | Mostrar la petición en la bandeja con «Aprobar una vez / Rechazar» en línea. Que Escape **cierre sin decidir** (la petición queda pendiente en la bandeja). |

## 4. Problemas de comprensión y acabado (P1)

| # | Problema | Evidencia | Propuesta |
| :--- | :--- | :--- | :--- |
| C1 | **Texto en inglés y valores crudos.** «Diff audit passed. Configured checks passed.», «Work type: TASK», «Prioridad: MEDIUM», «Recommended profile role: DEVELOPER», «allowed_warning». | [05](auditoria-ux/05-revision.png), [04](auditoria-ux/04-inspector-tarea.png), [09](auditoria-ux/09-agentes-ejecutar.png) | Traducir `resultSummary` en el núcleo. En el inspector, una lista blanca de atributos con etiqueta y valor en español (`labels.ts`). Ocultar lo que no le sirve al usuario (`recommendedProfileRole`). |
| C2 | **«Inicio» con plan es una pantalla sin salida.** Muestra «Paso 1 de 3» y «Este proyecto ya tiene un plan». A la vez, **no hay ningún lugar** donde ver el objetivo, el stack, las reglas y los comandos de verificación del proyecto después de aprobarlo. | [07](auditoria-ux/07-inicio-con-plan.png) | Convertir «Inicio» en **«Proyecto»** (§5.1). |
| C3 | **El inspector usa textos de tarea para todo.** Para el proyecto muestra «Historial de ejecuciones · Esta tarea aún no se ha ejecutado». El resumen de TASK-001 es una instrucción para el agente («No instales dependencias…»), no qué hace la tarea. | [04](auditoria-ux/04-inspector-tarea.png) | Secciones por tipo de entidad. En tareas: primero «Qué debe lograr» (criterios de aceptación como lista de comprobación) y después las notas para el agente, plegadas. |
| C4 | **El grafo no escala.** Con 30 nodos, «Ajustar a la vista» deja el zoom al 25 % (ilegible) y aun así hay desplazamiento horizontal. ADR, documentos y requisitos forman una fila plana; las aristas de código cruzan todo el lienzo. Al abrir, la vista no está ajustada. | [03](auditoria-ux/03-grafo-30-nodos.png), [10](auditoria-ux/10-planificar.png) | §5.3: el grafo deja de ser la vista principal del plan y pasa a ser una lente («ver relaciones de esto»). Agrupar por feature, ocultar Código por defecto y añadir búsqueda. |
| C5 | **Doble encabezado y texto de relleno.** «Agentes / Ejecuta tareas listas…» y debajo «EJECUCIÓN DE AGENTES / Monitor de tareas / El agente recibe…». Lo mismo en Grafo («Grafo del proyecto» dos veces). Le quitan ~150 px de alto a cada vista. | [09](auditoria-ux/09-agentes-ejecutar.png) | Un solo encabezado por vista; la explicación va en un «?» o en el estado vacío. |
| C6 | **Revisión: tiempos verbales y estado desfasado.** Una ejecución ya integrada dice «Se integrará en la rama…». Una feature ya integrada sigue mostrando «Integrar en main» como botón principal. El diff es texto plano, sin color para `+`/`−`. | [05](auditoria-ux/05-revision.png), [06](auditoria-ux/06-piloto.png) | «Integrada en `feature/…` (commit `baa9830a`)». Con la feature integrada, el botón pasa a secundario o desaparece. Colorear las líneas del diff. |
| C7 | **Piloto: tres pasos para arrancar y el desplegable elige la feature equivocada.** Elegir nivel → «Guardar autonomía» → «Iniciar piloto» → casilla de costo → «Iniciar». El desplegable abre en FEAT-001 (ya terminada) y no en la feature con trabajo pendiente ni en la que está seleccionada en el grafo. No indica cambios sin guardar. | [06](auditoria-ux/06-piloto.png) | Abrir en la feature seleccionada o en la primera con tareas pendientes. Un único botón «Activar piloto en FEAT-00X» que guarda y abre el aviso de costo. Marcar «cambios sin guardar». |
| C8 | **La actividad en vivo vuelca resultados completos de herramientas.** Un `Read` muestra el archivo entero, línea por línea, en una tarjeta. | [09](auditoria-ux/09-agentes-ejecutar.png) | Una línea por herramienta («Leyó `src/tasks.js` · 54 líneas») con detalle plegable. Auto-desplazamiento al final, con pausa si el usuario sube. |
| C9 | **La tarjeta de proyecto muestra «REV 32».** No dice nada al usuario. | [00](auditoria-ux/00-pantalla-inicial.png) | Mostrar progreso («5/5 tareas · 2 features») y la última actividad («hace 23 h»). |
| C10 | **A 860 px el grafo y el inspector se aprietan hasta no ser usables.** La barra lateral se pliega bien. | [08](auditoria-ux/08-ancho-860.png) | Por debajo de ~1100 px, el inspector pasa a cajón superpuesto sobre el contenido. |

## 5. Propuesta de reorganización

### 5.1 Pestañas: del componente técnico al trabajo del usuario

Hoy las pestañas siguen la arquitectura (grafo, planificador, agentes). El usuario hace cuatro cosas: **saber qué pasa**, **decidir el plan**, **seguir y aprobar el trabajo** y **ajustar las reglas**.

| Hoy | Propuesta | Qué cambia |
| :--- | :--- | :--- |
| Actividad | **1. Bandeja** | Igual, pero cada elemento lleva su acción **en línea**: «Aceptar», «Pedir ajustes», «Aprobar una vez», «Reanudar piloto», «Aplicar propuesta». Navegar a otra vista queda solo para ver el detalle. «Reciente» va plegado y paginado. |
| Grafo + Planificar | **2. Plan** | Vista principal: **features con sus tareas** en lista o tablero por estado (§5.3). El grafo pasa a ser un modo de ver («Lista · Tablero · Relaciones»). «Proponer cambios» se abre en un panel lateral desde cualquier sitio del plan, anclado a lo seleccionado y diciéndolo («Propuesta sobre FEAT-002»). |
| Agentes › Ejecutar + Revisión | **3. Ejecuciones** | Una sola pantalla con lista a la izquierda (**Por revisar · En curso · Historial**) y detalle a la derecha con pestañas **En vivo · Cambios · Verificación · Contexto**. Desaparece el desplegable «Ejecución» repetido en dos pestañas. Lanzar una tarea se hace desde el Plan (botón en la tarea) o desde «Ejecutar siguiente» aquí. |
| Agentes › Piloto | **Dentro de cada feature** (en Plan) | El encabezado de la feature muestra nivel, estado del piloto, «Activar piloto» e «Integrar». Una tira global en el shell indica «Piloto en marcha · FEAT-002 · 3/5» (solo corre uno por proyecto). |
| Agentes › Comandos | **Ejecuciones › Comandos** | Es «correr cosas», junto a las ejecuciones del agente. |
| Agentes › Ajustes | **5. Configuración** | Política (rutas y verificación), decisiones del agente, motor y autenticación, stack y skills, repositorio. Un indicador de salud arriba: «Verificación configurada ✓ · Repositorio ✓ · Sesión de Claude ✓». |
| Documentos | **4. Documentos** | Se queda. Lectura por defecto y «Editar» explícito. Los ADR muestran su estado y los botones «Aceptar / Rechazar». |
| Inicio | **0. Proyecto** | Sin plan: el asistente (como hoy). Con plan: **ficha del proyecto**, con objetivo, alcance, stack (ADR), reglas, verificación, repositorio y rama, progreso por feature y **pendientes que bloquean la autonomía** (ADR sin aceptar, sin comandos de verificación, repositorio sin conectar). |

Atajos: ⌘/Ctrl+1…6 se mantienen con el nuevo orden. El árbol lateral se queda (es la mejor navegación actual) y elegir un nodo abre su detalle en la vista actual, no fuerza el salto al grafo.

### 5.2 Un panel de detalle común

El inspector solo existe en Grafo. Propuesta: **un único panel de detalle** (cajón a la derecha) disponible en Plan, Bandeja y Ejecuciones, que se abre al elegir cualquier entidad. Sus secciones dependen del tipo:

- **Tarea:** objetivo, criterios de aceptación (lista), estado con botones de acción, dependencias (bloqueada por / desbloquea), última ejecución con su resumen de cierre, notas para el agente (plegadas) y contexto que recibirá.
- **Feature:** progreso, autonomía y piloto, rama e integración, tareas, documentos enlazados.
- **ADR / Documento:** estado y acciones, a quién afecta y un enlace para abrirlo en Documentos.

**Editar una tarea** (título, objetivo, criterios, prioridad) directamente en el panel. Hoy solo se puede con el JSON de «Avanzado» en Planificar. Para conservar la trazabilidad, guardar crea un ChangeSet manual que se aplica al momento y queda en el historial.

### 5.3 El plan como tablero, el grafo como lente

- **Lista por feature** (por defecto): feature › tareas con estado, dependencias («espera a TASK-002») y una acción principal por fila («Marcar lista», «Ejecutar», «Revisar»).
- **Tablero:** columnas Borrador · Lista · Bloqueada · En curso · En revisión · Hecha, con filas por feature.
- **Relaciones (grafo):** abre centrado en lo seleccionado y su vecindario a 1–2 saltos (modo foco), con búsqueda por clave o título, los nodos de Código ocultos por defecto y un carril por feature. Sigue mostrando los nodos fantasma de una propuesta.

### 5.4 Arrastrar y soltar: dónde sí y dónde no

| Dónde | Para qué | Regla |
| :--- | :--- | :--- |
| **Tablero del plan** | Mover una tarea de Borrador a Lista (el gesto más repetido antes de ejecutar), o a Archivada. | Solo se puede soltar en las columnas que permite `manualWorkItemTransitions`; las demás se atenúan al arrastrar. Teclado equivalente: menú «Mover a…». |
| **Orden dentro de una columna** | Fijar la prioridad, que hoy es `MEDIUM` fija y no se puede editar. | El piloto toma la siguiente tarea `READY` en ese orden. |
| **Referencias** (inicio, planificar, importar diseño) | Soltar capturas, PDF o HTML. | Mismas validaciones que el selector actual: 5 archivos, 3 MB y tipos permitidos, con error por archivo. |
| **Divisores de panel** | Ancho del panel de detalle y del planificador. | Guardar el ancho por vista en `localStorage`. |
| **Grafo** | No arrastrar nodos. | La posición sale del diseño automático; guardar posiciones manuales no aporta a la autonomía y se desincroniza al crecer el plan. |
| **Mover una tarea a otra feature** | Más adelante. | Debe pasar por un ChangeSet con validación (puede romper dependencias y ramas). |

### 5.5 Validaciones y salvaguardas

**En formularios (validación en el cliente, con el mensaje junto al campo):**

- **Piloto:** intentos 1–5, umbral 50–99 % y tamaño de grupo 1–5. Hoy un campo vacío se envía como `Number('') = 0`. El tamaño de grupo debe avisar al pasar de 3 (lo medido).
- **Política:** minutos 1–240 (hoy no se valida). Una ruta no puede estar a la vez en «escribibles» y «prohibidas». Los comandos de verificación no admiten `|`, `&&` ni `;` (la ayuda lo dice, pero no se comprueba). Avisar si `writablePaths` queda vacío.
- **Nivel Auto-aceptar o Piloto sin comandos de verificación:** bloquear el guardado con «Sin comandos de verificación nada se acepta solo: añade uno en Configuración» y un enlace directo. Hoy el piloto arranca y luego se queda esperando.
- **Crear proyecto:** avisar si el identificador ya existe antes de enviar.
- **Planificar:** contador de caracteres y aviso de costo según el modelo (opus) antes de «Proponer cambios».

**Salvaguardas de acciones:**

- Cambios sin guardar: aviso al cambiar de vista o de proyecto (B4).
- Acciones irreversibles o caras con confirmación en línea, no `window.confirm`: «Rechazar propuesta», «Archivar tarea», «Cancelar ejecución» («se pierde el trabajo de esta ejecución»), «Integrar en main».
- Escape en la aprobación de permisos cierra sin decidir (B6).
- **Aplicación parcial de propuestas:** casillas por operación («aplicar 4 de 6») que generan la edición del ChangeSet por debajo, en lugar de editar JSON.

## 6. Plan de trabajo sugerido

| Fase | Contenido | Tamaño | Cómo se comprueba |
| :--- | :--- | :--- | :--- |
| **F0 · Errores** | B1–B6, C1 (textos en inglés y valores crudos) y C6 | M (~1 día) | Pruebas de UI nuevas: el filtro no cambia `nodes` del shell; el banner de integración llama a `integrateFeature`; aviso por ADR en borrador; guarda de cambios sin guardar. Repetir el recorrido con el arnés. |
| **F1 · Reorganización** | Vista «Proyecto» (C2), «Ejecuciones» unificada, «Configuración» con indicador de salud, acciones en línea en la Bandeja, un solo encabezado (C5) y piloto dentro de la feature (C7) | L (3–4 días) | Prueba de uso (abajo) con métricas antes y después. |
| **F2 · Plan** | Lista y tablero por feature, panel de detalle común, editar tareas, drag de estado y prioridad, planificador en panel lateral con aplicación parcial, grafo en modo foco con búsqueda (C4) | L (4–5 días) | `ecommerce` (30 nodos) navegable sin zoom por debajo del 60 %. |
| **F3 · Acabado** | Arrastrar referencias, diff con color, actividad en vivo compacta (C8), divisores, tarjeta de proyecto (C9) y responsivo (C10) | M | Capturas a 1440, 1100 y 860 px. |

**Prueba de uso para validar (antes de F1 y después de F2).** Cinco tareas, con una persona que no conozca la app y sin la guía:

1. Crear un proyecto y llegar a la propuesta del asistente.
2. Encontrar el stack y los comandos de verificación del proyecto ya aprobado.
3. Ejecutar la primera tarea y aceptarla.
4. Activar el piloto en una feature.
5. Resolver un «el piloto espera tu decisión».

Métricas: clics y tiempo por tarea, tareas completadas sin ayuda y momentos de «¿dónde está…?». La métrica que importa para H4 es la **(5)**: tiempo desde el aviso hasta el piloto en marcha otra vez.

### Estado de F0 (2026-11-12)

**Con errores encontrados en la validación manual.** B1 pasa. B2 quedó bloqueado por un conflicto real al integrar
FEAT-002 en `todo-app`, que deja ver dos errores (features en paralelo sobre el mismo archivo y conflicto sin salida
en la interfaz). El resto está sin validar. Detalle en [VALIDACION_F0.md](VALIDACION_F0.md#resultados-de-la-validación).
Sigue pendiente repetir el recorrido con el arnés en el navegador.

| # | Qué se hizo | Dónde |
| :--- | :--- | :--- |
| B1 | El filtro solo oculta en el lienzo (también las aristas hacia nodos ocultos); el grafo del shell no cambia y el filtro se guarda en el shell, así que sobrevive al cambio de vista. Planificar comparte el mismo filtro. | `GraphCanvas.tsx` (`filter`, `onFilterChange`), `WorkspaceShell.tsx` |
| B2 | «Integrar FEAT-00X» integra desde el banner tras una confirmación en línea («¿Juntar N tareas de FEAT-00X en main?»). Sin el comando en el núcleo, el botón dice «Ver FEAT-00X para integrarla». | `next-step.ts` (`action`), `NextStepBanner.tsx` |
| B4 | `useUnsavedChanges` registra los borradores (documento, política, autonomía, «¿Qué quieres cambiar?») y el shell pregunta antes de cambiar de vista o de proyecto. | `state/unsaved-changes.tsx` |
| B5 | Botones con el nombre de la acción («Marcar como lista», «Bloquear», «Desbloquear», «Archivar» con confirmación); sin nada preseleccionado. | `ContextualInspector.tsx` (`StatusControl`) |
| B6 | La bandeja responde la petición de permiso en línea («Aprobar una vez» / «Rechazar»); Escape cierra el diálogo sin decidir. | `ActivityInbox.tsx`, `activity-service.ts` (`approvalRequestId`), `AgentsWorkspace.tsx` |
| C1 | Resúmenes de la validación en español (y traducción de los guardados en inglés); en el inspector, tipo y prioridad traducidos y el rol recomendado oculto; «cerca del límite» en lugar de `allowed_warning`. | `domain/agents/result-summary.ts`, `labels.ts` |
| C6 | «Integrada en … · commit …» una vez integrada y «Al aceptarla se integrará…» antes; feature ya integrada con «Volver a integrar» como acción secundaria; diff con color por línea. | `ExecutionReview.tsx`, `FeatureIntegration.tsx` |

## 7. Cómo repetir la revisión con la app real

El arnés no forma parte del repositorio. Se reconstruye en minutos:

1. `npm run build:core`.
2. Copiar `~/.local/share/dev.graphdev2.workspace/projects` a una carpeta temporal (nunca usar el original).
3. Un proceso Node que lance `dist/main/sidecar.js` con `GRAPHDEV_WORKSPACE_ROOT` apuntando a la copia y reenvíe `POST /req` → `stdin` (`{id, request:{channel,args}}`) y los eventos de `stdout` como SSE.
4. Una configuración de Vite que extienda `vite.config.ts` y sustituya `@tauri-apps/api/core` (`invoke` → `fetch`) y `@tauri-apps/api/event` (`listen` → `EventSource`).
5. Chrome sin ventana con `--remote-debugging-port` para hacer clic y capturar.

Si se repite a menudo, vale la pena convertirlo en `scripts/ui-harness/` con un comando `npm run ui:harness`, y usarlo también para pruebas de humo visuales en cada etapa.

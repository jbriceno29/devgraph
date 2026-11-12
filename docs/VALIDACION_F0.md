# Validación manual de F0 (errores de la interfaz)

Qué revisar en la app real para cerrar F0 de [AUDITORIA_UX.md](AUDITORIA_UX.md). Unos 15 minutos.
Marca cada casilla; si algo falla, anota qué hiciste y qué viste.

## Preparación

1. En `~/Documents/repos/graphdev2` (rama `feat/claude-code`, al día): `npm run desktop`. Compila el núcleo; la
   primera vez tarda.
2. Usa un proyecto de prueba con plan: por ejemplo `todo-app` (tiene features cerradas por el piloto). Si prefieres
   no tocarlo, crea uno nuevo con «Ya tengo el código» sobre una **copia** de `todo-app`.
3. Para **B2** necesitas una feature con todas sus tareas en «Hecha» y su rama sin integrar. Si no tienes una:
   ejecuta y acepta la última tarea pendiente de una feature (con `haiku` cuesta centavos) y no pulses «Integrar».

## Comprobaciones

### B1 · El filtro del grafo no rompe el resto de la app

- [ ] Grafo › Filtros › desactiva «Tarea». Las tareas desaparecen del lienzo.
- [ ] El árbol de la barra lateral **sigue mostrando** las tareas.
- [ ] Ve a Actividad: el banner «Siguiente paso» **no** cambia a «Desglosa tus features en tareas».
- [ ] Vuelve a Grafo: el filtro **sigue puesto** («Filtros · 1 ocultos») y las tareas siguen ocultas.
- [ ] En Planificar, el grafo usa el mismo filtro.
- [ ] Reactiva «Tarea»: todo vuelve a verse.

### B2 · «Integrar FEAT-00X» integra

- [ ] Con la feature terminada (ver Preparación), el banner de Actividad dice «Integra FEAT-00X … en main» y el botón
      «Integrar FEAT-00X».
- [ ] Al pulsarlo aparece en línea «¿Juntar N tareas de FEAT-00X en main?» con «Sí, integrar» y «Cancelar».
- [ ] «Cancelar» vuelve al botón sin hacer nada.
- [ ] «Sí, integrar» muestra «FEAT-00X integrada en main · commit xxxxxxx» y el banner pasa al siguiente paso.
- [ ] En el repositorio: `git log --oneline -3 main` muestra el commit «Integra feature/…».

### B4 · Cambiar de vista no pierde lo escrito

- [ ] Planificar: escribe algo en «¿Qué quieres cambiar?» y pulsa otra pestaña. Pregunta «Tienes cambios sin guardar
      en «¿Qué quieres cambiar?». ¿Salir y descartarlos?».
- [ ] «Cancelar» te deja en Planificar con el texto intacto; «Aceptar» cambia de vista.
- [ ] Lo mismo con el atajo Ctrl+2 (o ⌘+2).
- [ ] Documentos: edita un documento sin guardar y cambia de vista → pregunta.
- [ ] Agentes › Ajustes: cambia un campo de la política sin guardar y cambia de vista → pregunta.
- [ ] Agentes › Piloto: cambia el nivel de autonomía sin guardar y cambia de vista → pregunta.
- [ ] Sin cambios, cambiar de vista **no** pregunta nada.

### B5 · Estado de una tarea con botones

- [ ] Grafo: selecciona una tarea «Lista». En el inspector, la sección «Estado» tiene botones con nombre
      («Bloquear», «Archivar»…), **sin desplegable** y sin nada preseleccionado.
- [ ] Una tarea «Borrador» ofrece «Marcar como lista»; una «Bloqueada», «Desbloquear».
- [ ] «Archivar» pide confirmación en línea («Sale del plan y nadie la ejecutará…»); «Cancelar» no cambia nada.

### B6 · Peticiones de permiso desde Actividad

**No se puede provocar con Claude Code:** el motor corre con `--permission-mode dontAsk` y nunca pide permiso (lo que
no está permitido se deniega y aparece en «Acciones denegadas»). Solo lo haría Codex, que está desconectado. B6 queda
cubierto por las pruebas de UI (`tests/ui/activity-inbox.test.tsx` y `tests/ui/agents-workspace.test.tsx`).

- [ ] Nada que validar a mano. Si quieres, abre Actividad y comprueba que no hay un aviso «Un agente pide permiso»
      huérfano de pruebas anteriores.

### C1 · Textos en español y sin códigos crudos

- [ ] Agentes › Revisión de una ejecución nueva: el resumen dice «Los cambios solo tocan rutas permitidas y las
      comprobaciones pasaron.» (no «Diff audit passed…»).
- [ ] Una ejecución **antigua** también se muestra en español (la traducción se aplica al mostrar).
- [ ] Inspector de una tarea: «Tipo de trabajo: Tarea» y «Prioridad: Media»; **no** aparecen `TASK`, `MEDIUM` ni
      «Recommended profile role».
- [ ] Agentes › Ejecutar, durante una ejecución: el límite de uso dice «cerca del límite» en lugar de
      `allowed_warning` (solo si la ventana de uso está alta; si no aparece, no es un fallo).

### C6 · Revisión con el tiempo verbal correcto y diff con color

- [ ] Una ejecución pendiente de aceptar dice «Al aceptarla se integrará en feature/…».
- [ ] Una ejecución aceptada dice «Integrada en feature/… · commit xxxxxxxx» (sin «se integrará»).
- [ ] Al abrir un archivo cambiado, las líneas `+` se ven en verde, las `−` en rojo y las `@@` en el color de acento.
- [ ] Una feature ya integrada muestra «FEAT-00X está integrada en main» y el botón «Volver a integrar en main» como
      **secundario**, en el panel del piloto y en el inspector de la feature.

## Si algo falla

Anota la casilla, qué hiciste y qué viste (una captura ayuda). El registro del núcleo está en
`~/.local/share/dev.graphdev2.workspace/logs/sidecar.log`.

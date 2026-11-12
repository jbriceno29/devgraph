# Validación manual de 3d, el paso 4 y el paso 4b

Qué revisar en la app real para cerrar estos pasos:

- **3d:** Git seguro.
- **Paso 4:**
  - C1, documentación en línea;
  - C7a, perfil Next.js;
  - C6, verificación por stack.
- **Paso 4b:** R2, línea base de verificación.

Lleva unos 30–40 minutos. Marca cada casilla y, si algo falla, anota qué hiciste y qué viste. Las ejecuciones con
`haiku` cuestan centavos.

## Preparación

1. En `~/Documents/repos/graphdev2` (rama `feat/claude-code`, al día), ejecuta `npm run desktop`. Si ya estaba
   abierta, ciérrala antes, porque el núcleo no se recarga en vivo.
2. Haz dos copias de `todo-app`, para no tocar el original:

   ```sh
   git clone ~/Documents/repos/todo-app ~/Documents/repos/todo-prueba
   git clone ~/Documents/repos/todo-app ~/Documents/repos/todo-rota
   ```

3. En `todo-rota`, rompe una prueba a propósito: en `tests/tasks.test.js` cambia `'Estudiar'` por `'Otra cosa'` en
   la línea de `assert.equal(list.add('  Estudiar  ').title, 'Estudiar')`. Después ejecuta
   `git commit -am "prueba rota"`.
4. Crea en la app un proyecto con «Ya tengo el código» sobre `todo-prueba` y termina el inicio con `haiku`: responde
   las preguntas y aprueba la propuesta. Es el proyecto de las secciones 3d, C1 y C6.

## 3d · Git seguro

- [ ] En Ajustes › Repositorio y ramas aparecen:
  - la rama base `main`;
  - «Tienes abierta main»;
  - la nota sobre las ramas `graphdev/…`.
- [ ] En una terminal, dentro de `todo-prueba`, ejecuta `git checkout -b mi-rama`. Luego pulsa «Volver a comprobar»:
  - aparece «No se pueden guardar documentos ahora. Tu repositorio tiene abierta la rama mi-rama…».
- [ ] Sin cambiar de rama, edita y guarda un documento del proyecto (por ejemplo el PRD). Se rechaza con ese mismo
      mensaje.
- [ ] Sin cambiar de rama, ejecuta y acepta una tarea con `haiku`. Después comprueba:
  - `git log --oneline main..graphdev/feature/<la-feature>` muestra solo commits de la tarea;
  - `git log mi-rama` no tiene nada nuevo;
  - la carpeta sigue limpia (`git status`).
- [ ] Vuelve a `main` con `git checkout main` y pulsa «Volver a comprobar». El aviso desaparece.

## C1 · Documentación en línea

- [ ] Ajustes › Documentación en línea:
  - está activada;
  - «Según el stack del proyecto» incluye `nodejs.org`.
- [ ] Escribe `localhost` en «Otros dominios» y pulsa «Guardar la documentación». Sale el error «No son dominios
      válidos».
- [ ] Cambia el texto por `https://docs.python.org/3/` y guarda. Se queda como `docs.python.org`.
- [ ] Planifica y ejecuta con `haiku` una tarea que use una API de Node poco común. Por ejemplo: «crea `src/warn.js`
      con `util.styleText` de `node:util`; comprueba su documentación antes de usarla».
- [ ] En el registro de esa ejecución (Ejecuciones › eventos) aparece `WebFetch` con una URL de `nodejs.org`.
- [ ] Desactiva la documentación y guarda. La casilla se queda sin marcar y los dominios desaparecen.

## C6 · Verificación por stack

- [ ] En Revisión de cualquier ejecución terminada:
  - cada comprobación sale en su línea, con «Pasó» o «Falló», el comando y la duración;
  - debajo está el «Log de verificación» plegado.
- [ ] Con una feature de `todo-prueba` terminada, el panel de la feature **no** muestra «Comprobaciones de
      integración». El proyecto no tiene `build`, así que «Integrar» funciona como antes.

Las comprobaciones de integración (`next build`) se validan en la sección C7a.

## C7a · Perfil Next.js y cambio de stack

Hazlo en un proyecto aparte, creado desde cero o sobre otra copia, porque cambia el stack.

- [ ] En Planificar escribe: «Queremos migrar el proyecto a Next.js con Postgres: cambia el stack del proyecto. No
      crees tareas todavía.» La propuesta muestra:
  - «Definir el perfil del proyecto · Stack: TypeScript, Next.js (App Router), React, Tailwind CSS 4…»;
  - «Comprobaciones: node_modules/.bin/tsc --noEmit, node_modules/.bin/vitest run».
- [ ] Aplica la propuesta y comprueba:
  - Ajustes › Stack y skills dice «Aplicación web full-stack con Next.js»;
  - Documentación en línea incluye `nextjs.org`, `tailwindcss.com` y `orm.drizzle.team`.
- [ ] Crea una tarea de andamiaje: «Monta la base Next.js del perfil: configuración, `src/app/layout.tsx` y
      `page.tsx`, y una prueba de humo». Ejecútala con `haiku`. La app instala los paquetes, las comprobaciones pasan
      y la aceptas.
- [ ] Con la feature terminada, el panel muestra:
  - «Antes de integrar, la app comprueba que el resultado compila» y el comando `node_modules/.bin/next build`;
  - **ningún** botón «Integrar».
- [ ] Pulsa «Comprobar antes de integrar»:
  - aparece «Comprobando el resultado de integrar…»;
  - en uno o dos minutos pasa a «Las comprobaciones de integración pasaron»;
  - aparece «Integrar en main».
- [ ] Integra. Ni `main` ni la carpeta muestran restos: `git worktree list` tiene una sola línea.

## R2 · Línea base de verificación

- [ ] Crea un proyecto con «Ya tengo el código» sobre `todo-rota` y empieza el inicio con `haiku`. Bajo «Qué podrá
      tocar el agente», «Cómo está la verificación hoy» se comprueba sola y muestra:
  - «Falla · npm test: pasan 39, fallan 1»;
  - en «Final de la salida», la aserción que falla;
  - el aviso «Esto ya falla antes de que la app cambie nada…».
- [ ] Responde las preguntas. La propuesta empieza «Fundación» con la tarea «Dejar la verificación en verde».
- [ ] Aprueba la propuesta. `todo-rota` tiene que estar en `main`.
- [ ] Intenta activar el piloto en una feature. Se rechaza con «La verificación de la rama base falla (npm test)…».
- [ ] En Ajustes › «Cómo está la verificación hoy», pulsa «Aceptar estos fallos como conocidos»:
  - el panel dice «Aceptados como conocidos»;
  - en Políticas desaparece `npm test` de las comprobaciones;
  - el piloto ya no se rechaza por eso. No hace falta arrancarlo.
- [ ] Pulsa «Volver a comprobar». Sigue corriendo `npm test` y lo mantiene como fallo conocido.
- [ ] Pulsa «Dejar de aceptarlos». `npm test` vuelve a Políticas.
- [ ] Opcional: arregla la prueba en `todo-rota` (`git commit -am arreglo`) y pulsa «Volver a comprobar». Sale
      «Pasa · npm test: pasan 40».

## Resultados de la validación

Anota aquí lo que falle: paso, qué hiciste y qué viste.

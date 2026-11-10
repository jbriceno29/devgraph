# Graph Workspace

Workspace de ingeniería local-first. El shell de escritorio usa **Tauri 2**, la UI usa React/Tailwind y el núcleo de aplicación/persistencia permanece en TypeScript con SQLite.

## Ejecutar en desarrollo

Requisitos: Node.js 22 o posterior, npm, Rust/Cargo y las dependencias nativas de Tauri para tu plataforma. En Ubuntu, instala WebKitGTK/GTK y herramientas de compilación siguiendo la [guía oficial de requisitos de Tauri](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run desktop
```

La primera ejecución compila el host Rust y puede tardar un poco. `npm run desktop` ejecuta `tauri dev`; no necesita el helper SUID de Electron. La UI conversa con comandos Tauri tipados y estos reenvían las solicitudes al núcleo Node/TypeScript.

## Documentos Markdown

Abre un proyecto y selecciona **Documentos**. La primera vez, conecta una carpeta Git escribiendo su ruta absoluta; Graph Workspace observará `docs/`. Desde esa vista puedes generar PRD, arquitectura, especificaciones, planes, documentos de dominio y ADRs con plantillas, vincularlos a entidades del grafo, editar Markdown con vista previa y guardarlo de forma atómica. Los cambios hechos desde otro editor se detectan y aparecen como **Cambio externo**; recarga el documento antes de continuar si hay cambios locales sin guardar.

El shell Tauri mantiene un sidecar Node persistente para conservar el watcher activo y reenviar sus eventos tipados a la UI. El renderer no accede al filesystem ni a SQLite.

## Planificar cambios con Codex

Abre **Planificar**, conecta un repositorio Git y describe el cambio. La app invoca `codex exec` en modo `read-only` y sin aprobaciones interactivas para pedir una propuesta estructurada; Codex no aplica cambios directamente. La propuesta se valida contra la revisión y topología actuales, y el grafo muestra los nodos fantasma antes de confirmar. Puedes editar las operaciones JSON, rechazar la propuesta o aplicar únicamente una propuesta validada. Aplicar escribe los Markdown nuevos mediante staging y ejecuta las escrituras de grafo dentro de `BEGIN IMMEDIATE`; si SQLite falla, los archivos staged se retiran. Para usar esta vista necesitas el CLI `codex` instalado y autenticado. El sidecar busca el ejecutable en el `PATH` y en ubicaciones habituales; si lo instalaste en otro lugar, define `GRAPHDEV_CODEX_PATH` con su ruta absoluta antes de abrir la app.

## Verificación y build de escritorio

```bash
npm run typecheck
npm test
npm run build
npm run desktop:build
```

`desktop:build` empaqueta el host Tauri junto con el runtime Node, el núcleo compilado y `better-sqlite3` para la plataforma/arquitectura de build. El sidecar se prepara para el target local; los builds cruzados requieren preparar Node y el addon SQLite para el target correspondiente.

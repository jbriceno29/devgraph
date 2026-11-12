# Plan de diseño visual: direcciones con criterio y sitios web como referencia

Fecha: 2026-11-12 · Rama: `feat/claude-code` · Estado: aprobado; paso 5c de la hoja de ruta. D0 hecho
Relacionado: [PLAN_EXPLORACION_VISUAL_Y_OBJETIVO.md](PLAN_EXPLORACION_VISUAL_Y_OBJETIVO.md) (etapas V1–V4, ya hechas)

## 1. Problema

Las direcciones visuales de `EXPLORE_UI` funcionan, pero se ven básicas y parecidas entre sí. Las causas están en
cómo se piden, no en el visor:

1. **El prompt pide funciones, no diseño.** `UI_RULES` (`src/modules/inception/infrastructure/prompts/inception-prompts.ts`)
   exige CRUD, 8–15 registros, los cuatro estados, atajos y accesibilidad. No dice nada de concepto, tipografía,
   jerarquía ni de evitar el aspecto genérico. El modelo cumple la lista y cae en el panel de administración por
   defecto.
2. **No queda espacio para el estilo.** Una sola llamada escribe 3 prototipos de menos de 16 000 caracteres cada uno.
   El JavaScript de CRUD y estados se come casi todo, y el CSS queda mínimo. La importación ya admite 120 000
   (`MAX_PROTOTYPE_CHARS`).
3. **No hay un paso de concepto.** El modelo salta al HTML sin decidir antes a quién sirve, qué metáfora sigue ni
   qué tokens usa.
4. **No hay revisión.** Es una pasada a ciegas, con el HTML escapado dentro de un JSON.
5. **El modelo es Sonnet antes que Opus.** `uiModel` (`inception-kernel.ts`) recorre `['sonnet', 'opus']`.
6. **Sin recursos visuales.** Sin red: fuentes del sistema y SVG en línea.

## 2. El modelo de trabajo que se quiere integrar

Es lo que hace un diseñador cuando no hay dirección visual:

1. **Contexto de uso:** quién lo usa, cuántas horas al día, en qué dispositivo, cuánto está en juego. De ahí sale el
   registro (denso y calmo, cálido y guiado, sobrio, lúdico).
2. **Una metáfora ancla** en una frase («libro contable impreso», «cuaderno de campo», «sala de control»).
3. **Tokens derivados de la metáfora:** tipografía primero, luego paleta (base neutra con temperatura y un solo
   acento), densidad y ritmo (cuadrícula 4/8), forma (radio, bordes o sombras) y movimiento.
4. **La pantalla de la tarea más frecuente primero**, con datos reales. La navegación después.
5. **Convenciones del género:** se innova en la piel, no en la mecánica que el usuario ya conoce.
6. **Freno a los defaults:** comparar el plan con el aspecto genérico y cambiar lo que se parezca.
7. **Una sola audacia:** un elemento memorable, el resto disciplinado.
8. **Crítica viendo el resultado.**

## 3. Skills evaluadas

Se buscaron en el ecosistema de skills (`npx skills find`) y se leyó su `SKILL.md`. **Ninguna se instala dentro de
la app**: el motor corre aislado (`CLAUDE_ISOLATION_ARGS` deja fuera las skills del usuario) y el proyecto debe poder
cambiar de motor. Lo que sirve se trae como conocimiento a los prompts y como código propio.

| Skill | Instalaciones | Qué hace | Uso en este plan |
| --- | --- | --- | --- |
| `anthropics/skills@frontend-design` | 1,1 M | Guía de diseño: anclar en el tema, plan de tokens (4–6 hex con nombre, tipos y roles, layout en ASCII, principios), revisar el plan contra los defaults antes de escribir código, una sola audacia, autocrítica y redacción de la interfaz. Lista los rasgos típicos del diseño generado. | Base de la etapa D1. Licencia Apache-2.0: se redacta con palabras propias; si se copia texto literal, se cita con su aviso de licencia. |
| `arvindrk/extract-design-system@extract-design-system` | 131 K | `npx extract-design-system <url>`: abre el sitio con Playwright y extrae colores, fuentes, espaciado, radios y sombras a `tokens.json`/`tokens.css`. | No se integra: es una dependencia nueva más un navegador headless. Su enfoque (estilos calculados de la página renderizada) informa la etapa D5. |
| `manavarya09/design-extract@extract-design` | 3,4 K | `npx designlang <url>`: lo mismo con Playwright y además capturas, puntuación WCAG y un Markdown pensado para modelos. | Igual que la anterior. Su salida en Markdown para un modelo es el formato que imita D4. |
| `firecrawl/firecrawl-workflows@firecrawl-website-design-clone` | 33,5 K | Usa la API de Firecrawl para capturar la página y una captura de pantalla, y escribe un `DESIGN.md`. | Se descarta: necesita una API key y un servicio de pago de terceros, contrario al enfoque local-first. Su regla de separar valores extraídos de estimados se adopta en D4. |

## 4. Etapas

Cada etapa cierra como dice `CLAUDE.md`: `format`, `typecheck` y `test` en verde, una corrida real y su nota. Para
juzgar el diseño, la corrida de cierre usa además `sonnet` u `opus`, porque `haiku` no sirve para medir calidad
visual. `inception-prompts.ts` ya tiene 212 líneas, así que lo nuevo va en archivos propios bajo `prompts/`.

### D0 · Medición base (S, ~2 h)

- Elegir 3 briefs de prueba de registros distintos (por ejemplo una herramienta interna densa, una app de consumo y
  algo lúdico) y generar sus direcciones con la versión actual.
- Guardar capturas y una rúbrica en `docs/benchmarks/`: si se distinguen entre sí, cuántos rasgos genéricos tienen
  (de la lista de `frontend-design`), si hay escala tipográfica, si se nota una metáfora, tiempo y costo.
- **Acepta:** existe la línea base con la que se compararán D1–D3.

**Estado (2026-11-12): hecho.** Medición en
[benchmarks/2026-11-12-dis-d0-direcciones-base.md](benchmarks/2026-11-12-dis-d0-direcciones-base.md), con las 9
capturas de escritorio. Con `sonnet`, cada proyecto tarda 210–285 s y cuesta 0,38–0,50 USD. En los tres briefs salen
los mismos tres arquetipos: panel SaaS, papel crema con terracota y Georgia, y una variante audaz. 7 de 9 direcciones
caen en rasgos genéricos y el mismo `#8A3B12` aparece en dos proyectos. El contenido (datos y textos) es bueno y hay
que conservarlo. Dos prototipos superan el tope de 16 000 caracteres, que no se valida. Lo que piden los hallazgos
para D1: el registro debe salir del tema y no de una plantilla, y el pie con «Simular error» y los atajos no debe
competir con la primera vista.

### D1 · Concepto y criterio estético (M, ~1 día)

- `prompts/ui-design-principles.ts`: los pasos 1–7 de la sección 2 en forma de instrucciones, más la lista de rasgos
  genéricos que hay que evitar cuando el brief no los pide.
- El esquema de cada dirección gana un `concept`: `subject`, `audience`, `primaryJob`, `register`, `metaphor`,
  `palette` (4–6 hex con nombre y rol), `type` (familias, roles y escala), `layout` (una frase y un esquema ASCII),
  `boldMove` (el único elemento memorable) y `avoidedDefaults` (qué default se descartó y por qué).
- **La app asigna el registro de cada dirección** (por ejemplo «denso y profesional», «cálido y guiado» y
  «expresivo»), en lugar de dejar que el modelo elija. Así no convergen. Si hay referencias visuales o un
  repositorio con sistema de diseño, la primera dirección los sigue, como hoy.
- `UI_RULES` pasa a ser el **piso de calidad**: los cuatro estados, la accesibilidad y los datos realistas siguen.
  Se recorta lo que consume espacio sin aportar a la decisión visual: 3 vistas en lugar de 3–5, y atajos solo donde
  sean naturales.
- La interfaz muestra el concepto de cada dirección: la metáfora, la muestra de la paleta y las tipografías.
  Textos en `labels.ts`.
- **Acepta:** frente a D0, las tres direcciones de cada brief se distinguen a simple vista y cada una declara su
  metáfora.

### D2 · Dos fases y una llamada por dirección (M, ~1 día)

- **Fase 1, conceptos:** una llamada corta devuelve los 3 `concept` y revisa cada plan contra los defaults antes de
  responder. La interfaz los muestra en cuanto llegan (en segundos), mientras se construyen los prototipos.
- **Fase 2, prototipos:** una llamada por dirección, en paralelo, que recibe su concepto. El límite sube a unos
  40 000 caracteres por prototipo.
- Si una dirección falla, las demás se conservan y la fallida ofrece «Reintentar esta dirección».
- `uiModel` prefiere `opus` para diseño cuando está disponible (`['opus', 'sonnet']`).
- `reviseUiOption` conserva el concepto y lo ajusta solo si el usuario lo pide.
- **Acepta:** el tiempo de reloj no empeora frente a D0. El costo queda medido y anotado. Una dirección fallida no
  borra las otras.

### D3 · Pasada de crítica (S–M, ~½ día)

- Por cada prototipo, una llamada recibe el HTML como texto y su concepto, y lo critica contra el concepto, la lista
  de defaults y el piso de calidad. Devuelve el HTML pulido y 3–5 cambios hechos.
- Se mide en D0/D1 si compensa hacerla siempre. Si no, queda como botón «Pulir diseño» por dirección.
- Sin captura de pantalla: la crítica visual de verdad llega con D5.
- **Acepta:** la rúbrica mejora frente a D2 y ningún prototipo pulido deja de cumplir los cuatro estados.

### D4 · Un sitio web como referencia visual (M, ~1–1,5 días)

En las referencias del inicio se añade «Añadir sitio web» con la URL, el tipo (`VISUAL` o `CONCEPTUAL`) y una nota
de qué tomar o evitar. El resto reutiliza el flujo de referencias que ya existe:

1. **Descarga en el núcleo**, con el `fetch` de Node (sin dependencias nuevas), en un adaptador
   `website-reference-fetcher.ts`:
   - Solo `https`. Se resuelve el DNS y se rechazan las direcciones privadas, de loopback, link-local, ULA y de
     metadatos. Lo mismo en cada redirección, con un máximo de 3.
   - Límites de 10 s, 1,5 MB de HTML y hasta 6 hojas de estilo del mismo sitio de 500 KB cada una. Sin cookies ni
     credenciales, con un user-agent genérico.
   - Del HTML se quitan los `<script>` antes de guardarlo.
2. **Extracción determinista de tokens**, con lógica pura y pruebas unitarias: propiedades personalizadas de CSS,
   frecuencia de colores, `font-family`, escala de `font-size`, radios, sombras, espaciados y `theme-color`. Separa lo
   extraído de lo estimado, como pide la skill de Firecrawl.
3. **Traducción a texto:** el HTML limpio, el CSS y `site-tokens.json` van a la carpeta desechable del
   `ClaudeReferenceTranslator` (que solo tiene `Read`). El resultado es una referencia `VISUAL` normal: paleta,
   tipografía, layout, densidad y tono.
4. **Regla del prompt:** se toma el registro del sitio, nunca su identidad. Nada de logos, nombres de marca, textos
   ni la composición copiada.

Límites que la interfaz explica:
- Un sitio que se pinta con JavaScript (una SPA) da pocos tokens. La traducción lo dice en `openQuestions`, y la
  interfaz sugiere adjuntar una captura de pantalla, que el traductor ya lee.
- Se avisa de que la URL se descarga desde el equipo del usuario.

**Acepta:** pruebas de integración del fetcher con un servidor local, verificando que rechaza IPs privadas,
redirecciones a ellas y respuestas demasiado grandes. Una corrida real con 2 sitios públicos cambia la dirección
principal de forma reconocible.

### D5 · Ver lo que se renderiza (requiere decisión)

Una captura de pantalla mejora dos cosas: la referencia de un sitio con JavaScript y la crítica de D3, que pasaría a
juzgar píxeles en lugar de texto. Hay dos caminos, y los dos necesitan tu decisión:

- **El Chrome o Chromium del sistema en modo headless** (`--screenshot`), por `child_process` desde la composición.
  No es una dependencia npm, pero solo funciona si está instalado.
- **Una ventana oculta de Tauri** que cargue el sitio o el prototipo endurecido y lo capture. No depende de nada
  externo, pero cuesta más en Rust y hay que probarlo por plataforma.

### D6 · Fuentes empaquetadas (requiere decisión)

- La CSP de los prototipos ya permite `font-src data:`, así que no cambia el aislamiento.
- La app incluiría 6–8 fuentes libres (OFL, subconjunto latino en woff2, unos 20–40 KB cada una) con un catálogo de
  nombre y rol. El modelo elige del catálogo, y la app inyecta el `@font-face` al endurecer el prototipo y al
  guardarlo en `docs/design/`.
- Hay que decidir qué fuentes entran y revisar sus licencias. `UI_SPEC.md` debe decir cómo usarlas en el proyecto
  real sin romper la regla de no instalar paquetes fuera del perfil.

### D7 · Salida a Claude Design (S, ~2 h)

- Botón «Diseñar en Claude Design»: copia al portapapeles un brief listo con el concepto, las respuestas, las
  referencias ya traducidas y las pantallas.
- El usuario diseña allí y vuelve con «Importar prototipo», que ya existe y acepta HTML, React o imágenes.
- No hay integración directa: no hay una API pública verificada, y depende de la sesión del usuario en claude.ai.

## 5. Orden recomendado

D0 → D1 + D2 (juntas, porque comparten el esquema) → D4 → D3 → D7. D5 y D6 esperan una decisión explícita. D5
mejoraría además D3 y D4.

## 6. Riesgos

- **Costo:** dos fases, más llamadas en paralelo, más la crítica, con Opus. Hay que medirlo en D2 y D3, y dejar
  configurable el modelo de diseño.
- **Prototipos más largos:** con más JavaScript y CSS sube el riesgo de un error de sintaxis que deje el prototipo
  en blanco. Se mantiene la regla de JavaScript legible y la crítica de D3 revisa que corra.
- **Sitios de terceros:** su contenido es dato, nunca instrucciones (marcadores y JSON inerte, como el resto de las
  referencias). Tampoco se copia su identidad.
- **El visor:** cualquier cambio en `hardenPrototype` (D6) se verifica en un navegador real, porque jsdom no prueba
  la CSP ni el sandbox.

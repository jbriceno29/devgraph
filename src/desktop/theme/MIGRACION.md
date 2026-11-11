# Migración a tokens de tema

Los tokens viven en `tokens.css` (claro en `:root`, oscuro en `[data-theme=dark]` y en `prefers-color-scheme: dark` sin `data-theme=light`). `@theme inline` los expone como clases de Tailwind (`bg-surface`, `text-fg-muted`, `border-border`, `bg-accent`, `text-status-done`, `bg-tier-1`…), que admiten opacidad (`bg-danger/10`). La variante `dark:` sigue al tema resuelto (forzado o del sistema). Preferencia: `useTheme()` de `state/theme.ts`; selector: `presentation/shell/ThemeToggle.tsx`.

## Reemplazos (apariciones en `src/desktop/**/*.tsx`, medidas con grep el 2026-11-11, sin contar ThemeToggle)

| Patrón hardcodeado | Clase semántica | Apariciones |
|---|---|---|
| `bg-[#090d18]` | `bg-surface` | 2 |
| `bg-slate-950`, `bg-slate-950/xx` | `bg-surface` (fondos de página) o `bg-surface-sunken` (pozos, inputs) | 40 |
| `bg-slate-900`, `bg-slate-900/xx` | `bg-surface-raised` (tarjetas, paneles) / `bg-surface-sunken` | 18 |
| `bg-slate-800` (hover/seleccionado) | `bg-border` o `bg-surface-sunken` | 9 |
| `border-slate-800` | `border-border` | 56 |
| `border-slate-700` | `border-border-strong` | 31 |
| `border-slate-600/500` | `border-border-strong` (o `border-fg-subtle` si es control) | 7 |
| `text-slate-50/100/200`, `text-white` | `text-fg` | 70 |
| `text-slate-300/400` | `text-fg-muted` | 71 |
| `text-slate-500/600` | `text-fg-subtle` | 84 |
| `bg-cyan-400/500` + `text-slate-950` | `bg-accent text-accent-fg` | 10 (bg) / 11 (text-slate-950) |
| otros `text/border/bg/ring-cyan-*` | `text-accent`, `border-accent`, `bg-accent/10`, `bg-accent-soft` | 44 (incluye los 10 anteriores) |
| `focus*:…-cyan-*` | `focus-visible:outline-accent` / `ring-accent` | 29 |
| `…-rose-*` | `text-danger`, `border-danger/40`, `bg-danger/10` o `bg-danger-soft` | 32 |
| `…-emerald-*` | `success` con los mismos modificadores | 23 |
| `…-amber-*` | `warning` con los mismos modificadores | 11 |
| `hover:…-slate-*` | `hover:bg-surface-sunken`, `hover:text-fg`, `hover:border-border-strong` | 13 |
| `placeholder:text-slate-*` | `placeholder:text-fg-subtle` | 2 |

Notas: los recuentos de texto incluyen variantes con prefijo (`hover:text-slate-100` cuenta en `text-slate-100`). Mantener los modificadores de opacidad (`/10`, `/40`…): funcionan con los tokens. En claro, `bg-x/10` sobre blanco es muy tenue; para avisos usar `bg-*-soft`.

## Excepciones que requieren mano

- **violet / purple / indigo (14) y pink / fuchsia (6)**: piloto automático y flujo de contexto. No hay token genérico; usar `status-in-review` (violeta) para el piloto y `tier-1` (rosa) para el contexto, o añadir tokens `--pilot*` si hace falta.
- **Hex en JS (55, en WorkspaceShell, DocumentsPanel y GraphCanvas)**: el lienzo SVG usa `tones`, `statusLook` y `tierLook` con hex. Sustituir por `var(--node-<tipo>-fill|stroke)` (tipo en kebab-case: `project-root`, `work-item`, `decision-record`, `code-reference`…), `var(--status-<estado>)` (`ready`, `in-progress`, `in-review`, `done`, `blocked`, `draft`, `archived`; REMOVED usa `archived`), `var(--tier-N)`, `var(--node-fg)` (título del nodo), `var(--node-selected)`, `var(--node-ghost-fill|stroke)`, `var(--edge)`, `var(--edge-cross)`, `var(--edge-label)`. Preferir `style={{fill:'var(--x)'}}` a atributos de presentación. Colores sueltos sin token (`#a5b4fc` progreso, `#c4b5fd` piloto): usar `--node-feature-stroke` y `--status-in-review`.
- **Fondo de puntos del grafo**: `bg-[radial-gradient(#334155_…)]` → `bg-[radial-gradient(var(--grid-dot)_0.7px,transparent_0.7px)]`.
- **`.markdown-preview`, `::selection` y `.approval-dialog::backdrop` en `styles.css`**: hex fijos; pasar a `var(--fg-muted)`, `var(--fg)`, `var(--border)`, `var(--surface-sunken)`, `var(--accent)`, `var(--accent-soft)`.
- **Clases construidas con template strings** (``className={`…${cond?'a':'b'}`}``, 8 en WorkspaceShell, ExecutionReview, DocumentsPanel ×3, ExecutionPolicyForm, GraphCanvas, PlanningWorkspace): un codemod por regex debe revisar ambas ramas de cada ternario; no suponer que la clase completa está en un literal.
- **Mapas de clases por estado** (p. ej. objetos `{DONE:'text-emerald-…'}`): migrar a `text-status-*` para que coincidan con el grafo.

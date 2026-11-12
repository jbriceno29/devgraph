/** Clases compartidas: foco visible, controles de 36 px y un único estilo de botón primario (bg-accent). */
export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
export const control = `min-h-9 w-full rounded-lg border border-border-strong bg-surface-sunken px-3 text-xs text-fg placeholder:text-fg-subtle ${focusRing}`;
export const primary = `rounded-lg bg-accent px-4 font-semibold text-accent-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`;
export const secondary = `rounded-lg border border-border-strong px-3 text-fg hover:border-accent disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
export const danger = `rounded-lg border border-danger/50 px-3 text-danger hover:bg-danger-soft disabled:opacity-50 ${focusRing}`;

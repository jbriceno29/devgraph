/** Convierte un error crudo (Error, texto del núcleo, objeto IPC) en un mensaje en español; el original queda como detalle. */
export interface ReadableError {
  message: string;
  detail: string | null;
}
const rules: Array<[RegExp, string]> = [
  [
    /not a git repository|no es un repositorio git/i,
    'La carpeta no es un repositorio Git. Elige la carpeta que contiene «.git».',
  ],
  [/ENOENT|no such file or directory/i, 'No se encontró la carpeta o el archivo indicado.'],
  [/EACCES|EPERM|permission denied/i, 'La app no tiene permiso para leer o escribir en esa ubicación.'],
  [
    /hash mismatch|stale|expected content hash|modified externally/i,
    'El documento cambió fuera de la app. Recárgalo antes de guardar.',
  ],
  [
    /ECONNREFUSED|Failed to fetch|__TAURI|ipc channel|invoke.*(failed|error)/i,
    'No se pudo comunicar con el núcleo de la app. Vuelve a intentarlo.',
  ],
  [/timed out|ETIMEDOUT/i, 'La operación tardó demasiado y se canceló.'],
  [/SQLITE_/, 'La base de datos local rechazó la operación.'],
  [/Unexpected token|JSON\.parse|is not valid JSON|Unexpected end of JSON/i, 'El JSON no es válido.'],
];
export function readableError(reason: unknown): ReadableError {
  const raw =
    (reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : reason && typeof reason === 'object' && 'message' in reason
          ? String((reason as { message: unknown }).message)
          : (() => {
              try {
                return JSON.stringify(reason);
              } catch {
                return String(reason);
              }
            })()) ?? '';
  const text = raw.replace(/^(Uncaught )?(\w*Error):\s*/, '').trim();
  const rule = rules.find(([pattern]) => pattern.test(text));
  if (rule) return { message: rule[1], detail: text || null };
  return { message: text || 'Algo salió mal. Vuelve a intentarlo.', detail: null };
}
export const errorText = (reason: unknown) => readableError(reason).message;
/** Aviso de error: mensaje legible y, plegado, el detalle técnico para quien lo necesite. */
export function ErrorNotice({ error, className = '' }: { error: unknown; className?: string }) {
  if (error === null || error === undefined || error === '') return null;
  const { message, detail } = readableError(error);
  return (
    <div
      role="alert"
      className={`rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger ${className}`}
    >
      <p className="whitespace-pre-wrap">{message}</p>
      {detail && (
        <details className="mt-1">
          <summary className="cursor-pointer py-1 text-[11px] text-fg-muted">Detalles técnicos</summary>
          <p className="mt-1 break-words font-mono text-[11px] text-fg-muted">{detail}</p>
        </details>
      )}
    </div>
  );
}

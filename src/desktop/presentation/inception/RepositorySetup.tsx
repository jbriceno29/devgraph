import { useId, useState, type FormEvent } from 'react';
import type { InceptionIpcClient, InitializeRepositoryResultDto } from '../../../shared/contracts/inception-view.js';
import { normalizeRepositoryPath, validateRepositoryPath } from '../documents/DocumentsPanel.js';
import { ErrorNotice } from '../errors.js';
import { control, focusRing, secondary } from '../ui.js';

/** null si la ruta sirve para una carpeta nueva; si no, el motivo (mismas reglas que Documentos). */
export function validateNewRepositoryPath(path: string): string | null {
  return path ? validateRepositoryPath(path) : 'Escribe la ruta de la carpeta donde quieres el repositorio nuevo.';
}

/** Aviso tras crear el repositorio. */
export const RepositoryCreated = ({ result }: { result: InitializeRepositoryResultDto }) => (
  <p role="status" className="rounded-lg border border-success/50 bg-success-soft px-3 py-2 text-xs text-fg">
    Repositorio creado en <code className="font-mono">{result.localPath}</code> con el commit inicial{' '}
    <code className="font-mono">{result.initialCommit.slice(0, 7)}</code>
    {result.files.length ? ` (${result.files.join(', ')})` : ''}.
  </p>
);

/** Crea un repositorio Git nuevo (carpeta nueva o vacía) con `initializeRepository`; ofrece conectar uno existente en Documentos. */
export function RepositorySetup({
  projectId,
  client,
  onCreated,
  onConnectExisting,
}: {
  projectId: string;
  client: InceptionIpcClient;
  onCreated(result: InitializeRepositoryResultDto): void;
  onConnectExisting(): void;
}) {
  const id = useId();
  const [path, setPath] = useState(''),
    [pathError, setPathError] = useState<string | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeRepositoryPath(path),
      invalid = validateNewRepositoryPath(normalized);
    setPathError(invalid);
    setError(null);
    if (invalid) return;
    setBusy(true);
    try {
      const result = await client.initializeRepository(projectId, normalized);
      setPath('');
      onCreated(result);
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <p className="text-xs leading-5 text-fg-muted">
        La app crea la carpeta (o usa una vacía), ejecuta{' '}
        <code className="rounded bg-surface-sunken px-1">git init</code> y hace un primer commit con{' '}
        <code className="rounded bg-surface-sunken px-1">README.md</code>,{' '}
        <code className="rounded bg-surface-sunken px-1">.gitignore</code> y{' '}
        <code className="rounded bg-surface-sunken px-1">docs/</code>. No añade remotos ni instala nada.
      </p>
      <div>
        <label htmlFor={`${id}-path`} className="mb-1 block text-xs text-fg-muted">
          Ruta de la carpeta nueva o vacía
        </label>
        <input
          id={`${id}-path`}
          value={path}
          onChange={event => {
            setPath(event.target.value);
            setPathError(null);
          }}
          aria-invalid={pathError ? true : undefined}
          aria-describedby={`${id}-help${pathError ? ` ${id}-error` : ''}`}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          placeholder="/home/ana/proyectos/mi-app"
          className={`${control} min-h-10 font-mono ${pathError ? 'border-danger' : ''}`}
        />
        <div id={`${id}-help`} className="mt-1.5 space-y-0.5 text-[11px] text-fg-muted">
          <p>Ruta absoluta; si la carpeta existe, debe estar vacía. Por ejemplo:</p>
          <ul className="font-mono text-fg-subtle">
            <li>Linux: /home/ana/proyectos/mi-app</li>
            <li>macOS: /Users/ana/proyectos/mi-app</li>
            <li>Windows: C:\Users\ana\proyectos\mi-app</li>
          </ul>
        </div>
        {pathError && (
          <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs text-danger">
            {pathError}
          </p>
        )}
      </div>
      <ErrorNotice error={error} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="submit" disabled={busy} className={`min-h-9 text-xs ${secondary}`}>
          {busy ? 'Creando el repositorio…' : 'Crear el repositorio'}
        </button>
        <button
          type="button"
          onClick={onConnectExisting}
          className={`min-h-9 rounded px-1 text-xs text-accent underline-offset-2 hover:underline ${focusRing}`}
        >
          Ya tengo uno: conectarlo en Documentos
        </button>
      </div>
    </form>
  );
}

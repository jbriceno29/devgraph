import { useCallback, useEffect, useState } from 'react';
import type { CommandRunDto, ProjectScriptsDto } from '../../../shared/contracts/agent-view.js';
import { errorText } from '../errors.js';
import { control, focusRing, primary, secondary } from '../ui.js';

const STATUS: Record<CommandRunDto['status'], string> = {
  PREPARING: 'Preparando',
  RUNNING: 'En marcha',
  EXITED: 'Terminó bien',
  FAILED: 'Falló',
  STOPPED: 'Detenido',
};
/** Scripts first in this order, then the rest alphabetically: the usual ones are what people reach for. */
const USUAL = ['dev', 'start', 'test', 'build', 'preview', 'lint', 'typecheck'];

/**
 * The project's own commands (npm test, npm run dev, build…) on any branch: each run gets its own copy of the branch
 * with the dependencies installed, streams its output and shows the dev server's address. The user's folder is not touched.
 */
export function ProjectCommandsPanel({ projectId }: { projectId: string }) {
  const queries = window.workspaceIpc.queries,
    commands = window.workspaceIpc.commands,
    events = window.workspaceIpc.events;
  const [refs, setRefs] = useState<string[]>([]);
  const [ref, setRef] = useState('');
  const [scripts, setScripts] = useState<ProjectScriptsDto | null>(null);
  const [runs, setRuns] = useState<CommandRunDto[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const supported = Boolean(
    queries.getCommandRefs && queries.getProjectScripts && queries.listCommands && commands.startCommand,
  );

  useEffect(() => {
    if (!supported) return;
    let current = true;
    void Promise.all([queries.getCommandRefs!(projectId), queries.listCommands!(projectId)])
      .then(([result, list]) => {
        if (!current) return;
        setRefs(result.refs);
        setRef(value => value || result.current || result.refs[0] || '');
        setRuns(list);
        setSelected(value => value ?? list[0]?.id ?? null);
      })
      .catch(reason => current && setError(errorText(reason)));
    return () => {
      current = false;
    };
  }, [projectId, supported, queries]);

  useEffect(() => {
    if (!supported || !ref) return;
    let current = true;
    setScripts(null);
    void queries.getProjectScripts!(projectId, ref)
      .then(result => current && setScripts(result))
      .catch(reason => current && setError(errorText(reason)));
    return () => {
      current = false;
    };
  }, [projectId, ref, supported, queries]);

  const upsert = useCallback(
    (run: CommandRunDto) => setRuns(list => [run, ...list.filter(item => item.id !== run.id)]),
    [],
  );
  useEffect(() => {
    const offUpdated = events.onCommandUpdated?.(event => {
      if (event.projectId === projectId) upsert(event.run);
    });
    const offOutput = events.onCommandOutput?.(event => {
      if (event.projectId !== projectId) return;
      setRuns(list =>
        list.map(run =>
          run.id === event.runId ? { ...run, output: (run.output + event.chunk).slice(-200_000) } : run,
        ),
      );
    });
    return () => {
      offUpdated?.();
      offOutput?.();
    };
  }, [projectId, events, upsert]);

  if (!supported)
    return (
      <p className="text-xs text-fg-muted">Esta versión de la aplicación no puede correr comandos del proyecto.</p>
    );

  const start = async (script: string) => {
    setError(null);
    try {
      const run = await commands.startCommand!(projectId, { ref, script });
      upsert(run);
      setSelected(run.id);
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  const stop = async (runId: string) => {
    try {
      upsert(await commands.stopCommand!(projectId, runId));
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  const names = Object.keys(scripts?.scripts ?? {}).sort((a, b) => {
    const rank = (name: string) => (USUAL.includes(name) ? USUAL.indexOf(name) : USUAL.length);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  const run = runs.find(item => item.id === selected) ?? null;
  const active = (item: CommandRunDto) => item.status === 'PREPARING' || item.status === 'RUNNING';

  return (
    <section aria-label="Comandos del proyecto" className="space-y-3 text-xs text-fg">
      <p className="text-fg-muted">
        Corre los scripts del proyecto en una copia de la rama que elijas, con sus dependencias instaladas. Tu carpeta
        no se toca y la copia se borra al terminar.
      </p>
      <div className="grid gap-2 sm:grid-cols-[minmax(10rem,16rem)_1fr] sm:items-end">
        <div>
          <label htmlFor="commands-ref" className="mb-1 block text-[11px] font-medium text-fg-muted">
            Rama
          </label>
          <select id="commands-ref" value={ref} onChange={event => setRef(event.target.value)} className={control}>
            {refs.map(item => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Scripts">
          {scripts && !scripts.manager && <span className="text-fg-muted">Esta rama no tiene package.json.</span>}
          {scripts?.manager && !names.length && <span className="text-fg-muted">package.json no define scripts.</span>}
          {names.map(name => (
            <button
              key={name}
              type="button"
              title={scripts!.scripts[name]}
              className={`${secondary} min-h-9`}
              onClick={() => void start(name)}
            >
              {scripts!.manager} run {name}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {runs.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-[minmax(12rem,18rem)_1fr]">
          <ul className="space-y-1" aria-label="Comandos lanzados">
            {runs.map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setSelected(item.id)}
                  aria-current={item.id === selected}
                  className={`w-full rounded-lg border px-3 py-2 text-left ${focusRing} ${item.id === selected ? 'border-accent bg-accent-soft' : 'border-border bg-surface'}`}
                >
                  <span className="block font-mono text-[11px]">{item.command}</span>
                  <span className="text-[11px] text-fg-muted">
                    {item.ref} · {STATUS[item.status]}
                    {item.exitCode !== null && item.status !== 'EXITED' ? ` (código ${item.exitCode})` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {run && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{run.command}</span>
                <span className="rounded-full bg-surface-raised px-2 py-0.5 text-[11px] text-fg-muted">
                  {STATUS[run.status]}
                </span>
                {active(run) && (
                  <button type="button" className={`${primary} min-h-9`} onClick={() => void stop(run.id)}>
                    Detener
                  </button>
                )}
              </div>
              {run.url && active(run) && (
                <p className="flex flex-wrap items-center gap-2">
                  Servidor en{' '}
                  <a
                    href={run.url}
                    target="_blank"
                    rel="noreferrer"
                    className={`font-mono text-accent underline ${focusRing}`}
                  >
                    {run.url}
                  </a>
                  <button
                    type="button"
                    className={`${secondary} min-h-9`}
                    onClick={() =>
                      void navigator.clipboard?.writeText(run.url!).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      })
                    }
                  >
                    {copied ? 'Copiado' : 'Copiar'}
                  </button>
                  <span className="text-[11px] text-fg-muted">Ábrelo en tu navegador.</span>
                </p>
              )}
              <pre
                aria-label="Salida"
                aria-live="polite"
                className="max-h-96 overflow-auto rounded-lg border border-border bg-surface-sunken p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-fg-muted"
              >
                {run.output || 'Sin salida todavía.'}
              </pre>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

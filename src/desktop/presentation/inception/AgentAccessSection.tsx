import { useId, useState } from 'react';
import type {
  AgentAccessDto,
  AgentAccessEditDto,
  AgentAccessReason,
} from '../../../shared/contracts/repository-scan.js';
import { control, focusRing, secondary } from '../ui.js';

export const ACCESS_REASON: Record<AgentAccessReason, string> = {
  CODE: 'código y recursos',
  TESTS: 'pruebas',
  CONFIG: 'configuración de la raíz',
  GENERATED: 'lo que la app genera al instalar y compilar',
  USER: 'añadida por ti',
};

/**
 * Plan REP, R1: «Qué podrá tocar el agente» — the paths it may write and the checks that verify its work, as the
 * proposal will save them in the policy. With `onChange` the user removes or adds paths and edits the checks.
 */
export function AgentAccessSection({
  access,
  edit,
  onChange,
}: {
  access: AgentAccessDto;
  edit?: AgentAccessEditDto | null;
  onChange?(edit: AgentAccessEditDto | null): void;
}) {
  const id = useId();
  const reasons = new Map(access.writable.map(path => [path.pattern, path.reason]));
  const paths = edit?.writablePaths ?? access.writable.map(path => path.pattern),
    commands = edit?.verificationCommands ?? access.verificationCommands;
  const change = onChange
    ? (next: Partial<AgentAccessEditDto>) => onChange({ writablePaths: paths, verificationCommands: commands, ...next })
    : undefined;
  return (
    <section aria-labelledby={`${id}-title`} className="rounded-lg border border-border bg-surface-raised p-3 text-xs">
      <h3 id={`${id}-title`} className="font-semibold text-fg">
        Qué podrá tocar el agente
      </h3>
      <p className="mt-1 text-fg-muted">
        Al aprobar, estas rutas quedan como las que el agente puede escribir: lo que toque fuera de ellas se revierte al
        revisar su trabajo. <code className="font-mono">.env*</code> y <code className="font-mono">.git/config</code>{' '}
        siguen prohibidas.
      </p>
      <PathList paths={paths} reasons={reasons} onChange={change && (writablePaths => change({ writablePaths }))} />
      <p className="mt-3 font-medium text-fg">Comprobaciones al terminar cada tarea</p>
      <Checks commands={commands} onChange={change && (verificationCommands => change({ verificationCommands }))} />
      {onChange && (edit || access.edited) && (
        <button type="button" onClick={() => onChange(null)} className={`mt-2 min-h-8 px-3 text-xs ${secondary}`}>
          Volver a lo que se detectó
        </button>
      )}
    </section>
  );
}

function PathList({
  paths,
  reasons,
  onChange,
}: {
  paths: string[];
  reasons: Map<string, AgentAccessReason>;
  onChange?: ((paths: string[]) => void) | undefined;
}) {
  return (
    <>
      <ul aria-label="Rutas que puede escribir el agente" className="mt-2 space-y-1">
        {paths.map(path => (
          <li key={path} className="flex items-center gap-2">
            <code className="font-mono text-fg">{path}</code>
            <span className="text-fg-muted">· {ACCESS_REASON[reasons.get(path) ?? 'USER']}</span>
            {onChange && (
              <button
                type="button"
                aria-label={`Quitar ${path}`}
                onClick={() => onChange(paths.filter(item => item !== path))}
                disabled={paths.length === 1}
                className={`ml-auto min-h-7 rounded px-2 text-fg-muted hover:text-danger disabled:opacity-40 ${focusRing}`}
              >
                Quitar
              </button>
            )}
          </li>
        ))}
      </ul>
      {onChange && <AddPath onAdd={path => !paths.includes(path) && onChange([...paths, path])} />}
    </>
  );
}

function AddPath({ onAdd }: { onAdd(path: string): void }) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const add = () => {
    const value = draft.trim().replace(/^\.\//, '');
    if (value) onAdd(value);
    setDraft('');
  };
  return (
    <div className="mt-2 flex gap-2">
      <label htmlFor={`${id}-add`} className="sr-only">
        Añadir una ruta
      </label>
      <input
        id={`${id}-add`}
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          add();
        }}
        placeholder="Por ejemplo: server/** o next.config.mjs"
        className={control}
      />
      <button type="button" onClick={add} className={`min-h-9 shrink-0 px-3 text-xs ${secondary}`}>
        Añadir
      </button>
    </div>
  );
}

function Checks({ commands, onChange }: { commands: string[]; onChange?: ((commands: string[]) => void) | undefined }) {
  const id = useId();
  if (onChange)
    return (
      <>
        <label htmlFor={`${id}-checks`} className="mt-1 block text-fg-muted">
          Una por línea, de los scripts que ya tiene el proyecto. Sin tuberías ni instalaciones.
        </label>
        <textarea
          id={`${id}-checks`}
          rows={Math.max(2, commands.length)}
          value={commands.join('\n')}
          onChange={event => onChange(event.target.value.split('\n'))}
          className={`${control} mt-1 font-mono`}
        />
      </>
    );
  return commands.length ? (
    <ul className="mt-1 list-disc pl-5 font-mono text-fg">
      {commands.map(command => (
        <li key={command}>{command}</li>
      ))}
    </ul>
  ) : (
    <p className="mt-1 text-warning">
      El repositorio no define scripts de pruebas: sin comprobaciones nada se acepta solo.
    </p>
  );
}

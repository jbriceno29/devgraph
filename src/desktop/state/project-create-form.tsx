import { useState, type FormEvent } from 'react';
import { control, primary } from '../presentation/ui.js';
export function ProjectCreateForm({
  onCreate,
  disabled,
}: {
  onCreate(input: { name: string; slug: string }): Promise<void>;
  disabled: boolean;
}) {
  const [name, setName] = useState(''),
    [error, setError] = useState('');
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !slug) {
      setError('Escribe un nombre con al menos una letra o número.');
      return;
    }
    setError('');
    await onCreate({ name: name.trim(), slug });
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl border border-border bg-surface-raised p-5">
      <div>
        <h2 className="text-sm font-semibold text-fg">Crear proyecto</h2>
        <p className="mt-1 text-xs text-fg-muted">
          Se creará una base local con el elemento raíz del proyecto. Después, el asistente de inicio te ayudará a
          definir el objetivo, el stack y el plan.
        </p>
      </div>
      <div>
        <label htmlFor="project-name" className="mb-1.5 block text-xs text-fg-muted">
          Nombre del proyecto
        </label>
        <input
          id="project-name"
          value={name}
          onChange={e => {
            setName(e.target.value);
            setError('');
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={`project-slug${error ? ' project-name-error' : ''}`}
          placeholder="Mi proyecto"
          className={`${control} min-h-10 text-sm`}
        />
      </div>
      <p id="project-slug" className="text-[11px] text-fg-muted">
        Identificador: <code className="text-fg">{slug || 'nombre-del-proyecto'}</code>
      </p>
      {error && (
        <p id="project-name-error" role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <button disabled={disabled} className={`min-h-10 w-full text-sm ${primary}`}>
        Crear proyecto
      </button>
    </form>
  );
}

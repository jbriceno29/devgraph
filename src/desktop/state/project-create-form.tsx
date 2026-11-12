import { useEffect, useId, useState, type FormEvent } from 'react';
import type { AppSettingsDto, CreateProjectInput, FolderInspectionDto } from '../../shared/contracts/ipc-contracts.js';
import { FolderField, folderName, joinFolder } from '../presentation/FolderField.js';
import { ErrorNotice } from '../presentation/errors.js';
import { control, focusRing, primary } from '../presentation/ui.js';

export const slugify = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const INSPECT_DELAY_MS = 250;

/** Lo que hay en una ruta, consultado al núcleo con un pequeño retraso mientras el usuario escribe (null: sin datos). */
function useFolderInspection(path: string): { folder: FolderInspectionDto | null; error: string | null } {
  const [state, setState] = useState<{ path: string; folder: FolderInspectionDto | null; error: string | null }>({
    path: '',
    folder: null,
    error: null,
  });
  useEffect(() => {
    const inspect = window.workspaceIpc?.queries?.inspectFolder;
    if (!path || !inspect) return;
    let live = true;
    const timer = setTimeout(() => {
      inspect(path)
        .then(folder => live && setState({ path, folder, error: null }))
        .catch(
          reason =>
            live && setState({ path, folder: null, error: reason instanceof Error ? reason.message : String(reason) }),
        );
    }, INSPECT_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [path]);
  return state.path === path ? { folder: state.folder, error: state.error } : { folder: null, error: null };
}

/**
 * Pantalla inicial sin proyecto abierto: si la app aún no sabe dónde guardas tus proyectos, lo pregunta primero
 * (paso 1); después, crear un proyecto es darle un nombre (paso 2). Con un núcleo antiguo, el formulario de siempre.
 */
export function ProjectSetup({
  onCreate,
  disabled,
}: {
  onCreate(input: CreateProjectInput): Promise<void>;
  disabled: boolean;
}) {
  const supported = Boolean(
    window.workspaceIpc?.queries?.getAppSettings && window.workspaceIpc?.commands?.setProjectsFolder,
  );
  const [settings, setSettings] = useState<AppSettingsDto | null>(null),
    [loadError, setLoadError] = useState<unknown>(null),
    [changing, setChanging] = useState(false),
    // Right after choosing the folder for the first time, the form is the wizard's second step.
    [wizard, setWizard] = useState(false);
  useEffect(() => {
    if (!supported) return;
    let live = true;
    window.workspaceIpc.queries.getAppSettings!()
      .then(next => live && setSettings(next))
      .catch(reason => live && setLoadError(reason));
    return () => {
      live = false;
    };
  }, [supported]);
  if (!supported || loadError) return <ProjectCreateForm folder={null} onCreate={onCreate} disabled={disabled} />;
  if (!settings) return <p className="text-sm text-fg-muted">Cargando…</p>;
  if (!settings.projectsFolder || changing)
    return (
      <ProjectsFolderStep
        settings={settings}
        firstRun={!settings.projectsFolder}
        onSaved={next => {
          setWizard(!settings.projectsFolder);
          setSettings(next);
          setChanging(false);
        }}
        {...(settings.projectsFolder ? { onCancel: () => setChanging(false) } : {})}
      />
    );
  return (
    <ProjectCreateForm
      folder={settings.projectsFolder}
      onChangeFolder={() => setChanging(true)}
      eyebrow={wizard ? 'Paso 2 de 2 · Tu primer proyecto' : 'Nuevo proyecto'}
      onCreate={onCreate}
      disabled={disabled}
    />
  );
}

/** Paso 1: la carpeta donde vive cada proyecto (una subcarpeta por proyecto), con una sugerencia. */
export function ProjectsFolderStep({
  settings,
  firstRun,
  onSaved,
  onCancel,
}: {
  settings: AppSettingsDto;
  firstRun: boolean;
  onSaved(settings: AppSettingsDto): void;
  onCancel?(): void;
}) {
  const id = useId();
  const [path, setPath] = useState(settings.projectsFolder ?? settings.suggestion.path),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const { suggestion } = settings;
  const trimmed = path.trim();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed) {
      setError('Elige o escribe la carpeta donde guardas tus proyectos.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await window.workspaceIpc.commands.setProjectsFolder!(trimmed));
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby={`${id}-title`}
      className="space-y-4 rounded-2xl border border-border bg-surface-raised p-5"
    >
      <div>
        {firstRun && (
          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">Paso 1 de 2 · Tu espacio</p>
        )}
        <h2 id={`${id}-title`} className="mt-1 text-sm font-semibold text-fg">
          ¿En qué carpeta guardas tus proyectos?
        </h2>
        <p className="mt-1 text-xs leading-5 text-fg-muted">
          Cada proyecto será una carpeta nueva dentro de ella, con su propio repositorio Git. Lo normal es usar la
          carpeta donde ya tienes tus repositorios.
        </p>
      </div>
      <FolderField
        id={`${id}-folder`}
        label="Carpeta de proyectos"
        value={path}
        onChange={next => {
          setPath(next);
          setError(null);
        }}
        pickerTitle="Carpeta donde guardas tus proyectos"
        defaultPath={suggestion.path}
        disabled={busy}
        help={
          <>
            {trimmed === suggestion.path && (
              <p>
                {suggestion.repositoryCount > 0
                  ? `Te la proponemos porque ya tiene ${suggestion.repositoryCount} ${suggestion.repositoryCount === 1 ? 'repositorio' : 'repositorios'}.`
                  : suggestion.exists
                    ? 'Te la proponemos porque ya existe y es donde suelen ir los proyectos.'
                    : 'No existe todavía: la app la creará.'}
              </p>
            )}
            {trimmed && (
              <p>
                Por ejemplo, un proyecto «Mi tienda» quedará en{' '}
                <code className="font-mono text-fg">{joinFolder(trimmed, 'mi-tienda')}</code>.
              </p>
            )}
          </>
        }
      />
      {error !== null && <ErrorNotice error={error} />}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={`min-h-10 flex-1 text-sm ${primary}`}>
          {busy ? 'Guardando…' : 'Usar esta carpeta'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={`min-h-10 rounded-lg px-3 text-sm text-fg-muted hover:text-fg ${focusRing}`}
          >
            Cancelar
          </button>
        )}
      </div>
      <p className="text-[11px] text-fg-subtle">Puedes cambiarla después; los proyectos que ya creaste no se mueven.</p>
    </form>
  );
}

type Mode = 'NEW_FOLDER' | 'EXISTING_REPOSITORY';

/**
 * Paso 2: crear un proyecto. Con carpeta de proyectos: uno nuevo va en `<carpeta>/<identificador>` (la app hace `git init`),
 * o se conecta un repositorio que ya existe. Sin ella (núcleo antiguo), solo nombre e identificador, como antes.
 */
export function ProjectCreateForm({
  folder,
  onChangeFolder,
  eyebrow,
  onCreate,
  disabled,
}: {
  folder: string | null;
  onChangeFolder?(): void;
  /** Small line above the title (which step of the welcome wizard, or just «Nuevo proyecto»). */
  eyebrow?: string;
  onCreate(input: CreateProjectInput): Promise<void>;
  disabled: boolean;
}) {
  const id = useId();
  const [mode, setMode] = useState<Mode>('NEW_FOLDER'),
    [name, setName] = useState(''),
    [nameTouched, setNameTouched] = useState(false),
    [existingPath, setExistingPath] = useState(''),
    [error, setError] = useState(''),
    [submitError, setSubmitError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const slug = slugify(name);
  const located = folder !== null;
  const target = !located ? '' : mode === 'NEW_FOLDER' ? (slug ? joinFolder(folder, slug) : '') : existingPath.trim();
  const { folder: inspected, error: inspectError } = useFolderInspection(target);
  const problem = !located || !target ? null : locationProblem(mode, inspected, inspectError);
  const pickExisting = (path: string) => {
    setExistingPath(path);
    setSubmitError(null);
    if (!nameTouched) setName(folderName(path.trim()));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    if (located && mode === 'EXISTING_REPOSITORY' && !existingPath.trim()) {
      setError('Elige la carpeta del repositorio.');
      return;
    }
    if (!name.trim() || !slug) {
      setError('Escribe un nombre con al menos una letra o número.');
      return;
    }
    if (problem) return;
    setError('');
    setBusy(true);
    try {
      await onCreate({
        name: name.trim(),
        slug,
        ...(located ? { location: { mode, path: target } } : {}),
      });
    } catch (reason) {
      setSubmitError(reason);
    } finally {
      setBusy(false);
    }
  };
  const nameField = (
    <div>
      <label htmlFor={`${id}-name`} className="mb-1.5 block text-xs text-fg-muted">
        Nombre del proyecto
      </label>
      <input
        id={`${id}-name`}
        value={name}
        onChange={event => {
          setName(event.target.value);
          setNameTouched(true);
          setError('');
          setSubmitError(null);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-slug${error ? ` ${id}-error` : ''}`}
        placeholder="Mi proyecto"
        className={`${control} min-h-10 text-sm`}
      />
      <p id={`${id}-slug`} className="mt-1.5 text-[11px] text-fg-muted">
        Identificador: <code className="text-fg">{slug || 'nombre-del-proyecto'}</code>
      </p>
    </div>
  );
  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl border border-border bg-surface-raised p-5">
      <div>
        {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">{eyebrow}</p>}
        <h2 className="mt-1 text-sm font-semibold text-fg">Crear proyecto</h2>
        <p className="mt-1 text-xs text-fg-muted">
          {located
            ? 'Después, el asistente de inicio te ayudará a definir el objetivo, el stack y el plan.'
            : 'Se creará una base local con el elemento raíz del proyecto. Después, el asistente de inicio te ayudará a definir el objetivo, el stack y el plan.'}
        </p>
      </div>
      {located && (
        <fieldset>
          <legend className="sr-only">Dónde está el código</legend>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-surface-sunken p-1">
            {(
              [
                ['NEW_FOLDER', 'Proyecto nuevo'],
                ['EXISTING_REPOSITORY', 'Ya tengo el código'],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className={`flex min-h-9 cursor-pointer items-center justify-center rounded-md px-2 text-xs has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${mode === value ? 'bg-surface-raised font-semibold text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`}
              >
                <input
                  type="radio"
                  name={`${id}-mode`}
                  value={value}
                  checked={mode === value}
                  onChange={() => {
                    setMode(value);
                    setError('');
                    setSubmitError(null);
                  }}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {located && mode === 'EXISTING_REPOSITORY' && (
        <FolderField
          id={`${id}-existing`}
          label="Carpeta del repositorio"
          value={existingPath}
          onChange={pickExisting}
          pickerTitle="Carpeta con el código del proyecto"
          defaultPath={folder}
          placeholder={joinFolder(folder, 'mi-app')}
          error={problem}
          help="Debe contener un repositorio Git (.git). El asistente leerá su estructura y partirá de lo que existe; no cambia tu código hasta que apruebes el plan."
        />
      )}
      {nameField}
      {located && mode === 'NEW_FOLDER' && slug && (
        <LocationPreview
          path={target}
          folder={inspected}
          problem={problem}
          onUseExisting={() => {
            setMode('EXISTING_REPOSITORY');
            setExistingPath(target);
          }}
        />
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {submitError !== null && <ErrorNotice error={submitError} />}
      <button disabled={disabled || busy || Boolean(problem)} className={`min-h-10 w-full text-sm ${primary}`}>
        {busy
          ? 'Creando…'
          : mode === 'EXISTING_REPOSITORY' && located
            ? 'Crear proyecto con este código'
            : 'Crear proyecto'}
      </button>
      {located && onChangeFolder && (
        <p className="text-[11px] text-fg-muted">
          Carpeta de proyectos: <code className="font-mono text-fg">{folder}</code> ·{' '}
          <button
            type="button"
            onClick={onChangeFolder}
            className={`text-accent underline-offset-2 hover:underline ${focusRing}`}
          >
            Cambiar
          </button>
        </p>
      )}
    </form>
  );
}

/** Por qué no se puede crear el proyecto en esa ruta (null: se puede, o aún no se sabe). */
function locationProblem(mode: Mode, folder: FolderInspectionDto | null, inspectError: string | null): string | null {
  if (inspectError) return inspectError;
  if (!folder) return null;
  if (mode === 'EXISTING_REPOSITORY') {
    if (!folder.exists) return 'Esa carpeta no existe.';
    if (!folder.isDirectory) return 'Esa ruta no es una carpeta.';
    if (!folder.isGitRepository)
      return 'Esa carpeta no es un repositorio Git (no tiene «.git»). Elige la carpeta que lo contiene.';
    return null;
  }
  if (!folder.parentExists) return 'La carpeta de proyectos ya no existe. Cámbiala.';
  if (folder.exists && !folder.isDirectory) return 'Ya existe un archivo con ese nombre. Usa otro nombre.';
  if (folder.exists && !folder.empty)
    return folder.isGitRepository
      ? 'Ya existe un repositorio con ese nombre en tu carpeta de proyectos.'
      : 'Ya existe una carpeta con ese nombre y tiene archivos. Usa otro nombre.';
  return null;
}

/** Dónde quedará un proyecto nuevo y qué hará la app con esa carpeta. */
function LocationPreview({
  path,
  folder,
  problem,
  onUseExisting,
}: {
  path: string;
  folder: FolderInspectionDto | null;
  problem: string | null;
  onUseExisting(): void;
}) {
  return (
    <div
      role={problem ? 'alert' : 'status'}
      className={`rounded-lg border px-3 py-2 text-[11px] leading-5 ${problem ? 'border-danger/40 bg-danger-soft text-fg' : 'border-border bg-surface-sunken text-fg-muted'}`}
    >
      <p>
        {problem ? 'No se puede usar' : 'Se creará en'} <code className="break-all font-mono text-fg">{path}</code>
      </p>
      {problem ? (
        <>
          <p className="text-danger">{problem}</p>
          {folder?.isGitRepository && (
            <button
              type="button"
              onClick={onUseExisting}
              className={`mt-1 font-semibold text-accent underline-offset-2 hover:underline ${focusRing}`}
            >
              Es el código de este proyecto: usarlo
            </button>
          )}
        </>
      ) : (
        folder && (
          <p>
            {folder.exists ? 'La carpeta existe y está vacía: ' : 'Carpeta nueva: '}
            la app hace <code className="font-mono">git init</code> y un primer commit con README, .gitignore y docs/.
          </p>
        )
      )}
    </div>
  );
}

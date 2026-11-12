import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ArtifactDocumentDto, CreateArtifactDocumentInput } from '../../../shared/contracts/artifact-view.js';
import type { GraphNodeView } from '../../../shared/contracts/graph-view.js';
import { ErrorNotice } from '../errors.js';
import { control, focusRing, primary } from '../ui.js';

const artifactTypes = ['PRD', 'ARCHITECTURE', 'SPEC', 'IMPLEMENTATION_PLAN', 'DOMAIN_DOC', 'OTHER'] as const;
const eligibleTarget = (node: GraphNodeView) =>
  ['PROJECT_ROOT', 'MODULE', 'FEATURE', 'REQUIREMENT', 'WORK_ITEM'].includes(node.type);

export function DocumentsPanel({ projectId, nodes }: { projectId: string; nodes: GraphNodeView[] }) {
  const [documents, setDocuments] = useState<ArtifactDocumentDto[]>([]),
    [repositoryPath, setRepositoryPath] = useState<string | null>(null),
    [pathInput, setPathInput] = useState(''),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [content, setContent] = useState(''),
    [baseHash, setBaseHash] = useState(''),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [pathError, setPathError] = useState<string | null>(null),
    [notice, setNotice] = useState(''),
    [documentKind, setDocumentKind] = useState<'ARTIFACT' | 'DECISION_RECORD'>('ARTIFACT'),
    [artifactType, setArtifactType] = useState<(typeof artifactTypes)[number]>('SPEC'),
    [title, setTitle] = useState(''),
    [targetEntityId, setTargetEntityId] = useState('');
  const targets = useMemo(() => nodes.filter(eligibleTarget), [nodes]);
  const selectedTargetId = targets.some(node => node.id === targetEntityId) ? targetEntityId : (targets[0]?.id ?? '');
  const selected = documents.find(document => document.id === selectedId) ?? null;

  const refreshList = useCallback(async () => {
    const [path, items] = await Promise.all([
      window.workspaceIpc.queries.getRepositoryPath(projectId),
      window.workspaceIpc.queries.listArtifacts(projectId),
    ]);
    setRepositoryPath(path);
    setDocuments(items);
    setPathInput(current => current || path || '');
    setSelectedId(current => (current && items.some(item => item.id === current) ? current : (items[0]?.id ?? null)));
  }, [projectId]);
  const loadDocument = useCallback(async (id: string) => {
    setError(null);
    try {
      const view = await window.workspaceIpc.queries.getArtifact(id);
      setContent(view.content);
      setBaseHash(view.document.contentHash);
      setDirty(false);
      setDocuments(items => items.map(item => (item.id === id ? view.document : item)));
    } catch (cause) {
      setError(cause);
    }
  }, []);

  useEffect(() => {
    void refreshList().catch(setError);
  }, [refreshList]);
  useEffect(() => {
    if (selectedId && !dirty) void loadDocument(selectedId);
    else if (!selectedId) {
      setContent('');
      setBaseHash('');
    }
  }, [selectedId, dirty, loadDocument]);
  useEffect(
    () =>
      window.workspaceIpc.events.onArtifactSyncStatusChanged(event => {
        if (event.projectId !== projectId) return;
        setDocuments(items =>
          items.map(item => (item.id === event.documentId ? { ...item, syncStatus: event.syncStatus } : item)),
        );
        setNotice(`${event.relativePath}: ${statusLabel(event.syncStatus)}.`);
        if (event.documentId === selectedId && !dirty) void loadDocument(event.documentId);
      }),
    [projectId, selectedId, dirty, loadDocument],
  );

  const configureRepository = async (event: FormEvent) => {
    event.preventDefault();
    const path = normalizeRepositoryPath(pathInput),
      problem = validateRepositoryPath(path);
    setPathError(problem);
    if (problem) return;
    setPathInput(path);
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      const result = await window.workspaceIpc.commands.configureRepository(projectId, path);
      setRepositoryPath(result.localPath);
      setPathInput(result.localPath);
      setNotice('Repositorio conectado.');
      await refreshList();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  const createDocument = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !targetEntityId) return;
    setBusy(true);
    setError(null);
    setNotice('');
    const input: CreateArtifactDocumentInput = {
      projectId,
      entityType: documentKind,
      title: title.trim(),
      targetEntityId: selectedTargetId,
      ...(documentKind === 'ARTIFACT' ? { artifactType } : {}),
    };
    try {
      const created = await window.workspaceIpc.commands.createArtifact(input);
      await refreshList();
      setSelectedId(created.document.id);
      setContent(created.content);
      setBaseHash(created.document.contentHash);
      setDirty(false);
      setTitle('');
      setNotice(`${created.document.relativePath} creado y vinculado al grafo.`);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  const saveDocument = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !dirty) return;
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      const saved = await window.workspaceIpc.commands.saveArtifact(selected.id, baseHash, content);
      setDocuments(items => items.map(item => (item.id === selected.id ? saved.document : item)));
      setBaseHash(saved.document.contentHash);
      setDirty(false);
      setNotice('Documento guardado y sincronizado.');
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  const small = 'mb-1 block text-[11px] text-fg-muted';
  return (
    <section
      aria-labelledby="documents-heading"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 id="documents-heading" className="text-sm font-semibold text-fg">
            Documentos Markdown
          </h2>
          <p className="mt-0.5 text-xs text-fg-muted">Archivos del repositorio vinculados al grafo del proyecto.</p>
        </div>
        {repositoryPath && (
          <p className="max-w-[45%] truncate font-mono text-[11px] text-fg-subtle" title={repositoryPath}>
            {repositoryPath}
          </p>
        )}
      </header>
      {!repositoryPath ? (
        <form
          onSubmit={configureRepository}
          noValidate
          className="m-4 max-w-2xl space-y-4 rounded-xl border border-border bg-surface-sunken p-4"
        >
          <div>
            <h3 className="text-sm font-medium text-fg">Conecta el repositorio Git</h3>
            <p className="mt-1 text-xs leading-5 text-fg-muted">
              Indica la carpeta del proyecto que contiene <code className="rounded bg-surface-raised px-1">.git</code>.
              Graph Workspace leerá y escribirá los documentos de su carpeta{' '}
              <code className="rounded bg-surface-raised px-1">docs/</code>.
            </p>
          </div>
          <div>
            <label htmlFor="repository-path" className="mb-1 block text-xs text-fg-muted">
              Ruta local del repositorio
            </label>
            <input
              id="repository-path"
              name="repositoryPath"
              required
              value={pathInput}
              onChange={event => {
                setPathInput(event.target.value);
                setPathError(null);
              }}
              aria-invalid={pathError ? true : undefined}
              aria-describedby={`repository-path-help${pathError ? ' repository-path-error' : ''}`}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              placeholder="/home/ana/proyectos/mi-repo"
              className={`${control} min-h-10 font-mono ${pathError ? 'border-danger' : ''}`}
            />
            <div id="repository-path-help" className="mt-1.5 space-y-0.5 text-[11px] text-fg-muted">
              <p>Ruta absoluta, por ejemplo:</p>
              <ul className="font-mono text-fg-subtle">
                <li>Linux: /home/ana/proyectos/tienda</li>
                <li>macOS: /Users/ana/proyectos/tienda</li>
                <li>Windows: C:\Users\ana\proyectos\tienda</li>
              </ul>
              <p>
                Para obtenerla, abre una terminal en la carpeta y escribe{' '}
                <code className="rounded bg-surface-raised px-1">pwd</code> (o{' '}
                <code className="rounded bg-surface-raised px-1">cd</code> en Windows).
              </p>
            </div>
            {pathError && (
              <p id="repository-path-error" role="alert" className="mt-1.5 text-xs text-danger">
                {pathError}
              </p>
            )}
          </div>
          <button type="submit" disabled={busy} className={`min-h-9 text-xs ${primary}`}>
            Conectar repositorio
          </button>
        </form>
      ) : (
        <div className="grid min-h-0 flex-1 lg:grid-cols-[270px_minmax(0,1fr)]">
          <aside
            aria-label="Lista de documentos"
            className="flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r"
          >
            <div className="flex items-center justify-between px-3 py-2">
              <h3 className="text-xs font-semibold text-fg">Documentos ({documents.length})</h3>
              <button
                type="button"
                onClick={() => void refreshList().catch(setError)}
                className={`min-h-9 rounded px-2 text-xs text-fg-muted hover:bg-surface-sunken hover:text-fg ${focusRing}`}
              >
                Actualizar
              </button>
            </div>
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
              {documents.map(document => (
                <li key={document.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (dirty && !window.confirm('¿Descartar los cambios sin guardar?')) return;
                      setDirty(false);
                      setSelectedId(document.id);
                    }}
                    aria-pressed={document.id === selectedId}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition ${focusRing} ${document.id === selectedId ? 'border-accent/50 bg-accent-soft' : 'border-transparent hover:border-border hover:bg-surface-sunken'}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-fg">{document.title}</span>
                      <span className={`shrink-0 text-[11px] ${statusClass(document.syncStatus)}`}>
                        {statusLabel(document.syncStatus)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-fg-subtle">
                      {document.relativePath}
                    </span>
                  </button>
                </li>
              ))}
              {!documents.length && (
                <li className="px-3 py-8 text-center text-xs leading-5 text-fg-muted">
                  Aún no hay documentos ni decisiones. Crea el primero desde una plantilla.
                </li>
              )}
            </ul>
            <details className="border-t border-border p-3">
              <summary
                className={`min-h-9 cursor-pointer rounded px-2 py-2.5 text-xs font-medium text-accent ${focusRing}`}
              >
                Crear documento
              </summary>
              <form onSubmit={createDocument} className="mt-3 space-y-3">
                <div>
                  <label htmlFor="document-kind" className={small}>
                    Tipo de registro
                  </label>
                  <select
                    id="document-kind"
                    name="documentKind"
                    value={documentKind}
                    onChange={event => setDocumentKind(event.target.value as typeof documentKind)}
                    className={control}
                  >
                    <option value="ARTIFACT">Documento</option>
                    <option value="DECISION_RECORD">Decisión (ADR)</option>
                  </select>
                </div>
                {documentKind === 'ARTIFACT' && (
                  <div>
                    <label htmlFor="artifact-type" className={small}>
                      Plantilla
                    </label>
                    <select
                      id="artifact-type"
                      name="artifactType"
                      value={artifactType}
                      onChange={event => setArtifactType(event.target.value as typeof artifactType)}
                      className={control}
                    >
                      {artifactTypes.map(type => (
                        <option key={type} value={type}>
                          {artifactTypeLabel(type)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label htmlFor="document-title" className={small}>
                    Título
                  </label>
                  <input
                    id="document-title"
                    name="title"
                    required
                    value={title}
                    onChange={event => setTitle(event.target.value)}
                    className={control}
                  />
                </div>
                <div>
                  <label htmlFor="document-target" className={small}>
                    Vincular con
                  </label>
                  <select
                    id="document-target"
                    name="targetEntityId"
                    required
                    value={selectedTargetId}
                    onChange={event => setTargetEntityId(event.target.value)}
                    className={control}
                  >
                    {targets.map(node => (
                      <option key={node.id} value={node.id}>
                        {node.key} · {node.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={busy || !targets.length}
                  className={`min-h-9 w-full text-xs ${primary}`}
                >
                  Crear y vincular
                </button>
              </form>
            </details>
          </aside>
          {selected ? (
            <form onSubmit={saveDocument} className="flex min-h-0 min-w-0 flex-col">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-medium text-fg">{selected.title}</h3>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-fg-subtle">
                    {selected.displayKey} · {selected.relativePath}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-[11px] ${statusClass(selected.syncStatus)}`}>
                    {statusLabel(selected.syncStatus)}
                    {dirty ? ' · cambios sin guardar' : ''}
                  </span>
                  <button type="submit" disabled={busy || !dirty} className={`min-h-9 text-xs ${primary}`}>
                    Guardar Markdown
                  </button>
                </div>
              </div>
              <div className="grid min-h-0 flex-1 xl:grid-cols-2">
                <div className="flex min-h-0 flex-col border-b border-border xl:border-b-0 xl:border-r">
                  <label
                    htmlFor="markdown-content"
                    className="border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted"
                  >
                    Editor Markdown — contenido
                  </label>
                  <textarea
                    id="markdown-content"
                    name="content"
                    value={content}
                    onChange={event => {
                      setContent(event.target.value);
                      setDirty(true);
                    }}
                    spellCheck
                    autoCapitalize="sentences"
                    className="min-h-[280px] flex-1 resize-y bg-surface-sunken p-4 font-mono text-xs leading-6 text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                  />
                </div>
                <section aria-labelledby="markdown-preview-heading" className="min-h-[280px] overflow-auto px-5 py-4">
                  <h4
                    id="markdown-preview-heading"
                    className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-fg-muted"
                  >
                    Vista previa
                  </h4>
                  <article className="markdown-preview">
                    <ReactMarkdown>{content}</ReactMarkdown>
                  </article>
                </section>
              </div>
            </form>
          ) : (
            <div className="grid min-h-64 place-items-center p-8 text-center text-xs text-fg-muted">
              Selecciona un documento o crea uno desde una plantilla.
            </div>
          )}
        </div>
      )}
      {error !== null && error !== undefined ? (
        <ErrorNotice error={error} className="m-3" />
      ) : (
        notice && (
          <p role="status" aria-live="polite" className="border-t border-border px-4 py-2 text-xs text-fg-muted">
            {notice}
          </p>
        )
      )}
    </section>
  );
}

/** Quita comillas, espacios y un «/.git» final que se suele pegar por error. */
export function normalizeRepositoryPath(value: string): string {
  return value
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/[\\/]\.git[\\/]?$/, '')
    .replace(/(.)[\\/]+$/, '$1');
}
/** null si la ruta es aceptable; si no, el motivo en español. */
export function validateRepositoryPath(path: string): string | null {
  if (!path) return 'Escribe la ruta de la carpeta del repositorio.';
  if (path.startsWith('~'))
    return 'Escribe la ruta completa: «~» no se expande. Por ejemplo, /home/ana/proyectos/tienda.';
  if (/^https?:|^git@/.test(path))
    return 'Eso parece una URL remota. Indica la carpeta local donde está clonado el repositorio.';
  if (!/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(path))
    return 'La ruta debe ser absoluta: empieza por «/» (Linux y macOS) o por una unidad como «C:\\» (Windows).';
  return null;
}

function artifactTypeLabel(type: (typeof artifactTypes)[number]): string {
  return {
    PRD: 'PRD',
    ARCHITECTURE: 'Arquitectura',
    SPEC: 'Especificación',
    IMPLEMENTATION_PLAN: 'Plan de implementación',
    DOMAIN_DOC: 'Documento de dominio',
    OTHER: 'Otro',
  }[type];
}
function statusLabel(status: ArtifactDocumentDto['syncStatus']): string {
  return {
    SYNCED: 'Sincronizado',
    DRIFTED: 'Cambio externo',
    MISSING: 'Archivo ausente',
    UNTRACKED: 'Sin seguimiento',
  }[status];
}
function statusClass(status: ArtifactDocumentDto['syncStatus']): string {
  return { SYNCED: 'text-success', DRIFTED: 'text-warning', MISSING: 'text-danger', UNTRACKED: 'text-fg-subtle' }[
    status
  ];
}

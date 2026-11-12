import { useEffect, useMemo, useState } from 'react';
import { GraphCanvas, type GraphCanvasFilter } from '../graph/GraphCanvas.js';
import { useUnsavedChanges } from '../../state/unsaved-changes.js';
import type { ChangeSetDto } from '../../../shared/contracts/ipc-contracts.js';
import type { GraphEdgeView, GraphNodeView } from '../../../shared/contracts/graph-view.js';
import { useWorkspaceNavigation } from '../../state/workspace-navigation-context.js';
import { ContextPills } from './ContextPills.js';
import { changeSetStatusLabel, edgeLabel, operationLabel, shortDate } from '../labels.js';
import { ErrorNotice } from '../errors.js';
import { ReferencesField, ReferencesSummary, type DraftReference } from '../inception/ReferencesField.js';
import type { InceptionReferenceDto } from '../../../shared/contracts/inception-view.js';
import { UI_SPEC_PATH } from '../../../shared/ui-spec.js';

/** Las referencias ya traducidas se reutilizan mientras el usuario no cambie los archivos, su tipo o su nota (traducir cuesta una llamada al modelo). */
const referencesKey = (references: DraftReference[]) =>
  JSON.stringify(references.map(item => [item.key, item.kind, item.note]));

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const field = `w-full rounded-lg border border-border-strong bg-surface-sunken px-3 text-xs text-fg placeholder:text-fg-subtle ${focusRing}`;
const statusTone: Record<ChangeSetDto['status'], string> = {
  VALIDATED: 'bg-success-soft text-success',
  CONFLICTED: 'bg-danger-soft text-danger',
  PENDING_APPROVAL: 'bg-warning-soft text-warning',
  APPLIED: 'bg-accent-soft text-accent',
  REJECTED: 'bg-surface-sunken text-fg-subtle',
};
const Badge = ({ status }: { status: ChangeSetDto['status'] }) => (
  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusTone[status]}`}>
    {changeSetStatusLabel(status)}
  </span>
);
const describe = (operation: Record<string, unknown>) =>
  operation.type === 'CREATE_RELATIONSHIP' && typeof operation.edgeType === 'string'
    ? `Relacionar · ${edgeLabel(operation.edgeType)}`
    : operationLabel(String(operation.type ?? 'CAMBIO'));

/** Planificador: el motor propone cambios al grafo (sin tocar archivos), se previsualizan como elementos fantasma y el usuario decide si aplicarlos. */
export function PlanningWorkspace({
  changeSetId,
  graphFilter,
  onGraphFilterChange,
}: {
  changeSetId?: string | null;
  graphFilter?: GraphCanvasFilter;
  onGraphFilterChange?(filter: GraphCanvasFilter): void;
} = {}) {
  const state = useWorkspaceNavigation(),
    workspace = state.workspace!;
  const [changeSets, setChangeSets] = useState<ChangeSetDto[]>([]),
    [activeId, setActiveId] = useState<string | null>(changeSetId ?? null),
    [previewOperations, setPreviewOperations] = useState<Array<Record<string, unknown>>>([]);
  const [prompt, setPrompt] = useState(''),
    [operationsText, setOperationsText] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState<unknown>(null);
  useUnsavedChanges('«¿Qué quieres cambiar?»', prompt.trim() !== '');
  const [engine, setEngine] = useState<{ name: string; models: string[]; defaultModel: string | null } | null>(null),
    [model, setModel] = useState('');
  // Actualización visual por feature: referencias (las traduce el mismo modelo que en el inicio) y docs/UI_SPEC.md.
  const [references, setReferences] = useState<DraftReference[]>([]),
    [understood, setUnderstood] = useState<{ key: string; items: InceptionReferenceDto[] } | null>(null),
    [updateUiSpec, setUpdateUiSpec] = useState(false),
    [uiSpecExists, setUiSpecExists] = useState(false),
    [phase, setPhase] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void window.workspaceIpc.queries
      .listArtifacts(workspace.project.id)
      .then(documents => {
        if (current) setUiSpecExists(documents.some(document => document.relativePath === UI_SPEC_PATH));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [workspace.project.id, workspace.graph.revision]);
  const active = changeSets.find(item => item.id === activeId) ?? null;
  // El planificador usa el motor conectado; su lista de modelos y el predeterminado de planificación vienen del perfil DEVELOPER.
  useEffect(() => {
    let current = true;
    void window.workspaceIpc.queries
      .listAgentProfiles(workspace.project.id)
      .then(profiles => {
        const profile = profiles.find(item => item.roleKey === 'DEVELOPER') ?? profiles[0];
        if (!current || !profile) return;
        setEngine({
          name: profile.providerName,
          models: profile.availableModels ?? [],
          defaultModel: profile.planningModel ?? null,
        });
        setModel(profile.planningModel ?? '');
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [workspace.project.id]);
  const refresh = async () => {
    const result = await window.workspaceIpc.queries.listChangeSets(workspace.project.id);
    setChangeSets(result);
    setActiveId(current => (current && result.some(item => item.id === current) ? current : (result[0]?.id ?? null)));
  };
  useEffect(() => {
    void refresh().catch(setError);
  }, [workspace.project.id]);
  // Abrir una propuesta concreta (desde la bandeja de actividad o el siguiente paso).
  useEffect(() => {
    if (changeSetId) setActiveId(changeSetId);
  }, [changeSetId]);
  useEffect(() => {
    const selected = changeSets.find(item => item.id === activeId);
    if (selected) {
      setPreviewOperations(selected.status === 'APPLIED' || selected.status === 'REJECTED' ? [] : selected.operations);
      setOperationsText(JSON.stringify(selected.operations, null, 2));
    } else setPreviewOperations([]);
  }, [activeId, changeSets]);
  const ghosts = useMemo(
    () => buildGhosts(previewOperations, workspace.graph.nodes),
    [previewOperations, workspace.graph.nodes],
  );
  async function act(work: () => Promise<ChangeSetDto | { changeSet: ChangeSetDto; revision: number }>) {
    setBusy(true);
    setMessage('');
    setError(null);
    try {
      const result = await work();
      const proposal = 'changeSet' in result ? result.changeSet : result;
      setChangeSets(previous => [proposal, ...previous.filter(item => item.id !== proposal.id)]);
      setActiveId(proposal.id);
      if (proposal.status === 'APPLIED') await state.refreshGraph();
      setMessage(
        proposal.status === 'VALIDATED'
          ? 'Propuesta validada. Revisa en el grafo los elementos con borde discontinuo antes de aplicar.'
          : proposal.status === 'APPLIED'
            ? 'Cambios aplicados y grafo actualizado.'
            : `Estado de la propuesta: ${changeSetStatusLabel(proposal.status)}.`,
      );
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }
  const saveJson = () => {
    if (!active) return;
    let operations: unknown[];
    try {
      operations = JSON.parse(operationsText) as unknown[];
      if (!Array.isArray(operations)) throw new Error('Unexpected token: se esperaba una lista de operaciones.');
    } catch (reason) {
      setError(reason);
      return;
    }
    void act(() => window.workspaceIpc.commands.editChangeSet(active.id, operations));
  };
  const open = active && active.status !== 'APPLIED' && active.status !== 'REJECTED';
  return (
    <div className="flex min-h-0 min-w-0 flex-1 gap-4">
      <GraphCanvas
        projectId={workspace.project.id}
        nodes={workspace.graph.nodes}
        edges={workspace.graph.edges}
        ghostNodes={ghosts.nodes}
        ghostEdges={ghosts.edges}
        selectedId={state.selectedEntityId}
        onSelect={id => void state.selectEntity(id)}
        {...(graphFilter ? { filter: graphFilter } : {})}
        {...(onGraphFilterChange ? { onFilterChange: onGraphFilterChange } : {})}
      />
      <aside
        className="flex w-[clamp(17rem,36vw,24rem)] shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised"
        aria-label="Planificador de cambios"
      >
        {/* Never shrinks under its content (that painted it over the list); a tall context scrolls on its own. */}
        <div className="max-h-[45%] shrink-0 space-y-3 overflow-y-auto border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">Planificar con {engine?.name ?? 'el motor de IA'}</h2>
            <p className="mt-1 text-xs leading-5 text-fg-muted">
              El motor prepara una propuesta de cambios al plan sin tocar archivos. Tú decides si la aplicas.
            </p>
          </div>
          <ContextPills
            context={state.contextPackage}
            loading={state.contextLoading}
            error={state.contextError}
            onRefresh={state.refreshContext}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <form
            onSubmit={event => {
              event.preventDefault();
              if (!prompt.trim()) return;
              void act(async () => {
                try {
                  // 1. Las referencias se traducen a texto (una llamada al modelo) y el usuario ve qué se entendió; el planificador solo recibe ese texto.
                  let translated: InceptionReferenceDto[] = [];
                  if (references.length) {
                    const key = referencesKey(references);
                    if (understood?.key === key && understood.items.every(item => item.status === 'TRANSLATED'))
                      translated = understood.items;
                    else {
                      const translate = window.workspaceIpc.commands.translateReferences;
                      if (!translate) throw new Error('Esta versión de la app no puede analizar referencias.');
                      setPhase('Analizando tus referencias…');
                      translated = await translate(
                        workspace.project.id,
                        references.map(({ key: _key, bytes: _bytes, ...input }) => input),
                      );
                      setUnderstood({ key, items: translated });
                      const failed = translated.filter(item => item.status !== 'TRANSLATED');
                      if (failed.length)
                        throw new Error(
                          `No se pudo analizar ${failed.map(item => `«${item.name}»`).join(', ')}: ${failed[0]!.error ?? 'error desconocido'} Quítala o vuelve a intentarlo.`,
                        );
                    }
                  }
                  setPhase('Preparando la propuesta…');
                  const latestContext = await state.refreshContext(
                    state.contextPackage?.snapshot.tokenUsage.maxAllowedTokens ?? 32_000,
                    prompt,
                  );
                  const options =
                    translated.length || updateUiSpec
                      ? {
                          ...(translated.length
                            ? {
                                references: translated.map(item => ({
                                  name: item.name,
                                  kind: item.kind,
                                  note: item.note,
                                  translation: item.translation!,
                                })),
                              }
                            : {}),
                          ...(updateUiSpec ? { updateUiSpec: true } : {}),
                        }
                      : undefined;
                  const snapshotId = latestContext?.snapshot.id ?? state.contextPackage?.snapshot.id;
                  const proposal = options
                    ? await window.workspaceIpc.commands.proposeChanges(
                        workspace.project.id,
                        prompt,
                        state.selectedEntityId ?? undefined,
                        snapshotId,
                        model || undefined,
                        options,
                      )
                    : await window.workspaceIpc.commands.proposeChanges(
                        workspace.project.id,
                        prompt,
                        state.selectedEntityId ?? undefined,
                        snapshotId,
                        model || undefined,
                      );
                  setPrompt('');
                  setReferences([]);
                  setUpdateUiSpec(false);
                  await refresh();
                  return proposal;
                } finally {
                  setPhase(null);
                }
              });
            }}
            className="space-y-3"
          >
            <div>
              <label htmlFor="planning-prompt" className="mb-1 block text-xs font-medium text-fg">
                ¿Qué quieres cambiar?
              </label>
              <textarea
                id="planning-prompt"
                value={prompt}
                onChange={event => setPrompt(event.target.value)}
                rows={4}
                placeholder="Ej. Agrega una feature de autenticación, sus requisitos, tareas y una especificación Markdown."
                className={`${field} resize-y py-2.5 leading-5`}
              />
            </div>
            {engine && engine.models.length > 0 && (
              <div>
                <label htmlFor="planning-model" className="mb-1 block text-xs font-medium text-fg">
                  Modelo
                </label>
                <select
                  id="planning-model"
                  aria-describedby="planning-model-help"
                  value={model}
                  onChange={event => setModel(event.target.value)}
                  className={`${field} min-h-9`}
                >
                  {engine.models.map(option => (
                    <option key={option} value={option}>
                      {option}
                      {option === engine.defaultModel ? ' (predeterminado)' : ''}
                    </option>
                  ))}
                </select>
                <p id="planning-model-help" className="mt-1 text-[11px] text-fg-subtle">
                  Solo para planificar. El modelo de cada ejecución se elige en Agentes.
                </p>
              </div>
            )}
            <ReferencesField value={references} onChange={setReferences} disabled={busy} />
            <div className="rounded-lg border border-border bg-surface-sunken p-3">
              <label className="flex cursor-pointer items-start gap-2 text-xs text-fg">
                <input
                  type="checkbox"
                  checked={updateUiSpec}
                  disabled={busy}
                  onChange={event => setUpdateUiSpec(event.target.checked)}
                  className="mt-0.5 accent-[var(--accent)]"
                />
                <span>
                  <span className="font-medium">
                    {uiSpecExists
                      ? `Actualizar ${UI_SPEC_PATH} con este cambio`
                      : `Crear ${UI_SPEC_PATH} con este cambio`}
                  </span>
                  <span className="mt-1 block text-[11px] leading-4 text-fg-muted">
                    {uiSpecExists
                      ? 'El motor añade las pantallas, componentes y estados nuevos sin quitar lo que ya tiene. La propuesta no se podrá aplicar si le falta alguna de sus 8 secciones.'
                      : 'Para un proyecto con interfaz que aún no tiene especificación: el motor la escribe con sus 8 secciones.'}{' '}
                    Las features nuevas quedan enlazadas a ella, así sus agentes la reciben.
                  </span>
                </span>
              </label>
            </div>
            <button
              disabled={busy || !prompt.trim()}
              className={`min-h-9 w-full rounded-lg border border-accent/70 px-3 text-xs font-semibold text-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
            >
              {busy ? (phase ?? 'Procesando…') : 'Proponer cambios'}
            </button>
            {understood && understood.items.length > 0 && <ReferencesSummary references={understood.items} />}
          </form>
          {changeSets.length > 0 && (
            <section aria-labelledby="proposals-heading">
              <h3
                id="proposals-heading"
                className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted"
              >
                Propuestas ({changeSets.length})
              </h3>
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {changeSets.map(item => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={item.id === activeId ? 'true' : undefined}
                      onClick={() => setActiveId(item.id)}
                      className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left ${focusRing} ${item.id === activeId ? 'border-accent/60 bg-accent-soft' : 'border-transparent hover:border-border hover:bg-surface-sunken'}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-fg">{item.title}</span>
                        {shortDate(item.createdAt) && (
                          <span className="block text-[11px] text-fg-subtle">{shortDate(item.createdAt)}</span>
                        )}
                      </span>
                      <Badge status={item.status} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {active && (
            <article
              aria-label="Propuesta de cambios"
              className="rounded-xl border border-border bg-surface-sunken p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                    Propuesta de cambios
                  </p>
                  <h3 className="mt-0.5 text-sm font-semibold text-fg">{active.title}</h3>
                </div>
                <Badge status={active.status} />
              </div>
              <p className="mt-1 text-xs leading-5 text-fg-muted">{active.rationale}</p>
              <ul className="mt-3 space-y-1.5">
                {active.operations.map((operation, index) => (
                  <li
                    key={index}
                    className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-fg"
                  >
                    <span className="font-semibold text-accent">{describe(operation)}</span>
                    {typeof operation.title === 'string' && <span> · {operation.title}</span>}
                  </li>
                ))}
              </ul>
              {active.validationIssues.length > 0 && (
                <ul className="mt-3 space-y-1" aria-label="Problemas de validación">
                  {active.validationIssues.map((issue, index) => (
                    <li
                      key={index}
                      className={`text-xs leading-4 ${issue.severity === 'ERROR' ? 'text-danger' : 'text-warning'}`}
                    >
                      {issue.message}
                    </li>
                  ))}
                </ul>
              )}
              {open && (
                <>
                  <div className="mt-3 flex gap-2">
                    <button
                      disabled={busy || active.status !== 'VALIDATED'}
                      onClick={() => void act(() => window.workspaceIpc.commands.applyChangeSet(active.id))}
                      className={`min-h-9 flex-1 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-fg hover:opacity-90 disabled:opacity-40 ${focusRing}`}
                    >
                      Aplicar cambios
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void act(() => window.workspaceIpc.commands.rejectChangeSet(active.id))}
                      className={`min-h-9 rounded-lg border border-border-strong px-3 text-xs text-danger hover:border-danger/60 ${focusRing}`}
                    >
                      Rechazar
                    </button>
                  </div>
                  {active.status !== 'VALIDATED' && (
                    <p className="mt-2 text-[11px] text-fg-muted">
                      Solo se puede aplicar una propuesta validada. Corrige los problemas en «Avanzado» o pide otra
                      propuesta.
                    </p>
                  )}
                  <details className="mt-3 rounded-lg border border-border">
                    <summary
                      className={`min-h-9 cursor-pointer rounded-lg px-3 py-2.5 text-xs text-fg-muted ${focusRing}`}
                    >
                      Avanzado: editar las operaciones (JSON)
                    </summary>
                    <div className="space-y-2 border-t border-border p-3">
                      <label htmlFor="change-operations" className="block text-[11px] text-fg-muted">
                        Operaciones JSON
                      </label>
                      <textarea
                        id="change-operations"
                        value={operationsText}
                        onChange={event => setOperationsText(event.target.value)}
                        rows={12}
                        spellCheck={false}
                        className={`${field} py-2 font-mono text-[11px] leading-4`}
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={saveJson}
                        className={`min-h-9 w-full rounded-lg border border-border-strong px-3 text-xs text-fg hover:border-accent ${focusRing}`}
                      >
                        Guardar y validar
                      </button>
                    </div>
                  </details>
                </>
              )}
            </article>
          )}
          <ErrorNotice error={error} />
          <p role="status" aria-live="polite" className="min-h-5 text-xs leading-4 text-fg-muted">
            {message}
          </p>
          {ghosts.nodes.length > 0 && (
            <p className="text-[11px] text-accent">
              Vista previa: {ghosts.nodes.length} elementos propuestos en el grafo (borde discontinuo).
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
function buildGhosts(
  operations: Array<Record<string, unknown>>,
  existing: GraphNodeView[],
): { nodes: GraphNodeView[]; edges: GraphEdgeView[] } {
  const toNodeType = (type: unknown): GraphNodeView['type'] | null =>
    (
      ({
        CREATE_MODULE: 'MODULE',
        CREATE_FEATURE: 'FEATURE',
        CREATE_REQUIREMENT: 'REQUIREMENT',
        CREATE_WORK_ITEM: 'WORK_ITEM',
        CREATE_DECISION_RECORD: 'DECISION_RECORD',
        UPSERT_ARTIFACT: 'ARTIFACT',
      }) as Record<string, GraphNodeView['type']>
    )[String(type)] ?? null;
  const nodes = operations.flatMap((op, index) => {
    const type = toNodeType(op.type),
      id = typeof op.tempId === 'string' ? op.tempId : null;
    if (!type || !id) return [];
    const parentId =
      typeof op.moduleId === 'string' ? op.moduleId : typeof op.parentId === 'string' ? op.parentId : undefined;
    return [
      {
        id,
        key: `NEW-${index + 1}`,
        type,
        label: typeof op.title === 'string' ? op.title : type,
        status: 'GHOST',
        ...(parentId ? { parentId } : {}),
        metadata: { ghost: true },
      },
    ];
  });
  const known = new Set([...existing.map(node => node.id), ...nodes.map(node => node.id)]);
  const edges = operations.flatMap((op, index) => {
    if (
      op.type !== 'CREATE_RELATIONSHIP' ||
      typeof op.sourceId !== 'string' ||
      typeof op.targetId !== 'string' ||
      typeof op.edgeType !== 'string' ||
      !known.has(op.sourceId) ||
      !known.has(op.targetId)
    )
      return [];
    return [
      {
        id: `ghost-edge-${index}`,
        source: op.sourceId,
        target: op.targetId,
        type: op.edgeType as GraphEdgeView['type'],
        provenance: 'CHANGESET' as const,
      },
    ];
  });
  return { nodes, edges };
}

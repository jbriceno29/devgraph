import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GraphCanvas } from '../presentation/graph/GraphCanvas.js';
import { ContextualInspector } from '../presentation/inspector/ContextualInspector.js';
import { DocumentsPanel } from '../presentation/documents/DocumentsPanel.js';
import { PlanningWorkspace } from '../presentation/planning/PlanningWorkspace.js';
import { AgentsWorkspace } from '../presentation/agents/AgentsWorkspace.js';
import { ActivityInbox, useActivity } from '../presentation/shell/ActivityInbox.js';
import { Sidebar, panelId, tabId } from '../presentation/shell/Sidebar.js';
import { NextStepBanner } from '../presentation/shell/NextStepBanner.js';
import { EmptyProject } from '../presentation/shell/EmptyProject.js';
import { InceptionAssistant } from '../presentation/inception/InceptionAssistant.js';
import { ThemeToggle } from '../presentation/shell/ThemeToggle.js';
import { useResetOnChange } from '../presentation/use-reset-on-change.js';
import { VIEWS, viewInfo } from '../presentation/shell/views.js';
import { nextStep, type ShellTarget, type ShellView } from '../presentation/shell/next-step.js';
import { useWorkspaceNavigation } from './workspace-navigation-context.js';
import { ProjectCreateForm } from './project-create-form.js';
import type { GraphEdgeType, KnowledgeEntityType } from '../../shared/contracts/graph-view.js';
import type { WorkspaceLoadedStateDto } from '../../shared/contracts/ipc-contracts.js';

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export function WorkspaceShell() {
  const state = useWorkspaceNavigation();
  const { projects, workspace, loading, error } = state;
  if (loading && !workspace)
    return (
      <div className="grid min-h-screen place-items-center bg-surface text-sm text-fg-muted">
        Preparando el espacio de trabajo…
      </div>
    );
  return workspace ? (
    <ProjectShell workspace={workspace} />
  ) : (
    <main className="flex min-h-screen flex-col bg-surface text-fg">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-7 py-3">
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-sm font-bold text-accent"
          >
            G
          </div>
          <p className="text-sm font-semibold">Graph Workspace</p>
        </div>
        <ThemeToggle />
      </header>
      {error && (
        <div
          role="alert"
          className="mx-7 mt-4 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          {error}
        </div>
      )}
      <div className="mx-auto grid w-full max-w-5xl flex-1 content-center gap-8 px-6 py-12 md:grid-cols-[0.9fr_1.1fr]">
        <div className="self-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">Memoria local del proyecto</p>
          <h1 className="mt-4 max-w-lg text-4xl font-semibold leading-tight tracking-tight">
            El contexto del proyecto, conectado.
          </h1>
          <p className="mt-4 max-w-lg text-sm leading-6 text-fg-muted">
            Planifica, ejecuta con agentes y revisa el trabajo desde un único grafo local.
          </p>
          {projects.length > 0 && (
            <div className="mt-8">
              <h2 className="mb-3 text-sm font-medium text-fg-muted">Abrir un proyecto reciente</h2>
              <ul className="space-y-2">
                {projects.map(project => (
                  <li key={project.id}>
                    <button
                      type="button"
                      onClick={() => void state.openProject(project.id)}
                      className={`flex w-full items-center justify-between rounded-xl border border-border bg-surface-raised p-4 text-left transition hover:border-border-strong ${focusRing}`}
                    >
                      <span>
                        <span className="block text-sm font-medium text-fg">{project.name}</span>
                        <span className="mt-1 block font-mono text-[11px] text-fg-subtle">{project.slug}</span>
                      </span>
                      <span className="text-xs text-fg-subtle">REV {project.currentRevision} →</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="self-center">
          <ProjectCreateForm onCreate={state.createProject} disabled={loading} />
        </div>
      </div>
    </main>
  );
}

function ProjectShell({ workspace }: { workspace: WorkspaceLoadedStateDto }) {
  const state = useWorkspaceNavigation();
  const { projects, inspector, selectedEntityId, error } = state;
  const projectId = workspace.project.id,
    nodes = workspace.graph.nodes;
  const hasPlan = nodes.some(
    node => (node.type === 'FEATURE' || node.type === 'WORK_ITEM') && node.status !== 'ARCHIVED',
  );
  // Sin plan todavía, el proyecto abre en Inicio (el asistente); con plan, en Actividad.
  const [view, setView] = useState<ShellView>(() => (hasPlan ? 'activity' : 'inception')),
    [focus, setFocus] = useState<{ changeSetId?: string | null; executionId?: string | null }>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const activity = useActivity(projectId);
  const step = useMemo(() => nextStep(workspace.graph, activity.summary), [workspace.graph, activity.summary]);
  const hasFeatures = nodes.some(node => node.type === 'FEATURE' && node.status !== 'ARCHIVED');
  // Al cambiar de proyecto vuelve a su vista inicial; en el mismo render, para no pisar una vista que el usuario acabe de elegir.
  useResetOnChange(projectId, () => {
    setView(hasPlan ? 'activity' : 'inception');
    setFocus({});
  });
  const inception = activity.summary?.inception ?? null;
  /** Cambia de vista (y selecciona lo indicado) desde la bandeja, el banner o un atajo; lleva el foco al título. */
  const go = useCallback(
    (input: ShellTarget) => {
      const target: ShellTarget =
        input.view === 'planning' && input.changeSetId && input.changeSetId === inception?.changeSetId
          ? { view: 'inception' }
          : input;
      if (target.workItemId) void state.selectEntity(target.workItemId);
      setFocus({ changeSetId: target.changeSetId ?? null, executionId: target.executionId ?? null });
      setView(target.view);
      requestAnimationFrame(() => heading.current?.focus());
    },
    [state.selectEntity, inception?.changeSetId],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const index = Number(event.key) - 1;
      const target = VIEWS[index];
      if (!target) return;
      event.preventDefault();
      go({ view: target.id });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);
  const info = viewInfo(view);
  const integrateFeature = window.workspaceIpc.commands.integrateFeature;
  const changeStatus = async (status: string) => {
    if (!inspector) return;
    if (inspector.entity.type === 'DECISION_RECORD') {
      const setDecisionStatus = window.workspaceIpc.commands.setDecisionStatus;
      if (!setDecisionStatus) throw new Error('Esta versión de la app no puede cambiar el estado de una decisión.');
      await setDecisionStatus(projectId, inspector.entity.id, status);
    } else await window.workspaceIpc.commands.setWorkItemStatus(projectId, inspector.entity.id, status);
    await state.refreshGraph();
    await state.selectEntity(inspector.entity.id);
  };
  const content =
    view === 'activity' ? (
      <div className="mx-auto min-h-0 w-full max-w-4xl space-y-4 overflow-y-auto">
        {hasFeatures ? (
          <NextStepBanner step={step} onGo={go} />
        ) : (
          <EmptyProject
            projectName={workspace.project.name}
            inception={inception}
            onStart={() => go({ view: 'inception' })}
            onPlan={() => go({ view: 'planning' })}
          />
        )}
        {(hasFeatures || (activity.summary?.items.length ?? 0) > 0) && (
          <ActivityInbox
            projectId={projectId}
            onNavigate={go}
            summary={activity.summary}
            loading={activity.loading}
            error={activity.error}
          />
        )}
      </div>
    ) : view === 'graph' ? (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <NextStepBanner step={step} onGo={go} />
        <div className="flex min-h-0 min-w-0 flex-1 gap-4">
          <GraphCanvas
            projectId={projectId}
            nodes={nodes}
            edges={workspace.graph.edges}
            selectedId={selectedEntityId}
            onSelect={id => void state.selectEntity(id)}
            onFilter={(nodeTypes: KnowledgeEntityType[], edgeTypes: GraphEdgeType[]) =>
              void state.refreshGraph({ entityTypes: nodeTypes, edgeTypes })
            }
          />
          <ContextualInspector
            details={inspector}
            onChangeStatus={changeStatus}
            onOpenAgents={(workItemId, executionId) =>
              go({ view: 'agents', workItemId, executionId: executionId ?? null })
            }
            nodes={nodes}
            {...(integrateFeature
              ? { onIntegrateFeature: (featureId: string) => integrateFeature(projectId, featureId) }
              : {})}
            onFeatureIntegrated={() => {
              void activity.reload();
              if (inspector) void state.selectEntity(inspector.entity.id);
            }}
            contextPackage={state.contextPackage}
            contextLoading={state.contextLoading}
            contextError={state.contextError}
            onRefreshContext={state.refreshContext}
          />
        </div>
      </div>
    ) : view === 'planning' ? (
      <PlanningWorkspace changeSetId={focus.changeSetId ?? null} />
    ) : view === 'inception' ? (
      <InceptionAssistant
        projectId={projectId}
        nodes={nodes}
        onNavigate={go}
        onApplied={() => {
          void state.refreshGraph();
          void activity.reload();
        }}
      />
    ) : view === 'agents' ? (
      <AgentsWorkspace
        projectId={projectId}
        nodes={nodes}
        selectedEntityId={selectedEntityId}
        selectedExecutionId={focus.executionId ?? null}
      />
    ) : (
      <DocumentsPanel projectId={projectId} nodes={nodes} />
    );
  return (
    <div className="flex h-screen min-h-0 bg-surface text-fg">
      <Sidebar
        projects={projects}
        activeProject={workspace.project}
        onOpenProject={id => void state.openProject(id)}
        onRefreshProjects={() => void state.refreshProjects()}
        view={view}
        onSelectView={next => {
          setFocus({});
          setView(next);
        }}
        attentionCount={activity.summary?.attentionCount ?? 0}
        inceptionBadge={inception?.needsAttention ? inception.title : null}
        nodes={nodes}
        selectedId={selectedEntityId}
        onSelectNode={id => {
          void state.selectEntity(id);
          if (view === 'activity' || view === 'documents') setView('graph');
        }}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-border px-6 py-4">
          <nav aria-label="Ruta">
            <ol className="flex items-center gap-1.5 text-xs text-fg-subtle">
              <li>{workspace.project.name}</li>
              <li aria-hidden="true">›</li>
              <li aria-current="page" className="text-fg-muted">
                {info.label}
              </li>
            </ol>
          </nav>
          <h1
            ref={heading}
            tabIndex={-1}
            className="mt-1 text-lg font-semibold tracking-tight text-fg focus:outline-none"
          >
            {info.title}
          </h1>
          <p className="mt-0.5 text-sm text-fg-muted">{info.description}</p>
        </header>
        {error && (
          <div
            role="alert"
            className="mx-6 mt-4 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger"
          >
            {error}
          </div>
        )}
        <div
          id={panelId(view)}
          role="tabpanel"
          aria-labelledby={tabId(view)}
          className="flex min-h-0 flex-1 flex-col p-5 lg:p-6"
        >
          {content}
        </div>
        {VIEWS.filter(other => other.id !== view).map(other => (
          <div key={other.id} id={panelId(other.id)} role="tabpanel" aria-labelledby={tabId(other.id)} hidden />
        ))}
      </main>
    </div>
  );
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  EntityInspectorDto,
  GraphFilterDto,
  GraphViewDto,
  ProjectSummaryDto,
  WorkspaceLoadedStateDto,
} from '../../shared/contracts/ipc-contracts.js';
import type { ContextPackageDto } from '../../shared/contracts/context-view.js';
interface WorkspaceNavigationValue {
  projects: ProjectSummaryDto[];
  activeProject: ProjectSummaryDto | null;
  workspace: WorkspaceLoadedStateDto | null;
  inspector: EntityInspectorDto | null;
  contextPackage: ContextPackageDto | null;
  contextLoading: boolean;
  contextError: string | null;
  selectedEntityId: string | null;
  loading: boolean;
  error: string | null;
  createProject(input: { name: string; slug: string }): Promise<void>;
  openProject(projectId: string): Promise<void>;
  selectEntity(entityId: string): Promise<void>;
  refreshGraph(filter?: GraphFilterDto): Promise<void>;
  refreshContext(maxAllowedTokens?: number, query?: string): Promise<ContextPackageDto | null>;
  refreshProjects(): Promise<void>;
}
const NavigationContext = createContext<WorkspaceNavigationValue | null>(null);
export function WorkspaceNavigationProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectSummaryDto[]>([]),
    [workspace, setWorkspace] = useState<WorkspaceLoadedStateDto | null>(null),
    [inspector, setInspector] = useState<EntityInspectorDto | null>(null),
    [contextPackage, setContextPackage] = useState<ContextPackageDto | null>(null),
    [contextLoading, setContextLoading] = useState(false),
    [contextError, setContextError] = useState<string | null>(null),
    [selectedEntityId, setSelectedEntityId] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null);
  const contextRequest = useRef(0);
  const refreshProjects = useCallback(async () => {
    const result = await window.workspaceIpc.queries.listProjects();
    setProjects(result);
  }, []);
  useEffect(() => {
    void refreshProjects()
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [refreshProjects]);
  const openProject = useCallback(async (projectId: string) => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await window.workspaceIpc.commands.openProject(projectId);
      setWorkspace(loaded);
      setSelectedEntityId(loaded.selectedEntityId || null);
      setInspector(
        loaded.selectedEntityId
          ? await window.workspaceIpc.queries.getEntityInspectorDetails(loaded.selectedEntityId)
          : null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  const createProject = useCallback(
    async (input: { name: string; slug: string }) => {
      setLoading(true);
      setError(null);
      try {
        const created = await window.workspaceIpc.commands.createProject(input);
        await refreshProjects();
        await openProject(created.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    },
    [openProject, refreshProjects],
  );
  const selectEntity = useCallback(async (entityId: string) => {
    setSelectedEntityId(entityId);
    try {
      setInspector(await window.workspaceIpc.queries.getEntityInspectorDetails(entityId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  const refreshContext = useCallback(
    async (maxAllowedTokens = 32_000, query?: string): Promise<ContextPackageDto | null> => {
      if (!workspace || !selectedEntityId) return null;
      const focus = workspace.graph.nodes.find(node => node.id === selectedEntityId);
      if (!focus || !['FEATURE', 'WORK_ITEM'].includes(focus.type)) return null;
      const request = ++contextRequest.current;
      setContextLoading(true);
      setContextError(null);
      try {
        const trimmedQuery = query?.trim();
        const result = await window.workspaceIpc.queries.previewContext({
          projectId: workspace.project.id,
          focusEntityId: selectedEntityId,
          maxAllowedTokens,
          ...(trimmedQuery ? { query: trimmedQuery, recentNotes: [trimmedQuery] } : {}),
        });
        if (request === contextRequest.current) setContextPackage(result);
        return result;
      } catch (e) {
        if (request === contextRequest.current) setContextError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        if (request === contextRequest.current) setContextLoading(false);
      }
    },
    [workspace, selectedEntityId],
  );
  useEffect(() => {
    const focus = workspace?.graph.nodes.find(node => node.id === selectedEntityId);
    if (focus && ['FEATURE', 'WORK_ITEM'].includes(focus.type)) {
      void refreshContext();
      return;
    }
    contextRequest.current++;
    setContextPackage(null);
    setContextError(null);
    setContextLoading(false);
  }, [workspace?.project.id, workspace?.project.currentRevision, selectedEntityId, refreshContext]);
  const refreshGraph = useCallback(
    async (filter?: GraphFilterDto) => {
      if (!workspace) return;
      try {
        const graph = await window.workspaceIpc.queries.getGraphView(workspace.project.id, filter);
        setWorkspace(current =>
          current?.project.id === graph.projectId
            ? { ...current, project: { ...current.project, currentRevision: graph.revision }, graph }
            : current,
        );
        if (selectedEntityId && !graph.nodes.some(node => node.id === selectedEntityId)) {
          const first = graph.nodes[0]?.id ?? null;
          setSelectedEntityId(first);
          setInspector(first ? await window.workspaceIpc.queries.getEntityInspectorDetails(first) : null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [workspace, selectedEntityId],
  );
  useEffect(
    () =>
      window.workspaceIpc.events.onGraphRevisionUpdated(event => {
        if (workspace?.project.id !== event.projectId) return;
        setWorkspace(current =>
          current?.project.id === event.projectId
            ? { ...current, project: { ...current.project, currentRevision: event.revision } }
            : current,
        );
        void refreshGraph();
      }),
    [workspace?.project.id, refreshGraph],
  );
  const value = useMemo(
    () => ({
      projects,
      activeProject: workspace?.project ?? null,
      workspace,
      inspector,
      contextPackage,
      contextLoading,
      contextError,
      selectedEntityId,
      loading,
      error,
      createProject,
      openProject,
      selectEntity,
      refreshGraph,
      refreshContext,
      refreshProjects,
    }),
    [
      projects,
      workspace,
      inspector,
      contextPackage,
      contextLoading,
      contextError,
      selectedEntityId,
      loading,
      error,
      createProject,
      openProject,
      selectEntity,
      refreshGraph,
      refreshContext,
      refreshProjects,
    ],
  );
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}
export function useWorkspaceNavigation(): WorkspaceNavigationValue {
  const context = useContext(NavigationContext);
  if (!context) throw new Error('WorkspaceNavigationProvider is required.');
  return context;
}

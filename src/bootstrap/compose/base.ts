import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCodeAdapter } from '../../modules/execution/infrastructure/claude-code-adapter.js';
import { SqliteAgentExecutionRepository } from '../../modules/execution/infrastructure/sqlite-agent-execution-repository.js';
import { AtomicMarkdownFileStore } from '../../modules/documents/infrastructure/atomic-markdown-file-store.js';
import { GitDocumentCommitter } from '../../modules/documents/infrastructure/git-document-committer.js';
import { AppSettingsStore } from '../../modules/projects/infrastructure/project-folders.js';
import { GitRepositoryScanner } from '../../modules/projects/infrastructure/repository-scanner.js';
import type { Container, CoreDependencies, EngineConnection, WorkspaceEventEmitter } from '../container.js';
import { ProjectWorkspaceStore } from '../project-workspace-store.js';

/** Shared pieces every module uses: the per-project stores, the wired engine and how a project reaches it. */
export function baseServices(
  workspaceRoot: string,
  emit: WorkspaceEventEmitter,
  dependencies: CoreDependencies,
): Partial<Container> {
  const store = new ProjectWorkspaceStore(workspaceRoot);
  // Claude Code is the wired engine; CodexAgentAdapter stays in the codebase, unwired, until Claude is proven (migration plan, section 3).
  const agentAdapter = dependencies.agentAdapter ?? new ClaudeCodeAdapter();
  const repositoryPath = (projectId: string) =>
    store.openProject(projectId).repositories.findPrimaryForProject(projectId)?.localPath ?? null;
  // Every engine call follows the developer profile: its planning model and how it authenticates.
  const connection = (projectId: string): EngineConnection => {
    const profile = new SqliteAgentExecutionRepository(store.openProject(projectId).database, agentAdapter.providerId)
      .listProfiles(projectId)
      .find(item => item.roleKey === 'DEVELOPER');
    return {
      authMode: profile?.connectionConfig.authMode === 'api_key' ? 'api_key' : 'subscription',
      planningModel: profile?.models.planning ?? null,
      availableModels: profile?.models.available ?? [],
    };
  };
  return {
    workspaceRoot,
    dependencies,
    emit,
    store,
    settings: new AppSettingsStore(workspaceRoot, dependencies.homeDirectory ?? homedir()),
    files: new AtomicMarkdownFileStore(),
    documentCommitter: new GitDocumentCommitter(),
    agentAdapter,
    // Brownfield mode: reads manifests, structure and styles of a repository that already has code (nothing runs, ≤ 48 KB).
    scanner: dependencies.repositoryScanner ?? new GitRepositoryScanner(),
    connection,
    repositoryPath,
    currentRevision: projectId => store.openProject(projectId).projects.findById(projectId)!.currentRevision,
    repositoryOf: projectId => {
      const path = repositoryPath(projectId);
      if (!path) throw new Error('Configura primero un repositorio Git para este proyecto.');
      return path;
    },
    // A neutral working directory for model calls: no project instructions (CLAUDE.md) leak into them.
    engineDirectory: projectId => {
      const cwd = join(workspaceRoot, 'projects', projectId);
      mkdirSync(cwd, { recursive: true });
      return cwd;
    },
  };
}

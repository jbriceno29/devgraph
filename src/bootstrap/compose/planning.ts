import { join } from 'node:path';
import { ChangeSetPlanningService } from '../../modules/planning/application/change-set-planning-service.js';
import { PlanningReferencesService } from '../../modules/planning/application/planning-references.js';
import type { ChangeSetPlannerPort } from '../../modules/planning/application/ports/change-set-planning-port.js';
import { ClaudeChangeSetPlanner } from '../../modules/planning/infrastructure/claude-change-set-planner.js';
import { CodexChangeSetPlanner } from '../../modules/planning/infrastructure/codex-change-set-planner.js';
import { SqliteChangeSetApplier } from '../../modules/knowledge/infrastructure/sqlite-change-set-applier.js';
import { SqliteChangeSetRepository } from '../../modules/knowledge/infrastructure/sqlite-change-set-repository.js';
import { TransactionalMarkdownFileStore } from '../../modules/documents/infrastructure/transactional-markdown-file-store.js';
import type { ReferenceTranslatorPort } from '../../modules/inception/application/ports/inception-port.js';
import { ClaudeReferenceTranslator } from '../../modules/inception/infrastructure/claude-reference-translator.js';
import { InceptionReferenceFiles } from '../../modules/inception/infrastructure/inception-reference-files.js';
import type { Container } from '../container.js';

/** ChangeSet planning (engine, validation, transactional apply) and the reference translator it shares with the inception. */
export function planningServices(c: Container) {
  // The planner follows the wired engine, with the provider's planning model and auth mode.
  const plannerFor = (projectId: string, cwd: string): ChangeSetPlannerPort => {
    if (c.dependencies.changeSetPlanner) return c.dependencies.changeSetPlanner;
    if (c.agentAdapter.providerId !== 'claude-code') return new CodexChangeSetPlanner(cwd);
    const connection = c.connection(projectId);
    return new ClaudeChangeSetPlanner(cwd, { authMode: connection.authMode, defaultModel: connection.planningModel });
  };
  const planning = (projectId: string) => {
    const workspace = c.store.openProject(projectId);
    return new ChangeSetPlanningService(
      workspace.projects,
      workspace.graph,
      new SqliteChangeSetRepository(workspace.database),
      plannerFor(projectId, c.repositoryPath(projectId) ?? process.cwd()),
      new SqliteChangeSetApplier(
        workspace.database,
        new TransactionalMarkdownFileStore(),
        workspace.repositories,
        c.documentCommitter,
      ),
      id => c.repositoryPath(id),
    );
  };
  // The reference translator is its own model call (the only one with a tool: Read, inside a throwaway folder with copies of the files).
  const translator = (projectId: string): ReferenceTranslatorPort =>
    c.dependencies.referenceTranslator ?? {
      translate: input => {
        if (c.agentAdapter.providerId !== 'claude-code')
          throw new Error('El análisis de referencias todavía solo funciona con Claude Code.');
        return new ClaudeReferenceTranslator(c.engineDirectory(projectId), {
          authMode: c.connection(projectId).authMode,
        }).translate(input);
      },
    };
  return {
    planning,
    planningForChangeSet: (changeSetId: string) => {
      for (const project of c.store.listProjects())
        if (new SqliteChangeSetRepository(c.store.openProject(project.id).database).findById(changeSetId))
          return planning(project.id);
      throw new Error('Propuesta no encontrada.');
    },
    translator,
    // References attached while planning a feature (Planificar): translated with the same translator, files kept only during the call.
    planningReferences: new PlanningReferencesService({
      translator,
      files: new InceptionReferenceFiles(join(c.workspaceRoot, 'projects'), 'planning'),
      models: id => ({ planning: c.connection(id).planningModel, available: c.connection(id).availableModels }),
      projectExists: id => c.store.listProjects().some(project => project.id === id),
    }),
    close: () => undefined,
  };
}

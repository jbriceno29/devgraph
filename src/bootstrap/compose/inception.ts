import { join } from 'node:path';
import { ProjectInceptionService } from '../../modules/inception/application/project-inception-service.js';
import type {
  InceptionEnginePort,
  RepositorySurveyorPort,
} from '../../modules/inception/application/ports/inception-port.js';
import { ClaudeInceptionEngine } from '../../modules/inception/infrastructure/claude-inception-engine.js';
import { ClaudeRepositorySurveyor } from '../../modules/inception/infrastructure/claude-repository-surveyor.js';
import { DesignPrototypeWriter } from '../../modules/inception/infrastructure/design-prototype-writer.js';
import { InceptionReferenceFiles } from '../../modules/inception/infrastructure/inception-reference-files.js';
import { SqliteInceptionRepository } from '../../modules/inception/infrastructure/sqlite-inception-repository.js';
import { SqliteChangeSetRepository } from '../../modules/knowledge/infrastructure/sqlite-change-set-repository.js';
import type { Container } from '../container.js';

/** Project inception: one service per project (it tracks its background engine call). The engine follows the wired provider. */
export function inceptionServices(c: Container) {
  const inceptions = new Map<string, ProjectInceptionService>();
  const build = (projectId: string) => {
    const workspace = c.store.openProject(projectId);
    const claudeEngine = () => {
      if (c.agentAdapter.providerId !== 'claude-code')
        throw new Error('El asistente de inicio todavía solo funciona con Claude Code.');
      const connection = c.connection(projectId);
      return new ClaudeInceptionEngine(c.engineDirectory(projectId), {
        authMode: connection.authMode,
        defaultModel: connection.planningModel,
      });
    };
    // Built per call, so `inception:get` works with any engine and auth changes apply to the next call.
    const engine: InceptionEnginePort = c.dependencies.inceptionEngine ?? {
      askGoals: input => claudeEngine().askGoals(input),
      propose: input => claudeEngine().propose(input),
      exploreUi: input => claudeEngine().exploreUi(input),
    };
    return new ProjectInceptionService({
      projects: workspace.projects,
      graph: workspace.graph,
      store: new SqliteInceptionRepository(workspace.database),
      engine,
      planning: {
        submit: (id, draft, originRefId) => c.planning(id).submit(id, draft, originRefId, 'AI_CHAT'),
        find: id => new SqliteChangeSetRepository(workspace.database).findById(id),
        apply: async id => {
          const result = await c.planning(projectId).apply(id);
          return { revision: result.revision, resolvedIds: result.resolvedIds };
        },
        reject: id => {
          c.planning(projectId).reject(id);
        },
      },
      repositoryPath: id => c.repositoryPath(id),
      translator: c.translator(projectId),
      referenceFiles: new InceptionReferenceFiles(join(c.workspaceRoot, 'projects')),
      designFiles: new DesignPrototypeWriter(),
      scanner: c.scanner,
      baselineOf: id => c.baseline.stored(id),
      ...optional('surveyor', surveyorFor(c, projectId)),
      models: id => ({ planning: c.connection(id).planningModel, available: c.connection(id).availableModels }),
      emit: (channel, payload) => c.emit(channel, payload),
    });
  };
  return {
    inception: (projectId: string) => {
      const cached = inceptions.get(projectId);
      if (cached) return cached;
      const service = build(projectId);
      inceptions.set(projectId, service);
      return service;
    },
    inceptionIfStarted: (projectId: string) => inceptions.get(projectId),
    close: () => {
      for (const inception of inceptions.values()) inception.shutdown();
    },
  };
}

/** Plan REP, R3: the survey reads the code with Claude Code on a copy of the base branch. Tests that fake the engine get none unless they inject one. */
function surveyorFor(c: Container, projectId: string): RepositorySurveyorPort | undefined {
  if (c.dependencies.repositorySurveyor) return c.dependencies.repositorySurveyor;
  if (c.dependencies.inceptionEngine) return undefined;
  const checkout = {
    workspaceRoot: c.workspaceRoot,
    repositoryOf: (id: string) => c.repositoryPath(id),
    configuredBase: (id: string) => c.baseBranch(id),
  };
  return {
    survey: input => {
      if (c.agentAdapter.providerId !== 'claude-code')
        throw new Error('La lectura del código todavía solo funciona con Claude Code.');
      return new ClaudeRepositorySurveyor(c.engineDirectory(projectId), checkout, {
        authMode: c.connection(projectId).authMode,
      }).survey(input);
    },
  };
}

const optional = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>;

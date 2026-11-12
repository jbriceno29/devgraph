import type { ProjectEnvironmentDto } from '../../shared/contracts/agent-view.js';
import { serial, text, type IpcHandlers } from '../../shared/ipc-handlers.js';
import type { WorkspaceEnvironmentPort } from '../execution/index.js';
import type { ProjectCommands } from './infrastructure/project-commands.js';

export interface EnvironmentIpcDeps {
  environment(projectId: string): WorkspaceEnvironmentPort;
  environmentView(projectId: string): Promise<ProjectEnvironmentDto>;
  setSkills(projectId: string, enabled: unknown): Promise<ProjectEnvironmentDto>;
  approveDependencies(projectId: string, packages: unknown): Promise<ProjectEnvironmentDto>;
  commands: ProjectCommands;
  repositoryOf(projectId: string): string;
}

/** The project's environment (stack, approved packages, skills) and its own commands on any branch. */
export function environmentHandlers(d: EnvironmentIpcDeps): IpcHandlers {
  return {
    'environment:get': ([id]) => d.environmentView(text(id)),
    'environment:approve_dependencies': serial(([id, packages]) => d.approveDependencies(text(id), packages)),
    'environment:set_skills': serial(([id, enabled]) => d.setSkills(text(id), enabled)),
    'commands:refs': ([id]) => d.commands.refs(d.repositoryOf(text(id))),
    'commands:scripts': ([id, ref]) => d.commands.scripts(d.repositoryOf(text(id)), text(ref)),
    'commands:list': ([id]) => d.commands.list(text(id)),
    'commands:start': serial(([id, raw]) => {
      const projectId = text(id),
        input = (raw ?? {}) as { ref?: unknown; script?: unknown };
      return d.commands.start({
        projectId,
        repositoryRoot: d.repositoryOf(projectId),
        ref: text(input.ref),
        script: text(input.script),
        environment: d.environment(projectId).forProject(projectId),
      });
    }),
    'commands:stop': serial(([, runId]) => d.commands.stop(text(runId))),
  };
}

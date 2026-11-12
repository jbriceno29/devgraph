import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  SkillProvisionPort,
  WorkspaceEnvironmentPort,
} from '../../modules/execution/application/ports/agent-execution-port.js';
import { isInterfaceWork, stackHasInterface } from '../../modules/environment/domain/skill-selection.js';
import { NpmEnvironment } from '../../modules/environment/infrastructure/npm-environment.js';
import { ProjectCommands } from '../../modules/environment/infrastructure/project-commands.js';
import {
  loadBundledSkills,
  materializeSkill,
  type BundledSkill,
} from '../../modules/environment/infrastructure/skill-bundle.js';
import { SqliteProjectEnvironmentRepository } from '../../modules/environment/infrastructure/sqlite-project-environment.js';
import { parseApprovedPackages } from '../../modules/projects/domain/approved-packages.js';
import {
  PACKAGE_NAME,
  environmentFor,
  findStackProfile,
  profilePackages,
} from '../../modules/projects/domain/stack-catalog.js';
import type { ProjectEnvironmentDto } from '../../shared/contracts/agent-view.js';
import { UI_SPEC_PATH } from '../../shared/ui-spec.js';
import type { Container } from '../container.js';

/** What a run's worktree gets: the stack's dependencies (plan S2), the bundled skills (S4) and the project's commands. */
export function environmentServices(c: Container) {
  const rows = (projectId: string) => new SqliteProjectEnvironmentRepository(c.store.openProject(projectId).database);
  const stack = (projectId: string) => rows(projectId).stack(projectId);
  // Installed by the app in each run's worktree (log in executions/<id>/environment.log).
  const installer = c.dependencies.environmentInstaller ?? new NpmEnvironment();
  const commands = new ProjectCommands({
    workspaceRoot: c.workspaceRoot,
    installer: { provision: input => installer.provision(input) },
    emit: (channel, payload) => c.emit(channel as never, payload as never),
    ...(c.dependencies.commandExecutables ?? {}),
  });
  const environment = (_projectId: string) => workspaceEnvironment(c, installer, stack);
  // A bundle that fails its hash is never used (runs go on without skills).
  let bundled: Promise<BundledSkill[]> | null = null;
  const bundledSkills = () =>
    (bundled ??= loadBundledSkills(c.dependencies.skillsDirectory).catch(error => {
      console.error(`[skills] ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }));
  const environmentView = async (projectId: string): Promise<ProjectEnvironmentDto> => {
    const row = stack(projectId),
      profile = findStackProfile(row?.stackProfileId);
    return {
      stackProfile: profile
        ? { id: profile.id, title: profile.title, packages: profilePackages(profile), reviewedAt: profile.reviewedAt }
        : null,
      installs: environmentFor(row?.stackProfileId) !== null,
      approvedPackages: parseApprovedPackages(row?.approvedDependenciesJson),
      skillsEnabled: row?.skillsEnabled === true,
      bundledSkills: (await bundledSkills()).map(skill => ({
        id: skill.manifest.id,
        title: skill.manifest.title,
        license: skill.manifest.license,
      })),
    };
  };
  return {
    environment,
    environmentView,
    commands,
    skills: (projectId: string) => skillProvision(c, projectId, bundledSkills),
    setSkills: (projectId: string, enabled: unknown) => {
      if (typeof enabled !== 'boolean') throw new Error('Indica si activas las skills (sí o no).');
      rows(projectId).setSkillsEnabled(projectId, enabled);
      return environmentView(projectId);
    },
    approveDependencies: (projectId: string, packages: unknown) =>
      approveDependencies(rows(projectId), projectId, packages).then(() => environmentView(projectId)),
    close: () => commands.shutdown(),
  };
}

/** The bundled skills a run gets: only interface work of a project with an interface, and only if its tools exist. */
function skillProvision(
  c: Container,
  projectId: string,
  bundledSkills: () => Promise<BundledSkill[]>,
): SkillProvisionPort {
  const available = (skill: BundledSkill) =>
    skill.manifest.requires.every(
      command => spawnSync(command, ['--version'], { stdio: 'ignore', timeout: 5_000 }).status === 0,
    );
  return {
    select: async input => {
      const rows = new SqliteProjectEnvironmentRepository(c.store.openProject(projectId).database);
      const row = rows.stack(input.projectId);
      if (!row?.skillsEnabled) return [];
      let stack: Record<string, unknown> = {};
      try {
        stack = JSON.parse(row.techStackJson || '{}') as Record<string, unknown>;
      } catch {
        /* no stack */
      }
      const interfaceWork = isInterfaceWork({
        projectHasInterface:
          stackHasInterface(stack) || stackHasInterface(findStackProfile(row.stackProfileId)?.techStack),
        documentedByUiSpec: rows.tasksDocumentedBy(
          input.tasks.map(task => task.id),
          UI_SPEC_PATH,
        ),
        tasks: input.tasks,
      });
      if (!interfaceWork) return [];
      return (await bundledSkills())
        .filter(skill => skill.manifest.appliesTo === 'INTERFACE' && available(skill))
        .map(skill => skill.manifest.id);
    },
    materialize: async input => {
      const skills = (await bundledSkills()).filter(skill => input.skillIds.includes(skill.manifest.id));
      const paths: string[] = [];
      for (const skill of skills) paths.push(await materializeSkill(skill, input.workingDirectory));
      return { paths, notes: skills.map(skill => skill.manifest.promptNote) };
    },
    ownedPaths: async () => (await bundledSkills()).map(skill => `.claude/skills/${skill.manifest.id}`),
  };
}

/** Adds packages to the ones the user approved for a stack profile (plan S2). */
async function approveDependencies(rows: SqliteProjectEnvironmentRepository, projectId: string, packages: unknown) {
  const names = (Array.isArray(packages) ? packages : []).map(name => String(name).trim()).filter(Boolean);
  if (!names.length) throw new Error('Indica qué paquetes apruebas.');
  const invalid = names.filter(name => !PACKAGE_NAME.test(name));
  if (invalid.length) throw new Error(`Nombres de paquete no válidos: ${invalid.join(', ')}.`);
  const row = rows.stack(projectId);
  if (!environmentFor(row?.stackProfileId))
    throw new Error('Este proyecto no sigue un perfil de stack con dependencias.');
  rows.setApprovedDependencies(
    projectId,
    [...new Set([...parseApprovedPackages(row?.approvedDependenciesJson), ...names])].sort(),
  );
}

/** The environment a run's worktree gets, with its install log next to the run's artifacts. */
function workspaceEnvironment(
  c: Container,
  installer: NonNullable<Container['dependencies']['environmentInstaller']>,
  stack: (projectId: string) => ReturnType<SqliteProjectEnvironmentRepository['stack']>,
): WorkspaceEnvironmentPort {
  return {
    forProject: id => {
      const row = stack(id);
      return environmentFor(row?.stackProfileId, parseApprovedPackages(row?.approvedDependenciesJson));
    },
    provision: async input => {
      const result = await installer.provision(input);
      const directory = join(c.workspaceRoot, 'projects', input.projectId, 'executions', input.executionId);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'environment.log'), `${result.log}\n`, 'utf8');
      return result;
    },
    reconcile: input => installer.reconcile(input),
  };
}

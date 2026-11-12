import { AcceptKnownFailures } from '../../modules/environment/application/accept-known-failures.js';
import { BaselineRegistry } from '../../modules/environment/application/baseline-registry.js';
import { GetVerificationBaseline } from '../../modules/environment/application/get-verification-baseline.js';
import type { BaselineStorePort, PolicyChecksPort } from '../../modules/environment/application/ports/baseline-port.js';
import { RunVerificationBaseline } from '../../modules/environment/application/run-verification-baseline.js';
import { blockingFailures, type VerificationBaseline } from '../../modules/environment/domain/verification-baseline.js';
import { NpmEnvironment } from '../../modules/environment/infrastructure/npm-environment.js';
import { SqliteProjectEnvironmentRepository } from '../../modules/environment/infrastructure/sqlite-project-environment.js';
import { GitBaselineRunner } from '../../modules/execution/infrastructure/baseline-runner.js';
import { parseApprovedPackages } from '../../modules/projects/domain/approved-packages.js';
import { profileIssues } from '../../modules/projects/domain/project-profile.js';
import { environmentFor } from '../../modules/projects/domain/stack-catalog.js';
import type { Container } from '../container.js';

/** Plan REP, R2: the verification baseline of each project, run on a copy of its base branch. */
export function verificationBaselineServices(c: Container) {
  const rows = (projectId: string) => new SqliteProjectEnvironmentRepository(c.store.openProject(projectId).database);
  const store = baselineStore(rows);
  const policyOf = (projectId: string) => c.execution(projectId).getPolicy(projectId);
  const policy = policyChecks(c);
  const commands = {
    // Known failures left the policy, but the baseline keeps checking them until they pass.
    defaults: (projectId: string) => [
      ...new Set([...policyOf(projectId).allowedCommands, ...(store.get(projectId)?.knownFailing ?? [])]),
    ],
    issues: (list: string[]) =>
      profileIssues({
        objectives: ['-'],
        outOfScope: [],
        rules: [],
        techStack: { x: '-' },
        verificationCommands: list,
      }),
  };
  const runner = baselineRunner(c, rows);
  const registry = new BaselineRegistry();
  const status = new GetVerificationBaseline(store, registry, commands);
  return {
    baseline: {
      get: status,
      run: new RunVerificationBaseline(store, registry, runner, commands, status, policy),
      acceptKnown: new AcceptKnownFailures(store, status, policy),
      /** The stored baseline (the inception adds the fix task from it). */
      stored: (projectId: string) => store.get(projectId),
      /** Why the pilot cannot start (R2): failing checks not accepted as known. */
      pilotBlocker: (projectId: string) => {
        const blocking = blockingFailures(store.get(projectId));
        return blocking.length
          ? `La verificación de la rama base falla (${blocking.join(', ')}). Termina la tarea «Dejar la verificación en verde» y vuelve a comprobarla en Ajustes, o acepta esos fallos como conocidos.`
          : null;
      },
    },
    close: () => undefined,
  };
}

function baselineStore(rows: (projectId: string) => SqliteProjectEnvironmentRepository): BaselineStorePort {
  return {
    get: projectId => {
      const json = rows(projectId).baselineJson(projectId);
      try {
        return json ? (JSON.parse(json) as VerificationBaseline) : null;
      } catch {
        return null;
      }
    },
    save: (projectId, baseline) => rows(projectId).setBaselineJson(projectId, JSON.stringify(baseline)),
  };
}

/** Known failures leave the policy's checks and come back when they are no longer known. */
function policyChecks(c: Container): PolicyChecksPort {
  const policyOf = (projectId: string) => c.execution(projectId).getPolicy(projectId);
  return {
    exclude: (projectId: string, list: string[]) => {
      const current = policyOf(projectId);
      if (list.some(command => current.allowedCommands.includes(command)))
        c.execution(projectId).updatePolicy(projectId, {
          ...current,
          allowedCommands: current.allowedCommands.filter(command => !list.includes(command)),
        });
    },
    restore: (projectId: string, list: string[]) => {
      const current = policyOf(projectId);
      const missing = list.filter(command => !current.allowedCommands.includes(command));
      if (missing.length)
        c.execution(projectId).updatePolicy(projectId, {
          ...current,
          allowedCommands: [...current.allowedCommands, ...missing],
        });
    },
  };
}

function baselineRunner(
  c: Container,
  rows: (projectId: string) => SqliteProjectEnvironmentRepository,
): GitBaselineRunner {
  return new GitBaselineRunner({
    workspaceRoot: c.workspaceRoot,
    installer: c.dependencies.environmentInstaller ?? new NpmEnvironment(),
    environmentFor: projectId => {
      const row = rows(projectId).stack(projectId);
      return environmentFor(row?.stackProfileId, parseApprovedPackages(row?.approvedDependenciesJson));
    },
    repositoryOf: projectId => c.repositoryPath(projectId),
    configuredBase: projectId => c.baseBranch(projectId),
  });
}

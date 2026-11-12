import { normalizeDecisionPolicy } from '../../autopilot/index.js';
import type { AutonomyPolicy } from '../domain/governance.js';
import type { ExecutionKernel } from './execution-kernel.js';

/** Execution policy of the project's DEVELOPER profile (paths and verification commands). */
export function getPolicy(
  k: ExecutionKernel,
  projectId: string,
): Pick<
  AutonomyPolicy,
  | 'writablePaths'
  | 'readonlyPaths'
  | 'deniedPaths'
  | 'allowedCommands'
  | 'maxExecutionMinutes'
  | 'maxTurns'
  | 'decisionPolicy'
> {
  const policy = k.repository.getAutonomyPolicy(projectId, developerProfileId(k, projectId));
  return {
    writablePaths: policy.writablePaths,
    readonlyPaths: policy.readonlyPaths,
    deniedPaths: policy.deniedPaths,
    allowedCommands: policy.allowedCommands,
    maxExecutionMinutes: policy.maxExecutionMinutes,
    maxTurns: policy.maxTurns,
    decisionPolicy: policy.decisionPolicy,
  };
}

export function updatePolicy(
  k: ExecutionKernel,
  projectId: string,
  input: Pick<AutonomyPolicy, 'writablePaths' | 'readonlyPaths' | 'deniedPaths' | 'allowedCommands'> & {
    maxExecutionMinutes?: number;
    maxTurns?: number | null;
    decisionPolicy?: unknown;
  },
) {
  const policy = k.repository.getAutonomyPolicy(projectId, developerProfileId(k, projectId));
  const minutes = input.maxExecutionMinutes ?? policy.maxExecutionMinutes;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240)
    throw new Error('El tiempo máximo por ejecución debe ser un número entero de minutos entre 1 y 240.');
  const turns = input.maxTurns === undefined ? policy.maxTurns : (input.maxTurns ?? 0);
  if (!Number.isInteger(turns) || turns < 0 || turns > 1000)
    throw new Error('El tope de turnos por ejecución debe ser un número entero entre 0 (sin límite) y 1000.');
  const clean = {
    writablePaths: cleanPatterns(input.writablePaths, 'escribible'),
    readonlyPaths: cleanPatterns(input.readonlyPaths, 'de solo lectura'),
    deniedPaths: cleanPatterns(input.deniedPaths, 'prohibida'),
    allowedCommands: cleanCommands(input.allowedCommands),
    maxExecutionMinutes: minutes,
    maxTurns: turns,
    decisionPolicy:
      input.decisionPolicy === undefined ? policy.decisionPolicy : normalizeDecisionPolicy(input.decisionPolicy),
  };
  k.repository.updateAutonomyPolicy(policy.id, clean);
  return clean;
}

export function developerProfileId(k: ExecutionKernel, projectId: string): string {
  const profile = k.repository.listProfiles(projectId).find(item => item.roleKey === 'DEVELOPER');
  if (!profile) throw new Error('El proyecto no tiene un perfil DEVELOPER.');
  return profile.id;
}

/** Repository-relative glob patterns; a leading `/` anchors at the root (gitignore semantics). */
function cleanPatterns(values: string[], label: string): string[] {
  const cleaned = [...new Set(values.map(value => value.trim()).filter(Boolean))];
  for (const pattern of cleaned) {
    const escapes =
      pattern.split('/').includes('..') ||
      pattern.startsWith('~') ||
      pattern.startsWith('//') ||
      /^[A-Za-z]:/.test(pattern) ||
      pattern.includes('\\');
    if (escapes) throw new Error(`Ruta ${label} no válida: ${pattern}. Usa rutas relativas al repositorio.`);
  }
  return cleaned;
}

function cleanCommands(values: string[]): string[] {
  const cleaned = [...new Set(values.map(value => value.trim()).filter(Boolean))];
  for (const command of cleaned)
    if (/[;&|`$<>\n\r]/.test(command))
      throw new Error(
        `Comando no permitido: ${command}. No se admiten tuberías, redirecciones ni operadores de shell.`,
      );
  return cleaned;
}

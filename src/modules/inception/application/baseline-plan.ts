import type { ChangeOperation } from '../../knowledge/index.js';
import type { PlanBaseline } from './ports/inception-port.js';

export const FIX_VERIFICATION_TITLE = 'Dejar la verificación en verde';
const FIX_TEMP_ID = '$fix-verification';

/**
 * Plan REP, R2: what the verification baseline changes in the proposal of an existing repository.
 * - A failing check puts the task «Dejar la verificación en verde» first in «Fundación» (or the first feature).
 * - A failure the user accepted as known leaves the checks and is written down in the project's rules.
 */
export function withBaseline(
  operations: ChangeOperation[],
  baseline: PlanBaseline | null | undefined,
): ChangeOperation[] {
  const failing = (baseline?.checks ?? []).filter(check => !check.passed);
  if (!baseline || !failing.length) return operations;
  const known = failing.filter(check => baseline.knownFailing.includes(check.command)).map(check => check.command);
  const features = operations.filter(
    (op): op is Extract<ChangeOperation, { type: 'CREATE_FEATURE' }> => op.type === 'CREATE_FEATURE',
  );
  const foundation = features.find(op => /fundaci/i.test(op.title)) ?? features[0];
  const result = operations.map(op =>
    op.type === 'SET_PROJECT_PROFILE' && known.length
      ? {
          ...op,
          verificationCommands: op.verificationCommands.filter(command => !known.includes(command)),
          rules: [
            ...op.rules,
            `Fallos conocidos al empezar: ${known.join(', ')}. Quedan fuera de las comprobaciones hasta que la tarea «${FIX_VERIFICATION_TITLE}» los arregle.`,
          ],
        }
      : op,
  );
  if (!foundation) return result;
  const task: ChangeOperation = {
    type: 'CREATE_WORK_ITEM',
    tempId: FIX_TEMP_ID,
    parentId: foundation.tempId,
    workType: 'TASK',
    priority: 'CRITICAL',
    recommendedProfileRole: 'DEVELOPER',
    title: FIX_VERIFICATION_TITLE,
    summary: `Estas comprobaciones ya fallaban en la rama base antes de cualquier cambio: ${failing.map(check => check.command).join(', ')}. Haz que pasen corrigiendo la causa, sin borrar, saltar ni debilitar pruebas. Final de la salida:\n${failing.map(check => `$ ${check.command}\n${check.tail.slice(-600)}`).join('\n\n')}`,
    acceptanceCriteria: failing.map(check => `«${check.command}» pasa en la rama de la feature.`),
  };
  const at = result.indexOf(foundation) + 1;
  return [...result.slice(0, at), task, ...result.slice(at)];
}

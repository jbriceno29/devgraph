import { serial, text, type IpcHandlers } from '../../shared/ipc-handlers.js';
import type { Container } from '../container.js';

/** Plan REP, R2: the verification baseline (Ajustes and «Qué podrá tocar el agente»). */
export function verificationBaselineHandlers(c: Container): IpcHandlers {
  return {
    'baseline:get': async ([id]) => c.baseline.get.execute(text(id)),
    'baseline:run': serial(async ([id, commands]) => c.baseline.run.execute(text(id), commands)),
    'baseline:accept_known': serial(async ([id, commands]) => c.baseline.acceptKnown.execute(text(id), commands)),
  };
}

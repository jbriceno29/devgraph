import { serial, text, type IpcHandlers } from '../../shared/ipc-handlers.js';
import type { Container } from '../container.js';

/** Plan C1: which documentation the project's agents may read (Ajustes › Documentación en línea). */
export function projectDocsHandlers(c: Container): IpcHandlers {
  return {
    'project:docs': async ([id]) => c.docsView(text(id)),
    'project:set_docs': serial(async ([id, input]) => c.setDocs(text(id), input)),
  };
}

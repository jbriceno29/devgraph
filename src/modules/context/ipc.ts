import type { PreviewContextInput } from '../../shared/contracts/context-view.js';
import { text, type IpcHandlers } from '../../shared/ipc-handlers.js';
import type { ContextEngine } from './application/context-engine.js';

export interface ContextIpcDeps {
  context(projectId: string): ContextEngine;
  contextForSnapshot(snapshotId: string): ContextEngine;
}

/** The context a task would get (preview) and the snapshot a run received. */
export function contextHandlers(d: ContextIpcDeps): IpcHandlers {
  return {
    // UI preview, outside any execution: it reflects the user's working copy and HEAD on purpose (no sourceCommit).
    'context:preview_package': ([raw]) => {
      const { sourceCommit: _ignored, ...input } = raw as PreviewContextInput & { sourceCommit?: unknown };
      return d.context(input.projectId).preview(input);
    },
    'context:get_snapshot': ([id]) => d.contextForSnapshot(text(id)).getSnapshot(text(id)),
  };
}

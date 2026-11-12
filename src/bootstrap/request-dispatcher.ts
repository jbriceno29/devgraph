import type { WorkspaceRequest } from './workspace-core.js';

/**
 * Commands that mutate shared state run one at a time, in arrival order; each module declares them with `serial` in
 * its ipc.ts. Everything else (queries and the long-running ChangeSet proposal, which only reads the graph and inserts
 * a new pending ChangeSet) runs concurrently, so a slow proposal or execution start never blocks the rest of the UI.
 */
interface DispatchedCore {
  handle(request: WorkspaceRequest): Promise<unknown>;
  isSerialized(channel: string): boolean;
}

interface SidecarRequest {
  id: string;
  request: WorkspaceRequest;
}
type Output = (value: unknown) => void;

/** Returns a line handler that answers each request with its own id, possibly out of order. */
export function createRequestDispatcher(core: DispatchedCore, output: Output) {
  let serialQueue: Promise<void> = Promise.resolve();
  const inFlight = new Set<Promise<void>>();

  const answer = async (input: SidecarRequest): Promise<void> => {
    try {
      output({ id: input.id, ok: true, result: await core.handle(input.request) });
    } catch (error) {
      output({ id: input.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };

  return {
    dispatch(line: string): void {
      if (!line.trim()) return;
      let input: SidecarRequest;
      try {
        input = JSON.parse(line) as SidecarRequest;
      } catch (error) {
        output({
          id: null,
          ok: false,
          error: `Invalid sidecar request: ${error instanceof Error ? error.message : String(error)}`,
        });
        return;
      }
      const channel = String(input.request?.channel ?? '');
      const task = core.isSerialized(channel) ? (serialQueue = serialQueue.then(() => answer(input))) : answer(input);
      inFlight.add(task);
      void task.finally(() => inFlight.delete(task));
    },
    /** Resolves once every accepted request has been answered. */
    async drain(): Promise<void> {
      while (inFlight.size) await Promise.all([...inFlight]);
    },
  };
}

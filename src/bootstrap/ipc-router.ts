import type { IpcHandlers } from '../shared/ipc-handlers.js';

/** Joins the handlers of every module; a channel answered twice is a wiring mistake and fails at start. */
export function createIpcRouter(groups: IpcHandlers[]) {
  const handlers = new Map<string, IpcHandlers[string]>();
  for (const group of groups)
    for (const [channel, handler] of Object.entries(group)) {
      if (handlers.has(channel)) throw new Error(`IPC channel answered twice: ${channel}`);
      handlers.set(channel, handler);
    }
  return {
    channels: () => [...handlers.keys()],
    /** The channel mutates shared state and must run one at a time (declared with `serial` by its module). */
    isSerialized: (channel: string) => handlers.get(channel)?.serialized === true,
    handle: async (channel: string, args: unknown[]): Promise<unknown> => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`Unsupported workspace IPC channel: ${channel}`);
      return handler(Array.isArray(args) ? args : []);
    },
  };
}

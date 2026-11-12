/**
 * One IPC channel's handler: receives the request's positional arguments and returns the response (or its promise).
 * `serialized`: it mutates shared state, so the sidecar runs it one at a time, in arrival order (see `serial`).
 */
export type IpcHandler = ((args: unknown[]) => unknown) & { serialized?: boolean };
/** The channels a module answers, by name. */
export type IpcHandlers = Record<string, IpcHandler>;
/** Marks a handler that mutates shared state: it never runs at the same time as another serialized one. */
export const serial = (handler: (args: unknown[]) => unknown): IpcHandler =>
  Object.assign(handler, { serialized: true });
/** A positional argument as text (missing → ''). */
export const text = (value: unknown): string => String(value ?? '');

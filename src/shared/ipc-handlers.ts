/** One IPC channel's handler: receives the request's positional arguments and returns the response (or its promise). */
export type IpcHandler = (args: unknown[]) => unknown;
/** The channels a module answers, by name. */
export type IpcHandlers = Record<string, IpcHandler>;
/** A positional argument as text (missing → ''). */
export const text = (value: unknown): string => String(value ?? '');

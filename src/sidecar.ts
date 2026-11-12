/**
 * Entry point of the Node core (the sidecar the Tauri host starts). Its path is stable on purpose: the Rust host and
 * the packaged resources point at `sidecar.js`, so moving the core's folders never touches them.
 */
import { createInterface } from 'node:readline';
import { createWorkspaceCore } from './infrastructure/ipc/sidecar/workspace-core.js';
import { createRequestDispatcher } from './infrastructure/ipc/sidecar/request-dispatcher.js';

const output = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
const root = process.env.GRAPHDEV_WORKSPACE_ROOT;
if (!root) throw new Error('GRAPHDEV_WORKSPACE_ROOT is required.');
const core = createWorkspaceCore(root, (channel, payload) => output({ type: 'event', channel, payload }));
const dispatcher = createRequestDispatcher(core, output);
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

try {
  for await (const line of lines) dispatcher.dispatch(line);
  await dispatcher.drain();
} finally {
  core.close();
}

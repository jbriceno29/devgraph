import { describe, expect, it } from 'vitest';
import { createRequestDispatcher } from '../../src/bootstrap/request-dispatcher.js';
import type { WorkspaceRequest } from '../../src/bootstrap/workspace-core.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return { promise, resolve };
}
const line = (id: string, channel: string) => JSON.stringify({ id, request: { channel, args: [] } });

describe('sidecar request dispatcher (D1)', () => {
  it('answers a query while a slow ChangeSet proposal is still running', async () => {
    const slow = deferred();
    const answered: string[] = [];
    const dispatcher = createRequestDispatcher(
      {
        handle: async (request: WorkspaceRequest) => {
          if (request.channel === 'changeset:propose_from_chat') await slow.promise;
          return request.channel;
        },
        isSerialized: () => false,
      },
      value => answered.push((value as { id: string }).id),
    );
    dispatcher.dispatch(line('propose', 'changeset:propose_from_chat'));
    dispatcher.dispatch(line('list', 'project:list'));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(answered).toEqual(['list']);
    slow.resolve();
    await dispatcher.drain();
    expect(answered).toEqual(['list', 'propose']);
  });

  it('runs mutating commands one at a time in arrival order', async () => {
    const first = deferred();
    const order: string[] = [];
    let running = 0,
      maxRunning = 0;
    const dispatcher = createRequestDispatcher(
      {
        handle: async (request: WorkspaceRequest) => {
          running += 1;
          maxRunning = Math.max(maxRunning, running);
          order.push(`start ${request.channel}`);
          if (request.channel === 'artifact:save') await first.promise;
          running -= 1;
          order.push(`end ${request.channel}`);
          return null;
        },
        isSerialized: () => true,
      },
      () => undefined,
    );
    dispatcher.dispatch(line('a', 'artifact:save'));
    dispatcher.dispatch(line('b', 'changeset:apply'));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(order).toEqual(['start artifact:save']);
    first.resolve();
    await dispatcher.drain();
    expect(order).toEqual(['start artifact:save', 'end artifact:save', 'start changeset:apply', 'end changeset:apply']);
    expect(maxRunning).toBe(1);
  });

  it('keeps the queue going after a failed command and reports errors with the request id', async () => {
    const outputs: unknown[] = [];
    const dispatcher = createRequestDispatcher(
      {
        handle: async (request: WorkspaceRequest) => {
          if (request.channel === 'changeset:apply') throw new Error('REVISION_CONFLICT');
          return 'ok';
        },
        isSerialized: () => true,
      },
      value => outputs.push(value),
    );
    dispatcher.dispatch(line('a', 'changeset:apply'));
    dispatcher.dispatch(line('b', 'changeset:reject'));
    dispatcher.dispatch('not json');
    await dispatcher.drain();
    expect(outputs).toEqual(
      expect.arrayContaining([
        { id: 'a', ok: false, error: 'REVISION_CONFLICT' },
        { id: 'b', ok: true, result: 'ok' },
        expect.objectContaining({ id: null, ok: false }),
      ]),
    );
  });
});

describe('canales serializados declarados por cada módulo (A1b)', () => {
  it('are exactly the mutating commands the dispatcher serialized before, and every channel has a handler', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createWorkspaceCore } = await import('../../src/bootstrap/workspace-core.js');
    const root = mkdtempSync(join(tmpdir(), 'graphdev2-channels-'));
    const core = createWorkspaceCore(root);
    try {
      const serialized = core
        .channels()
        .filter(channel => core.isSerialized(channel))
        .sort();
      expect(serialized).toEqual(
        [
          'artifact:create',
          'artifact:save',
          'changeset:apply',
          'changeset:edit',
          'changeset:reject',
          'commands:start',
          'commands:stop',
          'decision:set_status',
          'environment:approve_dependencies',
          'environment:set_skills',
          'execution:accept',
          'execution:cancel',
          'execution:request_changes',
          'execution:resolve_approval',
          'execution:start',
          'feature:integrate',
          'feature:resolve_conflicts',
          'inception:answer',
          'inception:approve',
          'inception:choose_ui',
          'inception:import_design',
          'inception:import_prototype',
          'inception:reopen_design',
          'inception:restart',
          'inception:revise_ui',
          'inception:start',
          'pilot:resume',
          'pilot:set_autonomy',
          'pilot:start',
          'pilot:stop',
          'policy:update',
          'project:create',
          'project:open',
          'provider:set_auth_mode',
          'repository:configure',
          'repository:initialize',
          'repository:set_base_branch',
          'settings:set_projects_folder',
          'workitem:set_status',
        ].sort(),
      );
      expect(core.isSerialized('changeset:propose_from_chat')).toBe(false);
      expect(core.isSerialized('project:list')).toBe(false);
      // Every channel the Tauri client calls has a handler in some module.
      const { readFileSync } = await import('node:fs');
      const client = readFileSync(new URL('../../src/desktop/platform/tauri-ipc-client.ts', import.meta.url), 'utf8');
      const called = [...client.matchAll(/invokeCore(?:<[^>]*>)?\('([a-z_]+:[a-z_]+)'/g)].map(match => match[1]);
      expect(called.length).toBeGreaterThan(50);
      expect(called.filter(channel => !core.channels().includes(channel!))).toEqual([]);
    } finally {
      core.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

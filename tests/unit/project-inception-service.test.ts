import { describe, expect, it } from 'vitest';
import { ProjectInceptionService } from '../../src/application/inception/project-inception-service.js';
import type { InceptionRecord } from '../../src/application/ports/inception-port.js';

/** The service with in-memory stand-ins, to check what happens when the database misbehaves. */
function service(failSavesWhere: (record: InceptionRecord) => boolean) {
  const rows = new Map<string, InceptionRecord>(); const notified: string[] = [];
  const store = { find: (id: string) => rows.get(id) ?? null, delete: (id: string) => { rows.delete(id); }, save: (record: InceptionRecord) => { if (failSavesWhere(record)) throw new Error('disco lleno'); rows.set(record.projectId, record); } };
  const engine = { askGoals: async () => ({ questions: [{ id: 'q1', text: '¿?', options: ['a'], default: 'a', why: 'w' }], assumptions: [], usage: null }), propose: async () => { throw new Error('no'); }, exploreUi: async () => { throw new Error('no'); } };
  const instance = new ProjectInceptionService({
    projects: { findById: () => ({ props: { name: 'P', description: null } }) } as never,
    graph: { listEntities: () => [{ id: 'root', entityType: 'PROJECT_ROOT' }] } as never,
    store, engine, planning: {} as never, repositoryPath: () => null, models: () => ({ planning: 'opus', available: ['opus', 'sonnet'] }), emit: (_channel, payload) => { notified.push(JSON.stringify(payload)); },
  });
  return { instance, rows, notified };
}

describe('ProjectInceptionService: a result that cannot be stored', () => {
  it('turns into a failed call with the reason instead of staying WORKING forever, and can be retried', async () => {
    let refuse = true;
    const { instance, rows, notified } = service(record => refuse && record.status === 'WAITING_USER');
    instance.start('p', { brief: 'Una idea' });
    await instance.settled('p');
    expect(rows.get('p')).toMatchObject({ stage: 'ASK_GOALS', status: 'FAILED', error: 'No se pudo guardar el resultado: disco lleno' });
    expect(instance.get('p')).toMatchObject({ status: 'FAILED', nextAction: 'RETRY_QUESTIONS', error: 'No se pudo guardar el resultado: disco lleno' });
    expect(notified.at(-1)).toContain('"status":"FAILED"');
    refuse = false;
    instance.start('p', { brief: 'Una idea' });
    await instance.settled('p');
    expect(instance.get('p')).toMatchObject({ status: 'WAITING_USER', error: null });
  });
});

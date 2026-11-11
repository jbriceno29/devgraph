import test from 'node:test'; import assert from 'node:assert/strict'; import { mkdtempSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { createTaskList } from '../src/tasks.js'; import { loadTasks } from '../src/storage.js'; import { toCsv, fromCsv } from '../src/csv.js';
const file = content => { const f = join(mkdtempSync(join(tmpdir(), 'bench2-')), 'tasks.json'); writeFileSync(f, content); return f; };
const rejects = async (work) => { let error; try { await work(); } catch (caught) { error = caught; } assert.ok(error instanceof RangeError, `expected RangeError, got ${error}`); };
test('C4 malformed JSON is rejected with RangeError', async () => { await rejects(() => loadTasks(file('{ not json'))); });
test('C4 invalid priority in JSON is rejected with RangeError', async () => { await rejects(() => loadTasks(file(JSON.stringify([{ id: 1, title: 'a', completed: false, priority: 'urgente', due: null, tags: [] }])))); });
test('C4 invalid date in CSV is rejected with RangeError', async () => { const l = createTaskList(); l.add('a', { due: '2026-01-01' }); await rejects(() => fromCsv(toCsv(l).replace('2026-01-01', '2026-13-45'))); });

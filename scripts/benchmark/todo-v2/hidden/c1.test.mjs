import test from 'node:test'; import assert from 'node:assert/strict'; import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { createTaskList } from '../src/tasks.js'; import { saveTasks, loadTasks } from '../src/storage.js';
const file = () => join(mkdtempSync(join(tmpdir(), 'bench2-')), 'tasks.json');
const seeded = () => { const l = createTaskList(); const a = l.add('a', { priority: 'alta', due: '2026-03-01' }); l.add('b'); l.tag(a.id, 'casa'); l.complete(a.id); return l; };
test('C1 nothing is lost', async () => { const l = seeded(); const f = file(); await saveTasks(l, f); assert.deepEqual((await loadTasks(f)).list(), l.list()); });
test('C1 loaded list keeps the interface and ids continue', async () => { const l = seeded(); const f = file(); await saveTasks(l, f); const loaded = await loadTasks(f); const c = loaded.add('c', { priority: 'baja' }); assert.ok(c.id > 2); loaded.rename(c.id, 'cc'); loaded.tag(c.id, 'x'); loaded.remove(1); assert.deepEqual(loaded.list().map(t => t.title), ['b', 'cc']); });

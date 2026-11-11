import test from 'node:test'; import assert from 'node:assert/strict'; import { createTaskList } from '../src/tasks.js'; import { summarize } from '../src/stats.js';
test('B4 summarize counts total, completed and pending', () => { const l = createTaskList(); const a = l.add('a'); l.add('b'); l.add('c'); l.complete(a.id); assert.deepEqual({ ...summarize(l) }, { total: 3, completed: 1, pending: 2 }); });
test('B4 summarize of an empty list', () => { assert.deepEqual({ ...summarize(createTaskList()) }, { total: 0, completed: 0, pending: 0 }); });

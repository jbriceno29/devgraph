import test from 'node:test'; import assert from 'node:assert/strict'; import { createTaskList } from '../src/tasks.js';
test('A4 remove deletes and returns a copy', () => { const l = createTaskList(); const a = l.add('a'); l.add('b'); assert.equal(l.remove(a.id).title, 'a'); assert.deepEqual(l.list().map(t => t.title), ['b']); });
test('A4 unknown id is rejected without changes', () => { const l = createTaskList(); l.add('a'); assert.equal(typeof l.remove, 'function'); assert.throws(() => l.remove(9)); assert.equal(l.list().length, 1); });

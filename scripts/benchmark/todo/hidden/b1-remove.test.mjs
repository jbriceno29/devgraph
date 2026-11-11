import test from 'node:test'; import assert from 'node:assert/strict'; import { createTaskList } from '../src/tasks.js';
test('B1 remove deletes the task and returns a copy', () => { const l = createTaskList(); const a = l.add('a'); l.add('b'); const removed = l.remove(a.id); assert.equal(removed.title, 'a'); assert.deepEqual(l.list().map(t => t.title), ['b']); });
test('B1 remove of an unknown id throws without changes', () => { const l = createTaskList(); l.add('a'); assert.equal(typeof l.remove, 'function'); assert.throws(() => l.remove(99)); assert.equal(l.list().length, 1); });
test('B1 remove with a non-number id throws TypeError', () => { const l = createTaskList(); l.add('a'); assert.equal(typeof l.remove, 'function'); assert.throws(() => l.remove('1'), TypeError); });

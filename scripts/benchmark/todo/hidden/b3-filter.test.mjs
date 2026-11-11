import test from 'node:test'; import assert from 'node:assert/strict'; import { createTaskList } from '../src/tasks.js';
const seeded = () => { const l = createTaskList(); const a = l.add('a'); l.add('b'); l.complete(a.id); return l; };
test('B3 list() returns all tasks', () => { assert.equal(seeded().list().length, 2); });
test('B3 list({ completed: true }) returns only completed', () => { assert.deepEqual(seeded().list({ completed: true }).map(t => t.title), ['a']); });
test('B3 list({ completed: false }) returns only pending', () => { assert.deepEqual(seeded().list({ completed: false }).map(t => t.title), ['b']); });

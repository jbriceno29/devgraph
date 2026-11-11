import test from 'node:test'; import assert from 'node:assert/strict'; import { createTaskList } from '../src/tasks.js';
test('A2 due is stored as given', () => { const l = createTaskList(); assert.equal(l.add('a', { due: '2026-12-01' }).due, '2026-12-01'); });
test('A2 no due is null', () => { assert.equal(createTaskList().add('a').due, null); });
test('A2 wrong format throws RangeError', () => { assert.throws(() => createTaskList().add('a', { due: '01/12/2026' }), RangeError); });
test('A2 impossible date throws RangeError', () => { assert.throws(() => createTaskList().add('a', { due: '2026-02-30' }), RangeError); });

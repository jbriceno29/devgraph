import test from 'node:test'; import assert from 'node:assert/strict'; import { createTaskList } from '../src/tasks.js';
test('A1 default priority is media', () => { const l = createTaskList(); assert.equal(l.add('a').priority, 'media'); });
test('A1 add accepts { priority }', () => { const l = createTaskList(); assert.equal(l.add('a', { priority: 'alta' }).priority, 'alta'); assert.equal(l.list()[0].priority, 'alta'); });
test('A1 unknown priority throws RangeError (project convention)', () => { const l = createTaskList(); assert.throws(() => l.add('a', { priority: 'urgente' }), RangeError); assert.equal(l.list().length, 0); });

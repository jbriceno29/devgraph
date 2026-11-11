import test from 'node:test'; import assert from 'node:assert/strict'; import { createTaskList } from '../src/tasks.js';
const seeded = () => { const l = createTaskList(); const a = l.add('a', { priority: 'alta' }); const b = l.add('b'); l.add('c', { priority: 'alta' }); l.tag(a.id, 'casa'); l.tag(b.id, 'casa'); l.complete(a.id); return l; };
test('B1 no filter returns all', () => { assert.equal(seeded().list().length, 3); });
test('B1 filters combine', () => { const l = seeded(); assert.deepEqual(l.list({ priority: 'alta' }).map(t => t.title), ['a', 'c']); assert.deepEqual(l.list({ tag: 'casa', completed: false }).map(t => t.title), ['b']); assert.deepEqual(l.list({ priority: 'alta', completed: false }).map(t => t.title), ['c']); });

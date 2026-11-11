import test from 'node:test'; import assert from 'node:assert/strict'; import { createTaskList } from '../src/tasks.js';
test('A3 tags start empty', () => { assert.deepEqual(createTaskList().add('a').tags, []); });
test('A3 tag normalizes and deduplicates; untag removes', () => { const l = createTaskList(); const t = l.add('a'); l.tag(t.id, '  Casa '); l.tag(t.id, 'casa'); l.tag(t.id, 'Trabajo'); assert.deepEqual(l.list()[0].tags, ['casa', 'trabajo']); l.untag(t.id, 'CASA'); assert.deepEqual(l.list()[0].tags, ['trabajo']); });
test('A3 empty label throws RangeError', () => { const l = createTaskList(); const t = l.add('a'); assert.equal(typeof l.tag, 'function'); assert.throws(() => l.tag(t.id, '   '), RangeError); });
test('A3 unknown id is rejected', () => { const l = createTaskList(); assert.equal(typeof l.tag, 'function'); assert.throws(() => l.tag(99, 'x')); });

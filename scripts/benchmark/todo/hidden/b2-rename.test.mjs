import test from 'node:test'; import assert from 'node:assert/strict'; import { createTaskList } from '../src/tasks.js';
test('B2 rename trims and returns an updated copy', () => { const l = createTaskList(); const a = l.add('a'); const renamed = l.rename(a.id, '  nuevo  '); assert.equal(renamed.title, 'nuevo'); assert.equal(l.list()[0].title, 'nuevo'); });
test('B2 rename rejects empty titles without changes', () => { const l = createTaskList(); const a = l.add('a'); assert.equal(typeof l.rename, 'function'); assert.throws(() => l.rename(a.id, '   ')); assert.equal(l.list()[0].title, 'a'); });
test('B2 rename of an unknown id throws', () => { const l = createTaskList(); assert.equal(typeof l.rename, 'function'); assert.throws(() => l.rename(5, 'x')); });

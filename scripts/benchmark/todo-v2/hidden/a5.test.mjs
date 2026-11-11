import test from 'node:test'; import assert from 'node:assert/strict'; import { createTaskList } from '../src/tasks.js';
test('A5 rename normalizes', () => { const l = createTaskList(); const a = l.add('a'); assert.equal(l.rename(a.id, '  b ').title, 'b'); assert.equal(l.list()[0].title, 'b'); });
test('A5 rename rejects empty titles', () => { const l = createTaskList(); const a = l.add('a'); assert.equal(typeof l.rename, 'function'); assert.throws(() => l.rename(a.id, ' ')); assert.equal(l.list()[0].title, 'a'); });
test('A5 unknown id is rejected', () => { const l = createTaskList(); assert.equal(typeof l.rename, 'function'); assert.throws(() => l.rename(3, 'x')); });

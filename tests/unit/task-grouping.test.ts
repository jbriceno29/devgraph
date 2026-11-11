import { describe, expect, it } from 'vitest';
import { fixesConvention, nextTaskGroup, orderTasks, planTaskGroups, type GroupableTask } from '../../src/application/execution/task-grouping.js';

const task = (key: number, over: Partial<GroupableTask> = {}): GroupableTask => ({ id: `t${key}`, displayKey: `TASK-${String(key).padStart(3, '0')}`, title: `Tarea ${key}`, status: 'READY', dependsOn: [], summary: '', criteriaCount: 2, ...over });
/** A task whose criteria count the repository did not fill in. */
const unknownCriteria = (key: number): GroupableTask => { const { criteriaCount: _ignored, ...rest } = task(key); return rest; };
const ids = (group: { tasks: GroupableTask[] } | null) => group?.tasks.map(item => item.id) ?? null;

describe('nextTaskGroup', () => {
  it('returns null without READY tasks and only the leader when grouping is off', () => {
    expect(nextTaskGroup([task(1, { status: 'BLOCKED', dependsOn: ['x'] }), task(2, { status: 'DONE' })])).toBeNull();
    expect(ids(nextTaskGroup([task(1), task(2), task(3)], { maxGroupSize: 1 }))).toEqual(['t1']);
  });

  it('groups up to three READY tasks of the feature in key order', () => {
    expect(ids(nextTaskGroup([task(3), task(1), task(2), task(4)]))).toEqual(['t1', 't2', 't3']);
  });

  it('respects the criteria cap, skipping a big task but still taking a smaller later one', () => {
    expect(ids(nextTaskGroup([task(1, { criteriaCount: 3 }), task(2, { criteriaCount: 4 }), task(3, { criteriaCount: 3 }), task(4, { criteriaCount: 1 })]))).toEqual(['t1', 't3']);
    expect(ids(nextTaskGroup([task(1, { criteriaCount: 3 }), task(2, { criteriaCount: 4 }), task(3, { criteriaCount: 5 }), task(4, { criteriaCount: 1 })]))).toEqual(['t1', 't4']);
  });

  it('lets a BLOCKED task join when everything it depends on is in the group (A1+A2), but not when it waits for something outside', () => {
    expect(ids(nextTaskGroup([task(1), task(2, { status: 'BLOCKED', dependsOn: ['t1'] }), task(3, { status: 'BLOCKED', dependsOn: ['t2'] })]))).toEqual(['t1', 't2', 't3']);
    expect(ids(nextTaskGroup([task(1), task(2, { status: 'BLOCKED', dependsOn: ['t9'] }), task(3)]))).toEqual(['t1', 't3']);
    expect(ids(nextTaskGroup([task(1), task(2, { status: 'BLOCKED', dependsOn: ['t1', 't9'] }), task(3)]))).toEqual(['t1', 't3']);
  });

  it('runs the first task of the project alone', () => {
    expect(ids(nextTaskGroup([task(1), task(2), task(3)], { projectHasDoneTasks: false }))).toEqual(['t1']);
    expect(ids(nextTaskGroup([task(1), task(2), task(3)], { projectHasDoneTasks: true }))).toEqual(['t1', 't2', 't3']);
  });

  it('runs a convention-fixing task alone, whether it is the leader or a later candidate', () => {
    expect(fixesConvention({ title: 'Prioridad', summary: 'Convención del proyecto a partir de esta tarea: los errores son RangeError.' })).toBe(true);
    expect(fixesConvention({ title: 'Fijar convenciones de errores', summary: null })).toBe(true);
    expect(fixesConvention({ title: 'Etiquetas', summary: 'Añade tag y untag.' })).toBe(false);
    expect(ids(nextTaskGroup([task(1, { summary: 'A partir de esta tarea, las validaciones lanzan RangeError.' }), task(2), task(3)]))).toEqual(['t1']);
    expect(ids(nextTaskGroup([task(1), task(2, { title: 'Convención de nombres' }), task(3), task(4)]))).toEqual(['t1', 't3', 't4']);
  });

  it('keeps a task with pending retry context on its own and out of other groups', () => {
    expect(ids(nextTaskGroup([task(1), task(2), task(3)], { runAlone: ['t1'] }))).toEqual(['t1']);
    expect(ids(nextTaskGroup([task(1), task(2), task(3)], { runAlone: ['t2'] }))).toEqual(['t1', 't3']);
  });

  it('ignores DRAFT, IN_REVIEW and DONE tasks as candidates', () => {
    expect(ids(nextTaskGroup([task(1), task(2, { status: 'DRAFT' }), task(3, { status: 'IN_REVIEW' }), task(4, { status: 'DONE' }), task(5)]))).toEqual(['t1', 't5']);
  });

  it('treats an unknown criteria count as zero and never exceeds the size cap', () => {
    const tasks = [unknownCriteria(1), unknownCriteria(2), unknownCriteria(3), unknownCriteria(4)];
    expect(ids(nextTaskGroup(tasks, { maxGroupSize: 2 }))).toEqual(['t1', 't2']);
    expect(ids(nextTaskGroup(tasks))).toEqual(['t1', 't2', 't3']);
  });
});

describe('orderTasks', () => {
  it('puts dependencies first and breaks ties by key, and survives a cycle', () => {
    expect(orderTasks([task(3), task(1, { dependsOn: ['t3'] }), task(2)]).map(item => item.id)).toEqual(['t2', 't3', 't1']);
    expect(orderTasks([task(1, { dependsOn: ['t2'] }), task(2, { dependsOn: ['t1'] })]).map(item => item.id)).toEqual(['t1', 't2']);
  });
});

describe('planTaskGroups', () => {
  it('partitions the 13-task benchmark shape into the groups the autopilot would launch', () => {
    const feature = [
      task(201, { summary: 'Convención del proyecto a partir de esta tarea: RangeError.', criteriaCount: 3 }), task(202, { status: 'BLOCKED', dependsOn: ['t201'], criteriaCount: 3 }),
      task(203, { criteriaCount: 4 }), task(204, { criteriaCount: 2 }), task(205, { criteriaCount: 3 }),
    ];
    const groups = planTaskGroups(feature, { projectHasDoneTasks: false });
    expect(groups.map(ids)).toEqual([['t201'], ['t202', 't204'], ['t203'], ['t205']]);
    expect(groups.every(group => group.leader.id === group.tasks[0]!.id)).toBe(true);
  });

  it('with grouping off yields one group per runnable task, in order, unblocking dependents as it goes', () => {
    expect(planTaskGroups([task(1), task(2, { status: 'BLOCKED', dependsOn: ['t1'] }), task(3, { status: 'BLOCKED', dependsOn: ['t2'] })], { maxGroupSize: 1 }).map(ids)).toEqual([['t1'], ['t2'], ['t3']]);
  });

  it('leaves out tasks that stay blocked by something outside the feature', () => {
    expect(planTaskGroups([task(1), task(2, { status: 'BLOCKED', dependsOn: ['other'] })]).map(ids)).toEqual([['t1']]);
  });
});

/**
 * Task grouping for the feature autopilot (Etapa 0 of docs/PLAN_EXPLORACION_VISUAL_Y_OBJETIVO.md).
 *
 * Pure: decides which READY tasks of one feature run together in a single execution. The plan is never changed;
 * a group is only an execution that covers several WorkItems. Rules (decisión 5 del plan):
 * - same feature, all READY, or BLOCKED only by tasks already in the group (A1+A2 with DEPENDS_ON can go together);
 * - at most `maxGroupSize` tasks and at most `maxCriteria` acceptance criteria in total;
 * - a task that fixes a convention runs alone: the first task of the project, and any task whose title or summary
 *   says «convención» or «a partir de esta tarea»;
 * - a task listed in `runAlone` (pending retry context) runs alone, and never joins another leader's group;
 * - the order respects DEPENDS_ON and, otherwise, the display key (TASK-n).
 */
/** The minimum the grouping needs; the pilot port's FeatureTaskView satisfies it. */
export interface GroupableTask {
  id: string;
  displayKey: string;
  title: string;
  status: string;
  dependsOn: string[];
  /** Task summary, used to detect convention-fixing tasks. */
  summary?: string | null;
  /** Number of acceptance criteria; unknown counts as 0 (the repository fills it in). */
  criteriaCount?: number;
}
export interface TaskGroupingOptions {
  /** 1 disables grouping. Default 3. */
  maxGroupSize?: number;
  /** Total acceptance criteria a group may hold. Default 6. */
  maxCriteria?: number;
  /** False while no task of the project is DONE: the first task runs alone so its conventions land before the rest. Default true. */
  projectHasDoneTasks?: boolean;
  /** Tasks that must run on their own (for example, a failed task that retries with its error as context). */
  runAlone?: readonly string[];
}
export interface TaskGroup { leader: GroupableTask; tasks: GroupableTask[] }

export const DEFAULT_GROUPING = { maxGroupSize: 3, maxCriteria: 6 } as const;
const CONVENTION_PATTERN = /convenci[oó]n|a partir de esta tarea/i;

/** True when the task declares or fixes a project-wide convention and should run alone. */
export function fixesConvention(task: Pick<GroupableTask, 'title' | 'summary'>): boolean {
  return CONVENTION_PATTERN.test(task.title) || CONVENTION_PATTERN.test(task.summary ?? '');
}

const byKey = (a: GroupableTask, b: GroupableTask) => a.displayKey.localeCompare(b.displayKey, 'es', { numeric: true });

/** Tasks in dependency order (a task after everything it depends on inside the list), ties by display key. */
export function orderTasks<T extends GroupableTask>(tasks: readonly T[]): T[] {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const ordered: T[] = []; const placed = new Set<string>();
  let pending = [...tasks].sort(byKey);
  while (pending.length) {
    // One task at a time: the first by key whose dependencies are placed, so TASK-002 (after TASK-001) still comes
    // before TASK-003. A dependency cycle inside the list falls back to the first pending task so the loop ends.
    const next = pending.find(task => task.dependsOn.every(id => !byId.has(id) || placed.has(id))) ?? pending[0]!;
    ordered.push(next); placed.add(next.id);
    pending = pending.filter(task => task.id !== next.id);
  }
  return ordered;
}

/**
 * The next group to run: the first READY task (dependency order, then key) plus the tasks that may join it.
 * Null when nothing is READY. With grouping off (`maxGroupSize` 1) the group is just the leader, exactly as today.
 */
export function nextTaskGroup(tasks: readonly GroupableTask[], options: TaskGroupingOptions = {}): TaskGroup | null {
  const maxGroupSize = Math.max(1, Math.floor(options.maxGroupSize ?? DEFAULT_GROUPING.maxGroupSize));
  const maxCriteria = Math.max(0, options.maxCriteria ?? DEFAULT_GROUPING.maxCriteria);
  const alone = new Set(options.runAlone ?? []);
  const ordered = orderTasks(tasks);
  const leader = ordered.find(task => task.status === 'READY');
  if (!leader) return null;
  const single = { leader, tasks: [leader] };
  if (maxGroupSize === 1 || options.projectHasDoneTasks === false || fixesConvention(leader) || alone.has(leader.id)) return single;

  const done = new Set(tasks.filter(task => task.status === 'DONE').map(task => task.id));
  const inGroup = new Set([leader.id]);
  const group = [leader];
  let criteria = leader.criteriaCount ?? 0;
  for (const task of ordered) {
    if (group.length >= maxGroupSize) break;
    if (inGroup.has(task.id) || alone.has(task.id) || fixesConvention(task)) continue;
    if (task.status !== 'READY' && task.status !== 'BLOCKED') continue;
    // Every dependency must be DONE already or inside this group (outside the feature counts as satisfied only if DONE).
    if (!task.dependsOn.every(id => done.has(id) || inGroup.has(id) || (task.status === 'READY' && !tasks.some(item => item.id === id)))) continue;
    const count = task.criteriaCount ?? 0;
    if (criteria + count > maxCriteria) continue;
    group.push(task); inGroup.add(task.id); criteria += count;
  }
  return { leader, tasks: group };
}

/**
 * Partition of everything runnable into the groups the autopilot would launch, in order, as if each group closed
 * before the next one is chosen. For the cost notice («quedan N tareas en ~M ejecuciones»), not for launching.
 */
export function planTaskGroups(tasks: readonly GroupableTask[], options: TaskGroupingOptions = {}): TaskGroup[] {
  const groups: TaskGroup[] = [];
  let remaining = tasks.map(task => ({ ...task }));
  let projectHasDoneTasks = options.projectHasDoneTasks ?? true;
  for (let guard = 0; guard < tasks.length; guard += 1) {
    const group = nextTaskGroup(remaining, { ...options, projectHasDoneTasks });
    if (!group) break;
    groups.push(group);
    const closed = new Set(group.tasks.map(task => task.id));
    remaining = remaining.map(task => closed.has(task.id) ? { ...task, status: 'DONE' } : task);
    // Closing a group unblocks the tasks that only waited for it, as the orchestrator does.
    const doneIds = new Set(remaining.filter(task => task.status === 'DONE').map(task => task.id));
    remaining = remaining.map(task => task.status === 'BLOCKED' && task.dependsOn.every(id => doneIds.has(id)) ? { ...task, status: 'READY' } : task);
    projectHasDoneTasks = true;
  }
  return groups;
}

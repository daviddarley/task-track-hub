import { PRIORITY_RANK, type NormalizedTask, type Settings, type SortBy, type TaskStatus } from './types.js';

/**
 * Status ordering used as the tie-breaker everywhere: things you could act on
 * now float above things you are waiting on, and closed items sink.
 */
const STATUS_RANK = {
  in_progress: 0,
  open: 1,
  waiting: 2,
  closed: 3,
} as const satisfies Record<TaskStatus, number>;

/** Priority rank for tasks with none — below `low`, so undated junk sinks. */
const NO_PRIORITY_RANK = 3;

type Comparator = (a: NormalizedTask, b: NormalizedTask) => number;

export function comparatorFor(sortBy: SortBy): Comparator {
  switch (sortBy) {
    case 'title':
      return (a, b) => a.title.localeCompare(b.title) || byDueDate(a, b);
    case 'priority':
      return (a, b) => byPriority(a, b) || byDueDate(a, b) || a.title.localeCompare(b.title);
    case 'dueDate':
      return (a, b) => byDueDate(a, b) || byPriority(a, b) || a.title.localeCompare(b.title);
  }
}

/**
 * Undated work sorts last — a task with no due date is never more urgent than
 * one with a date on it, however far out that date is.
 */
function byDueDate(a: NormalizedTask, b: NormalizedTask): number {
  const aTime = a.dueDate ? Date.parse(a.dueDate) : Number.NaN;
  const bTime = b.dueDate ? Date.parse(b.dueDate) : Number.NaN;
  const aHas = Number.isFinite(aTime);
  const bHas = Number.isFinite(bTime);

  if (aHas && bHas) return aTime - bTime;
  if (aHas) return -1;
  if (bHas) return 1;
  return 0;
}

function byPriority(a: NormalizedTask, b: NormalizedTask): number {
  return rankPriority(a) - rankPriority(b);
}

function rankPriority(task: NormalizedTask): number {
  return task.priority ? PRIORITY_RANK[task.priority] : NO_PRIORITY_RANK;
}

/**
 * Filter + sort a snapshot's tasks for display. Closed items are dropped unless
 * the user asked to see them, and always sort to the bottom when shown.
 */
export function prepareTasks(tasks: NormalizedTask[], settings: Settings): NormalizedTask[] {
  const visible = settings.showClosed ? [...tasks] : tasks.filter((task) => task.status !== 'closed');
  const compare = comparatorFor(settings.sortBy);
  return visible.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || compare(a, b));
}

export interface TaskGroup {
  source: string;
  tasks: NormalizedTask[];
}

/** Bucket tasks by adapter id, preserving the order sources were registered in. */
export function groupBySource(tasks: NormalizedTask[], sourceOrder: string[]): TaskGroup[] {
  const groups = new Map<string, NormalizedTask[]>();
  for (const id of sourceOrder) groups.set(id, []);

  for (const task of tasks) {
    const bucket = groups.get(task.source);
    // A task from an unregistered source still gets a group rather than
    // vanishing — better a stray heading than silently dropped work.
    if (bucket) bucket.push(task);
    else groups.set(task.source, [task]);
  }

  return [...groups.entries()]
    .filter(([, items]) => items.length > 0)
    .map(([source, items]) => ({ source, tasks: items }));
}

export function countOpen(tasks: NormalizedTask[]): number {
  return tasks.filter((task) => task.status !== 'closed').length;
}

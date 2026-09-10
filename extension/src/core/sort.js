import { PRIORITY_RANK } from './types.js';

/** @typedef {import('./types.js').NormalizedTask} NormalizedTask */
/** @typedef {import('./types.js').Settings} Settings */

/**
 * Status ordering used as the tie-breaker everywhere: things you could act on
 * now float above things you are waiting on, and closed items sink.
 *
 * @type {Record<import('./types.js').TaskStatus, number>}
 */
const STATUS_RANK = { in_progress: 0, open: 1, waiting: 2, closed: 3 };

/**
 * @param {Settings['sortBy']} sortBy
 * @returns {(a: NormalizedTask, b: NormalizedTask) => number}
 */
export function comparatorFor(sortBy) {
  return (a, b) => {
    if (sortBy === 'title') {
      return a.title.localeCompare(b.title) || byDueDate(a, b);
    }
    if (sortBy === 'priority') {
      return byPriority(a, b) || byDueDate(a, b) || a.title.localeCompare(b.title);
    }
    return byDueDate(a, b) || byPriority(a, b) || a.title.localeCompare(b.title);
  };
}

/**
 * Undated work sorts last — a task with no due date is never more urgent than
 * one with a date on it, however far out that date is.
 *
 * @param {NormalizedTask} a
 * @param {NormalizedTask} b
 * @returns {number}
 */
function byDueDate(a, b) {
  const aTime = a.dueDate ? Date.parse(a.dueDate) : NaN;
  const bTime = b.dueDate ? Date.parse(b.dueDate) : NaN;
  const aHas = Number.isFinite(aTime);
  const bHas = Number.isFinite(bTime);
  if (aHas && bHas) return aTime - bTime;
  if (aHas) return -1;
  if (bHas) return 1;
  return 0;
}

/**
 * @param {NormalizedTask} a
 * @param {NormalizedTask} b
 * @returns {number}
 */
function byPriority(a, b) {
  return rankPriority(a) - rankPriority(b);
}

/**
 * @param {NormalizedTask} task
 * @returns {number}
 */
function rankPriority(task) {
  return task.priority ? PRIORITY_RANK[task.priority] : 3;
}

/**
 * Filter + sort a snapshot's tasks for display. Closed items are dropped unless
 * the user asked to see them, and always sort to the bottom when shown.
 *
 * @param {NormalizedTask[]} tasks
 * @param {Settings} settings
 * @returns {NormalizedTask[]}
 */
export function prepareTasks(tasks, settings) {
  const visible = settings.showClosed ? tasks.slice() : tasks.filter((t) => t.status !== 'closed');
  const compare = comparatorFor(settings.sortBy);
  return visible.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || compare(a, b));
}

/**
 * Bucket tasks by adapter id, preserving the order sources were registered in.
 *
 * @param {NormalizedTask[]} tasks
 * @param {string[]} sourceOrder
 * @returns {{ source: string, tasks: NormalizedTask[] }[]}
 */
export function groupBySource(tasks, sourceOrder) {
  /** @type {Map<string, NormalizedTask[]>} */
  const groups = new Map();
  for (const id of sourceOrder) groups.set(id, []);
  for (const task of tasks) {
    const bucket = groups.get(task.source);
    if (bucket) bucket.push(task);
    else groups.set(task.source, [task]);
  }
  return [...groups.entries()]
    .filter(([, items]) => items.length > 0)
    .map(([source, items]) => ({ source, tasks: items }));
}

/**
 * @param {NormalizedTask[]} tasks
 * @returns {number}
 */
export function countOpen(tasks) {
  return tasks.filter((task) => task.status !== 'closed').length;
}

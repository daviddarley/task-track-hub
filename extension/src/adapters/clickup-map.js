/**
 * ClickUp → `NormalizedTask` mapping. Deliberately split from `clickup.js`:
 * everything here is a pure function of an API payload, so it can be exercised
 * in plain Node without stubbing `chrome` or the network. Each future adapter
 * should carry the same split.
 */

/** @typedef {import('../core/types.js').NormalizedTask} NormalizedTask */
/** @typedef {import('../core/types.js').TaskStatus} TaskStatus */
/** @typedef {import('../core/types.js').TaskPriority} TaskPriority */

export const SOURCE = 'clickup';

/**
 * @param {any} task
 * @returns {NormalizedTask}
 */
export function normalizeTask(task) {
  const sourceId = String(task.id);
  return {
    id: `${SOURCE}:${sourceId}`,
    sourceId,
    title: String(task.name ?? '(untitled task)'),
    status: mapStatus(task.status),
    priority: mapPriority(task.priority),
    dueDate: msToIso(task.due_date),
    url: String(task.url ?? `https://app.clickup.com/t/${sourceId}`),
    source: SOURCE,
    subtitle: task.list?.name ? String(task.list.name) : (task.space?.name ?? null),
    raw: task,
  };
}

/**
 * ClickUp statuses are user-defined per space, so the `type` field is the only
 * reliable signal: `open` is the first column, `closed`/`done` the last, and
 * everything in between is `custom`. Names are only consulted to tell active
 * work apart from work that is parked on someone else.
 *
 * @param {any} status
 * @returns {TaskStatus}
 */
export function mapStatus(status) {
  const type = String(status?.type ?? '').toLowerCase();
  if (type === 'closed' || type === 'done') return 'closed';

  const label = String(status?.status ?? '').toLowerCase();
  if (/wait|hold|block|pending|review|approval|qa/.test(label)) return 'waiting';
  if (/progress|doing|active|working|started|dev/.test(label)) return 'in_progress';

  return type === 'custom' ? 'in_progress' : 'open';
}

/**
 * @param {any} priority
 * @returns {TaskPriority}
 */
export function mapPriority(priority) {
  switch (String(priority?.priority ?? '').toLowerCase()) {
    case 'urgent':
    case 'high':
      return 'high';
    case 'normal':
      return 'medium';
    case 'low':
      return 'low';
    default:
      return null;
  }
}

/**
 * ClickUp sends timestamps as epoch-milliseconds *strings*.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function msToIso(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}

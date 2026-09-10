/**
 * ClickUp → `NormalizedTask` mapping. Deliberately split from `clickup.ts`:
 * everything here is a pure function of an API payload, so it can be exercised
 * without stubbing `chrome` or the network. Each future adapter should carry
 * the same split.
 */

import type { NormalizedTask, TaskPriority, TaskStatus } from '../core/types.js';

export const SOURCE = 'clickup';

/**
 * The slice of ClickUp's task payload we actually read. Every field is optional
 * and `unknown`-ish because this describes JSON off the wire, not a promise the
 * API has made us — `normalizeTask` is written to survive any of it missing.
 */
export interface ClickUpTask {
  id?: unknown;
  name?: unknown;
  url?: unknown;
  due_date?: unknown;
  status?: { status?: unknown; type?: unknown } | null;
  priority?: { priority?: unknown } | null;
  list?: { name?: unknown } | null;
  space?: { name?: unknown } | null;
}

export function normalizeTask(task: ClickUpTask): NormalizedTask {
  const sourceId = String(task.id);
  return {
    id: `${SOURCE}:${sourceId}`,
    sourceId,
    title: asString(task.name) ?? '(untitled task)',
    status: mapStatus(task.status),
    priority: mapPriority(task.priority),
    dueDate: msToIso(task.due_date),
    url: asString(task.url) ?? `https://app.clickup.com/t/${sourceId}`,
    source: SOURCE,
    subtitle: asString(task.list?.name) ?? asString(task.space?.name) ?? null,
    raw: task,
  };
}

/**
 * ClickUp statuses are user-defined per space, so the `type` field is the only
 * reliable signal: `open` is the first column, `closed`/`done` the last, and
 * everything in between is `custom`. Names are only consulted to tell active
 * work apart from work that is parked on someone else.
 */
export function mapStatus(status: ClickUpTask['status']): TaskStatus {
  const type = (asString(status?.type) ?? '').toLowerCase();
  if (type === 'closed' || type === 'done') return 'closed';

  const label = (asString(status?.status) ?? '').toLowerCase();
  if (/wait|hold|block|pending|review|approval|qa/.test(label)) return 'waiting';
  if (/progress|doing|active|working|started|dev/.test(label)) return 'in_progress';

  return type === 'custom' ? 'in_progress' : 'open';
}

export function mapPriority(priority: ClickUpTask['priority']): TaskPriority {
  switch ((asString(priority?.priority) ?? '').toLowerCase()) {
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

/** ClickUp sends timestamps as epoch-milliseconds *strings*. */
export function msToIso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;

  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}

/** Coerce a JSON value to a non-empty string, or give up. */
function asString(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  if (typeof value === 'number') return String(value);
  return null;
}

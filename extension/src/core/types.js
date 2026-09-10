/**
 * Shared vocabulary for the whole extension.
 *
 * Nothing outside `src/adapters/` is allowed to know which service a task came
 * from. Everything downstream — merge, sort, badge count, popup — works purely
 * against `NormalizedTask`.
 */

/**
 * Normalized status buckets. Every adapter maps its service's own status
 * vocabulary onto exactly one of these.
 *
 * @typedef {'open' | 'in_progress' | 'waiting' | 'closed'} TaskStatus
 */

/**
 * Normalized priority, or `null` where the source has no equivalent.
 *
 * @typedef {'high' | 'medium' | 'low' | null} TaskPriority
 */

/**
 * The single shape every adapter returns.
 *
 * @typedef {object} NormalizedTask
 * @property {string} id          Globally unique, prefixed with the adapter id (`clickup:abc123`).
 * @property {string} sourceId    The service's own record id.
 * @property {string} title       Case subject / task name.
 * @property {TaskStatus} status
 * @property {TaskPriority} priority
 * @property {string | null} dueDate  ISO 8601 date-time, or null.
 * @property {string} url         Deep link back into the source system.
 * @property {string} source      Adapter id, for grouping/filtering in the UI.
 * @property {string | null} [subtitle] Optional source-supplied context (ClickUp list, NetSuite case number).
 * @property {unknown} raw        Untouched source payload, for debugging and future fields.
 */

/**
 * The one interface a new connector has to implement. See `docs/adding-an-adapter.md`.
 *
 * @typedef {object} TaskAdapter
 * @property {string} id
 * @property {string} displayName
 * @property {() => Promise<boolean>} isConfigured  Has the user supplied working credentials?
 * @property {() => Promise<void>} authenticate     Run the OAuth flow / validate + cache token metadata.
 * @property {() => Promise<NormalizedTask[]>} fetchTasks
 */

/**
 * Per-source outcome of one sync pass. Kept separately from the task list so a
 * single failing source degrades to its own error row instead of blanking the
 * whole popup.
 *
 * @typedef {object} SourceState
 * @property {string} id
 * @property {string} displayName
 * @property {'ok' | 'error' | 'unconfigured' | 'disabled'} status
 * @property {number} count             Tasks currently attributed to this source.
 * @property {string | null} error      Human-readable failure message.
 * @property {import('./errors.js').AdapterErrorKind | null} errorKind
 * @property {string | null} fetchedAt  ISO timestamp of the last *successful* fetch.
 * @property {boolean} stale            True when `count` reflects a previous pass, not this one.
 */

/**
 * What the popup reads. Written by the background worker only.
 *
 * @typedef {object} Snapshot
 * @property {NormalizedTask[]} tasks
 * @property {SourceState[]} sources
 * @property {string} updatedAt      ISO timestamp of the last sync attempt.
 * @property {number} openCount      Tasks not in the `closed` bucket.
 */

/**
 * @typedef {object} AdapterSettings
 * @property {boolean} enabled
 */

/**
 * @typedef {object} Settings
 * @property {number} refreshMinutes
 * @property {'dueDate' | 'priority' | 'title'} sortBy
 * @property {boolean} groupBySource
 * @property {boolean} showClosed
 * @property {Record<string, AdapterSettings>} adapters
 */

/** @type {readonly TaskStatus[]} */
export const TASK_STATUSES = ['open', 'in_progress', 'waiting', 'closed'];

/** @type {Record<TaskStatus, string>} */
export const STATUS_LABELS = {
  open: 'Open',
  in_progress: 'In progress',
  waiting: 'Waiting',
  closed: 'Closed',
};

/** @type {Record<Exclude<TaskPriority, null>, number>} */
export const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

export {};

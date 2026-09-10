import { adapters } from '../adapters/index.js';
import { describeErrorKind, toAdapterError } from './errors.js';
import { getSettings, getSnapshot, saveSnapshot } from './storage.js';
import { countOpen } from './sort.js';

/** @typedef {import('./types.js').NormalizedTask} NormalizedTask */
/** @typedef {import('./types.js').Snapshot} Snapshot */
/** @typedef {import('./types.js').SourceState} SourceState */
/** @typedef {import('./types.js').TaskAdapter} TaskAdapter */

/** In-flight sync, so an alarm and a manual refresh can't stampede each other. */
/** @type {Promise<Snapshot> | null} */
let inFlight = null;

/**
 * Poll every enabled adapter, merge the results, persist one snapshot.
 *
 * Sources are polled concurrently and failures are contained per source: if
 * ClickUp answers and NetSuite's token has expired, the ClickUp tasks still
 * render and NetSuite gets an error row plus its last known tasks, rather than
 * the whole list going blank.
 *
 * @param {{ reason?: string }} [options]
 * @returns {Promise<Snapshot>}
 */
export function syncAll(options = {}) {
  if (inFlight) return inFlight;
  inFlight = runSync(options.reason ?? 'manual').finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * @param {string} reason
 * @returns {Promise<Snapshot>}
 */
async function runSync(reason) {
  const settings = await getSettings();
  const previous = await getSnapshot();

  const results = await Promise.all(
    adapters.map((adapter) => runAdapter(adapter, settings, previous)),
  );

  /** @type {NormalizedTask[]} */
  const tasks = results.flatMap((result) => result.tasks);

  /** @type {Snapshot} */
  const snapshot = {
    tasks,
    sources: results.map((result) => result.state),
    updatedAt: new Date().toISOString(),
    openCount: countOpen(tasks),
  };

  await saveSnapshot(snapshot);
  console.info(`[task-hub] sync (${reason}): ${tasks.length} tasks from ${results.length} source(s)`);
  return snapshot;
}

/**
 * @param {TaskAdapter} adapter
 * @param {import('./types.js').Settings} settings
 * @param {Snapshot} previous
 * @returns {Promise<{ tasks: NormalizedTask[], state: SourceState }>}
 */
async function runAdapter(adapter, settings, previous) {
  const base = { id: adapter.id, displayName: adapter.displayName };
  const priorState = previous.sources.find((source) => source.id === adapter.id);
  const priorTasks = previous.tasks.filter((task) => task.source === adapter.id);

  if (settings.adapters[adapter.id]?.enabled === false) {
    // Disabled means "pretend this source doesn't exist" — drop its cached tasks
    // so the badge count matches what the popup actually shows.
    return {
      tasks: [],
      state: { ...base, status: 'disabled', count: 0, error: null, errorKind: null, fetchedAt: null, stale: false },
    };
  }

  try {
    if (!(await adapter.isConfigured())) {
      return {
        tasks: [],
        state: {
          ...base,
          status: 'unconfigured',
          count: 0,
          error: null,
          errorKind: null,
          fetchedAt: null,
          stale: false,
        },
      };
    }

    const tasks = await adapter.fetchTasks();
    return {
      tasks,
      state: {
        ...base,
        status: 'ok',
        count: tasks.length,
        error: null,
        errorKind: null,
        fetchedAt: new Date().toISOString(),
        stale: false,
      },
    };
  } catch (err) {
    const error = toAdapterError(err, adapter.id);
    console.warn(`[task-hub] ${adapter.id} sync failed (${error.kind}):`, error.message);
    return {
      // Serve the last good data rather than nothing — stale work items are far
      // more useful than an empty list, as long as the UI says they're stale.
      tasks: priorTasks,
      state: {
        ...base,
        status: 'error',
        count: priorTasks.length,
        error: `${describeErrorKind(error.kind, adapter.displayName)} (${error.message})`,
        errorKind: error.kind,
        fetchedAt: priorState?.fetchedAt ?? null,
        stale: priorTasks.length > 0,
      },
    };
  }
}

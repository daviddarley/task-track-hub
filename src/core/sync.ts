import { adapters } from '../adapters/index.js';
import { describeErrorKind, toAdapterError } from './errors.js';
import { countOpen } from './sort.js';
import { getSettings, getSnapshot, saveSnapshot } from './storage.js';
import type { NormalizedTask, Settings, Snapshot, SourceState, TaskAdapter } from './types.js';

interface AdapterResult {
  tasks: NormalizedTask[];
  state: SourceState;
}

/** In-flight sync, so an alarm and a manual refresh can't stampede each other. */
let inFlight: Promise<Snapshot> | null = null;

/**
 * Poll every enabled adapter, merge the results, persist one snapshot.
 *
 * Sources are polled concurrently and failures are contained per source: if
 * ClickUp answers and NetSuite's token has expired, the ClickUp tasks still
 * render and NetSuite gets an error row plus its last known tasks, rather than
 * the whole list going blank.
 */
export function syncAll(options: { reason?: string } = {}): Promise<Snapshot> {
  inFlight ??= runSync(options.reason ?? 'manual').finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runSync(reason: string): Promise<Snapshot> {
  const settings = await getSettings();
  const previous = await getSnapshot();

  const results = await Promise.all(adapters.map((adapter) => runAdapter(adapter, settings, previous)));
  const tasks = results.flatMap((result) => result.tasks);

  const snapshot: Snapshot = {
    tasks,
    sources: results.map((result) => result.state),
    updatedAt: new Date().toISOString(),
    openCount: countOpen(tasks),
  };

  await saveSnapshot(snapshot);
  console.info(`[task-hub] sync (${reason}): ${tasks.length} tasks from ${results.length} source(s)`);
  return snapshot;
}

async function runAdapter(
  adapter: TaskAdapter,
  settings: Settings,
  previous: Snapshot,
): Promise<AdapterResult> {
  const identity = { id: adapter.id, displayName: adapter.displayName };
  const priorState = previous.sources.find((source) => source.id === adapter.id);
  const priorTasks = previous.tasks.filter((task) => task.source === adapter.id);

  if (settings.adapters[adapter.id]?.enabled === false) {
    // Disabled means "pretend this source doesn't exist" — drop its cached tasks
    // so the badge count matches what the popup actually shows.
    return { tasks: [], state: { ...identity, status: 'disabled' } };
  }

  try {
    if (!(await adapter.isConfigured())) {
      return { tasks: [], state: { ...identity, status: 'unconfigured' } };
    }

    const tasks = await adapter.fetchTasks();
    return {
      tasks,
      state: { ...identity, status: 'ok', count: tasks.length, fetchedAt: new Date().toISOString() },
    };
  } catch (err) {
    const error = toAdapterError(err, adapter.id);
    console.warn(`[task-hub] ${adapter.id} sync failed (${error.kind}):`, error.message);

    return {
      // Serve the last good data rather than nothing — stale work items are far
      // more useful than an empty list, as long as the UI says they're stale.
      tasks: priorTasks,
      state: {
        ...identity,
        status: 'error',
        count: priorTasks.length,
        error: `${describeErrorKind(error.kind, adapter.displayName)} (${error.message})`,
        errorKind: error.kind,
        fetchedAt: lastSuccessAt(priorState),
        stale: priorTasks.length > 0,
      },
    };
  }
}

/**
 * When did this source last actually succeed? `unconfigured` and `disabled`
 * carry no timestamp, which is exactly why `SourceState` is a union.
 */
function lastSuccessAt(state: SourceState | undefined): string | null {
  if (!state) return null;
  switch (state.status) {
    case 'ok':
      return state.fetchedAt;
    case 'error':
      return state.fetchedAt;
    default:
      return null;
  }
}

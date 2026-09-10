/**
 * Popup — a pure view over whatever the background worker last wrote to
 * storage. It makes no network calls and never touches a credential, which is
 * why it opens instantly instead of waiting on ClickUp.
 */

import { adapterIds, displayNameFor } from '../adapters/index.js';
import { sendMessage } from '../core/messages.js';
import { getSettings, getSnapshot, getUiState, saveUiState } from '../core/storage.js';
import { groupBySource, prepareTasks } from '../core/sort.js';
import { STATUS_LABELS } from '../core/types.js';
import { formatAgo, formatDue, plural } from './format.js';

/** @typedef {import('../core/types.js').NormalizedTask} NormalizedTask */
/** @typedef {import('../core/types.js').Snapshot} Snapshot */
/** @typedef {import('../core/types.js').SourceState} SourceState */

const els = {
  meta: /** @type {HTMLElement} */ (document.getElementById('meta')),
  alerts: /** @type {HTMLElement} */ (document.getElementById('alerts')),
  list: /** @type {HTMLElement} */ (document.getElementById('list')),
  refresh: /** @type {HTMLButtonElement} */ (document.getElementById('refresh')),
  options: /** @type {HTMLButtonElement} */ (document.getElementById('options')),
};

/** @type {Set<string>} */
let collapsed = new Set();

els.options.addEventListener('click', () => chrome.runtime.openOptionsPage());

els.refresh.addEventListener('click', async () => {
  els.refresh.dataset.busy = 'true';
  els.meta.textContent = 'Refreshing…';
  try {
    await sendMessage({ type: 'refresh' });
  } catch (err) {
    els.meta.textContent = err instanceof Error ? err.message : 'Refresh failed.';
  } finally {
    delete els.refresh.dataset.busy;
    await render();
  }
});

// The worker may finish a poll while the popup is open; re-render rather than
// leaving a stale list on screen.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.snapshot) void render();
});

void init();

async function init() {
  collapsed = new Set((await getUiState()).collapsed);
  await render();
}

async function render() {
  const [snapshot, settings] = await Promise.all([getSnapshot(), getSettings()]);
  const tasks = prepareTasks(snapshot.tasks, settings);

  renderMeta(snapshot, tasks.length);
  renderAlerts(snapshot.sources);

  els.list.textContent = '';

  const connected = snapshot.sources.filter((source) => source.status !== 'unconfigured' && source.status !== 'disabled');
  if (connected.length === 0) {
    els.list.append(
      emptyState('No sources connected', 'Add a ClickUp personal API token to start pulling your tasks.', {
        label: 'Open options',
        onClick: () => chrome.runtime.openOptionsPage(),
      }),
    );
    return;
  }

  if (tasks.length === 0) {
    const blocked = snapshot.sources.every((source) => source.status === 'error');
    els.list.append(
      blocked
        ? emptyState('Nothing to show', 'Every connected source failed to refresh. See the errors above.')
        : emptyState('All clear', 'Nothing is assigned to you right now.'),
    );
    return;
  }

  if (settings.groupBySource) {
    for (const group of groupBySource(tasks, adapterIds())) {
      els.list.append(renderGroup(group.source, group.tasks));
    }
  } else {
    const container = document.createElement('div');
    container.className = 'group__items';
    for (const task of tasks) container.append(renderTask(task));
    els.list.append(container);
  }
}

/**
 * @param {Snapshot} snapshot
 * @param {number} visible
 */
function renderMeta(snapshot, visible) {
  if (!snapshot.updatedAt) {
    els.meta.textContent = 'Not synced yet';
    return;
  }
  els.meta.textContent = `${plural(visible, 'item')} · updated ${formatAgo(snapshot.updatedAt)}`;
}

/**
 * @param {SourceState[]} sources
 */
function renderAlerts(sources) {
  els.alerts.textContent = '';
  for (const source of sources) {
    if (source.status !== 'error') continue;

    const alert = document.createElement('div');
    alert.className = source.stale ? 'alert alert--warn' : 'alert alert--error';

    const title = document.createElement('strong');
    title.textContent = source.stale
      ? `${source.displayName} — showing cached items`
      : `${source.displayName} — refresh failed`;

    const detail = document.createElement('span');
    detail.textContent = source.error ?? 'Unknown error.';

    alert.append(title, detail);
    els.alerts.append(alert);
  }
}

/**
 * @param {string} sourceId
 * @param {NormalizedTask[]} tasks
 * @returns {HTMLElement}
 */
function renderGroup(sourceId, tasks) {
  const group = document.createElement('section');
  group.className = 'group';
  group.dataset.collapsed = String(collapsed.has(sourceId));

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'group__header';

  const caret = document.createElement('span');
  caret.className = 'group__caret';
  caret.textContent = '▼';

  const label = document.createElement('span');
  label.textContent = displayNameFor(sourceId);

  const count = document.createElement('span');
  count.className = 'group__count';
  count.textContent = String(tasks.length);

  header.append(caret, label, count);
  header.addEventListener('click', () => {
    const nowCollapsed = group.dataset.collapsed !== 'true';
    group.dataset.collapsed = String(nowCollapsed);
    if (nowCollapsed) collapsed.add(sourceId);
    else collapsed.delete(sourceId);
    void saveUiState([...collapsed]);
  });

  const items = document.createElement('div');
  items.className = 'group__items';
  for (const task of tasks) items.append(renderTask(task));

  group.append(header, items);
  return group;
}

/**
 * Built with `createElement`/`textContent` rather than `innerHTML`: task titles
 * come straight from a third-party API and are not ours to trust.
 *
 * @param {NormalizedTask} task
 * @returns {HTMLElement}
 */
function renderTask(task) {
  const link = document.createElement('a');
  link.className = 'task';
  link.href = task.url;
  link.target = '_blank';
  link.rel = 'noreferrer noopener';
  link.dataset.status = task.status;

  const rail = document.createElement('span');
  rail.className = 'task__rail';
  if (task.priority) rail.dataset.priority = task.priority;

  const body = document.createElement('span');

  const title = document.createElement('span');
  title.className = 'task__title';
  title.textContent = task.title;

  const sub = document.createElement('span');
  sub.className = 'task__sub';
  sub.textContent = [STATUS_LABELS[task.status], task.subtitle].filter(Boolean).join(' · ');

  body.append(title, sub);

  const due = formatDue(task.dueDate);
  const dueEl = document.createElement('span');
  dueEl.className = 'task__due';
  dueEl.textContent = due.text;
  if (due.overdue) dueEl.dataset.overdue = 'true';

  link.append(rail, body, dueEl);
  return link;
}

/**
 * @param {string} heading
 * @param {string} message
 * @param {{ label: string, onClick: () => void }} [action]
 * @returns {HTMLElement}
 */
function emptyState(heading, message, action) {
  const wrap = document.createElement('div');
  wrap.className = 'empty';

  const title = document.createElement('h2');
  title.textContent = heading;

  const body = document.createElement('p');
  body.textContent = message;

  wrap.append(title, body);

  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button';
    button.textContent = action.label;
    button.addEventListener('click', action.onClick);
    wrap.append(button);
  }

  return wrap;
}

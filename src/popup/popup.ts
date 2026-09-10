/**
 * Popup — a pure view over whatever the background worker last wrote to
 * storage. It makes no network calls and never touches a credential, which is
 * why it opens instantly instead of waiting on ClickUp.
 */

import { adapterIds, displayNameFor } from '../adapters/index.js';
import { sendMessage } from '../core/messages.js';
import { getSettings, getSnapshot, getUiState, saveUiState } from '../core/storage.js';
import { groupBySource, prepareTasks } from '../core/sort.js';
import { STATUS_LABELS, type NormalizedTask, type Snapshot, type SourceState } from '../core/types.js';
import { el, requireElement } from '../ui/dom.js';
import { formatAgo, formatDue, plural } from './format.js';

const els = {
  meta: requireElement('meta'),
  alerts: requireElement('alerts'),
  list: requireElement('list'),
  refresh: requireElement('refresh', 'button'),
  options: requireElement('options', 'button'),
};

const collapsed = new Set<string>();

els.options.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

els.refresh.addEventListener('click', () => {
  void manualRefresh();
});

// The worker may finish a poll while the popup is open; re-render rather than
// leaving a stale list on screen.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['snapshot']) void render();
});

void init();

async function init(): Promise<void> {
  for (const id of (await getUiState()).collapsed) collapsed.add(id);
  await render();
}

async function manualRefresh(): Promise<void> {
  els.refresh.dataset['busy'] = 'true';
  els.meta.textContent = 'Refreshing…';

  try {
    await sendMessage({ type: 'refresh' });
  } catch (err) {
    els.meta.textContent = err instanceof Error ? err.message : 'Refresh failed.';
  } finally {
    delete els.refresh.dataset['busy'];
    await render();
  }
}

async function render(): Promise<void> {
  const [snapshot, settings] = await Promise.all([getSnapshot(), getSettings()]);
  const tasks = prepareTasks(snapshot.tasks, settings);

  renderMeta(snapshot, tasks.length);
  renderAlerts(snapshot.sources);

  const connected = snapshot.sources.filter(
    (source) => source.status !== 'unconfigured' && source.status !== 'disabled',
  );

  if (connected.length === 0) {
    els.list.replaceChildren(
      emptyState('No sources connected', 'Add a ClickUp personal API token to start pulling your tasks.', {
        label: 'Open options',
        onClick: () => chrome.runtime.openOptionsPage(),
      }),
    );
    return;
  }

  if (tasks.length === 0) {
    const allFailed = connected.every((source) => source.status === 'error');
    els.list.replaceChildren(
      allFailed
        ? emptyState('Nothing to show', 'Every connected source failed to refresh. See the errors above.')
        : emptyState('All clear', 'Nothing is assigned to you right now.'),
    );
    return;
  }

  if (settings.groupBySource) {
    els.list.replaceChildren(
      ...groupBySource(tasks, adapterIds()).map((group) => renderGroup(group.source, group.tasks)),
    );
  } else {
    els.list.replaceChildren(el('div', { class: 'group__items' }, ...tasks.map(renderTask)));
  }
}

function renderMeta(snapshot: Snapshot, visible: number): void {
  els.meta.textContent = snapshot.updatedAt
    ? `${plural(visible, 'item')} · updated ${formatAgo(snapshot.updatedAt)}`
    : 'Not synced yet';
}

function renderAlerts(sources: SourceState[]): void {
  const alerts = sources.flatMap((source) => {
    // Narrowing on the union means `source.error` and `source.stale` below are
    // known to exist — no optional chaining, no null fallbacks.
    if (source.status !== 'error') return [];

    return [
      el(
        'div',
        { class: source.stale ? 'alert alert--warn' : 'alert alert--error' },
        el('strong', {
          text: source.stale
            ? `${source.displayName} — showing cached items`
            : `${source.displayName} — refresh failed`,
        }),
        el('span', { text: source.error }),
      ),
    ];
  });

  els.alerts.replaceChildren(...alerts);
}

function renderGroup(sourceId: string, tasks: NormalizedTask[]): HTMLElement {
  const isCollapsed = collapsed.has(sourceId);

  const header = el(
    'button',
    { class: 'group__header' },
    el('span', { class: 'group__caret', text: '▼' }),
    el('span', { text: displayNameFor(sourceId) }),
    el('span', { class: 'group__count', text: String(tasks.length) }),
  );
  header.type = 'button';

  const group = el(
    'section',
    { class: 'group', dataset: { collapsed: String(isCollapsed) } },
    header,
    el('div', { class: 'group__items' }, ...tasks.map(renderTask)),
  );

  header.addEventListener('click', () => {
    const nowCollapsed = group.dataset['collapsed'] !== 'true';
    group.dataset['collapsed'] = String(nowCollapsed);

    if (nowCollapsed) collapsed.add(sourceId);
    else collapsed.delete(sourceId);

    void saveUiState([...collapsed]);
  });

  return group;
}

function renderTask(task: NormalizedTask): HTMLElement {
  const due = formatDue(task.dueDate);

  const link = el(
    'a',
    { class: 'task', dataset: { status: task.status } },
    el('span', { class: 'task__rail', dataset: { priority: task.priority ?? undefined } }),
    el(
      'span',
      {},
      el('span', { class: 'task__title', text: task.title }),
      el('span', {
        class: 'task__sub',
        text: [STATUS_LABELS[task.status], task.subtitle].filter(Boolean).join(' · '),
      }),
    ),
    el('span', {
      class: 'task__due',
      text: due.text,
      dataset: { overdue: due.overdue ? 'true' : undefined },
    }),
  );

  link.href = task.url;
  link.target = '_blank';
  link.rel = 'noreferrer noopener';
  return link;
}

interface EmptyAction {
  label: string;
  onClick: () => void;
}

function emptyState(heading: string, message: string, action?: EmptyAction): HTMLElement {
  const wrap = el('div', { class: 'empty' }, el('h2', { text: heading }), el('p', { text: message }));

  if (action) {
    const button = el('button', { class: 'button', text: action.label });
    button.type = 'button';
    button.addEventListener('click', action.onClick);
    wrap.append(button);
  }

  return wrap;
}

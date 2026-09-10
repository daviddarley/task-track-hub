/**
 * Smoke test for the pure logic — normalization, sorting, date formatting.
 * Run with `npm test`. No Chrome APIs are touched, so plain Node is enough.
 */

import assert from 'node:assert/strict';

import { mapPriority, mapStatus, msToIso, normalizeTask } from '../extension/src/adapters/clickup-map.js';
import { countOpen, groupBySource, prepareTasks } from '../extension/src/core/sort.js';
import { formatAgo, formatDue } from '../extension/src/popup/format.js';

let failures = 0;

/**
 * @param {string} name
 * @param {() => void} fn
 */
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * @param {Partial<import('../extension/src/core/types.js').NormalizedTask>} overrides
 */
function task(overrides) {
  return {
    id: 'clickup:x',
    sourceId: 'x',
    title: 'Task',
    status: 'open',
    priority: null,
    dueDate: null,
    url: 'https://example.test',
    source: 'clickup',
    subtitle: null,
    raw: {},
    ...overrides,
  };
}

const settings = {
  refreshMinutes: 10,
  sortBy: 'dueDate',
  groupBySource: true,
  showClosed: false,
  adapters: {},
};

console.log('clickup-map');

test('normalizes a ClickUp task onto the shared shape', () => {
  const result = normalizeTask({
    id: 'abc123',
    name: 'Fix the widget',
    status: { status: 'in progress', type: 'custom' },
    priority: { priority: 'urgent' },
    due_date: '1757462400000',
    url: 'https://app.clickup.com/t/abc123',
    list: { name: 'Support' },
  });

  assert.equal(result.id, 'clickup:abc123');
  assert.equal(result.sourceId, 'abc123');
  assert.equal(result.title, 'Fix the widget');
  assert.equal(result.status, 'in_progress');
  assert.equal(result.priority, 'high');
  assert.equal(result.dueDate, new Date(1757462400000).toISOString());
  assert.equal(result.subtitle, 'Support');
  assert.equal(result.source, 'clickup');
});

test('survives a sparse payload without throwing', () => {
  const result = normalizeTask({ id: 42 });
  assert.equal(result.title, '(untitled task)');
  assert.equal(result.status, 'open');
  assert.equal(result.priority, null);
  assert.equal(result.dueDate, null);
  assert.equal(result.url, 'https://app.clickup.com/t/42');
});

test('maps status types before status names', () => {
  assert.equal(mapStatus({ type: 'done', status: 'in progress' }), 'closed');
  assert.equal(mapStatus({ type: 'closed', status: 'complete' }), 'closed');
  assert.equal(mapStatus({ type: 'open', status: 'to do' }), 'open');
  assert.equal(mapStatus({ type: 'custom', status: 'waiting on client' }), 'waiting');
  assert.equal(mapStatus({ type: 'custom', status: 'code review' }), 'waiting');
  assert.equal(mapStatus({ type: 'custom', status: 'something bespoke' }), 'in_progress');
  assert.equal(mapStatus(undefined), 'open');
});

test('folds urgent into high and normal into medium', () => {
  assert.equal(mapPriority({ priority: 'urgent' }), 'high');
  assert.equal(mapPriority({ priority: 'high' }), 'high');
  assert.equal(mapPriority({ priority: 'normal' }), 'medium');
  assert.equal(mapPriority({ priority: 'low' }), 'low');
  assert.equal(mapPriority(null), null);
});

test('rejects junk timestamps rather than emitting Invalid Date', () => {
  assert.equal(msToIso(null), null);
  assert.equal(msToIso(''), null);
  assert.equal(msToIso('0'), null);
  assert.equal(msToIso('not a number'), null);
  assert.equal(msToIso(1757462400000), new Date(1757462400000).toISOString());
});

console.log('sort');

test('hides closed tasks unless asked for', () => {
  const tasks = [task({ id: 'a', status: 'closed' }), task({ id: 'b', status: 'open' })];
  assert.deepEqual(
    prepareTasks(tasks, settings).map((t) => t.id),
    ['b'],
  );
  assert.deepEqual(
    prepareTasks(tasks, { ...settings, showClosed: true }).map((t) => t.id),
    ['b', 'a'],
  );
});

test('sorts undated work below dated work', () => {
  const tasks = [
    task({ id: 'none' }),
    task({ id: 'later', dueDate: '2030-01-01T00:00:00.000Z' }),
    task({ id: 'sooner', dueDate: '2026-01-01T00:00:00.000Z' }),
  ];
  assert.deepEqual(
    prepareTasks(tasks, settings).map((t) => t.id),
    ['sooner', 'later', 'none'],
  );
});

test('ranks actionable statuses above waiting ones', () => {
  const tasks = [
    task({ id: 'waiting', status: 'waiting' }),
    task({ id: 'active', status: 'in_progress' }),
    task({ id: 'open', status: 'open' }),
  ];
  assert.deepEqual(
    prepareTasks(tasks, settings).map((t) => t.id),
    ['active', 'open', 'waiting'],
  );
});

test('sorts by priority when asked, with due date as the tie-break', () => {
  const tasks = [
    task({ id: 'low', priority: 'low' }),
    task({ id: 'high-late', priority: 'high', dueDate: '2030-01-01T00:00:00.000Z' }),
    task({ id: 'high-soon', priority: 'high', dueDate: '2026-01-01T00:00:00.000Z' }),
  ];
  assert.deepEqual(
    prepareTasks(tasks, { ...settings, sortBy: 'priority' }).map((t) => t.id),
    ['high-soon', 'high-late', 'low'],
  );
});

test('groups in registry order and drops empty groups', () => {
  const tasks = [task({ id: 'c1', source: 'clickup' }), task({ id: 'n1', source: 'netsuite' })];
  const groups = groupBySource(tasks, ['netsuite', 'clickup', 'jira']);
  assert.deepEqual(
    groups.map((g) => g.source),
    ['netsuite', 'clickup'],
  );
});

test('counts everything that is not closed', () => {
  assert.equal(countOpen([task({ status: 'closed' }), task({ status: 'waiting' }), task({})]), 2);
});

console.log('format');

test('describes due dates relative to today', () => {
  const now = new Date('2026-09-10T15:00:00.000Z');
  const at = (/** @type {string} */ iso) => formatDue(iso, now);

  assert.equal(at('2026-09-10T09:00:00.000Z').text, 'Today');
  assert.equal(at('2026-09-10T09:00:00.000Z').overdue, true);
  assert.equal(at('2026-09-09T09:00:00.000Z').text, '1d late');
  assert.equal(at('2026-09-07T09:00:00.000Z').text, '3d late');
  assert.equal(at('2026-09-11T09:00:00.000Z').text, 'Tomorrow');
  assert.equal(at('2026-09-11T09:00:00.000Z').overdue, false);
  assert.equal(formatDue(null, now).text, '');
  assert.equal(formatDue('garbage', now).text, '');
});

test('describes sync age in the largest sensible unit', () => {
  const now = new Date('2026-09-10T15:00:00.000Z');
  assert.equal(formatAgo('2026-09-10T14:59:30.000Z', now), 'just now');
  assert.equal(formatAgo('2026-09-10T14:45:00.000Z', now), '15m ago');
  assert.equal(formatAgo('2026-09-10T12:00:00.000Z', now), '3h ago');
  assert.equal(formatAgo('2026-09-08T15:00:00.000Z', now), '2d ago');
  assert.equal(formatAgo('', now), 'never');
});

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

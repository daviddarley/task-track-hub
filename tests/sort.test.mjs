// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { countOpen, groupBySource, prepareTasks } from '../dist/core/sort.js';

/**
 * @param {Partial<import('../dist/core/types.js').NormalizedTask>} overrides
 * @returns {import('../dist/core/types.js').NormalizedTask}
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

/** @type {import('../dist/core/types.js').Settings} */
const settings = {
  refreshMinutes: 10,
  sortBy: 'dueDate',
  groupBySource: true,
  showClosed: false,
  adapters: {},
};

describe('prepareTasks', () => {
  it('hides closed tasks unless asked for, and sinks them when shown', () => {
    const tasks = [task({ id: 'a', status: 'closed' }), task({ id: 'b', status: 'open' })];

    assert.deepEqual(prepareTasks(tasks, settings).map((t) => t.id), ['b']);
    assert.deepEqual(
      prepareTasks(tasks, { ...settings, showClosed: true }).map((t) => t.id),
      ['b', 'a'],
    );
  });

  it('sorts undated work below dated work', () => {
    const tasks = [
      task({ id: 'none' }),
      task({ id: 'later', dueDate: '2030-01-01T00:00:00.000Z' }),
      task({ id: 'sooner', dueDate: '2026-01-01T00:00:00.000Z' }),
    ];

    assert.deepEqual(prepareTasks(tasks, settings).map((t) => t.id), ['sooner', 'later', 'none']);
  });

  it('ranks actionable statuses above waiting ones', () => {
    const tasks = [
      task({ id: 'waiting', status: 'waiting' }),
      task({ id: 'active', status: 'in_progress' }),
      task({ id: 'open', status: 'open' }),
    ];

    assert.deepEqual(prepareTasks(tasks, settings).map((t) => t.id), ['active', 'open', 'waiting']);
  });

  it('sorts by priority when asked, with due date as the tie-break', () => {
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

  it('does not mutate the array it was given', () => {
    const tasks = [
      task({ id: 'later', dueDate: '2030-01-01T00:00:00.000Z' }),
      task({ id: 'sooner', dueDate: '2026-01-01T00:00:00.000Z' }),
    ];

    prepareTasks(tasks, settings);
    assert.deepEqual(tasks.map((t) => t.id), ['later', 'sooner']);
  });

  it('treats an unparseable due date as undated rather than throwing', () => {
    const tasks = [task({ id: 'junk', dueDate: 'not-a-date' }), task({ id: 'real', dueDate: '2026-01-01T00:00:00.000Z' })];
    assert.deepEqual(prepareTasks(tasks, settings).map((t) => t.id), ['real', 'junk']);
  });
});

describe('groupBySource', () => {
  it('groups in registry order and drops empty groups', () => {
    const tasks = [task({ id: 'c1', source: 'clickup' }), task({ id: 'n1', source: 'netsuite' })];
    const groups = groupBySource(tasks, ['netsuite', 'clickup', 'jira']);

    assert.deepEqual(groups.map((g) => g.source), ['netsuite', 'clickup']);
    assert.deepEqual(groups[0].tasks.map((t) => t.id), ['n1']);
  });

  it('still surfaces tasks from a source that is not registered', () => {
    const tasks = [task({ id: 'orphan', source: 'retired-tool' })];
    const groups = groupBySource(tasks, ['clickup']);

    assert.deepEqual(groups.map((g) => g.source), ['retired-tool']);
  });
});

describe('countOpen', () => {
  it('counts everything that is not closed', () => {
    assert.equal(countOpen([task({ status: 'closed' }), task({ status: 'waiting' }), task({})]), 2);
    assert.equal(countOpen([]), 0);
  });
});

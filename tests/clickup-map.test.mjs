// @ts-check
/**
 * Runs against `dist/` — the compiled artifact Chrome actually loads — so a
 * build that emits something broken fails here rather than in the browser.
 * `npm test` builds first.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mapPriority, mapStatus, msToIso, normalizeTask } from '../dist/adapters/clickup-map.js';

describe('normalizeTask', () => {
  it('maps a full ClickUp payload onto the shared shape', () => {
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

  it('survives a sparse payload without throwing', () => {
    const result = normalizeTask({ id: 42 });

    assert.equal(result.title, '(untitled task)');
    assert.equal(result.status, 'open');
    assert.equal(result.priority, null);
    assert.equal(result.dueDate, null);
    assert.equal(result.url, 'https://app.clickup.com/t/42');
    assert.equal(result.subtitle, null);
  });

  it('falls back to the space name when a task has no list', () => {
    const result = normalizeTask({ id: '1', space: { name: 'Engineering' } });
    assert.equal(result.subtitle, 'Engineering');
  });
});

describe('mapStatus', () => {
  it('trusts the status type over the status name', () => {
    assert.equal(mapStatus({ type: 'done', status: 'in progress' }), 'closed');
    assert.equal(mapStatus({ type: 'closed', status: 'complete' }), 'closed');
  });

  it('reads custom status names to separate active work from parked work', () => {
    assert.equal(mapStatus({ type: 'custom', status: 'waiting on client' }), 'waiting');
    assert.equal(mapStatus({ type: 'custom', status: 'code review' }), 'waiting');
    assert.equal(mapStatus({ type: 'custom', status: 'in development' }), 'in_progress');
  });

  it('treats an unrecognized custom status as mid-flow, not new', () => {
    assert.equal(mapStatus({ type: 'custom', status: 'something bespoke' }), 'in_progress');
  });

  it('defaults to open for the first column and for junk', () => {
    assert.equal(mapStatus({ type: 'open', status: 'to do' }), 'open');
    assert.equal(mapStatus(undefined), 'open');
    assert.equal(mapStatus(null), 'open');
  });
});

describe('mapPriority', () => {
  it('folds urgent into high and normal into medium', () => {
    assert.equal(mapPriority({ priority: 'urgent' }), 'high');
    assert.equal(mapPriority({ priority: 'high' }), 'high');
    assert.equal(mapPriority({ priority: 'normal' }), 'medium');
    assert.equal(mapPriority({ priority: 'low' }), 'low');
  });

  it('returns null when ClickUp has no priority set', () => {
    assert.equal(mapPriority(null), null);
    assert.equal(mapPriority(undefined), null);
    assert.equal(mapPriority({}), null);
  });
});

describe('msToIso', () => {
  it('rejects junk rather than emitting an Invalid Date', () => {
    assert.equal(msToIso(null), null);
    assert.equal(msToIso(undefined), null);
    assert.equal(msToIso(''), null);
    assert.equal(msToIso('0'), null);
    assert.equal(msToIso('not a number'), null);
    assert.equal(msToIso(-5), null);
  });

  it('accepts epoch milliseconds as a string or a number', () => {
    const expected = new Date(1757462400000).toISOString();
    assert.equal(msToIso('1757462400000'), expected);
    assert.equal(msToIso(1757462400000), expected);
  });
});

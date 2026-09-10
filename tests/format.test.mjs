// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatAgo, formatDue, plural } from '../dist/popup/format.js';

const NOW = new Date('2026-09-10T15:00:00.000Z');

describe('formatDue', () => {
  /** @param {string} iso */
  const at = (iso) => formatDue(iso, NOW);

  it('calls anything due today "Today", and flags it', () => {
    // 09:00 today at 15:00 is still Today, not "1d late" — the comparison is
    // by calendar day, not by elapsed time.
    assert.deepEqual(at('2026-09-10T09:00:00.000Z'), { text: 'Today', overdue: true });
    assert.deepEqual(at('2026-09-10T23:00:00.000Z'), { text: 'Today', overdue: true });
  });

  it('counts overdue work in whole days', () => {
    assert.deepEqual(at('2026-09-09T09:00:00.000Z'), { text: '1d late', overdue: true });
    assert.deepEqual(at('2026-09-07T09:00:00.000Z'), { text: '3d late', overdue: true });
  });

  it('names the next six days rather than dating them', () => {
    assert.equal(at('2026-09-11T09:00:00.000Z').text, 'Tomorrow');
    assert.equal(at('2026-09-11T09:00:00.000Z').overdue, false);
    assert.equal(at('2026-09-14T09:00:00.000Z').text.length, 3); // a weekday abbreviation
  });

  it('returns an empty label for missing or unparseable dates', () => {
    assert.deepEqual(formatDue(null, NOW), { text: '', overdue: false });
    assert.deepEqual(formatDue('garbage', NOW), { text: '', overdue: false });
  });
});

describe('formatAgo', () => {
  it('describes sync age in the largest sensible unit', () => {
    assert.equal(formatAgo('2026-09-10T14:59:30.000Z', NOW), 'just now');
    assert.equal(formatAgo('2026-09-10T14:45:00.000Z', NOW), '15m ago');
    assert.equal(formatAgo('2026-09-10T12:00:00.000Z', NOW), '3h ago');
    assert.equal(formatAgo('2026-09-08T15:00:00.000Z', NOW), '2d ago');
  });

  it('never reports a negative age from a clock skew', () => {
    assert.equal(formatAgo('2026-09-10T15:05:00.000Z', NOW), 'just now');
  });

  it('says never for an empty or unparseable timestamp', () => {
    assert.equal(formatAgo('', NOW), 'never');
    assert.equal(formatAgo('garbage', NOW), 'never');
  });
});

describe('plural', () => {
  it('only pluralizes when it should', () => {
    assert.equal(plural(1, 'item'), '1 item');
    assert.equal(plural(0, 'item'), '0 items');
    assert.equal(plural(7, 'item'), '7 items');
  });
});

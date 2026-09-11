// @ts-check
/**
 * Shapes here follow a real `GET /search/issues` response captured from a live
 * account, not documentation.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mapStatus, normalizeSearchResults, repoFullName, toIsoDate } from '../dist/adapters/github-map.js';

const ITEM = {
  id: 2847,
  number: 44,
  title: 'Fix subsidiary mapping on invoice print',
  html_url: 'https://github.com/acme/sdf-paper-roll-products/pull/44',
  state: 'open',
  draft: false,
  repository_url: 'https://api.github.com/repos/acme/sdf-paper-roll-products',
  pull_request: { merged_at: null },
};

const response = (...items) => ({ total_count: items.length, incomplete_results: false, items });

describe('normalizeSearchResults', () => {
  it('maps a real-shaped search item onto the shared shape', () => {
    const [task] = normalizeSearchResults(response(ITEM));

    assert.equal(task.id, 'github:acme/sdf-paper-roll-products#44');
    assert.equal(task.title, 'Fix subsidiary mapping on invoice print');
    assert.equal(task.status, 'open');
    assert.equal(task.priority, null);
    assert.equal(task.source, 'github');
    assert.equal(task.url, 'https://github.com/acme/sdf-paper-roll-products/pull/44');
    assert.equal(task.subtitle, 'acme/sdf-paper-roll-products #44');
  });

  it('scopes the id by repo, since PR numbers repeat across repos', () => {
    const other = { ...ITEM, repository_url: 'https://api.github.com/repos/acme/sdf-biologic' };
    const tasks = normalizeSearchResults(response(ITEM, other));

    assert.notEqual(tasks[0].id, tasks[1].id, '#44 in two repos must not collide');
    assert.equal(tasks[1].id, 'github:acme/sdf-biologic#44');
  });

  it('has no due date unless the PR is in a milestone', () => {
    const [plain] = normalizeSearchResults(response(ITEM));
    assert.equal(plain.dueDate, null);

    const [milestoned] = normalizeSearchResults(
      response({ ...ITEM, milestone: { due_on: '2026-10-01T07:00:00Z' } }),
    );
    assert.equal(milestoned.dueDate, new Date('2026-10-01T07:00:00Z').toISOString());
  });

  it('skips items with no number rather than linking nowhere', () => {
    const tasks = normalizeSearchResults(response(ITEM, { title: 'orphan' }, null));
    assert.equal(tasks.length, 1);
  });

  it('returns empty for a non-search payload', () => {
    assert.deepEqual(normalizeSearchResults(null), []);
    assert.deepEqual(normalizeSearchResults({ message: 'Bad credentials' }), []);
    assert.deepEqual(normalizeSearchResults(response()), []);
  });
});

describe('mapStatus', () => {
  it('treats a draft as work in progress', () => {
    assert.equal(mapStatus({ state: 'open', draft: true }), 'in_progress');
  });

  it('treats a ready open PR as open', () => {
    assert.equal(mapStatus({ state: 'open', draft: false }), 'open');
    assert.equal(mapStatus({ state: 'open' }), 'open');
  });

  it('treats closed as closed even when still flagged draft', () => {
    assert.equal(mapStatus({ state: 'closed', draft: true }), 'closed');
    assert.equal(mapStatus({ state: 'CLOSED' }), 'closed');
  });

  it('defaults to open for a missing state', () => {
    assert.equal(mapStatus({}), 'open');
  });
});

describe('repoFullName', () => {
  it('extracts owner/name from the API url', () => {
    assert.equal(repoFullName('https://api.github.com/repos/acme/widget'), 'acme/widget');
  });

  it('returns null for junk', () => {
    assert.equal(repoFullName(null), null);
    assert.equal(repoFullName(''), null);
    assert.equal(repoFullName('nope'), null);
  });
});

describe('toIsoDate', () => {
  it('normalizes or rejects', () => {
    assert.equal(toIsoDate('2026-10-01T07:00:00Z'), new Date('2026-10-01T07:00:00Z').toISOString());
    assert.equal(toIsoDate(null), null);
    assert.equal(toIsoDate('not a date'), null);
  });
});

// @ts-check
/**
 * Shapes here follow the documented GET /people/{id}/assigned_todos.json
 * response: an array of to-do lists, each carrying an `assigned_todos` array.
 * Unlike the ClickUp and NetSuite suites, these were never checked against a
 * live account — there are no Basecamp credentials yet.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildSubtitle, normalizeAssignedTodos, toIsoDate } from '../dist/adapters/basecamp-map.js';

const LIST = {
  id: 9001,
  name: 'Launch checklist',
  bucket: { name: 'Website Redesign' },
  assigned_todos: [
    {
      id: 12345,
      content: 'Write the migration guide',
      due_at: '2026-09-15',
      app_url: 'https://basecamp.com/1/projects/2/todos/12345',
      url: 'https://basecamp.com/1/api/v1/projects/2/todos/12345.json',
    },
  ],
};

describe('normalizeAssignedTodos', () => {
  it('flattens lists into tasks on the shared shape', () => {
    const [task] = normalizeAssignedTodos([LIST]);

    assert.equal(task.id, 'basecamp:12345');
    assert.equal(task.sourceId, '12345');
    assert.equal(task.title, 'Write the migration guide');
    assert.equal(task.status, 'open');
    assert.equal(task.priority, null);
    assert.equal(task.source, 'basecamp');
    assert.equal(task.subtitle, 'Website Redesign · Launch checklist');
  });

  it('deep links with app_url, not the API url', () => {
    // `url` is the API endpoint. Using it would send the user to raw JSON.
    const [task] = normalizeAssignedTodos([LIST]);
    assert.equal(task.url, 'https://basecamp.com/1/projects/2/todos/12345');
  });

  it('populates dueDate — unlike NetSuite cases, Basecamp to-dos have one', () => {
    const [task] = normalizeAssignedTodos([LIST]);
    assert.equal(task.dueDate, new Date('2026-09-15').toISOString());
  });

  it('flattens across several lists', () => {
    const second = { ...LIST, id: 9002, name: 'Second list', assigned_todos: [{ id: 2, content: 'Another' }] };
    const tasks = normalizeAssignedTodos([LIST, second]);

    assert.equal(tasks.length, 2);
    assert.deepEqual(tasks.map((t) => t.sourceId), ['12345', '2']);
  });

  it('skips malformed entries rather than rendering blank rows', () => {
    const tasks = normalizeAssignedTodos([
      LIST,
      null,
      { name: 'no todos key' },
      { name: 'todos not an array', assigned_todos: 'nope' },
      { name: 'todo without id', assigned_todos: [{ content: 'orphan' }] },
    ]);

    assert.equal(tasks.length, 1, 'one bad entry must not cost the whole source');
  });

  it('returns an empty list for a non-array response', () => {
    assert.deepEqual(normalizeAssignedTodos(null), []);
    assert.deepEqual(normalizeAssignedTodos({ error: 'nope' }), []);
    assert.deepEqual(normalizeAssignedTodos([]), []);
  });

  it('falls back when a to-do has no content', () => {
    const [task] = normalizeAssignedTodos([{ ...LIST, assigned_todos: [{ id: 7 }] }]);
    assert.equal(task.title, '(untitled to-do)');
    assert.equal(task.dueDate, null);
  });
});

describe('buildSubtitle', () => {
  it('joins project and list, and copes with either missing', () => {
    assert.equal(buildSubtitle({ name: 'List', bucket: { name: 'Project' } }), 'Project · List');
    assert.equal(buildSubtitle({ name: 'List' }), 'List');
    assert.equal(buildSubtitle({ bucket: { name: 'Project' } }), 'Project');
    assert.equal(buildSubtitle({}), null);
  });
});

describe('toIsoDate', () => {
  it('accepts both a bare date and a full timestamp', () => {
    assert.equal(toIsoDate('2026-09-15'), new Date('2026-09-15').toISOString());
    assert.equal(toIsoDate('2026-09-15T14:00:00.000-05:00'), new Date('2026-09-15T14:00:00.000-05:00').toISOString());
  });

  it('returns null rather than an Invalid Date', () => {
    assert.equal(toIsoDate(null), null);
    assert.equal(toIsoDate(undefined), null);
    assert.equal(toIsoDate(''), null);
    assert.equal(toIsoDate('not a date'), null);
  });
});

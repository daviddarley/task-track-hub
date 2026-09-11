/**
 * Basecamp 2 (BCX) → `NormalizedTask` mapping.
 *
 * Pure functions of an API payload, split from `basecamp.ts` the same way the
 * other adapters are, so all of it is testable without OAuth or a network.
 *
 * `GET /people/{id}/assigned_todos.json` returns an array of *to-do lists*,
 * each carrying an `assigned_todos` array — so the mapping flattens lists into
 * tasks, keeping the list and project names as context.
 */

import type { NormalizedTask, TaskPriority, TaskStatus } from '../core/types.js';

export const SOURCE = 'basecamp';

/** A to-do inside a list's `assigned_todos`. */
export interface BasecampTodo {
  id?: unknown;
  content?: unknown;
  due_at?: unknown;
  /** Browser link. The sibling `url` is the API endpoint and is not a deep link. */
  app_url?: unknown;
  url?: unknown;
  comments_count?: unknown;
}

/** One entry of the `assigned_todos.json` response. */
export interface BasecampTodoList {
  id?: unknown;
  name?: unknown;
  /** The project the list belongs to. */
  bucket?: { name?: unknown } | null;
  assigned_todos?: unknown;
}

/**
 * Flatten the response into tasks.
 *
 * Anything that isn't a recognizable to-do is skipped rather than rendered as a
 * blank row — a malformed entry should cost one item, not the whole source.
 */
export function normalizeAssignedTodos(response: unknown): NormalizedTask[] {
  if (!Array.isArray(response)) return [];

  const tasks: NormalizedTask[] = [];
  for (const entry of response) {
    const list = asRecord(entry) as BasecampTodoList | null;
    if (!list) continue;

    const todos = list.assigned_todos;
    if (!Array.isArray(todos)) continue;

    for (const raw of todos) {
      const todo = asRecord(raw) as BasecampTodo | null;
      if (!todo || asString(todo.id) === null) continue;
      tasks.push(normalizeTodo(todo, list));
    }
  }

  return tasks;
}

export function normalizeTodo(todo: BasecampTodo, list: BasecampTodoList): NormalizedTask {
  const sourceId = String(asString(todo.id));

  return {
    id: `${SOURCE}:${sourceId}`,
    sourceId,
    title: asString(todo.content) ?? '(untitled to-do)',
    // `assigned_todos` carries no `completed_at` — the endpoint returns work
    // still assigned and outstanding, so everything here is open by definition.
    status: mapStatus(),
    // Basecamp 2 has no priority concept at all, on to-dos or lists.
    priority: mapPriority(),
    dueDate: toIsoDate(todo.due_at),
    url: asString(todo.app_url) ?? asString(todo.url) ?? 'https://basecamp.com/',
    source: SOURCE,
    subtitle: buildSubtitle(list),
    raw: todo,
  };
}

/**
 * Always `open`. Kept as a function so the reason lives somewhere findable, and
 * so a future switch to an endpoint that does report completion has one place
 * to change.
 */
export function mapStatus(): TaskStatus {
  return 'open';
}

export function mapPriority(): TaskPriority {
  return null;
}

/** "Project · List", falling back to whichever half exists. */
export function buildSubtitle(list: BasecampTodoList): string | null {
  const project = asString(list.bucket?.name);
  const name = asString(list.name);
  return [project, name].filter(Boolean).join(' · ') || null;
}

/**
 * Basecamp sends ISO 8601, but `due_at` is sometimes a bare date
 * (`2026-09-15`) and sometimes a full timestamp. Both parse; anything that
 * doesn't becomes null rather than an Invalid Date in storage.
 */
export function toIsoDate(value: unknown): string | null {
  const text = asString(value);
  if (!text) return null;

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  return null;
}

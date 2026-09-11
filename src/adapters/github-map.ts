/**
 * GitHub search results → `NormalizedTask` mapping.
 *
 * Pure functions of an API payload, split from `github.ts` like the other
 * adapters, so all of it is testable without a token or a network.
 *
 * Field names and shapes were read from a live `GET /search/issues` response,
 * not from documentation.
 */

import type { NormalizedTask, TaskPriority, TaskStatus } from '../core/types.js';

export const SOURCE = 'github';

/** The slice of a search result item we read. */
export interface GitHubSearchItem {
  id?: unknown;
  number?: unknown;
  title?: unknown;
  html_url?: unknown;
  state?: unknown;
  draft?: unknown;
  /** API URL of the repo, e.g. `https://api.github.com/repos/owner/name`. */
  repository_url?: unknown;
  milestone?: { due_on?: unknown } | null;
  /** Present on pull requests, absent on plain issues. */
  pull_request?: { merged_at?: unknown } | null;
}

export function normalizeSearchResults(response: unknown): NormalizedTask[] {
  const body = asRecord(response);
  const items = body?.['items'];
  if (!Array.isArray(items)) return [];

  const tasks: NormalizedTask[] = [];
  for (const raw of items) {
    const item = asRecord(raw) as GitHubSearchItem | null;
    // Without a number there is no usable identity or link; skip rather than
    // render a broken row.
    if (!item || asString(item.number) === null) continue;
    tasks.push(normalizePullRequest(item));
  }

  return tasks;
}

export function normalizePullRequest(item: GitHubSearchItem): NormalizedTask {
  const repo = repoFullName(item.repository_url);
  const number = String(asString(item.number));
  // The PR number is only unique within a repo, so the id is scoped by repo.
  const sourceId = repo ? `${repo}#${number}` : number;

  return {
    id: `${SOURCE}:${sourceId}`,
    sourceId,
    title: asString(item.title) ?? '(untitled pull request)',
    status: mapStatus(item),
    // GitHub has no priority concept. Labels are sometimes used as one, but the
    // convention is per-repo and guessing at it would be wrong more often than
    // right.
    priority: mapPriority(),
    // A PR has no deadline of its own; a milestone is the only real one GitHub
    // offers, and only when the PR is in one.
    dueDate: toIsoDate(item.milestone?.due_on),
    url: asString(item.html_url) ?? (repo ? `https://github.com/${repo}/pull/${number}` : 'https://github.com'),
    source: SOURCE,
    subtitle: repo ? `${repo} #${number}` : `#${number}`,
    raw: item,
  };
}

/**
 * A draft is work you haven't finished, which is `in_progress`; a ready PR is
 * `open`. `waiting` is deliberately unused — from the assignee's side a PR is
 * their own work, not something parked on someone else.
 */
export function mapStatus(item: GitHubSearchItem): TaskStatus {
  if (asString(item.state)?.toLowerCase() === 'closed') return 'closed';
  if (item.draft === true) return 'in_progress';
  return 'open';
}

export function mapPriority(): TaskPriority {
  return null;
}

/** `https://api.github.com/repos/owner/name` → `owner/name`. */
export function repoFullName(repositoryUrl: unknown): string | null {
  const url = asString(repositoryUrl);
  if (!url) return null;

  const parts = url.split('/').filter(Boolean);
  if (parts.length < 2) return null;

  const owner = parts[parts.length - 2];
  const name = parts[parts.length - 1];
  return owner && name ? `${owner}/${name}` : null;
}

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

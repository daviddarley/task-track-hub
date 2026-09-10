/**
 * Shared vocabulary for the whole extension.
 *
 * Nothing outside `src/adapters/` is allowed to know which service a task came
 * from. Everything downstream — merge, sort, badge count, popup — works purely
 * against `NormalizedTask`.
 */

import type { AdapterErrorKind } from './errors.js';

/**
 * Normalized status buckets. Every adapter maps its service's own status
 * vocabulary onto exactly one of these.
 */
export type TaskStatus = 'open' | 'in_progress' | 'waiting' | 'closed';

/** Normalized priority, or `null` where the source has no equivalent. */
export type TaskPriority = 'high' | 'medium' | 'low' | null;

/** The single shape every adapter returns. */
export interface NormalizedTask {
  /** Globally unique, prefixed with the adapter id (`clickup:abc123`). */
  id: string;
  /** The service's own record id. */
  sourceId: string;
  /** Case subject / task name. */
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** ISO 8601 date-time, or null. */
  dueDate: string | null;
  /** Deep link back into the source system. */
  url: string;
  /** Adapter id, for grouping/filtering in the UI. */
  source: string;
  /** Optional source-supplied context (ClickUp list, NetSuite case number). */
  subtitle?: string | null;
  /** Untouched source payload, for debugging and future fields. */
  raw: unknown;
}

/**
 * The one interface a new connector has to implement.
 * See `docs/adding-an-adapter.md`.
 */
export interface TaskAdapter {
  readonly id: string;
  readonly displayName: string;
  /** Has the user supplied credentials complete enough to attempt a fetch? */
  isConfigured(): Promise<boolean>;
  /** Run the OAuth flow / validate the token and cache any ids it implies. */
  authenticate(): Promise<void>;
  fetchTasks(): Promise<NormalizedTask[]>;
}

interface SourceIdentity {
  id: string;
  displayName: string;
}

/**
 * Per-source outcome of one sync pass, as a discriminated union: `error` and
 * `stale` only exist on the failure variant, so the popup cannot read an error
 * message off a source that succeeded, and cannot forget to handle one that
 * didn't.
 */
export type SourceState =
  | (SourceIdentity & {
      status: 'ok';
      count: number;
      /** ISO timestamp of this successful fetch. */
      fetchedAt: string;
    })
  | (SourceIdentity & {
      status: 'error';
      /** Tasks still being served for this source — the last good set, if any. */
      count: number;
      error: string;
      errorKind: AdapterErrorKind;
      /** ISO timestamp of the last *successful* fetch, if there ever was one. */
      fetchedAt: string | null;
      /** True when `count` reflects a previous pass rather than this one. */
      stale: boolean;
    })
  | (SourceIdentity & { status: 'unconfigured' | 'disabled' });

/** What the popup reads. Written by the background worker only. */
export interface Snapshot {
  tasks: NormalizedTask[];
  sources: SourceState[];
  /** ISO timestamp of the last sync attempt. */
  updatedAt: string;
  /** Tasks not in the `closed` bucket. */
  openCount: number;
}

export type SortBy = 'dueDate' | 'priority' | 'title';

export interface AdapterSettings {
  enabled: boolean;
}

export interface Settings {
  refreshMinutes: number;
  sortBy: SortBy;
  groupBySource: boolean;
  showClosed: boolean;
  adapters: Record<string, AdapterSettings | undefined>;
}

export const STATUS_LABELS = {
  open: 'Open',
  in_progress: 'In progress',
  waiting: 'Waiting',
  closed: 'Closed',
} as const satisfies Record<TaskStatus, string>;

export const PRIORITY_RANK = {
  high: 0,
  medium: 1,
  low: 2,
} as const satisfies Record<Exclude<TaskPriority, null>, number>;

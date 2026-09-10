/**
 * NetSuite Support Case → `NormalizedTask` mapping.
 *
 * Pure functions of a SuiteQL row, split from `netsuite.ts` the same way
 * `clickup-map.ts` is split from `clickup.ts`, so all of it is testable without
 * OAuth, `chrome`, or a network.
 *
 * The status ids below were read out of a live account rather than guessed —
 * `SELECT DISTINCT status, BUILTIN.DF(status) FROM supportcase`. They are
 * NetSuite's standard case-status ids, but an account can add its own, so
 * `mapStatus` degrades to a safe default rather than throwing on an unknown id.
 */

import type { NormalizedTask, TaskPriority, TaskStatus } from '../core/types.js';

export const SOURCE = 'netsuite';

/**
 * One SuiteQL row from `supportcase`. Every field is optional and loosely typed
 * because this is JSON off the wire — and note SuiteQL returns *every* value as
 * a string, ids and numbers included.
 */
export interface SupportCaseRow {
  id?: unknown;
  casenumber?: unknown;
  title?: unknown;
  status?: unknown;
  priority?: unknown;
  assigned?: unknown;
  startdate?: unknown;
  enddate?: unknown;
  datecreated?: unknown;
  lastmessagedate?: unknown;
}

/**
 * Observed in account 6967599. Ids 3 and 4 are absent there; NetSuite's stock
 * set includes them, so they are mapped defensively rather than left to the
 * fallback.
 */
const STATUS_BY_ID: Record<string, TaskStatus> = {
  '1': 'open', // Not Started
  '2': 'in_progress', // In Progress
  '3': 'in_progress', // Escalated (stock; unused in 6967599)
  '4': 'open', // Re-opened (stock; unused in 6967599)
  '5': 'closed', // Closed
  '6': 'waiting', // Waiting for Customer Response
  '7': 'waiting', // On Hold
  '8': 'waiting', // Waiting on NetSuite
  '9': 'open', // Scheduled
  '10': 'waiting', // Submitted to Development
  '11': 'open', // Follow Up Required — action sits with you
  '12': 'in_progress', // Ongoing Project
};

/** NetSuite's stock case priority ids. */
const PRIORITY_BY_ID: Record<string, Exclude<TaskPriority, null>> = {
  '1': 'high',
  '2': 'medium',
  '3': 'low',
};

export function normalizeCase(row: SupportCaseRow, accountId: string): NormalizedTask {
  const sourceId = String(row.id ?? '');
  const caseNumber = asString(row.casenumber);

  return {
    id: `${SOURCE}:${sourceId}`,
    sourceId,
    title: asString(row.title) ?? '(untitled case)',
    status: mapStatus(row.status),
    priority: mapPriority(row.priority),
    // Support cases carry no due-date field. `enddate` is the *closed* date,
    // not a target, so mapping it here would invent urgency that doesn't exist.
    // The raw dates stay on `raw` if we later want to sort by activity instead.
    dueDate: null,
    url: caseUrl(accountId, sourceId),
    source: SOURCE,
    subtitle: caseNumber ? `Case ${caseNumber}` : null,
    raw: row,
  };
}

/**
 * An unknown status id means the account added a custom one. Treating it as
 * `open` keeps it visible and counted — the opposite mistake, hiding it as
 * closed, would silently drop real work off the list.
 */
export function mapStatus(status: unknown): TaskStatus {
  const id = asString(status);
  if (!id) return 'open';
  return STATUS_BY_ID[id] ?? 'open';
}

export function mapPriority(priority: unknown): TaskPriority {
  const id = asString(priority);
  if (!id) return null;
  return PRIORITY_BY_ID[id] ?? null;
}

/**
 * NetSuite's UI hostname differs from the API one, and sandbox account ids use
 * a hyphen on the wire where the id itself has an underscore (`1234567_SB1` →
 * `1234567-sb1`).
 */
export function accountHost(accountId: string, kind: 'app' | 'api'): string {
  const slug = accountId.trim().toLowerCase().replace(/_/g, '-');
  return kind === 'app' ? `${slug}.app.netsuite.com` : `${slug}.suitetalk.api.netsuite.com`;
}

export function caseUrl(accountId: string, caseId: string): string {
  return `https://${accountHost(accountId, 'app')}/app/crm/support/supportcase.nl?id=${encodeURIComponent(caseId)}`;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  return null;
}

import { AdapterError } from '../core/errors.js';
import { requestJson } from '../core/http.js';
import { createCredentialStore, getSettings, type CredentialStore } from '../core/storage.js';
import type { NormalizedTask, TaskAdapter } from '../core/types.js';
import { SOURCE, accountHost, normalizeCase, type SupportCaseRow } from './netsuite-map.js';
import {
  beginAuthorization,
  completeAuthorization,
  getAccessToken,
  type NetSuiteCredentials,
} from './netsuite-oauth.js';
import type { PendingAuth } from '../core/webauth.js';

export type { NetSuiteCredentials } from './netsuite-oauth.js';

export const netSuiteCredentials: CredentialStore<NetSuiteCredentials> =
  createCredentialStore<NetSuiteCredentials>(SOURCE);

/** SuiteQL pages via offset; 1000 is the server's own cap per response. */
const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

/** Closed. Excluded unless the user asked to see closed work. */
const STATUS_CLOSED = '5';

/**
 * NetSuite Support Cases assigned to one employee.
 *
 * Uses SuiteQL rather than the REST record API: one filtered query returns
 * exactly the columns we need, where the record endpoint would mean a list call
 * plus an N+1 fetch per case.
 *
 * The column list is not guesswork — it came from
 * `SELECT * FROM supportcase FETCH FIRST 1 ROWS ONLY` against a live account.
 */
export const netSuiteAdapter: TaskAdapter = {
  id: SOURCE,
  displayName: 'NetSuite',

  async isConfigured(): Promise<boolean> {
    const creds = await netSuiteCredentials.get();
    return Boolean(creds.accountId && creds.clientId && creds.employeeId && creds.refreshToken);
  },

  /**
   * Opens the sign-in tab and returns — it does not wait for the user. The
   * flow is finished by `finishNetSuiteAuth` when the redirect arrives, which
   * may be after this service worker has been torn down and restarted.
   */
  async authenticate(): Promise<void> {
    await beginAuthorization(netSuiteCredentials);
  },

  async fetchTasks(): Promise<NormalizedTask[]> {
    const creds = await netSuiteCredentials.get();
    const { accountId, employeeId } = creds;

    if (!accountId || !employeeId) {
      throw new AdapterError('not_configured', 'NetSuite account id and employee id are required.', {
        source: SOURCE,
      });
    }

    const settings = await getSettings();
    const token = await getAccessToken(netSuiteCredentials);
    const internalId = await resolveEmployeeId(accountId, token, employeeId, creds.resolvedEmployeeId);

    const rows = await runQuery(accountId, token, buildQuery(internalId, settings.showClosed));
    return rows.map((row) => normalizeCase(row as SupportCaseRow, accountId));
  },
};

/** A NetSuite internal id is digits; anything else is treated as an email. */
export function looksLikeInternalId(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

/**
 * Turn whatever the user typed into an employee internal id.
 *
 * Asking a teammate for their internal id means sending them into Setup →
 * Users/Roles to read a number out of a URL. Asking for their email means
 * asking something they already know, so an email is resolved here once and
 * cached — the query filters on the id either way.
 */
async function resolveEmployeeId(
  accountId: string,
  token: string,
  typed: string,
  cached: string | undefined,
): Promise<string> {
  const value = typed.trim();
  if (looksLikeInternalId(value)) return value;
  if (cached && looksLikeInternalId(cached)) return cached;

  const rows = await runQuery(accountId, token, {
    q: 'SELECT id FROM employee WHERE UPPER(email) = UPPER(?)',
    params: [value],
  });

  const id = rows.length > 0 ? String((rows[0] as { id?: unknown }).id ?? '') : '';
  if (!looksLikeInternalId(id)) {
    throw new AdapterError(
      'not_configured',
      `No NetSuite employee found with email ${value}. Check the address, or enter your internal id instead.`,
      { source: SOURCE },
    );
  }

  await netSuiteCredentials.patch({ resolvedEmployeeId: id });
  return id;
}

/**
 * Assignment is direct employee assignment in this account — `assigned` holds
 * the employee internal id. (A mirrored custom field, `custevent_cur_assigned`,
 * exists and agreed with `assigned` on every row sampled, so the stock field is
 * the one to trust.)
 *
 * The employee id is bound as a parameter rather than interpolated: it comes
 * from a text input, and SuiteQL is still SQL.
 */
export function buildQuery(employeeId: string, includeClosed: boolean): { q: string; params: string[] } {
  const where = includeClosed ? 'WHERE assigned = ?' : `WHERE assigned = ? AND status != ${STATUS_CLOSED}`;

  return {
    // Ordered by id alone, deliberately. Display order is decided client-side in
    // `core/sort.ts`, so this only has to be *stable* for paging — and ordering
    // by a nullable column isn't: NetSuite sorts NULLs first under DESC, which
    // floated a case with no message activity to the top.
    q: `SELECT id, casenumber, title, status, priority, assigned, startdate, enddate, datecreated, lastmessagedate
        FROM supportcase
        ${where}
        ORDER BY id DESC`,
    params: [employeeId],
  };
}

/** Rows come back as untyped JSON; callers narrow to the shape they asked for. */
type QueryRow = Record<string, unknown>;

async function runQuery(
  accountId: string,
  token: string,
  query: { q: string; params: string[] },
): Promise<QueryRow[]> {
  const collected: QueryRow[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE_SIZE;
    const url =
      `https://${accountHost(accountId, 'api')}/services/rest/query/v1/suiteql` +
      `?limit=${PAGE_SIZE}&offset=${offset}`;

    const response = await requestJson(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        // SuiteQL rejects the request without this; it is not optional.
        Prefer: 'transient',
      },
      body: { q: query.q, params: query.params },
      source: SOURCE,
    });

    const { items, hasMore } = readPage(response);
    collected.push(...items);

    if (!hasMore || items.length === 0) break;
  }

  return collected;
}

/**
 * Redeem the authorization code once the sign-in tab reaches the redirect URI.
 * Called from the worker's top-level tab listener, not from the adapter itself.
 */
export async function finishNetSuiteAuth(pending: PendingAuth, redirectedTo: string): Promise<void> {
  await completeAuthorization(netSuiteCredentials, pending, redirectedTo);
}

function readPage(response: unknown): { items: QueryRow[]; hasMore: boolean } {
  const body = typeof response === 'object' && response !== null ? (response as Record<string, unknown>) : {};
  const items = body['items'];

  return {
    items: Array.isArray(items) ? (items as QueryRow[]) : [],
    hasMore: body['hasMore'] === true,
  };
}

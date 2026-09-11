import { AdapterError } from '../core/errors.js';
import { requestJson } from '../core/http.js';
import { createCredentialStore, type CredentialStore } from '../core/storage.js';
import type { NormalizedTask, TaskAdapter } from '../core/types.js';
import { SOURCE, normalizeAssignedTodos } from './basecamp-map.js';
import { authorize, getAccessToken, type BasecampCredentials } from './basecamp-oauth.js';

export type { BasecampCredentials } from './basecamp-oauth.js';

export const basecampCredentials: CredentialStore<BasecampCredentials> =
  createCredentialStore<BasecampCredentials>(SOURCE);

const LAUNCHPAD_IDENTITY = 'https://launchpad.37signals.com/authorization.json';

/** Launchpad labels Basecamp 2 accounts with this product id. */
const PRODUCT_BC2 = 'bcx';

/**
 * Basecamp 2 to-dos assigned to you.
 *
 * `GET /people/{id}/assigned_todos.json` is a purpose-built "assigned to me"
 * endpoint — no query language and no schema discovery, unlike NetSuite.
 *
 * Account id and person id are discovered after sign-in rather than typed, so
 * onboarding a teammate is two pasted strings and a login.
 */
export const basecampAdapter: TaskAdapter = {
  id: SOURCE,
  displayName: 'Basecamp',

  async isConfigured(): Promise<boolean> {
    const creds = await basecampCredentials.get();
    return Boolean(creds.clientId && creds.clientSecret && creds.refreshToken && creds.accountId && creds.personId);
  },

  async authenticate(): Promise<void> {
    await authorize(basecampCredentials);
    await discoverIdentity();
  },

  async fetchTasks(): Promise<NormalizedTask[]> {
    const creds = await basecampCredentials.get();
    if (!creds.accountId || !creds.personId) {
      throw new AdapterError('not_configured', 'Basecamp is not connected.', { source: SOURCE });
    }

    const token = await getAccessToken(basecampCredentials);
    const response = await apiGet(
      creds.accountId,
      token,
      `/people/${encodeURIComponent(creds.personId)}/assigned_todos.json`,
    );

    return normalizeAssignedTodos(response);
  },
};

/**
 * Resolve which Basecamp 2 account this person belongs to, and their person id
 * within it. Cached — neither changes, and re-deriving them on every poll would
 * be two wasted round trips.
 */
async function discoverIdentity(): Promise<void> {
  const token = await getAccessToken(basecampCredentials);

  const identity = await requestJson(LAUNCHPAD_IDENTITY, {
    headers: { Authorization: `Bearer ${token}` },
    source: SOURCE,
  });

  const account = pickBasecamp2Account(identity);
  if (!account) {
    throw new AdapterError(
      'not_configured',
      'This login has no Basecamp 2 account. (Basecamp 3 and 4 use a different API this adapter does not speak.)',
      { source: SOURCE },
    );
  }

  const me = await apiGet(account.id, token, '/people/me.json');
  const person = typeof me === 'object' && me !== null ? (me as Record<string, unknown>) : {};
  const personId = person['id'];

  if (personId === undefined || personId === null) {
    throw new AdapterError('auth', 'Basecamp did not identify the signed-in person.', { source: SOURCE });
  }

  await basecampCredentials.patch({
    accountId: account.id,
    accountName: account.name,
    personId: String(personId),
    personName: typeof person['name'] === 'string' ? person['name'] : 'Basecamp user',
  });
}

function pickBasecamp2Account(identity: unknown): { id: string; name: string } | null {
  const body = typeof identity === 'object' && identity !== null ? (identity as Record<string, unknown>) : {};
  const accounts = body['accounts'];
  if (!Array.isArray(accounts)) return null;

  for (const entry of accounts) {
    const account = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null;
    if (!account || account['product'] !== PRODUCT_BC2) continue;
    if (account['id'] === undefined || account['id'] === null) continue;

    return {
      id: String(account['id']),
      name: typeof account['name'] === 'string' ? account['name'] : 'Basecamp',
    };
  }

  return null;
}

/**
 * Basecamp requires a `User-Agent` naming the app with contact details. Chrome
 * treats that as a forbidden header and ignores attempts to set it from an
 * extension, sending its own instead — probing suggests Basecamp accepts that,
 * since a browser agent drew the same responses as a compliant one rather than
 * the documented 400. If that turns out to be wrong on authenticated requests,
 * the fix is a `declarativeNetRequest` rule rewriting the header.
 */
async function apiGet(accountId: string, token: string, path: string): Promise<unknown> {
  return requestJson(`https://basecamp.com/${encodeURIComponent(accountId)}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    source: SOURCE,
  });
}

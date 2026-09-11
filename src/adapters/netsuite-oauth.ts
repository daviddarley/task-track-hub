/**
 * NetSuite OAuth 2.0 — authorization code grant with PKCE, as a public client.
 *
 * Deliberately not Token-Based Authentication: Oracle stops accepting new TBA
 * integrations for REST services in release 2027.1.
 *
 * No client secret is involved. An extension can't keep one — anyone can unzip
 * it — so the integration record is registered as a **Public Client** and PKCE
 * supplies the per-request proof instead. See docs/netsuite-oauth-setup.md.
 */

import { AdapterError } from '../core/errors.js';
import { requestJson } from '../core/http.js';
import { createPkcePair, createState } from '../core/pkce.js';
import type { CredentialStore } from '../core/storage.js';
import { startAuthTab, type PendingAuth } from '../core/webauth.js';
import { SOURCE, accountHost } from './netsuite-map.js';

export interface NetSuiteCredentials {
  /** e.g. `6967599`, or `1234567_SB1` for a sandbox. User-supplied. */
  accountId: string;
  /** From the integration record. Not a secret — public clients have none. */
  clientId: string;
  /**
   * Who to fetch cases for, as the user typed it: either a numeric internal id
   * or an email address. Email is what a teammate actually knows about
   * themselves; the internal id means hunting through Setup screens.
   */
  employeeId: string;
  /**
   * Internal id resolved from an email, cached so the lookup happens once
   * rather than on every poll.
   */
  resolvedEmployeeId: string;
  /** Long-lived, and rotated on every refresh. */
  refreshToken: string;
  accessToken: string;
  /** Epoch ms. */
  expiresAt: number;
}

/** SuiteQL lives behind REST web services; RESTlets are not needed. */
const SCOPE = 'rest_webservices';

/** Refresh this far before actual expiry, so a poll can't race the deadline. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * NetSuite rotates the refresh token on every refresh: the old one dies the
 * moment a new one is issued. Two concurrent refreshes would therefore race,
 * and the loser would persist a token NetSuite has already invalidated —
 * logging the user out for no visible reason. All refreshes funnel through
 * this one promise.
 */
let refreshing: Promise<string> | null = null;

/**
 * Start the interactive flow: build the authorize URL and open it in a tab.
 *
 * This returns as soon as the tab is open — the user may take minutes to get
 * through SSO, far longer than a service worker survives. Completion happens in
 * `completeAuthorization`, driven by a top-level tab listener.
 */
export async function beginAuthorization(store: CredentialStore<NetSuiteCredentials>): Promise<void> {
  const { accountId, clientId } = await store.get();
  if (!accountId || !clientId) {
    throw new AdapterError('not_configured', 'NetSuite account id and client id are required.', { source: SOURCE });
  }

  const redirectUri = chrome.identity.getRedirectURL();
  const pkce = await createPkcePair();
  const state = createState();

  const authUrl = new URL(`https://${accountHost(accountId, 'app')}/app/login/oauth2/authorize.nl`);
  authUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPE,
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: pkce.method,
  }).toString();

  await startAuthTab(authUrl.toString(), { adapterId: SOURCE, verifier: pkce.verifier, state, redirectUri });
}

/**
 * Finish a flow started by `beginAuthorization`, given the URL NetSuite
 * redirected to and the pending record saved when it started.
 */
export async function completeAuthorization(
  store: CredentialStore<NetSuiteCredentials>,
  pending: PendingAuth,
  redirectedTo: string,
): Promise<void> {
  const returned = new URL(redirectedTo);

  const error = returned.searchParams.get('error');
  if (error) {
    const description = returned.searchParams.get('error_description') ?? '';
    throw new AdapterError('auth', `NetSuite refused authorization: ${error}. ${description}`.trim(), {
      source: SOURCE,
    });
  }

  // Proves the redirect belongs to the request we started, not one an attacker
  // induced. A mismatch is the one case where we must not redeem the code.
  if (returned.searchParams.get('state') !== pending.state) {
    throw new AdapterError('auth', 'NetSuite returned a mismatched state value; authorization aborted.', {
      source: SOURCE,
    });
  }

  const code = returned.searchParams.get('code');
  if (!code) {
    throw new AdapterError('auth', 'NetSuite did not return an authorization code.', { source: SOURCE });
  }

  const { accountId, clientId } = await store.get();
  if (!accountId || !clientId) {
    throw new AdapterError('not_configured', 'NetSuite account id and client id are required.', { source: SOURCE });
  }

  const tokens = await exchange(accountId, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: pending.redirectUri,
    client_id: clientId,
    // The verifier is what makes the intercepted code useless to anyone else —
    // it never travelled with the redirect.
    code_verifier: pending.verifier,
  });

  await store.patch(tokens);
}

/**
 * A valid access token, refreshing first if the stored one is spent.
 */
export async function getAccessToken(store: CredentialStore<NetSuiteCredentials>): Promise<string> {
  const creds = await store.get();

  if (!creds.refreshToken) {
    throw new AdapterError('not_configured', 'NetSuite is not connected.', { source: SOURCE });
  }

  if (creds.accessToken && creds.expiresAt && creds.expiresAt - EXPIRY_SKEW_MS > Date.now()) {
    return creds.accessToken;
  }

  refreshing ??= refresh(store).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function refresh(store: CredentialStore<NetSuiteCredentials>): Promise<string> {
  const { accountId, clientId, refreshToken } = await store.get();
  if (!accountId || !clientId || !refreshToken) {
    throw new AdapterError('not_configured', 'NetSuite is not connected.', { source: SOURCE });
  }

  let tokens: TokenSet;
  try {
    tokens = await exchange(accountId, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    });
  } catch (err) {
    // A dead refresh token is unrecoverable without the user, so say so plainly
    // rather than letting it read as a transient network blip.
    if (err instanceof AdapterError && err.kind === 'auth') {
      throw new AdapterError(
        'auth',
        'NetSuite sign-in has expired (refresh tokens last 7 days). Reconnect in Options.',
        { source: SOURCE, cause: err },
      );
    }
    throw err;
  }

  await store.patch(tokens);
  return tokens.accessToken;
}

interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

async function exchange(accountId: string, form: Record<string, string>): Promise<TokenSet> {
  const response = await requestJson(
    `https://${accountHost(accountId, 'api')}/services/rest/auth/oauth2/v1/token`,
    { method: 'POST', form, source: SOURCE },
  );

  return readTokenSet(response);
}

function readTokenSet(response: unknown): TokenSet {
  const body = typeof response === 'object' && response !== null ? (response as Record<string, unknown>) : {};

  const accessToken = body['access_token'];
  const refreshToken = body['refresh_token'];
  const expiresIn = Number(body['expires_in']);

  if (typeof accessToken !== 'string' || !accessToken) {
    throw new AdapterError('auth', 'NetSuite did not return an access token.', { source: SOURCE });
  }
  if (typeof refreshToken !== 'string' || !refreshToken) {
    throw new AdapterError('auth', 'NetSuite did not return a refresh token.', { source: SOURCE });
  }

  return {
    accessToken,
    refreshToken,
    // Default to NetSuite's documented hour if the field is missing or junk.
    expiresAt: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
  };
}


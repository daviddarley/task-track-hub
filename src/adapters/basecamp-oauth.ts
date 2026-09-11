/**
 * Basecamp 2 OAuth 2.0 via 37signals Launchpad.
 *
 * Unlike NetSuite, Basecamp offers **no PKCE and no public-client mode** — the
 * token exchange requires a `client_secret`. An extension cannot keep a secret,
 * so the secret here is treated as a *user-supplied credential*: each person
 * pastes the team's client id and secret into Options, where they live in that
 * person's `chrome.storage.local`. It is never in the source and never
 * committed. See docs/basecamp-assessment.md for why this was chosen over the
 * alternatives.
 *
 * The practical blast radius of that shared secret is limited by the
 * integration record pinning the redirect URI to this extension: the secret
 * alone does not let anyone complete a flow.
 *
 * Note Launchpad takes its parameters in the **query string** of a POST, not a
 * form body — unusual, but it is what the documented endpoint expects.
 */

import { AdapterError } from '../core/errors.js';
import { requestJson } from '../core/http.js';
import type { CredentialStore } from '../core/storage.js';
import { SOURCE } from './basecamp-map.js';

export interface BasecampCredentials {
  /** From the team's integration at launchpad.37signals.com/integrations. */
  clientId: string;
  /** Shared within the team; never in source control. */
  clientSecret: string;
  /** BCX account id, discovered after sign-in. */
  accountId: string;
  accountName: string;
  /** This person's id within that account, discovered after sign-in. */
  personId: string;
  personName: string;
  refreshToken: string;
  accessToken: string;
  /** Epoch ms. */
  expiresAt: number;
}

const LAUNCHPAD = 'https://launchpad.37signals.com';

/** Refresh this far before real expiry so a poll can't race the deadline. */
const EXPIRY_SKEW_MS = 60_000;

/** Basecamp access tokens last two weeks; this is only a fallback. */
const DEFAULT_LIFETIME_S = 1_209_600;

let refreshing: Promise<string> | null = null;

export async function authorize(store: CredentialStore<BasecampCredentials>): Promise<void> {
  const { clientId, clientSecret } = await store.get();
  if (!clientId || !clientSecret) {
    throw new AdapterError('not_configured', 'Basecamp client id and secret are required.', { source: SOURCE });
  }

  const redirectUri = chrome.identity.getRedirectURL();

  const authUrl = `${LAUNCHPAD}/authorization/new?${new URLSearchParams({
    type: 'web_server',
    client_id: clientId,
    redirect_uri: redirectUri,
  })}`;

  const redirected = await launchWebAuthFlow(authUrl);
  const returned = new URL(redirected);

  const error = returned.searchParams.get('error');
  if (error) {
    throw new AdapterError('auth', `Basecamp refused authorization: ${error}`, { source: SOURCE });
  }

  const code = returned.searchParams.get('code');
  if (!code) {
    throw new AdapterError('auth', 'Basecamp did not return an authorization code.', { source: SOURCE });
  }

  // Launchpad's authorize endpoint accepts no `state` parameter, so there is no
  // echo to verify. The code is still bound to this client id and redirect URI,
  // both of which are ours.
  const tokens = await exchange({
    type: 'web_server',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });

  // The initial exchange must yield a refresh token; without one the connection
  // dies in two weeks with no way back except re-authorizing.
  if (!tokens.refreshToken) {
    throw new AdapterError('auth', 'Basecamp did not return a refresh token.', { source: SOURCE });
  }

  await store.patch(tokens);
}

export async function getAccessToken(store: CredentialStore<BasecampCredentials>): Promise<string> {
  const creds = await store.get();

  if (!creds.refreshToken) {
    throw new AdapterError('not_configured', 'Basecamp is not connected.', { source: SOURCE });
  }

  if (creds.accessToken && creds.expiresAt && creds.expiresAt - EXPIRY_SKEW_MS > Date.now()) {
    return creds.accessToken;
  }

  refreshing ??= refresh(store).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function refresh(store: CredentialStore<BasecampCredentials>): Promise<string> {
  const { clientId, clientSecret, refreshToken } = await store.get();
  if (!clientId || !clientSecret || !refreshToken) {
    throw new AdapterError('not_configured', 'Basecamp is not connected.', { source: SOURCE });
  }

  try {
    const tokens = await exchange({
      type: 'refresh',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });

    // Only overwrite the refresh token if a new one actually came back. A
    // refresh response may omit it, meaning "keep the one you have" — writing
    // the empty string would sign the user out a fortnight later, for no
    // visible reason.
    const patch: Partial<BasecampCredentials> = {
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
    };
    if (tokens.refreshToken) patch.refreshToken = tokens.refreshToken;

    await store.patch(patch);
    return tokens.accessToken;
  } catch (err) {
    if (err instanceof AdapterError && err.kind === 'auth') {
      throw new AdapterError('auth', 'Basecamp sign-in has expired. Reconnect in Options.', {
        source: SOURCE,
        cause: err,
      });
    }
    throw err;
  }
}

interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

async function exchange(params: Record<string, string>): Promise<TokenSet> {
  const response = await requestJson(`${LAUNCHPAD}/authorization/token?${new URLSearchParams(params)}`, {
    method: 'POST',
    source: SOURCE,
  });

  return readTokenSet(response);
}

function readTokenSet(response: unknown): TokenSet {
  const body = typeof response === 'object' && response !== null ? (response as Record<string, unknown>) : {};

  const accessToken = body['access_token'];
  const refreshToken = body['refresh_token'];
  const expiresIn = Number(body['expires_in']);

  if (typeof accessToken !== 'string' || !accessToken) {
    throw new AdapterError('auth', 'Basecamp did not return an access token.', { source: SOURCE });
  }

  return {
    accessToken,
    // A refresh response may omit the refresh token, meaning "keep the one you
    // have". Blanking it here would silently sign the user out a fortnight on.
    refreshToken: typeof refreshToken === 'string' && refreshToken ? refreshToken : '',
    expiresAt: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : DEFAULT_LIFETIME_S) * 1000,
  };
}

function launchWebAuthFlow(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectUrl) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new AdapterError('auth', `Basecamp sign-in failed: ${lastError.message}`, { source: SOURCE }));
        return;
      }
      if (!redirectUrl) {
        reject(new AdapterError('auth', 'Basecamp sign-in was cancelled.', { source: SOURCE }));
        return;
      }
      resolve(redirectUrl);
    });
  });
}

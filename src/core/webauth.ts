/**
 * Browser-tab OAuth redirect capture.
 *
 * `chrome.identity.launchWebAuthFlow` is the obvious tool for this and we don't
 * use it, for one reason: it opens a small fixed popup window and exposes no
 * way to size it or open a tab instead (its options are `url`, `interactive`,
 * and two non-interactive timeouts — nothing about presentation). A cramped
 * window is a poor place to meet an SSO challenge.
 *
 * The cost of a real tab is that the flow now outlives the service worker: MV3
 * tears workers down after roughly 30 seconds idle, and signing in takes longer
 * than that. `launchWebAuthFlow` held the worker open for us; a tab does not.
 * So the in-flight flow is persisted, and the listener that completes it is
 * registered at the top level of the worker — meaning it is re-registered every
 * time the worker wakes, and a teardown mid-login is survivable.
 */

/** Everything needed to finish a flow that started before the worker died. */
export interface PendingAuth {
  adapterId: string;
  /** PKCE verifier. Never leaves the extension until the token exchange. */
  verifier: string;
  /** CSRF value to match against the redirect. */
  state: string;
  redirectUri: string;
  tabId: number;
  startedAt: number;
}

const KEY_PENDING = 'pendingAuth';

/** Abandon a flow nobody finished, rather than leaving it to match later. */
const PENDING_TTL_MS = 15 * 60_000;

/**
 * Open the authorization URL in a normal tab and record what will be needed to
 * complete it.
 */
export async function startAuthTab(authUrl: string, pending: Omit<PendingAuth, 'tabId' | 'startedAt'>): Promise<void> {
  const tab = await chrome.tabs.create({ url: authUrl, active: true });
  if (tab.id === undefined) {
    throw new Error('Could not open a tab for sign-in.');
  }

  const record: PendingAuth = { ...pending, tabId: tab.id, startedAt: Date.now() };
  await chrome.storage.local.set({ [KEY_PENDING]: record });
}

export async function getPendingAuth(): Promise<PendingAuth | null> {
  const stored = await chrome.storage.local.get(KEY_PENDING);
  const pending = stored[KEY_PENDING] as PendingAuth | undefined;
  if (!pending) return null;

  if (Date.now() - pending.startedAt > PENDING_TTL_MS) {
    await clearPendingAuth();
    return null;
  }
  return pending;
}

export async function clearPendingAuth(): Promise<void> {
  await chrome.storage.local.remove(KEY_PENDING);
}

/**
 * Does this navigation belong to the flow we're waiting on?
 *
 * Matching on tab id as well as URL prefix means a redirect arriving in some
 * other tab — a stale flow, or a second window — can't hijack this one.
 */
export function matchesPending(pending: PendingAuth, tabId: number, url: string): boolean {
  return tabId === pending.tabId && url.startsWith(pending.redirectUri);
}

/**
 * Close the sign-in tab. Best-effort: the user may have closed it already, and
 * failing to close a tab must never fail the sign-in.
 */
export async function closeAuthTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    /* already gone */
  }
}

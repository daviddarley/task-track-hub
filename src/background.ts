/**
 * Background service worker — the only place in the extension that talks to an
 * external API.
 *
 * It owns the polling schedule, asks each registered adapter for its tasks,
 * merges them into one normalized snapshot in `chrome.storage.local`, and keeps
 * the toolbar badge current. It has no idea what ClickUp or NetSuite are; it
 * only knows about `TaskAdapter`.
 */

import { getAdapter } from './adapters/index.js';
import { finishNetSuiteAuth } from './adapters/netsuite.js';
import { updateBadge } from './core/badge.js';
import type { Message, MessageResponses, Result } from './core/messages.js';
import { getSettings, getSnapshot } from './core/storage.js';
import { syncAll } from './core/sync.js';
import type { Snapshot } from './core/types.js';
import { clearPendingAuth, closeAuthTab, getPendingAuth, matchesPending } from './core/webauth.js';

const ALARM_NAME = 'task-hub-refresh';

type AnyResponse = MessageResponses[Message['type']];

chrome.runtime.onInstalled.addListener(() => {
  void bootstrap('installed');
});

chrome.runtime.onStartup.addListener(() => {
  void bootstrap('startup');
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  void refresh('alarm');
});

/**
 * Registered at the top level on purpose. An OAuth sign-in can take minutes,
 * far longer than a service worker survives idle — so this listener must be
 * re-established every time the worker wakes, not only while a flow is running.
 * The flow's state lives in storage, which is what makes that possible.
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // `changeInfo.url` is only populated for URLs we hold host permission for,
  // which is the redirect host alone — NetSuite's own login pages stay opaque
  // to us, as they should.
  if (!changeInfo.url) return;
  void handleAuthRedirect(tabId, changeInfo.url);
});

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (response: Result<AnyResponse>) => void) => {
    handleMessage(message)
      .then((value) => sendResponse({ ok: true, value }))
      .catch((err: unknown) => sendResponse({ ok: false, error: describe(err) }));

    // Keep the message channel open for the async reply above.
    return true;
  },
);

/**
 * `message` arrives as `unknown` because anything on the machine that can reach
 * this extension can post to it. Narrow before trusting it.
 */
async function handleMessage(message: unknown): Promise<AnyResponse> {
  const parsed = parseMessage(message);

  switch (parsed.type) {
    case 'refresh':
      return refresh('manual');

    case 'reschedule': {
      await ensureAlarm({ reset: true });
      const { refreshMinutes } = await getSettings();
      return { refreshMinutes };
    }

    case 'connect': {
      const adapter = getAdapter(parsed.adapterId);
      if (!adapter) throw new Error(`Unknown adapter: ${parsed.adapterId}`);
      // Validating credentials means hitting the network, which only the worker
      // is allowed to do — hence the round trip from the options page.
      await adapter.authenticate();
      return refresh('connect');
    }
  }
}

function parseMessage(message: unknown): Message {
  if (typeof message !== 'object' || message === null) {
    throw new Error('Malformed message.');
  }

  const { type, adapterId } = message as { type?: unknown; adapterId?: unknown };

  if (type === 'refresh' || type === 'reschedule') return { type };
  if (type === 'connect' && typeof adapterId === 'string') return { type, adapterId };

  throw new Error(`Unknown message: ${JSON.stringify(message)}`);
}

/**
 * Complete an OAuth flow whose sign-in tab has just reached the redirect URI.
 *
 * Failures are recorded in storage rather than thrown: by the time this runs,
 * the options page's original request has long since returned, so there is
 * nobody left to reject to.
 */
async function handleAuthRedirect(tabId: number, url: string): Promise<void> {
  const pending = await getPendingAuth();
  if (!pending || !matchesPending(pending, tabId, url)) return;

  // Clear first: the redirect carries a single-use code, and a retry would
  // fail confusingly rather than succeed.
  await clearPendingAuth();
  await closeAuthTab(tabId);

  try {
    if (pending.adapterId !== 'netsuite') {
      throw new Error(`No auth handler for adapter: ${pending.adapterId}`);
    }
    await finishNetSuiteAuth(pending, url);
    await chrome.storage.local.set({ authResult: { adapterId: pending.adapterId, ok: true, at: Date.now() } });
    await refresh('connect');
  } catch (err) {
    console.warn('[task-hub] auth completion failed:', err);
    await chrome.storage.local.set({
      authResult: { adapterId: pending.adapterId, ok: false, error: describe(err), at: Date.now() },
    });
  }
}

async function bootstrap(reason: string): Promise<void> {
  await ensureAlarm({ reset: true });
  await refresh(reason);
}

async function refresh(reason: string): Promise<Snapshot> {
  const snapshot = await syncAll({ reason });
  await updateBadge(snapshot);
  return snapshot;
}

/**
 * `chrome.alarms` survives the service worker being torn down, which is the
 * whole reason polling lives here rather than in a `setInterval`.
 */
async function ensureAlarm(options: { reset?: boolean } = {}): Promise<void> {
  const settings = await getSettings();
  const existing = await chrome.alarms.get(ALARM_NAME);

  if (existing && !options.reset && existing.periodInMinutes === settings.refreshMinutes) return;

  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: settings.refreshMinutes,
    periodInMinutes: settings.refreshMinutes,
  });
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// A worker that was torn down and revived still needs the badge to be right,
// even if the next poll is minutes away.
void (async () => {
  await ensureAlarm();
  await updateBadge(await getSnapshot());
})();

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
import { updateBadge } from './core/badge.js';
import { getSettings, getSnapshot } from './core/storage.js';
import { syncAll } from './core/sync.js';

const ALARM_NAME = 'task-hub-refresh';

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((value) => sendResponse({ ok: true, value }))
    .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  // Keep the message channel open for the async reply above.
  return true;
});

/**
 * @param {import('./core/messages.js').Message} message
 * @returns {Promise<any>}
 */
async function handleMessage(message) {
  switch (message?.type) {
    case 'refresh':
      return refresh('manual');

    case 'reschedule':
      await ensureAlarm({ reset: true });
      return { ok: true };

    case 'connect': {
      const adapter = getAdapter(message.adapterId);
      if (!adapter) throw new Error(`Unknown adapter: ${message.adapterId}`);
      // Validating credentials means hitting the network, which only the worker
      // is allowed to do — hence the round trip from the options page.
      await adapter.authenticate();
      return refresh('connect');
    }

    default:
      throw new Error(`Unknown message: ${JSON.stringify(message)}`);
  }
}

/**
 * @param {string} reason
 * @returns {Promise<void>}
 */
async function bootstrap(reason) {
  await ensureAlarm({ reset: true });
  await refresh(reason);
}

/**
 * @param {string} reason
 * @returns {Promise<import('./core/types.js').Snapshot>}
 */
async function refresh(reason) {
  const snapshot = await syncAll({ reason });
  await updateBadge(snapshot);
  return snapshot;
}

/**
 * `chrome.alarms` survives the service worker being torn down, which is the
 * whole reason polling lives here rather than in a `setInterval`.
 *
 * @param {{ reset?: boolean }} [options]
 * @returns {Promise<void>}
 */
async function ensureAlarm(options = {}) {
  const settings = await getSettings();
  const existing = await chrome.alarms.get(ALARM_NAME);

  if (existing && !options.reset && existing.periodInMinutes === settings.refreshMinutes) return;

  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: settings.refreshMinutes,
    periodInMinutes: settings.refreshMinutes,
  });
}

// A worker that was torn down and revived still needs the badge to be right,
// even if the next poll is minutes away.
void (async () => {
  await ensureAlarm();
  await updateBadge(await getSnapshot());
})();

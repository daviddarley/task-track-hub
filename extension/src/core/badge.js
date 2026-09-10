/** @typedef {import('./types.js').Snapshot} Snapshot */

const COLOR_NORMAL = '#4f46e5';
const COLOR_ERROR = '#b91c1c';
const COLOR_CLEAR = '#16a34a';

/**
 * The toolbar badge is the only thing most people look at most of the day, so
 * it carries two signals: the open count, and whether what it's counting is
 * trustworthy. A source that failed with nothing cached shows `!` instead of a
 * count that would silently under-report.
 *
 * @param {Snapshot} snapshot
 * @returns {Promise<void>}
 */
export async function updateBadge(snapshot) {
  const broken = snapshot.sources.some((source) => source.status === 'error');
  const usable = snapshot.sources.some((source) => source.status === 'ok' || source.stale);

  const text = broken && !usable ? '!' : snapshot.openCount > 0 ? formatCount(snapshot.openCount) : '';
  const color = broken ? COLOR_ERROR : snapshot.openCount > 0 ? COLOR_NORMAL : COLOR_CLEAR;

  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setTitle({ title: badgeTitle(snapshot, broken) });
}

/**
 * @param {number} count
 * @returns {string}
 */
function formatCount(count) {
  return count > 99 ? '99+' : String(count);
}

/**
 * @param {Snapshot} snapshot
 * @param {boolean} broken
 * @returns {string}
 */
function badgeTitle(snapshot, broken) {
  const configured = snapshot.sources.filter(
    (source) => source.status !== 'unconfigured' && source.status !== 'disabled',
  );
  if (configured.length === 0) return 'Task Track Hub — no sources connected yet';

  const parts = [`${snapshot.openCount} open item${snapshot.openCount === 1 ? '' : 's'}`];
  if (broken) parts.push('some sources failed to refresh');
  return `Task Track Hub — ${parts.join(', ')}`;
}

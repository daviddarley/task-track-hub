import type { Snapshot, SourceState } from './types.js';

const COLOR_NORMAL = '#4f46e5';
const COLOR_ERROR = '#b91c1c';
const COLOR_CLEAR = '#16a34a';

/**
 * The toolbar badge is the only thing most people look at most of the day, so
 * it carries two signals: the open count, and whether what it's counting is
 * trustworthy. A source that failed with nothing cached shows `!` instead of a
 * count that would silently under-report.
 */
export async function updateBadge(snapshot: Snapshot): Promise<void> {
  const broken = snapshot.sources.some((source) => source.status === 'error');
  const usable = snapshot.sources.some(isServingData);

  const text = broken && !usable ? '!' : snapshot.openCount > 0 ? formatCount(snapshot.openCount) : '';
  const color = broken ? COLOR_ERROR : snapshot.openCount > 0 ? COLOR_NORMAL : COLOR_CLEAR;

  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setTitle({ title: badgeTitle(snapshot, broken) });
}

/** Fresh data, or stale-but-real data from a source that has since failed. */
function isServingData(source: SourceState): boolean {
  return source.status === 'ok' || (source.status === 'error' && source.stale);
}

function formatCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

function badgeTitle(snapshot: Snapshot, broken: boolean): string {
  const connected = snapshot.sources.filter(
    (source) => source.status !== 'unconfigured' && source.status !== 'disabled',
  );
  if (connected.length === 0) return 'Task Track Hub — no sources connected yet';

  const parts = [`${snapshot.openCount} open item${snapshot.openCount === 1 ? '' : 's'}`];
  if (broken) parts.push('some sources failed to refresh');
  return `Task Track Hub — ${parts.join(', ')}`;
}

/**
 * Every read/write of extension state goes through here.
 *
 * Everything lives in `chrome.storage.local`, never `chrome.storage.sync` —
 * sync would push API tokens through Google's servers to every signed-in Chrome
 * instance, which is exposure we get nothing for.
 */

import type { Settings, Snapshot } from './types.js';

const KEY_SETTINGS = 'settings';
const KEY_CREDENTIALS = 'credentials';
const KEY_SNAPSHOT = 'snapshot';
const KEY_UI = 'ui';

export const MIN_REFRESH_MINUTES = 5;
export const MAX_REFRESH_MINUTES = 120;

export const DEFAULT_SETTINGS: Settings = {
  refreshMinutes: 10,
  sortBy: 'dueDate',
  groupBySource: true,
  showClosed: false,
  adapters: {},
};

export const EMPTY_SNAPSHOT: Snapshot = {
  tasks: [],
  sources: [],
  updatedAt: '',
  openCount: 0,
};

/**
 * Storage is `unknown` until proven otherwise: it survives extension upgrades,
 * so anything read back may predate the current schema.
 */
async function readKey<T>(key: string): Promise<Partial<T> | undefined> {
  const stored = await chrome.storage.local.get(key);
  const value: unknown = stored[key];
  if (typeof value !== 'object' || value === null) return undefined;
  return value as Partial<T>;
}

export async function getSettings(): Promise<Settings> {
  const raw = await readKey<Settings>(KEY_SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    refreshMinutes: clampRefresh(raw?.refreshMinutes ?? DEFAULT_SETTINGS.refreshMinutes),
    adapters: { ...DEFAULT_SETTINGS.adapters, ...raw?.adapters },
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = {
    ...current,
    ...patch,
    refreshMinutes: clampRefresh(patch.refreshMinutes ?? current.refreshMinutes),
    adapters: { ...current.adapters, ...patch.adapters },
  };
  await chrome.storage.local.set({ [KEY_SETTINGS]: next });
  return next;
}

function clampRefresh(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_SETTINGS.refreshMinutes;
  return Math.min(MAX_REFRESH_MINUTES, Math.max(MIN_REFRESH_MINUTES, Math.round(minutes)));
}

export async function getSnapshot(): Promise<Snapshot> {
  const raw = await readKey<Snapshot>(KEY_SNAPSHOT);
  return { ...EMPTY_SNAPSHOT, ...raw };
}

export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  await chrome.storage.local.set({ [KEY_SNAPSHOT]: snapshot });
}

export interface UiState {
  collapsed: string[];
}

/**
 * Purely cosmetic popup state (which source sections are collapsed). Kept out
 * of `settings` so it never rides along with anything the worker cares about.
 */
export async function getUiState(): Promise<UiState> {
  const raw = await readKey<UiState>(KEY_UI);
  return { collapsed: raw?.collapsed ?? [] };
}

export async function saveUiState(collapsed: string[]): Promise<void> {
  await chrome.storage.local.set({ [KEY_UI]: { collapsed } satisfies UiState });
}

/**
 * A credential bag scoped to one adapter. Adapters get one of these instead of
 * reaching into storage directly, so no adapter can read another's secrets by
 * accident and the storage layout stays a detail of this file.
 *
 * Values are `Partial<T>` because a credential set is built up over time — a
 * token exists before the user id it resolves to does.
 */
export interface CredentialStore<T> {
  get(): Promise<Partial<T>>;
  patch(values: Partial<T>): Promise<Partial<T>>;
  clear(): Promise<void>;
}

export function createCredentialStore<T extends object>(adapterId: string): CredentialStore<T> {
  const readAll = async (): Promise<Record<string, Partial<T>>> => {
    const all = await readKey<Record<string, Partial<T>>>(KEY_CREDENTIALS);
    return (all as Record<string, Partial<T>>) ?? {};
  };

  return {
    async get() {
      const all = await readAll();
      return all[adapterId] ?? {};
    },

    async patch(values) {
      const all = await readAll();
      const next: Partial<T> = { ...all[adapterId], ...values };
      all[adapterId] = next;
      await chrome.storage.local.set({ [KEY_CREDENTIALS]: all });
      return next;
    },

    async clear() {
      const all = await readAll();
      delete all[adapterId];
      await chrome.storage.local.set({ [KEY_CREDENTIALS]: all });
    },
  };
}

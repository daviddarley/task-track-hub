/**
 * Every read/write of extension state goes through here.
 *
 * Everything lives in `chrome.storage.local`, never `chrome.storage.sync` —
 * sync would push API tokens through Google's servers to every signed-in Chrome
 * instance, which is exposure we get nothing for.
 */

/** @typedef {import('./types.js').Settings} Settings */
/** @typedef {import('./types.js').Snapshot} Snapshot */

const KEY_SETTINGS = 'settings';
const KEY_CREDENTIALS = 'credentials';
const KEY_SNAPSHOT = 'snapshot';
const KEY_UI = 'ui';

export const MIN_REFRESH_MINUTES = 5;
export const MAX_REFRESH_MINUTES = 120;

/** @type {Settings} */
export const DEFAULT_SETTINGS = {
  refreshMinutes: 10,
  sortBy: 'dueDate',
  groupBySource: true,
  showClosed: false,
  adapters: {},
};

/** @type {Snapshot} */
export const EMPTY_SNAPSHOT = {
  tasks: [],
  sources: [],
  updatedAt: '',
  openCount: 0,
};

/**
 * @returns {Promise<Settings>}
 */
export async function getSettings() {
  const stored = await chrome.storage.local.get(KEY_SETTINGS);
  const raw = /** @type {Partial<Settings> | undefined} */ (stored[KEY_SETTINGS]);
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    refreshMinutes: clampRefresh(raw?.refreshMinutes ?? DEFAULT_SETTINGS.refreshMinutes),
    adapters: { ...DEFAULT_SETTINGS.adapters, ...raw?.adapters },
  };
}

/**
 * @param {Partial<Settings>} patch
 * @returns {Promise<Settings>}
 */
export async function saveSettings(patch) {
  const current = await getSettings();
  /** @type {Settings} */
  const next = {
    ...current,
    ...patch,
    refreshMinutes: clampRefresh(patch.refreshMinutes ?? current.refreshMinutes),
    adapters: { ...current.adapters, ...patch.adapters },
  };
  await chrome.storage.local.set({ [KEY_SETTINGS]: next });
  return next;
}

/**
 * @param {number} minutes
 * @returns {number}
 */
function clampRefresh(minutes) {
  if (!Number.isFinite(minutes)) return DEFAULT_SETTINGS.refreshMinutes;
  return Math.min(MAX_REFRESH_MINUTES, Math.max(MIN_REFRESH_MINUTES, Math.round(minutes)));
}

/**
 * @returns {Promise<Snapshot>}
 */
export async function getSnapshot() {
  const stored = await chrome.storage.local.get(KEY_SNAPSHOT);
  const raw = /** @type {Partial<Snapshot> | undefined} */ (stored[KEY_SNAPSHOT]);
  return { ...EMPTY_SNAPSHOT, ...raw };
}

/**
 * @param {Snapshot} snapshot
 * @returns {Promise<void>}
 */
export async function saveSnapshot(snapshot) {
  await chrome.storage.local.set({ [KEY_SNAPSHOT]: snapshot });
}

/**
 * Purely cosmetic popup state (which source sections are collapsed). Kept out
 * of `settings` so it never rides along with anything the worker cares about.
 *
 * @returns {Promise<{ collapsed: string[] }>}
 */
export async function getUiState() {
  const stored = await chrome.storage.local.get(KEY_UI);
  const raw = /** @type {{ collapsed?: string[] } | undefined} */ (stored[KEY_UI]);
  return { collapsed: raw?.collapsed ?? [] };
}

/**
 * @param {string[]} collapsed
 * @returns {Promise<void>}
 */
export async function saveUiState(collapsed) {
  await chrome.storage.local.set({ [KEY_UI]: { collapsed } });
}

/**
 * @template T
 * @typedef {object} CredentialStore
 * @property {() => Promise<Partial<T>>} get
 * @property {(values: Partial<T>) => Promise<Partial<T>>} patch
 * @property {() => Promise<void>} clear
 */

/**
 * A credential bag scoped to one adapter. Adapters get one of these instead of
 * reaching into storage directly, so no adapter can read another's secrets by
 * accident and the storage layout stays a detail of this file.
 *
 * @template {Record<string, any>} T
 * @param {string} adapterId
 * @returns {CredentialStore<T>}
 */
export function createCredentialStore(adapterId) {
  return {
    async get() {
      const stored = await chrome.storage.local.get(KEY_CREDENTIALS);
      const all = /** @type {Record<string, Partial<T>> | undefined} */ (stored[KEY_CREDENTIALS]);
      return all?.[adapterId] ?? {};
    },
    async patch(values) {
      const stored = await chrome.storage.local.get(KEY_CREDENTIALS);
      const all = /** @type {Record<string, Partial<T>>} */ (stored[KEY_CREDENTIALS] ?? {});
      const next = { ...(all[adapterId] ?? {}), ...values };
      all[adapterId] = next;
      await chrome.storage.local.set({ [KEY_CREDENTIALS]: all });
      return next;
    },
    async clear() {
      const stored = await chrome.storage.local.get(KEY_CREDENTIALS);
      const all = /** @type {Record<string, unknown>} */ (stored[KEY_CREDENTIALS] ?? {});
      delete all[adapterId];
      await chrome.storage.local.set({ [KEY_CREDENTIALS]: all });
    },
  };
}

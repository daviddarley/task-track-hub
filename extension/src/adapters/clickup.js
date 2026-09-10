import { AdapterError } from '../core/errors.js';
import { requestJson } from '../core/http.js';
import { createCredentialStore, getSettings } from '../core/storage.js';
import { SOURCE, normalizeTask } from './clickup-map.js';

/** @typedef {import('../core/types.js').NormalizedTask} NormalizedTask */

/**
 * @typedef {object} ClickUpCredentials
 * @property {string} token      Personal API token (`pk_…`), never expires.
 * @property {string} userId     Resolved once during `authenticate()`.
 * @property {string} userName
 * @property {{ id: string, name: string }[]} teams  Every workspace the token can see.
 * @property {string[]} teamIds  Workspaces the user actually wants polled.
 */

const API = 'https://api.clickup.com/api/v2';
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

/** @type {import('../core/storage.js').CredentialStore<ClickUpCredentials>} */
const credentials = createCredentialStore(SOURCE);

export const clickUpCredentials = credentials;

/**
 * ClickUp uses a personal API token rather than OAuth: for a single-user tool
 * there is no redirect flow to run and no client secret to protect, so
 * `authenticate()` is really "validate the pasted token and cache the ids we
 * would otherwise look up on every poll".
 *
 * @type {import('../core/types.js').TaskAdapter}
 */
export const clickUpAdapter = {
  id: SOURCE,
  displayName: 'ClickUp',

  async isConfigured() {
    const creds = await credentials.get();
    return Boolean(creds.token && creds.userId);
  },

  async authenticate() {
    const { token } = await credentials.get();
    if (!token) {
      throw new AdapterError('not_configured', 'No ClickUp token saved.', { source: SOURCE });
    }

    const [userResponse, teamResponse] = await Promise.all([
      requestJson(`${API}/user`, { headers: authHeaders(token), source: SOURCE }),
      requestJson(`${API}/team`, { headers: authHeaders(token), source: SOURCE }),
    ]);

    const user = userResponse?.user;
    if (!user?.id) {
      throw new AdapterError('auth', 'ClickUp did not return a user for this token.', { source: SOURCE });
    }

    /** @type {{ id: string, name: string }[]} */
    const teams = Array.isArray(teamResponse?.teams)
      ? teamResponse.teams.map((/** @type {any} */ team) => ({ id: String(team.id), name: String(team.name) }))
      : [];
    if (teams.length === 0) {
      throw new AdapterError('auth', 'This ClickUp token has no accessible workspaces.', { source: SOURCE });
    }

    const existing = await credentials.get();
    // Keep an existing workspace selection, minus any the token can no longer see.
    const keptSelection = (existing.teamIds ?? []).filter((id) => teams.some((t) => t.id === id));

    await credentials.patch({
      userId: String(user.id),
      userName: String(user.username ?? user.email ?? 'ClickUp user'),
      teams,
      teamIds: keptSelection.length > 0 ? keptSelection : teams.map((t) => t.id),
    });
  },

  async fetchTasks() {
    const creds = await credentials.get();
    if (!creds.token || !creds.userId) {
      throw new AdapterError('not_configured', 'ClickUp is not connected.', { source: SOURCE });
    }

    const settings = await getSettings();
    const teamIds = creds.teamIds?.length ? creds.teamIds : (creds.teams ?? []).map((t) => t.id);
    if (teamIds.length === 0) {
      throw new AdapterError('not_configured', 'No ClickUp workspace selected.', { source: SOURCE });
    }

    /** @type {NormalizedTask[]} */
    const tasks = [];
    // Query at the workspace level rather than per-list: ClickUp nests
    // Workspace → Space → Folder → List → Task, and anything assigned to you in
    // a space you forgot to add would silently go missing otherwise.
    for (const teamId of teamIds) {
      const raw = await fetchTeamTasks(creds.token, teamId, creds.userId, settings.showClosed);
      for (const task of raw) tasks.push(normalizeTask(task));
    }

    // The same task can surface twice if workspaces overlap; last write wins.
    return [...new Map(tasks.map((task) => [task.id, task])).values()];
  },
};

/**
 * @param {string} token
 * @returns {Record<string, string>}
 */
function authHeaders(token) {
  // Personal tokens go in `Authorization` raw — no `Bearer` prefix.
  return { Authorization: token };
}

/**
 * @param {string} token
 * @param {string} teamId
 * @param {string} userId
 * @param {boolean} includeClosed
 * @returns {Promise<any[]>}
 */
async function fetchTeamTasks(token, teamId, userId, includeClosed) {
  /** @type {any[]} */
  const collected = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      page: String(page),
      subtasks: 'true',
      include_closed: String(includeClosed),
      order_by: 'due_date',
    });
    params.append('assignees[]', userId);

    const body = await requestJson(`${API}/team/${encodeURIComponent(teamId)}/task?${params}`, {
      headers: authHeaders(token),
      source: SOURCE,
    });

    const batch = Array.isArray(body?.tasks) ? body.tasks : [];
    collected.push(...batch);

    // `last_page` is authoritative where ClickUp sends it; a short page is the
    // fallback signal for accounts where it comes back undefined.
    if (body?.last_page === true || batch.length < PAGE_SIZE) break;
  }

  return collected;
}


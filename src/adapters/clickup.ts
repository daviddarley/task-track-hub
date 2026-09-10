import { AdapterError } from '../core/errors.js';
import { requestJson } from '../core/http.js';
import { createCredentialStore, getSettings, type CredentialStore } from '../core/storage.js';
import type { NormalizedTask, TaskAdapter } from '../core/types.js';
import { SOURCE, normalizeTask, type ClickUpTask } from './clickup-map.js';

export interface ClickUpWorkspace {
  id: string;
  name: string;
}

export interface ClickUpCredentials {
  /** Personal API token (`pk_…`), never expires. */
  token: string;
  /** Resolved once during `authenticate()`. */
  userId: string;
  userName: string;
  /** Every workspace the token can see. */
  teams: ClickUpWorkspace[];
  /** Workspaces the user actually wants polled. */
  teamIds: string[];
}

const API = 'https://api.clickup.com/api/v2';
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

export const clickUpCredentials: CredentialStore<ClickUpCredentials> =
  createCredentialStore<ClickUpCredentials>(SOURCE);

/**
 * ClickUp uses a personal API token rather than OAuth: for a single-user tool
 * there is no redirect flow to run and no client secret to protect, so
 * `authenticate()` is really "validate the pasted token and cache the ids we
 * would otherwise look up on every poll".
 */
export const clickUpAdapter: TaskAdapter = {
  id: SOURCE,
  displayName: 'ClickUp',

  async isConfigured(): Promise<boolean> {
    const creds = await clickUpCredentials.get();
    return Boolean(creds.token && creds.userId);
  },

  async authenticate(): Promise<void> {
    const { token } = await clickUpCredentials.get();
    if (!token) {
      throw new AdapterError('not_configured', 'No ClickUp token saved.', { source: SOURCE });
    }

    const [userResponse, teamResponse] = await Promise.all([
      requestJson(`${API}/user`, { headers: authHeaders(token), source: SOURCE }),
      requestJson(`${API}/team`, { headers: authHeaders(token), source: SOURCE }),
    ]);

    const user = readUser(userResponse);
    if (!user) {
      throw new AdapterError('auth', 'ClickUp did not return a user for this token.', { source: SOURCE });
    }

    const teams = readTeams(teamResponse);
    if (teams.length === 0) {
      throw new AdapterError('auth', 'This ClickUp token has no accessible workspaces.', { source: SOURCE });
    }

    const existing = await clickUpCredentials.get();
    // Keep an existing workspace selection, minus any the token can no longer see.
    const kept = (existing.teamIds ?? []).filter((id) => teams.some((team) => team.id === id));

    await clickUpCredentials.patch({
      userId: user.id,
      userName: user.name,
      teams,
      teamIds: kept.length > 0 ? kept : teams.map((team) => team.id),
    });
  },

  async fetchTasks(): Promise<NormalizedTask[]> {
    const creds = await clickUpCredentials.get();
    const { token, userId } = creds;
    if (!token || !userId) {
      throw new AdapterError('not_configured', 'ClickUp is not connected.', { source: SOURCE });
    }

    const settings = await getSettings();
    const teamIds = creds.teamIds?.length ? creds.teamIds : (creds.teams ?? []).map((team) => team.id);
    if (teamIds.length === 0) {
      throw new AdapterError('not_configured', 'No ClickUp workspace selected.', { source: SOURCE });
    }

    const tasks: NormalizedTask[] = [];
    // Query at the workspace level rather than per-list: ClickUp nests
    // Workspace → Space → Folder → List → Task, and anything assigned to you in
    // a space you forgot to add would silently go missing otherwise.
    for (const teamId of teamIds) {
      const raw = await fetchTeamTasks(token, teamId, userId, settings.showClosed);
      for (const task of raw) tasks.push(normalizeTask(task));
    }

    // The same task can surface twice if workspaces overlap; last write wins.
    return [...new Map(tasks.map((task) => [task.id, task])).values()];
  },
};

function authHeaders(token: string): Record<string, string> {
  // Personal tokens go in `Authorization` raw — no `Bearer` prefix.
  return { Authorization: token };
}

async function fetchTeamTasks(
  token: string,
  teamId: string,
  userId: string,
  includeClosed: boolean,
): Promise<ClickUpTask[]> {
  const collected: ClickUpTask[] = [];

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

    const { tasks, lastPage } = readTaskPage(body);
    collected.push(...tasks);

    // `last_page` is authoritative where ClickUp sends it; a short page is the
    // fallback signal for accounts where it comes back undefined.
    if (lastPage === true || tasks.length < PAGE_SIZE) break;
  }

  return collected;
}

/* Response readers ---------------------------------------------------------
 *
 * `requestJson` returns `unknown`. These narrow it at the one boundary where
 * the shape is actually in question, so the rest of the adapter is typed.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function readUser(response: unknown): { id: string; name: string } | null {
  const user = asRecord(asRecord(response)?.['user']);
  const id = user?.['id'];
  if (id === undefined || id === null || id === '') return null;

  const name = user?.['username'] ?? user?.['email'];
  return { id: String(id), name: typeof name === 'string' && name ? name : 'ClickUp user' };
}

function readTeams(response: unknown): ClickUpWorkspace[] {
  const teams = asRecord(response)?.['teams'];
  if (!Array.isArray(teams)) return [];

  return teams.flatMap((entry: unknown) => {
    const team = asRecord(entry);
    if (!team || team['id'] === undefined || team['id'] === null) return [];
    return [{ id: String(team['id']), name: String(team['name'] ?? 'Workspace') }];
  });
}

function readTaskPage(response: unknown): { tasks: ClickUpTask[]; lastPage: boolean | undefined } {
  const body = asRecord(response);
  const tasks = body?.['tasks'];
  const lastPage = body?.['last_page'];

  return {
    tasks: Array.isArray(tasks) ? (tasks as ClickUpTask[]) : [],
    lastPage: typeof lastPage === 'boolean' ? lastPage : undefined,
  };
}

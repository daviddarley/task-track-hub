import { AdapterError } from '../core/errors.js';
import { requestJson } from '../core/http.js';
import { createCredentialStore, getSettings, type CredentialStore } from '../core/storage.js';
import type { NormalizedTask, TaskAdapter } from '../core/types.js';
import { SOURCE, normalizeSearchResults } from './github-map.js';

export interface GitHubCredentials {
  /** Personal access token. Each person generates their own. */
  token: string;
  /** Resolved once at connect time, so queries don't depend on `@me`. */
  login: string;
  /** Also pull PRs where this user's review has been requested. */
  includeReviewRequests: boolean;
}

const API = 'https://api.github.com';

/** Search caps at 100 per page; 13 PRs is typical, 100 is generous headroom. */
const PER_PAGE = 100;
const MAX_PAGES = 5;

export const gitHubCredentials: CredentialStore<GitHubCredentials> =
  createCredentialStore<GitHubCredentials>(SOURCE);

/**
 * Open pull requests assigned to you.
 *
 * Uses a personal access token rather than OAuth: each teammate generates their
 * own, scoped to their own repo access, with no shared secret anywhere. Same
 * shape as ClickUp, and the reason GitHub is the easiest of the four sources to
 * roll out to a team.
 */
export const gitHubAdapter: TaskAdapter = {
  id: SOURCE,
  displayName: 'GitHub',

  async isConfigured(): Promise<boolean> {
    const creds = await gitHubCredentials.get();
    return Boolean(creds.token && creds.login);
  },

  async authenticate(): Promise<void> {
    const { token } = await gitHubCredentials.get();
    if (!token) {
      throw new AdapterError('not_configured', 'No GitHub token saved.', { source: SOURCE });
    }

    const user = asRecord(await request('/user', token));
    const login = user?.['login'];
    if (typeof login !== 'string' || !login) {
      throw new AdapterError('auth', 'GitHub did not return a user for this token.', { source: SOURCE });
    }

    await gitHubCredentials.patch({ login });
  },

  async fetchTasks(): Promise<NormalizedTask[]> {
    const creds = await gitHubCredentials.get();
    const { token, login } = creds;

    if (!token || !login) {
      throw new AdapterError('not_configured', 'GitHub is not connected.', { source: SOURCE });
    }

    const settings = await getSettings();
    const tasks: NormalizedTask[] = [];

    // Resolved login rather than `@me`: it is equivalent when authenticated,
    // but an explicit login keeps the query readable in logs and independent of
    // who the token belongs to.
    for (const qualifier of qualifiersFor(creds)) {
      tasks.push(...(await search(token, `${qualifier}:${login}`, settings.showClosed)));
    }

    // A PR can be both assigned to you and awaiting your review.
    return [...new Map(tasks.map((task) => [task.id, task])).values()];
  },
};

function qualifiersFor(creds: Partial<GitHubCredentials>): string[] {
  return creds.includeReviewRequests ? ['assignee', 'review-requested'] : ['assignee'];
}

async function search(token: string, filter: string, includeClosed: boolean): Promise<NormalizedTask[]> {
  const state = includeClosed ? '' : ' is:open';
  const tasks: NormalizedTask[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      q: `is:pr${state} ${filter}`,
      per_page: String(PER_PAGE),
      page: String(page),
      sort: 'updated',
      order: 'desc',
    });

    const body = await request(`/search/issues?${params}`, token);
    const batch = normalizeSearchResults(body);
    tasks.push(...batch);

    if (batch.length < PER_PAGE) break;
  }

  return tasks;
}

async function request(path: string, token: string): Promise<unknown> {
  return requestJson(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      // Pinned so a future default version change can't alter response shapes
      // underneath the mapping.
      'X-GitHub-Api-Version': '2022-11-28',
    },
    source: SOURCE,
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

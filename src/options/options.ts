/**
 * Options page. It writes credentials to storage, then asks the background
 * worker to validate them — the network call has to happen in the worker, which
 * is the only context Manifest V3 grants cross-origin access to.
 */

import { clickUpCredentials, type ClickUpCredentials } from '../adapters/clickup.js';
import { sendMessage } from '../core/messages.js';
import { getSettings, saveSettings } from '../core/storage.js';
import type { SortBy } from '../core/types.js';
import { el, requireElement } from '../ui/dom.js';

const els = {
  enabled: requireElement('clickup-enabled', 'input'),
  token: requireElement('clickup-token', 'input'),
  teamsField: requireElement('clickup-teams-field'),
  teams: requireElement('clickup-teams'),
  connect: requireElement('clickup-connect', 'button'),
  disconnect: requireElement('clickup-disconnect', 'button'),
  clickupStatus: requireElement('clickup-status'),
  refreshMinutes: requireElement('refresh-minutes', 'select'),
  sortBy: requireElement('sort-by', 'select'),
  groupBySource: requireElement('group-by-source', 'input'),
  showClosed: requireElement('show-closed', 'input'),
  settingsStatus: requireElement('settings-status'),
};

type Tone = 'ok' | 'error';

void load();

async function load(): Promise<void> {
  const [settings, creds] = await Promise.all([getSettings(), clickUpCredentials.get()]);

  els.refreshMinutes.value = String(settings.refreshMinutes);
  els.sortBy.value = settings.sortBy;
  els.groupBySource.checked = settings.groupBySource;
  els.showClosed.checked = settings.showClosed;
  els.enabled.checked = settings.adapters['clickup']?.enabled !== false;
  els.token.value = creds.token ?? '';

  renderConnection(creds);
  wireEvents();
}

function wireEvents(): void {
  els.connect.addEventListener('click', () => void connect());
  els.disconnect.addEventListener('click', () => void disconnect());

  els.enabled.addEventListener('change', () => {
    void (async () => {
      await saveSettings({ adapters: { clickup: { enabled: els.enabled.checked } } });
      await refreshAndReport();
    })();
  });

  els.refreshMinutes.addEventListener('change', () => {
    void (async () => {
      await saveSettings({ refreshMinutes: Number(els.refreshMinutes.value) });
      // The alarm period is baked in at creation time, so it has to be rebuilt.
      const { refreshMinutes } = await sendMessage({ type: 'reschedule' });
      report(els.settingsStatus, `Saved — refreshing every ${refreshMinutes} minutes.`, 'ok');
    })();
  });

  els.sortBy.addEventListener('change', () => {
    void (async () => {
      await saveSettings({ sortBy: parseSortBy(els.sortBy.value) });
      report(els.settingsStatus, 'Saved.', 'ok');
    })();
  });

  els.groupBySource.addEventListener('change', () => {
    void (async () => {
      await saveSettings({ groupBySource: els.groupBySource.checked });
      report(els.settingsStatus, 'Saved.', 'ok');
    })();
  });

  els.showClosed.addEventListener('change', () => {
    void (async () => {
      // This one changes what we ask ClickUp for, not just how we display it.
      await saveSettings({ showClosed: els.showClosed.checked });
      await refreshAndReport();
    })();
  });
}

/** The <select> is ours, but its value is still a string until proven otherwise. */
function parseSortBy(value: string): SortBy {
  return value === 'priority' || value === 'title' ? value : 'dueDate';
}

async function connect(): Promise<void> {
  const token = els.token.value.trim();

  if (!token) {
    report(els.clickupStatus, 'Paste a personal API token first.', 'error');
    return;
  }
  if (!token.startsWith('pk_')) {
    report(els.clickupStatus, 'That does not look like a ClickUp personal token (they start with pk_).', 'error');
    return;
  }

  setBusy(true);
  report(els.clickupStatus, 'Checking token…');

  try {
    await clickUpCredentials.patch({ token });
    await sendMessage({ type: 'connect', adapterId: 'clickup' });

    const creds = await clickUpCredentials.get();
    renderConnection(creds);
    report(els.clickupStatus, `Connected as ${creds.userName ?? 'ClickUp user'}.`, 'ok');
  } catch (err) {
    report(els.clickupStatus, describe(err), 'error');
  } finally {
    setBusy(false);
  }
}

async function disconnect(): Promise<void> {
  setBusy(true);

  try {
    await clickUpCredentials.clear();
    els.token.value = '';
    renderConnection({});
    await sendMessage({ type: 'refresh' });
    report(els.clickupStatus, 'Disconnected.');
  } catch (err) {
    report(els.clickupStatus, describe(err), 'error');
  } finally {
    setBusy(false);
  }
}

function renderConnection(creds: Partial<ClickUpCredentials>): void {
  const teams = creds.teams ?? [];
  const selected = new Set(creds.teamIds ?? []);

  els.teamsField.hidden = teams.length === 0;

  els.teams.replaceChildren(
    ...teams.map((team) => {
      const checkbox = el('input');
      checkbox.type = 'checkbox';
      checkbox.value = team.id;
      // An empty selection means "all" rather than "none" — a token that just
      // gained a workspace shouldn't silently stop reporting it.
      checkbox.checked = selected.size === 0 || selected.has(team.id);
      checkbox.addEventListener('change', () => void saveTeamSelection());

      return el('label', {}, checkbox, el('span', { text: team.name }));
    }),
  );

  els.disconnect.hidden = !creds.token;
  els.connect.textContent = creds.userId ? 'Re-check token' : 'Connect';

  if (creds.userId) {
    report(els.clickupStatus, `Connected as ${creds.userName ?? 'ClickUp user'}.`, 'ok');
  }
}

async function saveTeamSelection(): Promise<void> {
  const boxes = [...els.teams.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  const checked = boxes.filter((box) => box.checked).map((box) => box.value);

  if (checked.length === 0) {
    report(els.clickupStatus, 'Pick at least one workspace.', 'error');
    return;
  }

  await clickUpCredentials.patch({ teamIds: checked });
  await refreshAndReport();
}

async function refreshAndReport(): Promise<void> {
  try {
    await sendMessage({ type: 'refresh' });
    report(els.clickupStatus, 'Saved and refreshed.', 'ok');
  } catch (err) {
    report(els.clickupStatus, describe(err), 'error');
  }
}

function setBusy(busy: boolean): void {
  els.connect.disabled = busy;
  els.disconnect.disabled = busy;
}

function report(target: HTMLElement, message: string, tone?: Tone): void {
  target.textContent = message;
  if (tone) target.dataset['tone'] = tone;
  else delete target.dataset['tone'];
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

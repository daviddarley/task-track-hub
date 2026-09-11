/**
 * Options page. It writes credentials to storage, then asks the background
 * worker to validate them — the network call has to happen in the worker, which
 * is the only context Manifest V3 grants cross-origin access to.
 */

import { clickUpCredentials, type ClickUpCredentials } from '../adapters/clickup.js';
import { adapters } from '../adapters/index.js';
import { netSuiteCredentials } from '../adapters/netsuite.js';
import { sendMessage } from '../core/messages.js';
import { getSettings, saveSettings } from '../core/storage.js';
import type { SortBy } from '../core/types.js';
import { el, requireElement } from '../ui/dom.js';

const els = {
  sources: requireElement('sources'),
  token: requireElement('clickup-token', 'input'),
  teamsField: requireElement('clickup-teams-field'),
  teams: requireElement('clickup-teams'),
  connect: requireElement('clickup-connect', 'button'),
  disconnect: requireElement('clickup-disconnect', 'button'),
  clickupStatus: requireElement('clickup-status'),
  nsAccount: requireElement('netsuite-account', 'input'),
  nsClient: requireElement('netsuite-client', 'input'),
  nsEmployee: requireElement('netsuite-employee', 'input'),
  nsRedirect: requireElement('netsuite-redirect', 'input'),
  nsConnect: requireElement('netsuite-connect', 'button'),
  nsDisconnect: requireElement('netsuite-disconnect', 'button'),
  nsStatus: requireElement('netsuite-status'),
  refreshMinutes: requireElement('refresh-minutes', 'select'),
  sortBy: requireElement('sort-by', 'select'),
  groupBySource: requireElement('group-by-source', 'input'),
  showClosed: requireElement('show-closed', 'input'),
  settingsStatus: requireElement('settings-status'),
};

type Tone = 'ok' | 'error';

void load();

async function load(): Promise<void> {
  const [settings, creds, ns] = await Promise.all([
    getSettings(),
    clickUpCredentials.get(),
    netSuiteCredentials.get(),
  ]);

  els.refreshMinutes.value = String(settings.refreshMinutes);
  els.sortBy.value = settings.sortBy;
  els.groupBySource.checked = settings.groupBySource;
  els.showClosed.checked = settings.showClosed;
  els.token.value = creds.token ?? '';

  els.nsAccount.value = ns.accountId ?? '';
  els.nsClient.value = ns.clientId ?? '';
  els.nsEmployee.value = ns.employeeId ?? '';
  // Shown read-only so it can be copied into NetSuite without transcription
  // errors — it must match the integration record byte for byte.
  els.nsRedirect.value = chrome.identity.getRedirectURL();

  renderConnection(creds);
  renderNetSuiteConnection(ns.refreshToken !== undefined);
  await renderSources();
  wireEvents();
  watchAuthResult();
}

/**
 * The source list is built from the adapter registry, not hand-written per
 * adapter: registering a new `TaskAdapter` gives it a toggle here for free.
 * Only its credential fields need bespoke UI.
 */
async function renderSources(): Promise<void> {
  const settings = await getSettings();

  const rows = await Promise.all(
    adapters.map(async (adapter) => {
      const enabled = settings.adapters[adapter.id]?.enabled !== false;
      const configured = await adapter.isConfigured();

      const checkbox = el('input');
      checkbox.type = 'checkbox';
      checkbox.checked = enabled;
      checkbox.addEventListener('change', () => void toggleSource(adapter.id, checkbox.checked));

      // Saying "not connected yet" here is what makes an empty popup
      // explicable without hunting through the cards below.
      const note = el('span', {
        class: 'checklist__note',
        text: configured ? '' : 'not connected yet',
      });

      return el('label', {}, checkbox, el('span', { text: adapter.displayName }), note);
    }),
  );

  els.sources.replaceChildren(...rows);
  for (const adapter of adapters) {
    markCard(adapter.id, settings.adapters[adapter.id]?.enabled !== false);
  }
}

async function toggleSource(adapterId: string, enabled: boolean): Promise<void> {
  await saveSettings({ adapters: { [adapterId]: { enabled } } });
  markCard(adapterId, enabled);

  try {
    await sendMessage({ type: 'refresh' });
  } catch (err) {
    report(els.settingsStatus, describe(err), 'error');
    return;
  }
  report(els.settingsStatus, enabled ? `${adapterId} enabled.` : `${adapterId} disabled.`, 'ok');
}

/** Dim a disabled source's settings card so it reads as inactive, not broken. */
function markCard(adapterId: string, enabled: boolean): void {
  const card = document.querySelector<HTMLElement>(`[data-adapter="${adapterId}"]`);
  if (card) card.dataset['disabled'] = String(!enabled);
}

function wireEvents(): void {
  els.connect.addEventListener('click', () => void connect());
  els.disconnect.addEventListener('click', () => void disconnect());

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
      // This one changes what we ask the sources for, not just how we display it.
      await saveSettings({ showClosed: els.showClosed.checked });
      await refreshAndReport();
    })();
  });

  els.nsConnect.addEventListener('click', () => void connectNetSuite());
  els.nsDisconnect.addEventListener('click', () => void disconnectNetSuite());

}

async function connectNetSuite(): Promise<void> {
  const accountId = els.nsAccount.value.trim();
  const clientId = els.nsClient.value.trim();
  const employeeId = els.nsEmployee.value.trim();

  if (!accountId || !clientId || !employeeId) {
    report(els.nsStatus, 'Account ID, Client ID and employee ID are all required.', 'error');
    return;
  }
  // Either a numeric internal id or an email address — an email is what a
  // teammate actually knows about themselves, and the adapter resolves it.
  if (!/^\d+$/.test(employeeId) && !employeeId.includes('@')) {
    report(els.nsStatus, 'Enter your work email, or your numeric NetSuite internal id.', 'error');
    return;
  }

  setNetSuiteBusy(true);
  report(els.nsStatus, 'Opening NetSuite sign-in in a new tab…');

  try {
    // Saved before the flow starts: the worker reads them to build the
    // authorize URL, and they are settings rather than secrets. Any previously
    // resolved id is dropped, since the identity being connected may differ.
    await netSuiteCredentials.patch({ accountId, clientId, employeeId, resolvedEmployeeId: '' });
    await sendMessage({ type: 'connect', adapterId: 'netsuite' });

    // `connect` returns as soon as the tab opens — sign-in can take minutes and
    // outlives the service worker, so the outcome arrives via storage instead.
    report(els.nsStatus, 'Waiting for you to finish signing in…');
  } catch (err) {
    report(els.nsStatus, describe(err), 'error');
    setNetSuiteBusy(false);
  }
}

/**
 * The worker records how the sign-in ended, because by the time it finishes
 * there is no pending request left to answer.
 */
function watchAuthResult(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes['authResult']) return;

    const result = changes['authResult'].newValue as
      | { adapterId?: string; ok?: boolean; error?: string }
      | undefined;
    if (result?.adapterId !== 'netsuite') return;

    setNetSuiteBusy(false);

    if (result.ok) {
      renderNetSuiteConnection(true);
      void renderSources();
      report(els.nsStatus, 'Connected.', 'ok');
    } else {
      report(els.nsStatus, result.error ?? 'Sign-in failed.', 'error');
    }
  });
}

async function disconnectNetSuite(): Promise<void> {
  setNetSuiteBusy(true);

  try {
    await netSuiteCredentials.clear();
    els.nsAccount.value = '';
    els.nsClient.value = '';
    els.nsEmployee.value = '';
    renderNetSuiteConnection(false);
    await renderSources();
    await sendMessage({ type: 'refresh' });
    report(els.nsStatus, 'Disconnected.');
  } catch (err) {
    report(els.nsStatus, describe(err), 'error');
  } finally {
    setNetSuiteBusy(false);
  }
}

function renderNetSuiteConnection(connected: boolean): void {
  els.nsDisconnect.hidden = !connected;
  els.nsConnect.textContent = connected ? 'Reconnect' : 'Connect';
}

function setNetSuiteBusy(busy: boolean): void {
  els.nsConnect.disabled = busy;
  els.nsDisconnect.disabled = busy;
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
    await renderSources();
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
    await renderSources();
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

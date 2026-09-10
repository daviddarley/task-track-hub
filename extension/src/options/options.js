/**
 * Options page. It writes credentials to storage, then asks the background
 * worker to validate them — the network call has to happen in the worker, which
 * is the only context Manifest V3 grants cross-origin access to.
 */

import { clickUpCredentials } from '../adapters/clickup.js';
import { sendMessage } from '../core/messages.js';
import { getSettings, saveSettings } from '../core/storage.js';

const els = {
  enabled: /** @type {HTMLInputElement} */ (document.getElementById('clickup-enabled')),
  token: /** @type {HTMLInputElement} */ (document.getElementById('clickup-token')),
  teamsField: /** @type {HTMLElement} */ (document.getElementById('clickup-teams-field')),
  teams: /** @type {HTMLElement} */ (document.getElementById('clickup-teams')),
  connect: /** @type {HTMLButtonElement} */ (document.getElementById('clickup-connect')),
  disconnect: /** @type {HTMLButtonElement} */ (document.getElementById('clickup-disconnect')),
  clickupStatus: /** @type {HTMLElement} */ (document.getElementById('clickup-status')),
  refreshMinutes: /** @type {HTMLSelectElement} */ (document.getElementById('refresh-minutes')),
  sortBy: /** @type {HTMLSelectElement} */ (document.getElementById('sort-by')),
  groupBySource: /** @type {HTMLInputElement} */ (document.getElementById('group-by-source')),
  showClosed: /** @type {HTMLInputElement} */ (document.getElementById('show-closed')),
  settingsStatus: /** @type {HTMLElement} */ (document.getElementById('settings-status')),
};

void load();

async function load() {
  const [settings, creds] = await Promise.all([getSettings(), clickUpCredentials.get()]);

  els.refreshMinutes.value = String(settings.refreshMinutes);
  els.sortBy.value = settings.sortBy;
  els.groupBySource.checked = settings.groupBySource;
  els.showClosed.checked = settings.showClosed;
  els.enabled.checked = settings.adapters.clickup?.enabled !== false;
  els.token.value = creds.token ?? '';

  renderConnection(creds);
  wireEvents();
}

function wireEvents() {
  els.connect.addEventListener('click', connect);
  els.disconnect.addEventListener('click', disconnect);

  els.enabled.addEventListener('change', async () => {
    await saveSettings({ adapters: { clickup: { enabled: els.enabled.checked } } });
    await refreshAndReport();
  });

  els.refreshMinutes.addEventListener('change', async () => {
    await saveSettings({ refreshMinutes: Number(els.refreshMinutes.value) });
    // The alarm period is baked in at creation time, so it has to be rebuilt.
    await sendMessage({ type: 'reschedule' });
    report(els.settingsStatus, 'Saved.', 'ok');
  });

  els.sortBy.addEventListener('change', async () => {
    await saveSettings({ sortBy: /** @type {any} */ (els.sortBy.value) });
    report(els.settingsStatus, 'Saved.', 'ok');
  });

  els.groupBySource.addEventListener('change', async () => {
    await saveSettings({ groupBySource: els.groupBySource.checked });
    report(els.settingsStatus, 'Saved.', 'ok');
  });

  els.showClosed.addEventListener('change', async () => {
    // This one changes what we ask ClickUp for, not just how we display it.
    await saveSettings({ showClosed: els.showClosed.checked });
    await refreshAndReport();
  });
}

async function connect() {
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
    report(els.clickupStatus, err instanceof Error ? err.message : String(err), 'error');
  } finally {
    setBusy(false);
  }
}

async function disconnect() {
  setBusy(true);
  try {
    await clickUpCredentials.clear();
    els.token.value = '';
    renderConnection({});
    await sendMessage({ type: 'refresh' });
    report(els.clickupStatus, 'Disconnected.');
  } catch (err) {
    report(els.clickupStatus, err instanceof Error ? err.message : String(err), 'error');
  } finally {
    setBusy(false);
  }
}

/**
 * @param {Partial<import('../adapters/clickup.js').ClickUpCredentials>} creds
 */
function renderConnection(creds) {
  const teams = creds.teams ?? [];
  const selected = new Set(creds.teamIds ?? []);

  els.teamsField.hidden = teams.length === 0;
  els.teams.textContent = '';

  for (const team of teams) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = team.id;
    input.checked = selected.size === 0 || selected.has(team.id);
    input.addEventListener('change', saveTeamSelection);

    const name = document.createElement('span');
    name.textContent = team.name;

    label.append(input, name);
    els.teams.append(label);
  }

  els.disconnect.hidden = !creds.token;
  els.connect.textContent = creds.userId ? 'Re-check token' : 'Connect';

  if (creds.userId) {
    report(els.clickupStatus, `Connected as ${creds.userName ?? 'ClickUp user'}.`, 'ok');
  }
}

async function saveTeamSelection() {
  const checked = [...els.teams.querySelectorAll('input[type="checkbox"]')]
    .filter((input) => /** @type {HTMLInputElement} */ (input).checked)
    .map((input) => /** @type {HTMLInputElement} */ (input).value);

  if (checked.length === 0) {
    report(els.clickupStatus, 'Pick at least one workspace.', 'error');
    return;
  }

  await clickUpCredentials.patch({ teamIds: checked });
  await refreshAndReport();
}

async function refreshAndReport() {
  try {
    await sendMessage({ type: 'refresh' });
    report(els.clickupStatus, 'Saved and refreshed.', 'ok');
  } catch (err) {
    report(els.clickupStatus, err instanceof Error ? err.message : String(err), 'error');
  }
}

/**
 * @param {boolean} busy
 */
function setBusy(busy) {
  els.connect.disabled = busy;
  els.disconnect.disabled = busy;
}

/**
 * @param {HTMLElement} target
 * @param {string} message
 * @param {'ok' | 'error' | null} [tone]
 */
function report(target, message, tone = null) {
  target.textContent = message;
  if (tone) target.dataset.tone = tone;
  else delete target.dataset.tone;
}

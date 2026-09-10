# Task Track Hub

A Chrome (Manifest V3) extension that pulls the work assigned to you out of every system you're
expected to watch and puts it in one popup, behind one badge count.

**Phase 1 is done: ClickUp works end to end.** NetSuite Support Cases are Phase 2. The adapter
seam that makes a third source cheap is already in place — see
[docs/adding-an-adapter.md](docs/adding-an-adapter.md).

Built from [task-hub-extension-plan.md](task-hub-extension-plan.md).

## Install it

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select the [extension/](extension/) folder (not the repo root).
3. Open the extension's **Options** and paste a ClickUp personal API token
   (ClickUp → **Settings → Apps** → generate; it starts with `pk_` and never expires).
4. Hit **Connect**. It resolves your user id and workspaces once and caches them, then does a
   first sync. The badge should show your open count within a second or two.

There is no build step. The extension loads its source directly — `npm install` is only needed
for the type check and tests.

## How it fits together

```
┌─────────────┐      ┌───────────────────────┐      ┌───────────────┐
│  Popup UI   │◄─────│ chrome.storage.local  │◄─────│ Background SW │
│ (read-only) │      │  (normalized tasks)   │      │  (polling)    │
└─────────────┘      └───────────────────────┘      └───────┬───────┘
                                                            │ calls
                                                   ┌────────┴────────┐
                                                   │    Adapters     │
                                                   │ ClickUpAdapter  │
                                                   │ (NetSuite next) │
                                                   └─────────────────┘
```

Three rules hold the design together:

- **Only the service worker touches the network.** Manifest V3 grants background workers a
  documented same-origin-policy exception for hosts in `host_permissions`; content scripts don't
  get it. That's why no proxy server is needed, and why the popup asks the worker to refresh
  rather than fetching anything itself.
- **Only adapters know which service a task came from.** Everything downstream — merge, sort,
  badge, popup — works on `NormalizedTask` and nothing else.
- **The popup is a pure view over storage.** It opens instantly because it never waits on a
  network call, and it never holds a credential.

## Layout

| Path | What lives there |
|---|---|
| [extension/manifest.json](extension/manifest.json) | MV3 manifest, permissions, host permissions |
| [extension/src/background.js](extension/src/background.js) | Alarm schedule, message handling, badge refresh |
| [extension/src/core/types.js](extension/src/core/types.js) | `NormalizedTask`, `TaskAdapter`, `Snapshot` — the shared vocabulary |
| [extension/src/core/sync.js](extension/src/core/sync.js) | Polls adapters concurrently, merges, contains per-source failure |
| [extension/src/core/storage.js](extension/src/core/storage.js) | The only module that touches `chrome.storage` |
| [extension/src/core/http.js](extension/src/core/http.js) | `fetch` + timeout + HTTP status → typed `AdapterError` |
| [extension/src/adapters/](extension/src/adapters/) | One file per service, plus the registry |
| [extension/src/popup/](extension/src/popup/) | The list view |
| [extension/src/options/](extension/src/options/) | Credentials, workspace picker, refresh + display settings |

## Commands

```sh
npm install       # only needed for the two commands below
npm test          # smoke tests over normalization, sorting, date formatting
npm run typecheck # tsc --noEmit over the JSDoc types
npm run icons     # regenerate extension/icons/*.png
```

The source is plain ES modules with JSDoc types rather than TypeScript, because this machine is on
Node 15 and every current bundler needs Node 18+. `npm run typecheck` still enforces the
`TaskAdapter` contract in full — a new adapter that gets the shape wrong fails the check.

## What Phase 1 actually does

- Polls ClickUp on a `chrome.alarms` schedule (5–120 min, default 10) that survives the service
  worker being torn down.
- Queries at the **workspace** level (`GET /team/{id}/task?assignees[]=…`), not per list, so work
  in a space you forgot about doesn't silently go missing. Paginates; de-duplicates across
  overlapping workspaces.
- Normalizes ClickUp's user-defined statuses into `open` / `in_progress` / `waiting` / `closed`,
  and `urgent|high|normal|low` into `high` / `medium` / `low`.
- Badge shows the open count, turns red when a source failed, and shows `!` if a failure left
  nothing trustworthy to count.
- **Failures are contained per source already** (planned for Phase 3, but it cost almost nothing
  and it's what makes Phase 2 a drop-in): a source that errors keeps serving its last good tasks,
  flagged as stale in an amber banner, instead of blanking the list.
- Manual refresh button, collapsible per-source groups, sort by due date / priority / title.

## Deviations from the plan, and why

- **Plain ESM + JSDoc instead of TypeScript.** Node 15 on this machine; no bundler will run. Type
  safety is preserved via `checkJs`.
- **`identity` permission not requested yet.** The plan's manifest skeleton lists it, but it's only
  needed for NetSuite's OAuth flow in Phase 2. Requesting it now would be a permission the
  extension can't justify — the plan's own advice on asking for the narrowest scope applies.
- **Added an optional `subtitle` field** to the normalized shape. The plan's table has no room for
  source context, but a list where every row just says "ClickUp" is worse than one showing the
  ClickUp list or (later) the NetSuite case number. It's optional, so adapters can skip it.
- **Per-source error containment landed in Phase 1** rather than Phase 3, as noted above.

## Roadmap

- [x] **Phase 1** — ClickUp, read-only: options page, polling, badge, popup.
- [ ] **Phase 2** — NetSuite Support Cases over OAuth 2.0 (`chrome.identity.launchWebAuthFlow` +
      SuiteQL). Built on OAuth rather than TBA because Oracle deprecates new TBA integrations for
      REST in 2027.1.
- [ ] **Phase 3** — Unified-list polish. Error containment is done; remaining: cross-source
      grouping options, keyboard navigation.
- [ ] **Phase 4** — Extensibility hardening: per-adapter enable toggles are in, the registry is in,
      the contract is written down.
- [ ] **Phase 5** — A third source (Jira or GitHub Issues) as the real test of the seam.

## Open questions carried forward from the plan

- How "assigned to me" should be defined for NetSuite if the account uses queue/team-based
  assignment rather than direct assignment. Blocks part of Phase 2.
- Whether recently closed items should linger (e.g. "closed today"). The `showClosed` toggle
  currently treats it as all-or-nothing.

## Security notes

- Credentials live in `chrome.storage.local`, never `chrome.storage.sync` — sync would push API
  tokens through Google's servers to every signed-in Chrome instance.
- `host_permissions` is narrowed to `https://api.clickup.com/*`; NetSuite's account-specific
  domain gets added with the adapter that needs it.
- The popup builds every row with `createElement`/`textContent`, never `innerHTML` — task titles
  come from a third-party API and aren't ours to trust.
- This is a single-user, local-credentials tool by design. Handing it to someone else would mean
  adding a real backend to broker OAuth and hold long-lived secrets.

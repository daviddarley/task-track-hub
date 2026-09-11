# Task Track Hub

A Chrome (Manifest V3) extension that pulls the work assigned to you out of every system you're
expected to watch and puts it in one popup, behind one badge count.

**Phase 1 is done: ClickUp works end to end.** NetSuite Support Cases are Phase 2. The adapter
seam that makes a third source cheap is already in place — see
[docs/adding-an-adapter.md](docs/adding-an-adapter.md).

Built from [task-hub-extension-plan.md](task-hub-extension-plan.md).

## Install it

```sh
npm install
npm run build      # compiles src/ → dist/
```

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select the generated **`dist/`** folder (not the repo root, not `src/`).
3. Open the extension's **Options** and paste a ClickUp personal API token
   (ClickUp → **Settings → Apps** → generate; it starts with `pk_` and never expires).
4. Hit **Connect**. It resolves your user id and workspaces once and caches them, then does a
   first sync. The badge should show your open count within a second or two.

While working on it, `npm run watch` rebuilds on save. Chrome still needs the reload button on
`chrome://extensions` to pick up service-worker changes.

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
| [src/manifest.json](src/manifest.json) | MV3 manifest, permissions, host permissions |
| [src/background.ts](src/background.ts) | Alarm schedule, message handling, badge refresh |
| [src/core/types.ts](src/core/types.ts) | `NormalizedTask`, `TaskAdapter`, `Snapshot` — the shared vocabulary |
| [src/core/sync.ts](src/core/sync.ts) | Polls adapters concurrently, merges, contains per-source failure |
| [src/core/storage.ts](src/core/storage.ts) | The only module that touches `chrome.storage` |
| [src/core/http.ts](src/core/http.ts) | `fetch` + timeout + HTTP status → typed `AdapterError` |
| [src/core/pkce.ts](src/core/pkce.ts) | RFC 7636 PKCE — what lets NetSuite work with no client secret |
| [src/adapters/](src/adapters/) | One file per service (transport + pure mapping), plus the registry |
| [src/popup/](src/popup/) | The list view |
| [src/options/](src/options/) | Credentials, workspace picker, refresh + display settings |
| [src/ui/dom.ts](src/ui/dom.ts) | Typed DOM helpers shared by both pages |
| `dist/` | Build output — this is what you load into Chrome. Git-ignored. |

## Commands

```sh
npm run build     # compile src/ → dist/, copy static assets
npm run watch     # same, rebuilding on save
npm test          # builds, then runs the suite against dist/
npm run typecheck # tsc --noEmit
npm run icons     # regenerate src/icons/*.png
npm run clean     # remove dist/
```

## Build setup

TypeScript, compiled by `tsc` straight to native ES modules — **no bundler**. The manifest's
`"type": "module"` service worker and the pages' `<script type="module">` load the emitted files
directly. This keeps a one-to-one mapping between source file and shipped file, which matters a lot
when you're debugging a service worker that Chrome tears down between polls: what you see in
devtools is the file you wrote, minus the types, with a source map back to the original.

[tools/build.mjs](tools/build.mjs) runs `tsc` and copies the files the compiler ignores
(manifest, HTML, CSS, icons) into `dist/`, preserving structure.

`tsconfig.json` runs at full strictness — `strict`, plus `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `verbatimModuleSyntax`, and `noUnusedLocals`/`noUnusedParameters`.
Where that's load-bearing:

- **`SourceState` is a discriminated union** on `status`. `error` and `stale` exist only on the
  failure variant, so the popup can't read an error message off a source that succeeded, and can't
  forget to handle one that failed.
- **`requestJson` returns `unknown`.** HTTP responses are untyped data until an adapter narrows
  them; the narrowing happens in one clearly marked block per adapter rather than being assumed.
- **`describeErrorKind` has no `default` case** — adding an `AdapterErrorKind` breaks the build
  until every site handles it.
- **`sendMessage` maps message type → response type**, so `{ type: 'reschedule' }` resolves to
  `{ refreshMinutes }` without a cast at the call site.

Tests are plain `.mjs` under [tests/](tests/) and import from `dist/`, so they exercise the compiled
artifact Chrome actually loads rather than the source. They run on Node's built-in test runner —
no jest, no vitest, no config.

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

- **`identity` permission not requested yet.** The plan's manifest skeleton lists it, but it's only
  needed for NetSuite's OAuth flow in Phase 2. Requesting it now would be a permission the
  extension can't justify — the plan's own advice on asking for the narrowest scope applies.
- **Added an optional `subtitle` field** to the normalized shape. The plan's table has no room for
  source context, but a list where every row just says "ClickUp" is worse than one showing the
  ClickUp list or (later) the NetSuite case number. It's optional, so adapters can skip it.
- **Per-source error containment landed in Phase 1** rather than Phase 3, as noted above.

## Roadmap

- [x] **Phase 1** — ClickUp, read-only: options page, polling, badge, popup.
- [x] **Phase 2** — NetSuite Support Cases over OAuth 2.0 + PKCE (`chrome.identity.launchWebAuthFlow`)
      and SuiteQL. Built on OAuth rather than TBA because Oracle deprecates new TBA integrations for
      REST in 2027.1. **Code complete; awaiting a Client ID to exercise end to end** — see
      [docs/netsuite-oauth-setup.md](docs/netsuite-oauth-setup.md). The SuiteQL query, the ten
      status ids, and bound-parameter support were all validated against a live account.
- [ ] **Phase 3** — Unified-list polish. Error containment is done; remaining: cross-source
      grouping options, keyboard navigation.
- [ ] **Phase 4** — Extensibility hardening: per-adapter enable toggles are in, the registry is in,
      the contract is written down.
- [x] **Phase 5** — Two more sources, as the real test of the seam:
      **Basecamp 2** to-dos ([setup](docs/basecamp-setup.md), [why its auth is awkward](docs/basecamp-assessment.md))
      and **GitHub** pull requests assigned to you. Each was three adapter files, one registry line,
      a host permission and an options card — nothing in `core/`, the popup, the badge, `sync.ts`
      or the storage schema changed, and the Sources toggle appeared on its own.

## Sources at a glance

| Source | Auth | Shared secret? | Due dates | Verified live |
|---|---|---|---|---|
| ClickUp | Personal token | No — one per person | Yes | Yes |
| NetSuite | OAuth 2.0 + PKCE, public client | No — none exists | No such field | Yes |
| GitHub | Personal access token | No — one per person | Milestones only | Query verified |
| Basecamp 2 | OAuth 2.0 + client secret | **Yes** — no PKCE available | Yes | Not yet |

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

# Task Hub — Browser Extension Plan

A Chrome extension that pulls your open work from NetSuite (Support Cases) and ClickUp into one popup, with an adapter pattern that makes adding a third or fourth source (Jira, GitHub Issues, Asana, etc.) a matter of writing one new file rather than touching the core.

## 1. What it does

Every time you click the extension icon, it shows a single list of items assigned to you — NetSuite support cases and ClickUp tasks side by side, sorted by due date or priority, with a small badge on the icon showing an open count. Each item links straight back to the record in NetSuite or the task in ClickUp. Data refreshes on a timer in the background (e.g. every 5–10 minutes) so the badge is current without you having to open the popup.

## 2. High-level architecture

The extension has four pieces, and the separation between them is what makes it extensible:

**Background service worker** — owns the polling schedule (`chrome.alarms`), calls each connected adapter, merges the results into one normalized list, writes it to `chrome.storage.local`, and updates the badge count. It never talks to any specific API directly; it only talks to adapters.

**Adapters** (one per service) — each adapter is a small module that knows how to authenticate with, query, and normalize data from exactly one service. A `NetSuiteAdapter` and a `ClickUpAdapter` both implement the same interface, described below. Adding a new source later means writing a new adapter and registering it — nothing else in the extension changes.

**Popup / side panel UI** — reads the normalized list from storage and renders it. It never calls any external API itself; it's a pure view over what the background worker already fetched. This keeps the popup fast to open (no waiting on network calls) and keeps API credentials out of the UI code entirely.

**Options page** — where you paste in credentials per service, toggle which adapters are active, and set refresh interval and grouping/sort preferences.

```
┌─────────────┐      ┌──────────────────────┐      ┌───────────────┐
│  Popup UI   │◄─────│  chrome.storage.local │◄─────│ Background SW │
│ (read-only) │      │  (normalized tasks)   │      │  (polling)    │
└─────────────┘      └──────────────────────┘      └───────┬───────┘
                                                             │ calls
                                                    ┌────────┴────────┐
                                                    │    Adapters     │
                                                    │ NetSuiteAdapter │
                                                    │ ClickUpAdapter  │
                                                    │ (…future ones)  │
                                                    └─────────────────┘
```

## 3. Why no backend server is needed

A natural instinct is to put a small server in between the extension and NetSuite/ClickUp to hold credentials and avoid CORS problems. You don't need one here. Manifest V3 background service workers are allowed to make cross-origin requests to any domain listed in the extension's `host_permissions` — that's a documented exception to the same-origin policy that applies to ordinary web pages ([Chrome for Developers: cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)). Content scripts don't get this exception, which is why all API calls should happen from the background worker, not from any script injected into a page. Practically: as long as `netsuite.com`/your account's NetSuite domain and `api.clickup.com` are declared in `host_permissions`, `fetch()` calls to them from the background worker work without a proxy.

The tradeoff is that this makes it a single-user, local-credentials tool by design — fine for your own use, but not something you'd want to hand to a client as-is without adding a real backend to broker OAuth and hide long-lived secrets.

## 4. Auth strategy per service

### ClickUp — personal API token

ClickUp supports two auth modes: a personal API token (prefixed `pk_`, generated from Settings → Apps in the ClickUp UI, never expires) or a full OAuth2 authorization-code flow meant for apps used by other people ([ClickUp API authentication docs](https://developer.clickup.com/docs/authentication)). For a personal tool this isn't a close call — use the personal token. Paste it into the Options page, store it in `chrome.storage.local`, and send it as the `Authorization` header on every request. No redirect flow, no client secret to protect.

### NetSuite — OAuth 2.0, not Token-Based Authentication

This is the one place worth doing the more complex thing up front. NetSuite's REST APIs have historically supported Token-Based Authentication (TBA) — an integration record gives you a consumer key/secret, and each user generates a token ID/secret pair via Setup → Users/Roles → Access Tokens ([Oracle: Create Integration Records for TBA](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_4249032125.html)). That still works today. But Oracle's own documentation now states that **new TBA integrations are deprecated for REST services as of the 2027.1 release, with OAuth 2.0 recommended for all new integrations** — and third-party coverage of the same change ([Houseblend: NetSuite TBA Deprecation](https://www.houseblend.io/articles/netsuite-tba-deprecation-oauth2-migration), [Adaptive Solutions Group: 2027.1 release notes](https://adaptivesuitesolutions.com/release-notes/2027-1-tba-end-of-support-oauth2-migration)) puts that release in early 2027 — i.e., not long after you'd realistically finish building this. Building on TBA now means redoing NetSuite auth within a few months; building on OAuth 2.0 now means doing the harder setup once.

Practically, that means:

- In NetSuite, go to **Setup → Integration → Manage Integrations → New**, enable OAuth 2.0 (not TBA), and set the redirect/callback URL to your extension's identity redirect URL.
- In the extension, use `chrome.identity.launchWebAuthFlow` to run the authorization-code flow and get an access + refresh token. This is the standard pattern for OAuth in Manifest V3 extensions since they can't safely embed a client secret (treat the NetSuite OAuth client as a "public" client, using PKCE if NetSuite's implementation supports it).
- Store the refresh token in `chrome.storage.local`; keep the short-lived access token in memory in the service worker and refresh it silently when it expires.
- This is meaningfully more setup than ClickUp's token — budget real time for it in Phase 2 below, and expect some trial and error since NetSuite's OAuth setup screens vary a bit by account type.

### General credential hygiene

Whichever service, don't put credentials in `chrome.storage.sync` (it syncs across your signed-in Chrome instances via Google's servers — unnecessary exposure for API tokens). `chrome.storage.local` is the right place. Request the narrowest `host_permissions` you actually need (your specific NetSuite account domain, `api.clickup.com`) rather than `<all_urls>`.

## 5. Extensibility pattern — the adapter interface

Every adapter, regardless of service, implements the same shape. In TypeScript:

```ts
interface TaskAdapter {
  id: string;                 // "netsuite", "clickup", "jira", …
  displayName: string;        // "NetSuite", "ClickUp", …
  isConfigured(): Promise<boolean>;      // has the user entered credentials?
  authenticate(): Promise<void>;         // run OAuth flow / validate token
  fetchTasks(): Promise<NormalizedTask[]>;
}
```

And every adapter's `fetchTasks()` returns the same normalized shape, so the UI and the merge/sort/badge-count logic never need to know which service a task came from:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Prefixed with adapter id to stay globally unique, e.g. `netsuite:12345` |
| `sourceId` | string | The service's own record id |
| `title` | string | Case subject / task name |
| `status` | string | Normalized bucket: `open`, `in_progress`, `waiting`, `closed` |
| `priority` | string \| null | Normalized to `high` / `medium` / `low` where the source has an equivalent |
| `dueDate` | ISO date \| null | |
| `url` | string | Deep link back into NetSuite or ClickUp |
| `source` | string | Adapter id, for grouping/filtering in the UI |
| `raw` | object | The untouched source payload, kept for debugging and future fields |

Adding a new connector later (say, GitHub Issues assigned to you) means writing one file that implements `TaskAdapter`, mapping GitHub's fields onto this same shape, and adding it to a small `adapters/index.ts` registry array. Nothing in the background worker's merge logic, the popup UI, or storage schema changes.

## 6. NetSuite adapter specifics

Two ways to pull Support Cases via NetSuite's REST layer:

- **SuiteQL** (`POST /services/rest/query/v1/suiteql`): run a SQL-like query directly against the `supportcase` table, filtered to cases where `assigned` = your internal employee id and `status` is open. This is the more flexible option and lets you pull exactly the fields you want (case number, title, status, priority, due date) in one call.
- **REST Record API** (`GET /services/rest/record/v1/supportCase`): a more RESTful, record-oriented endpoint with built-in query params — simpler for basic filtering, less flexible for complex joins.

Start with SuiteQL — for a single filtered list like "my open cases" it's the most direct path and avoids over-fetching fields you don't need. You'll need your NetSuite account id (for the base URL, `https://<account-id>.suitetalk.api.netsuite.com`) and your internal employee record id to filter by "assigned to me" — grab that once from your own Employee record and store it alongside the OAuth token in the options page rather than looking it up on every poll.

## 7. ClickUp adapter specifics

The relevant call is `GET /api/v2/team/{team_id}/task`, filtered with `assignees[]=<your_user_id>` and `subtasks`/`include_closed` params tuned to taste. ClickUp's structure is Workspace (team) → Space → Folder → List → Task, so if you work across multiple spaces you'll want to pull at the team level rather than per-list so nothing gets missed. Your ClickUp user id and team id are both retrievable once via the `GET /api/v2/user` and `GET /api/v2/team` endpoints during initial setup, then cached.

## 8. UI/UX

A popup is the simplest starting point (fast, no extra permission prompts) — group items by source with a collapsible section per service, sort by due date within each group, and show a relative badge count (e.g. "7") on the toolbar icon for total open items. If the list grows long or you want it visible while you work, a `chrome.sidePanel` view is a natural upgrade later since it stays open alongside a tab instead of closing on blur — worth keeping in mind when choosing where state lives, but not something to build for on day one.

## 9. Manifest V3 skeleton

```json
{
  "manifest_version": 3,
  "name": "Task Hub",
  "permissions": ["storage", "alarms", "identity"],
  "host_permissions": [
    "https://*.suitetalk.api.netsuite.com/*",
    "https://api.clickup.com/*"
  ],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html" },
  "options_page": "options.html"
}
```

## 10. Phased build order

**Phase 1 — ClickUp only, read-only.** Popup UI, options page for the personal token, background polling, badge count. This proves out the whole pipeline (storage schema, merge logic, UI) against the easier of the two auth models before NetSuite's OAuth complexity enters the picture. This phase alone is a genuinely useful tool.

**Phase 2 — NetSuite adapter via OAuth 2.0.** Set up the NetSuite integration record, implement the `chrome.identity` OAuth flow, build the SuiteQL query for open Support Cases, map results into the normalized shape. Expect this to take longer than Phase 1 — OAuth setup and NetSuite account quirks are the main risk here, not the extension code.

**Phase 3 — Unified list and polish.** Merge both adapters' output, sort/group in the popup, handle partial failures gracefully (e.g. ClickUp is fine but NetSuite's token expired — show a per-source error state rather than blanking the whole list), add a manual refresh button.

**Phase 4 — Extensibility hardening.** Formalize the `TaskAdapter` interface and adapter registry if it isn't already clean from Phases 1–2, add a toggle per adapter in the options page, write down (even just for yourself) what a new adapter needs to implement — this is the point where adding a third source becomes trivial rather than requiring you to relearn the codebase.

**Phase 5 (optional) — a third source.** Once the pattern is proven, adding something like Jira or GitHub Issues is a good test of whether the extensibility goal was actually met — if it takes an afternoon instead of a weekend, the architecture did its job.

## 11. Open decisions to make as you build

A few things are genuinely your call rather than something to resolve in a plan doc: how "assigned to me" should be defined for NetSuite cases if your account uses a queue/team-based assignment model instead of direct assignment; whether closed/resolved items should ever show up (e.g. "closed today" for a sense of completion) or drop immediately; and how aggressively to poll — ClickUp and NetSuite both have rate limits, so a 5–10 minute interval is a reasonable starting point rather than anything tighter.

## Sources

- [Chrome for Developers — Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [ClickUp API — Authentication](https://developer.clickup.com/docs/authentication)
- [Oracle NetSuite — Create Integration Records for Applications to Use TBA](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_4249032125.html)
- [Oracle NetSuite — Setting Up Token-Based Authentication](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_4164105234.html)
- [Houseblend — NetSuite TBA Deprecation: Migrating to OAuth 2.0 by 2027](https://www.houseblend.io/articles/netsuite-tba-deprecation-oauth2-migration)
- [Adaptive Solutions Group — 2027.1 Release Notes: TBA End of Support, OAuth2 Migration](https://adaptivesuitesolutions.com/release-notes/2027-1-tba-end-of-support-oauth2-migration)

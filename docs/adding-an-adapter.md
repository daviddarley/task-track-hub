# Adding a source

Everything the extension does downstream of an adapter — merging, sorting, the badge count, the
popup — is written against `NormalizedTask` and knows nothing about any specific service. Adding a
source is therefore two files and one line.

## The contract

```ts
import type { NormalizedTask, TaskAdapter } from '../core/types.js';

export const jiraAdapter: TaskAdapter = {
  id: 'jira',                 // lowercase, stable — it prefixes task ids and keys settings
  displayName: 'Jira',        // shown in the popup group header and error banners

  async isConfigured(): Promise<boolean> { … },   // credentials good enough to try a fetch?
  async authenticate(): Promise<void> { … },      // validate, cache ids we'd otherwise re-look-up
  async fetchTasks(): Promise<NormalizedTask[]> { … },
};
```

And the shape every adapter returns ([src/core/types.ts](../src/core/types.ts)):

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Prefixed with the adapter id: `jira:PROJ-14` |
| `sourceId` | `string` | The service's own record id |
| `title` | `string` | Case subject / task name / issue summary |
| `status` | `TaskStatus` | `'open' \| 'in_progress' \| 'waiting' \| 'closed'` |
| `priority` | `TaskPriority` | `'high' \| 'medium' \| 'low' \| null` |
| `dueDate` | `string \| null` | ISO 8601 |
| `url` | `string` | Deep link back into the source system |
| `source` | `string` | Your adapter id |
| `subtitle` | `string \| null` | *Optional.* Source context — the ClickUp list, a NetSuite case number |
| `raw` | `unknown` | The untouched payload, for debugging and fields you haven't mapped yet |

## Steps

1. **Split transport from mapping.** Put the pure payload→`NormalizedTask` functions in
   `adapters/<service>-map.ts` and the auth/fetch/pagination in `adapters/<service>.ts`. The
   mapping half then imports nothing from `chrome` and is testable directly — see
   [clickup-map.ts](../src/adapters/clickup-map.ts) and
   [tests/clickup-map.test.mjs](../tests/clickup-map.test.mjs).

2. **Type the payload as what it is: JSON.** Declare the slice you read with optional,
   `unknown`-ish fields (see `ClickUpTask`) rather than asserting the API's documented shape. The
   documented shape is a promise, not a guarantee, and `noUncheckedIndexedAccess` will not save you
   from a `null` the docs didn't mention.

3. **Get a credential store.** `createCredentialStore<YourCredentials>('<id>')` from
   [core/storage.ts](../src/core/storage.ts) returns a `CredentialStore<T>` scoped to your adapter.
   Don't reach into `chrome.storage` directly — the layout is a detail of that module, and scoping
   keeps one adapter from reading another's secrets. Note the store returns `Partial<T>`: a
   credential set is built up over time, and a token exists before the user id it resolves to does.

4. **Fetch through `requestJson`** from [core/http.ts](../src/core/http.ts). It applies a timeout
   and turns HTTP status codes into `AdapterError` kinds (`auth`, `rate_limit`, `network`,
   `timeout`), which drives the "re-enter your token" vs "the service is down" wording in the
   popup. It returns `unknown` — narrow it in one clearly marked block, the way `clickup.ts` does
   under *Response readers*, instead of casting at each use.

5. **Register it** in [adapters/index.ts](../src/adapters/index.ts). Array order is display order.

6. **Declare the host** in [src/manifest.json](../src/manifest.json) under `host_permissions`. Only
   the background worker can use it — Manifest V3 grants workers a cross-origin exception that
   content scripts don't get. Keep it narrow; no `<all_urls>`.

7. **Add the options UI** — a card in `options/options.html` plus wiring in `options.ts`. Save the
   credential, then `sendMessage({ type: 'connect', adapterId: '<id>' })` so the *worker* validates
   it; the options page can't make the call itself.

8. **Run `npm test`.** It builds first, so a type error fails the test run. The `TaskAdapter`
   annotation is what catches a wrong status string or a missing method — at compile time, not in
   the browser.

## What you don't have to touch

`core/sync.ts`, `core/badge.ts`, `core/sort.ts`, the storage schema, and the entire popup. If a
change to a source requires editing any of those, the abstraction has sprung a leak — fix it there
rather than special-casing.

## Things worth getting right

- **Statuses are the hard part.** Most systems let users define their own. Prefer a structural
  signal (ClickUp's `status.type`, Jira's status *category*) over matching on display names, and
  fall back to name matching only to separate active work from parked work.
- **Query at the highest level the API allows** and filter down, rather than iterating containers.
  Per-container iteration means anything in a container you forgot silently goes missing.
- **Never trust a timestamp.** Guard against `0`, `''`, and non-numeric junk before constructing a
  `Date`, or an `Invalid Date` ends up in storage and every sort involving it goes strange.
- **Fail loudly, degrade quietly.** Throwing from `fetchTasks` is correct and safe: `sync.ts`
  catches it, keeps serving your last good tasks marked stale, and shows a banner for your source
  alone. Returning an empty array on error is the harmful option — it looks like "all clear".

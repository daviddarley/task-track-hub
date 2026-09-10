# Adding a source

Everything the extension does downstream of an adapter — merging, sorting, the badge count, the
popup — is written against `NormalizedTask` and knows nothing about any specific service. Adding a
source is therefore two files and one line.

## The contract

```js
/** @type {import('../core/types.js').TaskAdapter} */
export const myAdapter = {
  id: 'jira',                       // lowercase, stable — it prefixes task ids and keys settings
  displayName: 'Jira',              // shown in the popup group header and error banners
  async isConfigured() {},          // do we have credentials good enough to try a fetch?
  async authenticate() {},          // validate credentials, cache ids we'd otherwise re-lookup
  async fetchTasks() {},            // → NormalizedTask[]
};
```

And the shape every adapter returns:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Prefixed with the adapter id: `jira:PROJ-14` |
| `sourceId` | string | The service's own record id |
| `title` | string | Case subject / task name / issue summary |
| `status` | `'open' \| 'in_progress' \| 'waiting' \| 'closed'` | Map the source's vocabulary onto these four |
| `priority` | `'high' \| 'medium' \| 'low' \| null` | `null` where the source has no equivalent |
| `dueDate` | ISO 8601 string \| null | |
| `url` | string | Deep link back into the source system |
| `source` | string | Your adapter id |
| `subtitle` | string \| null | *Optional.* Source context — the ClickUp list, a NetSuite case number |
| `raw` | object | The untouched payload, for debugging and fields you haven't mapped yet |

## Steps

1. **Split transport from mapping.** Put the pure payload→`NormalizedTask` functions in
   `adapters/<service>-map.js` and the auth/fetch/pagination in `adapters/<service>.js`. The
   mapping half then imports nothing from `chrome` and can be tested in plain Node — see
   [clickup-map.js](../extension/src/adapters/clickup-map.js) and the cases in
   [tools/smoke-test.mjs](../tools/smoke-test.mjs).

2. **Get a credential store.** `createCredentialStore('<id>')` from `core/storage.js` hands you a
   `get` / `patch` / `clear` bag scoped to your adapter. Don't reach into `chrome.storage`
   directly — the layout is a detail of that module, and scoping keeps one adapter from reading
   another's secrets.

3. **Fetch through `requestJson`** from `core/http.js`. It applies a timeout and turns HTTP status
   codes into `AdapterError` kinds (`auth`, `rate_limit`, `network`, `timeout`), which is what
   drives the "re-enter your token" vs "the service is down" wording in the popup. Throw
   `AdapterError` yourself for anything it can't infer.

4. **Register it** in [adapters/index.js](../extension/src/adapters/index.js). Array order is
   display order.

5. **Declare the host** in `manifest.json` under `host_permissions`. Only the background worker can
   use it — Manifest V3 grants workers a cross-origin exception that content scripts don't get.
   Keep it narrow; no `<all_urls>`.

6. **Add the options UI** — a card in `options/options.html` plus wiring in `options.js`. Save the
   credential, then send `{ type: 'connect', adapterId: '<id>' }` so the *worker* validates it; the
   options page can't make the call itself.

7. **Run `npm run typecheck` and `npm test`.** The type check enforces the interface — an adapter
   with a wrong status string or a missing method fails there rather than at runtime.

## What you don't have to touch

`core/sync.js`, `core/badge.js`, `core/sort.js`, the storage schema, and the entire popup. If a
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
- **Fail loudly, degrade quietly.** Throwing from `fetchTasks` is correct and safe: `sync.js`
  catches it, keeps serving your last good tasks marked stale, and shows a banner for your source
  alone. Returning an empty array on error is the harmful option — it looks like "all clear".

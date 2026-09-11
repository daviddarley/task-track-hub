# Basecamp 2 (BCX) — feasibility assessment

Research done before writing any adapter, because one finding could rule the whole thing out.
**Status: viable on the data side, blocked on a credential decision.** No code written yet.

## Summary

| | Verdict |
|---|---|
| Data endpoints | **Good fit** — better than NetSuite |
| `User-Agent` requirement | **Probably not a blocker** (probed, see below) |
| Auth for a single user | Workable |
| **Auth for a team** | **Blocked — needs a decision** |

## The blocker: auth

Basecamp 2 offers two mechanisms, and unlike NetSuite neither is a clean public client.

| | Basecamp 2 | NetSuite, for contrast |
|---|---|---|
| PKCE | **Not supported** — absent from the docs entirely | Supported; mandatory from 2027.1 |
| Public client | **No such option** | Explicit checkbox |
| Token exchange | **Requires `client_secret`** | No secret exists |
| HTTP Basic | Supported, Basecamp 2 only | n/a |

Endpoints:

- Authorize — `https://launchpad.37signals.com/authorization/new?type=web_server&client_id=…&redirect_uri=…`
- Token — `POST https://launchpad.37signals.com/authorization/token?type=web_server&client_id=…&redirect_uri=…&client_secret=…&code=…`
- Refresh — `POST …/authorization/token?type=refresh&refresh_token=…&client_id=…&client_secret=…`

Access tokens last 2 weeks; refresh tokens are issued.

### Why this is hard for a team

An extension cannot keep a secret — anyone can read its source. That was fine for NetSuite, which
supports public clients. Basecamp doesn't, so every option has a real cost:

1. **Each teammate registers their own Basecamp integration** and pastes their own client id +
   secret. Technically sound, no shared secret — but every colleague has to create a developer
   integration before they can see a to-do list.
2. **One shared client secret**, distributed to the team. It stops being a secret, and it is the
   *app's* identity rather than a personal credential. Never commit it — this repo is public.
3. **HTTP Basic with each person's account password.** Simplest to build and the worst to own:
   stores a real password, breaks under 2FA, not independently revocable. Basecamp's own docs bless
   it only for personal use and warn against asking other users for credentials.
4. **A backend that brokers the exchange.** The plan's original caveat. Correct, and far beyond the
   scope of a personal-tools extension.

This is precisely the case [task-hub-extension-plan.md](../task-hub-extension-plan.md) §3 warned
about: *"not something you'd want to hand to a client as-is without adding a real backend to broker
OAuth and hide long-lived secrets."*

## The data side is genuinely good

Better than NetSuite, in fact:

- **`GET /people/{id}/assigned_todos.json`** — a purpose-built "assigned to me" endpoint. No query
  language, no schema discovery. Also accepts `?due_since=DATE`.
- **Todos carry `due_at`**, so `dueDate` would be populated — unlike NetSuite cases, which have no
  due-date field at all.
- Base URL `https://basecamp.com/{account_id}/api/v1/`, JSON throughout, all paths end `.json`.
- Rate limit **500 requests / 10 seconds** — far more headroom than a 5-minute poll needs.

Mapping onto `NormalizedTask`:

| Field | Source |
|---|---|
| `title` | `content` |
| `dueDate` | `due_at` |
| `status` | `completed_at` — null → `open`, set → `closed` |
| `priority` | `null` — Basecamp has no priority concept |
| `subtitle` | the to-do list name |

Note the status mapping is **binary**. There is no `in_progress` or `waiting` equivalent, so those
buckets would go unused for this source.

## The `User-Agent` question — probed

The docs say a `User-Agent` identifying your app with contact info is mandatory and that omitting it
returns 400. Chrome treats `User-Agent` as a forbidden header name, so extension `fetch()` generally
cannot set it — which would have been a hard block.

Probed unauthenticated with two different agents:

| Host | Chrome-style UA | Documented-style UA |
|---|---|---|
| `launchpad.37signals.com/authorization.json` | 401 | 401 |
| `basecamp.com/999999999/api/v1/projects.json` | 404 | 404 |

Neither returned 400, and the browser UA was treated the same as a compliant one. **Not conclusive**
— the 404 may short-circuit before validation, and authenticated requests may behave differently —
but it suggests Chrome's own UA will pass. If it doesn't, the workaround is a
`declarativeNetRequest` rule rewriting the header, at the cost of another permission.

## What has to be decided before any code

**Which credential model.** Everything else is ready: the adapter interface, the registry, the
options-page pattern, and `requestJson`'s form-encoding support (added for NetSuite's token
endpoint) all transfer directly. A Basecamp adapter is a day's work *once this is settled*, and
unbuildable before it.

## Sources

- [37signals API — Authentication](https://github.com/basecamp/api/blob/master/sections/authentication.md)
- [Basecamp 2 (BCX) API](https://github.com/basecamp/bcx-api)
- [BCX — To-do lists](https://github.com/basecamp/bcx-api/blob/master/sections/todolists.md)

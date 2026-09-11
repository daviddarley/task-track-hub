# Basecamp 2 setup

Background on why it works this way: [basecamp-assessment.md](basecamp-assessment.md).

## Who does what

| Step | Who | How often |
|---|---|---|
| Register the integration (step 1) | One person | Once for the team |
| Share the client id **and secret** internally | That person | Once |
| Paste both into Options and sign in | Each teammate | Once each |

Unlike NetSuite, **there is a client secret here and it does matter.** Basecamp 2 supports neither
PKCE nor public clients, so the token exchange requires one. Treat it like a password:

- Share it over internal chat or a password manager — **never commit it, never post it publicly.**
- It is stored in each person's `chrome.storage.local`, never in this repo.
- If it leaks, reset it at launchpad.37signals.com and everyone reconnects.

The integration record pins the redirect URI to this extension, so a leaked secret on its own does
not let anyone complete a sign-in. That limits the damage; it does not make the secret harmless.

## Step 1 — register the integration

Go to **https://launchpad.37signals.com/integrations** and create one.

| Field | Value |
|---|---|
| Name | `Task Track Hub` |
| Company / website | your own |
| **Redirect URI** | `https://cnkigchgphmlkdmiiejnkkbblnoabfob.chromiumapp.org/` |

The redirect URI must match **exactly**, trailing slash included. Copy it from the read-only field
in the extension's Options page rather than retyping it.

You'll be given a **client id** and **client secret**. Both are needed.

## Step 2 — each teammate connects

Extension **Options → Basecamp**: paste the client id and secret, then **Connect**. Basecamp's
sign-in opens, you approve once, and that's it.

Nothing else to enter. The adapter discovers your Basecamp 2 account and your person id within it
after sign-in, and caches both.

## What you get

To-dos assigned to you, via `GET /people/{id}/assigned_todos.json`, with real due dates — so
Basecamp items sort meaningfully by due date, unlike NetSuite cases which have no due-date field.

## Known limitations

- **Everything shows as `open`.** The `assigned_todos` endpoint returns outstanding work and
  carries no completion field, so the `in_progress`, `waiting` and `closed` buckets go unused. The
  "Show recently closed items" setting has no effect on this source.
- **No priority.** Basecamp 2 has no priority concept, so every to-do has `priority: null` and
  sorting by priority does nothing for them.
- **Basecamp 2 only.** If sign-in reports no Basecamp 2 account, you're on Basecamp 3 or 4, which
  use a different API this adapter does not speak.

## If it fails

`chrome://extensions` → **service worker** → Console, look for `[task-hub] basecamp sync failed`.

One failure mode is specific to Basecamp and worth naming: it documents a required `User-Agent`
header identifying the app with contact details, and Chrome forbids extensions from setting that
header. Probing suggests Chrome's own agent is accepted, but that was never confirmed against an
authenticated request. **A `400` mentioning the user agent means the probe was wrong** — the fix is
a `declarativeNetRequest` rule rewriting the header, at the cost of another permission. Report it
and it can be added.

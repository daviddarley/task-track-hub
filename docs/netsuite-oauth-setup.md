# NetSuite OAuth 2.0 setup

One-time setup on the NetSuite side, for account **6967599** (`CPPROD`). You need the
**Administrator** role, or a role with the *Integration Application* permission.

## Who does what

This is **done once for the whole team**, not once per person.

| Step | Who | How often |
|---|---|---|
| Create the integration record (steps 0–2) | An admin | Once for the account |
| Share the Client ID with the team | An admin | Once |
| Connect in Options and authorize | Each teammate | Once each |
| Enter their own employee internal id (step 3) | Each teammate | Once each |

The **Client ID is not a secret** — the integration is registered as a *Public Client*, so there is
no client secret in existence and the id is safe to paste in chat, a wiki, or the repo. Each
teammate's authorization produces tokens scoped to *their own* NetSuite role, so nobody sees cases
they couldn't already see in NetSuite.

One redirect URI covers everyone: it is derived from the extension id, which is pinned by the
manifest key, so every teammate loading the same `dist/` has the same id.

**Check with your NetSuite admin** that each teammate's role has REST Web Services permission —
without it, authorization succeeds and then every query returns 403.

This is built on OAuth 2.0 rather than Token-Based Authentication deliberately: Oracle stops
accepting new TBA integrations for REST services in release **2027.1**, so a TBA build would need
redoing within months of being finished.

## What we're aiming for

A **public client** using **PKCE** — no client secret anywhere in the extension. An extension can't
keep a secret (anyone can unzip it and read the source), so the alternative would be unsafe.
NetSuite supports this directly, and as of 2027.1 will *require* PKCE for the authorization code
grant regardless.

## Step 0 — check the feature is on

**Setup → Company → Enable Features → SuiteCloud** tab. Under *SuiteTalk (Web Services)*, confirm
**REST WEB SERVICES** is checked. Under *Manage Authentication*, confirm **OAUTH 2.0** is checked.

If either is off, tick it and save before continuing — the integration record's scope options
depend on it.

## Step 1 — create the integration record

**Setup → Integration → Manage Integrations → New**

| Field | Value |
|---|---|
| **Name** | `Task Track Hub` |
| **State** | `Enabled` |
| **Description** | Optional — e.g. "Chrome extension: my open support cases" |

On the **Authentication** subtab:

| Setting | Value | Why |
|---|---|---|
| **TOKEN-BASED AUTHENTICATION** | ☐ **unchecked** | TBA is the deprecated path we're deliberately avoiding |
| **OAUTH 2.0 → AUTHORIZATION CODE GRANT** | ☑ **checked** | The flow `chrome.identity` runs |
| **PUBLIC CLIENT** | ☑ **checked** | This is the important one — it's what makes the client-secret-free flow legal |
| **REDIRECT URI** | `https://cnkigchgphmlkdmiiejnkkbblnoabfob.chromiumapp.org/` | Must match exactly, trailing slash included |
| **SCOPE → REST WEB SERVICES** | ☑ **checked** | Required for SuiteQL |
| **SCOPE → RESTLETS** | ☐ unchecked | Not used |
| **SCOPE → SUITEANALYTICS CONNECT** | ☐ unchecked | Not used |

Click **Save**.

## Step 2 — capture the Client ID

On save, NetSuite shows the **CLIENT ID** and **CLIENT SECRET** **once, and never again**. If you
navigate away without copying, you have to reset the credentials to get new ones.

- **Copy the CLIENT ID.** This is what the extension needs. It is not a secret — it's fine to paste
  it into the extension's Options page, and it's fine to tell me.
- **The CLIENT SECRET is not needed** for a public client. Don't paste it anywhere, and don't send
  it to me. If you'd rather keep a copy for future use, put it in a password manager.

## Step 3 — each teammate finds their own employee internal id

The SuiteQL query filters cases by the employee they're assigned to, and looking that up on every
poll would be wasted work. Each person grabs theirs once:

**Setup → Users/Roles → Manage Users**, find yourself, open the record, and read the `id=` value
from the browser's address bar. That number goes into the extension's Options page alongside the
account id and client id.

An admin can look these up for the whole team in one query:

```sql
SELECT id, entityid, email FROM employee WHERE email IN ('a@x.com', 'b@x.com')
```

## The redirect URI, and why it's pinned

`https://cnkigchgphmlkdmiiejnkkbblnoabfob.chromiumapp.org/` is derived from the extension's id,
which Chrome normally derives from the *folder path* of an unpacked extension — meaning it would
change if the repo ever moved, silently breaking OAuth against a redirect URI NetSuite has
hard-coded.

`npm run key` pinned it by embedding a public key in the manifest (see
[tools/make-extension-key.mjs](../tools/make-extension-key.mjs)). The id is now stable across
machines, paths, and a future Web Store listing. The matching private key is at
`extension-private-key.pem`, git-ignored — **back it up**; losing it doesn't break the current
setup, but it's the extension's identity if you ever publish.

## Endpoints the adapter will use

For account `6967599`:

| Purpose | URL |
|---|---|
| Authorize | `https://6967599.app.netsuite.com/app/login/oauth2/authorize.nl` |
| Token / refresh | `https://6967599.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token` |
| SuiteQL | `https://6967599.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql` |

Only the `suitetalk.api.netsuite.com` host needs to be in `host_permissions` — the authorize URL is
a browser navigation run by `chrome.identity.launchWebAuthFlow`, not a `fetch`.

## What each teammate enters in Options

| Field | Value | Same for everyone? |
|---|---|---|
| Account ID | `6967599` | Yes |
| Client ID | from step 2 | Yes |
| Your employee internal ID | from step 3 | **No — personal** |

Then **Connect**, which opens NetSuite's sign-in once. Tokens are stored in that person's own
`chrome.storage.local` and never leave their machine.

## Distributing the extension to the team

Everyone must load the **same build** so the extension id — and therefore the redirect URI — stays
`cnkigchgphmlkdmiiejnkkbblnoabfob`. Either:

- each teammate clones the repo and runs `npm install && npm run build`, then loads `dist/`; or
- one person builds and shares the `dist/` folder.

Both require **Developer mode** in `chrome://extensions`, which some managed-Chrome policies
disable — worth checking before promising the team it'll work. Publishing to the Chrome Web Store
as an unlisted item avoids that, but the Store assigns its own extension id, which changes the
redirect URI and means updating the integration record.

## Sources

- [Oracle — Create Integration Records for Applications to Use OAuth 2.0](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157771733782.html)
- [Oracle — OAuth 2.0 Authorization Code Grant Flow](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_160855520475.html)
- [Houseblend — NetSuite OAuth 2.0 Setup Guide](https://www.houseblend.io/articles/netsuite-oauth-2-setup-guide)
- [Bundlet — OAuth 2.0 for NetSuite, Part Three: PKCE](https://www.bundlet.com/blog/oauth2-for-netsuite-pkce)

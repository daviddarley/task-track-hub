# NetSuite OAuth 2.0 setup

One-time setup on the NetSuite side, for account **6967599** (`CPPROD`). You need the
**Administrator** role, or a role with the *Integration Application* permission.

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

## Step 3 — find your employee internal id

The SuiteQL query filters cases by the employee they're assigned to, and looking that up on every
poll would be wasted work. Grab it once:

**Setup → Users/Roles → Manage Users**, find yourself, open the record, and read the `id=` value
from the browser's address bar. That number goes into the extension's Options page alongside the
account id and client id.

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

## What to send me when you're done

1. The **Client ID** from step 2.
2. Your **employee internal id** from step 3.
3. Confirmation that **Public Client** was checkable — if the checkbox is greyed out or missing,
   say so, because that changes the approach.

## Sources

- [Oracle — Create Integration Records for Applications to Use OAuth 2.0](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157771733782.html)
- [Oracle — OAuth 2.0 Authorization Code Grant Flow](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_160855520475.html)
- [Houseblend — NetSuite OAuth 2.0 Setup Guide](https://www.houseblend.io/articles/netsuite-oauth-2-setup-guide)
- [Bundlet — OAuth 2.0 for NetSuite, Part Three: PKCE](https://www.bundlet.com/blog/oauth2-for-netsuite-pkce)

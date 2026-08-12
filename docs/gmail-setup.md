# Gmail API setup

One-time setup so the scheduling agent can send compliance emails as
`cole@sixarrowsconstruction.com`. Budget about 20 minutes.

**Cost: nothing.** The Gmail API is free, and a Google Cloud project is free
unless you turn on billable services. Sending one email costs 100 quota units
against a daily budget of 1,000,000,000. A few hundred emails a month is
statistically zero.

At the end you will have three values to paste into Netlify:
`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`.

---

## 1. Create a Google Cloud project

1. Go to <https://console.cloud.google.com/>
2. Project dropdown in the top bar, then **New Project**
3. Name it `Six Arrows Agent`. Leave the organization as-is.
4. **Create**, then make sure the new project is selected in the top bar

## 2. Turn on the Gmail API

1. Search **Gmail API** in the top search bar and open it
2. Click **Enable**

## 3. Configure the consent screen

Search **OAuth consent screen** and open it.

**This step decides whether your login keeps working.** Pick based on whether
`sixarrowsconstruction.com` is a Google Workspace domain, which it is if you
pay Google for email on that domain.

- **Workspace domain (most likely):** choose **Internal**. Nothing further is
  needed. No Google review, and the login never expires.
- **Regular Gmail account:** choose **External**. Fill in the app name
  (`Six Arrows Agent`), your email as both support and developer contact, then
  save. On the **Audience** or **Publishing status** panel, click
  **Publish app** and confirm.

> **Do not leave an External app in Testing.** Google expires the refresh token
> after 7 days in Testing mode, and the agent silently stops sending. If emails
> stop about a week after setup, this is why.

## 4. Create the OAuth client

1. Search **Credentials**, then **Create Credentials**, then **OAuth client ID**
2. Application type: **Web application**
3. Name: `Six Arrows Agent`
4. Under **Authorized redirect URIs**, click **Add URI** and paste exactly:

   ```
   https://developers.google.com/oauthplayground
   ```

5. **Create**

Copy the **Client ID** and **Client secret** from the panel that appears. These
are two of your three values. Keep the tab open.

## 5. Get the refresh token

This is the one-time "yes, this app may send mail as me" step.

1. Go to <https://developers.google.com/oauthplayground>
2. Click the **gear icon** at the top right
3. Tick **Use your own OAuth credentials**
4. Paste your Client ID and Client secret into the two boxes that appear
5. In the left panel, ignore the API list and paste this into the
   **Input your own scopes** box at the bottom:

   ```
   https://www.googleapis.com/auth/gmail.send
   ```

6. Click **Authorize APIs**, sign in as `cole@sixarrowsconstruction.com`, and
   allow the access
7. Back in the playground, click **Exchange authorization code for tokens**
8. Copy the **Refresh token**. It starts with `1//`.

> If Google warns the app is unverified, click **Advanced** then
> **Go to Six Arrows Agent (unsafe)**. You are the app's author and the only
> user; that warning is aimed at strangers' apps.

Note the scope is `gmail.send` only. This grants permission to send mail and
nothing else. It cannot read your inbox.

## 6. Add the three values to Netlify

Netlify, then your site, then **Site configuration**, then
**Environment variables**. Add:

| Key | Value |
|---|---|
| `GMAIL_CLIENT_ID` | from step 4 |
| `GMAIL_CLIENT_SECRET` | from step 4 |
| `GMAIL_REFRESH_TOKEN` | from step 5, starts with `1//` |

Optionally `GMAIL_SENDER` if you ever want mail to come from a different
address. It defaults to `cole@sixarrowsconstruction.com`.

Redeploy, or just wait for the next push.

---

## Verifying it works

```
curl -X POST 'https://sparkly-baklava-bb8c92.netlify.app/.netlify/functions/compliance-sweep?test=1'
```

That sends one email to Cole and nothing to any subcontractor.

## If it stops working

Almost always one of two things:

- **`invalid_grant` in the logs.** The refresh token was revoked or the consent
  screen is still in Testing. Fix the publishing status per step 3, then redo
  step 5 and update `GMAIL_REFRESH_TOKEN`.
- **Password change.** Changing the Google account password revokes refresh
  tokens. Redo step 5.

Rotating the token is safe and takes two minutes. It does not affect anything
else in the portal.

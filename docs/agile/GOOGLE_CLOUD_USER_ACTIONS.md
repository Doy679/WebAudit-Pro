# Google Cloud and Credential Actions for the User (2026-11-04)

WebAudit Pro's code can't fix these: they are configuration steps only you can take. Nothing here has been done.
Google Cloud project: **154245030857** (ID `neural-quarter-513607-d5`, "My Project 80884").

## 1. Replace the saved PageSpeed credential (fixes GQA-01: PageSpeed failing)
The value saved in WebAudit Pro's API key field is an OAuth client secret (`GOCSPX-…`, 35 characters), not an API key. The real key exists in Google Cloud and is set up correctly; **don't create a new one**.

1. Google Cloud Console → **APIs & Services → Credentials** (project 154245030857). Under **API keys**, open **WebAudit Pro PageSpeed** and press **Show key**. Copy it yourself (starts with `AIza`, 39 characters).
2. WebAudit Pro → **Google Connections** → *Google Cloud credentials (admin)* → paste it into **Google API key: usually starts with AIza** → **Save credentials**. Leave the OAuth fields blank to keep them.
   - The new build refuses anything that isn't an API key, so a second mis-paste is caught before it's saved.
3. On the same page, tick the confirmation and press **Test PageSpeed key** once. It sends one request; repeats within 60 seconds are refused.
4. Expected: setup checklist step 2 shows **Done** and the PageSpeed status shows "PageSpeed working".

Optional hardening: add an **IP address** application restriction for this computer's public IP to that key.

## 2. Check the OAuth client secret (security, GQA-02)
The `GOCSPX-` value found in the key field is **not** the client secret currently saved in the OAuth field. It was sent to Google 9 times as a `key` parameter (6× at 11:47 AM, 3× at 2:09 PM), over HTTPS and only to Google.

1. Google Cloud → Credentials → **OAuth 2.0 Client IDs** → **WebAudit Pro Local** → *Client secrets*.
2. If that older secret is still listed as enabled, **add a new secret** and paste it into WebAudit Pro's **OAuth client secret** field (not the API key field).
3. Test sign-in (Retry on Google Connections). Then **disable/delete** the old secret in Google Cloud.
4. If only the currently saved secret is listed, no rotation is needed.

## 3. Re-check Search Console (fixes the stale "API not enabled" status, GQA-04)
Google Cloud already shows **Google Search Console API: enabled** in project 154245030857. WebAudit Pro's "not enabled" status is from the last check (12:40 PM), and the new build labels it "may be out of date".

1. Google Connections → **Retry / Test connection** (one read-only request).
2. Expected: status changes to "No Search Console property selected", with "Last successful check" filled in.
3. Choose the Capital Home Mortgage property and press **Use this property**.
4. If Retry says "No access", add the connected Google account as a user of the property in Search Console (Settings → Users and permissions).

## 4. Before any of the above: restart onto the new build (needs your approval)
The running app (port 3000) is still the old build. Restarting deploys the format checks, so step 1 is protected. Ask Claude CLI: "restart the app" (and separately "push" if you want the commits on GitHub).

## Not required
- Enabling or disabling any API: nothing to change.
- Creating a new API key: not needed; the existing one is correct.
- Changing OAuth consent screen, scopes or redirect URIs: not needed.

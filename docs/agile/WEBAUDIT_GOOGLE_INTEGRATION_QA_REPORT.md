# WebAudit Pro: Google Integrations Deep QA Report

**Date:** 2026-11-04, about 2:20–2:40 PM (Asia/Singapore) · **App:** http://localhost:3000 (build `d95cfa2`, started 2:16 PM) · **Browser:** Chrome "Browser 1" via Claude in Chrome, signed in as J. Pajares (Admin)
**Scope:** read-only. No source changes, no settings saved, no Google Cloud changes, no "Test PageSpeed key", no "Retry", no reconnect, no audits, reports or record changes. No credential was displayed or copied: the API key's *shape* was checked with yes/no tests and its length only.

**Evidence levels:** **Confirmed** (observed directly) · **Likely** (strong indirect evidence) · **Not verifiable** (needs access or authorization not used).

---

## A. Executive summary

- **PageSpeed (P1, root cause confirmed: configuration error plus a software gap).** Google's own reply, stored by the app, is `HTTP 400 INVALID_ARGUMENT [API_KEY_INVALID]: API key not valid`. The value saved in WebAudit Pro's *PageSpeed API key* field is **35 characters long, does not start with `AIza`, and starts with `GOCSPX-`**: it is an **OAuth client secret**, not an API key (Google API keys are 39 characters starting with `AIza`). It isn't the client secret currently saved in the OAuth field.
  - In Google Cloud project 154245030857 the real key **"WebAudit Pro PageSpeed"** exists (created Nov 4, 10:05:07 AM): application restriction **None**, API restriction **PageSpeed Insights API**. That is correct for server use.
  - The key itself is fine. WebAudit Pro is sending the wrong credential. Most likely the credentials form was re-saved between 10:19 AM (last success) and 11:47 AM (first failure) with the client secret pasted into the API key field.
  - **Software gap:** WebAudit Pro accepted a value that can't be a Google API key, with no warning, and kept no record of when the key was changed before 2:04 PM.
- **Search Console (configuration now fixed; app status stale).** Google Cloud shows **Google Search Console API enabled** in project 154245030857. WebAudit Pro still says "Search Console API not enabled" everywhere, because its status comes from the last check (12:40 PM) and nothing marks it as possibly out of date. One **Retry / Test connection** (not pressed) should move it to "choose property".
- **Security note (Likely).** The client secret saved in the key field was sent to Google as the `key` parameter of 9 PageSpeed requests (6 at 11:47 AM, 3 at 2:09 PM), over HTTPS and only to Google. If that secret is still valid for the OAuth client, treat it as exposed and rotate it.
- **BUG-10 503s: not a WebAudit Pro fault (Likely).** In this browser, `?_rsc=` 503s appeared **only** for navigations interrupted by a newer click. Single clicks gave 200 in both the extension's network log and the page's own fetch, and the server log for the whole session has **no errors and no 503**.
- **Other confirmed defects:**
  - "Test PageSpeed key" allows repeated clicks (3 live requests in 4 s at 2:09 PM).
  - Cache reuses are listed as "Completed" requests.
  - PageSpeed "Latest results" shows a 10:15 AM result for the home page without saying a newer attempt (2:09 PM) failed.
  - The Structured Data page still shows old-rules double verdicts (stored results; fix awaiting a fresh audit or approval).
- **Application health:**
  - every page opened with HTTP 200;
  - no JavaScript errors on the pages checked;
  - worker online;
  - status messages consistent across 9 screens.

## B. Integration status matrix

| Service | Configured? | Connected? | Last success | Last failure | Current error (app) | Verified cause | User action | Developer action | Status |
|---|---|---|---|---|---|---|---|---|---|
| PageSpeed Insights API | Yes: a value is saved, but **it isn't an API key** | n/a (API key) | Nov 4, 10:19 AM | Nov 4, 2:09 PM (3 test requests) | "API key rejected" | **Confirmed:** saved value is an OAuth client secret (GOCSPX-…, 35 chars); Google: API_KEY_INVALID. Cloud key and restrictions correct | Paste the real key ("WebAudit Pro PageSpeed") into the API key field and save; then one approved Test | Validate key format on save; record and show key-change time; warn on format mismatch; lock the Test button | **Failing: configuration** |
| Chrome UX Report API | Off (optional) | — | — | — | — | By design: basic real-user data comes from PageSpeed | — | — | Off |
| Search Console OAuth client | Yes ("Client configured") | — | Token refresh worked at 12:35/12:40 PM (Google answered with an API error, not an auth error) | — | — | Confirmed working as of 12:40 PM | — | — | OK |
| Your Google account | Connected Nov 4, 10:05 AM | Yes | — | — | — | Confirmed | — | — | OK |
| Search Console API | — | — | Never | Nov 4, 12:40 PM (403 SERVICE_DISABLED) | "API not enabled in Google Cloud" (stale) | **Confirmed:** API now **enabled** in Cloud project 154245030857; app status not rechecked since | Press Retry once (authorized), then choose the property | Show check age and a "may be outdated, Retry to recheck" hint on every status | **Stale status: retest needed** |
| Search Console property | None selected | — | — | — | "none selected" | Can't list properties until a successful Retry | Choose the CHM property after Retry | — | **Blocked until Retry** |
| Search Console data (Performance / Inspection / Sitemaps) | — | — | Never | — | API-disabled banner | Follows from the property step | — | — | **Not verifiable yet** |
| Rich Results / Structured Data | Internal validator | — | Latest CHM audit 11:44 AM (rules 2026-11-03) | — | Old double verdicts on stored results | Confirmed: results predate the 2026-11-04 rules | Approve a fresh audit or display reinterpretation | — | **Working, stale results** |

What's proven for Search Console: (1) OAuth connected: **proven**. (2) API enabled in Cloud: **proven** (Cloud Console). (3) Property accessible: **not verifiable** (needs Retry). (4) Property selected: **no**. (5) API requests working: **not verifiable** (needs Retry). The app doesn't misreport the API-disabled error as a permission error (correct), but it now reports an outdated state.

## C. Confirmed bugs

### GQA-01 (P1): The PageSpeed key field accepts values that can't be Google API keys
- **Page:** `/google/connections`, "Google Cloud credentials (admin)"
- **Reproduction (no Google call needed):** save any non-API-key value (for example an OAuth client secret) in "API key (PageSpeed Insights / CrUX)". It's accepted silently and the page says "Key saved (settings)".
- **Expected:** a value that doesn't match Google's API key format (39 characters starting `AIza`) is rejected with a clear message. Specifically: "This looks like an OAuth client secret (starts with GOCSPX-). Paste the API key from Credentials → API keys instead."
- **Actual:** accepted. On the live system the saved "API key" is a `GOCSPX-` value of 35 characters, so every live PageSpeed request fails with API_KEY_INVALID.
- **Evidence:** stored technical detail `HTTP 400 INVALID_ARGUMENT [API_KEY_INVALID, badRequest]: API key not valid`; yes/no shape check on the saved value; Cloud key exists, restriction None, API restriction PageSpeed only.
- **Root cause:** confirmed. No input validation on credential fields.
- **Fix:** format validation on save (API key: `^AIza[0-9A-Za-z_-]{35}$`; also reject `GOCSPX-` and `…apps.googleusercontent.com` values with targeted messages). The health status should also flag "saved key isn't a Google API key" without any Google call.
- **Acceptance:** saving a `GOCSPX-…` value in the API key field fails with that message; the existing saved value shows "Saved value is not a Google API key" on Connections, Overview and New Audit.

### GQA-02 (P1, security): A client secret was sent to Google as an API key, and secrets in the wrong field aren't redacted
- **Evidence:** 9 PageSpeed requests (11:47 AM ×6, 2:09 PM ×3) were made with the GOCSPX value as the `key` URL parameter. Redaction (`redactKey`) only recognises `AIza…` keys and `key=` parameters in stored text.
- **Expected:** credential format validated before use (GQA-01); redaction covers `GOCSPX-` client secrets and other token shapes.
- **Fix:** validate before every request (refuse to call Google with a non-key value); extend redaction patterns.
- **User action:** if that client secret is still active for the OAuth client "WebAudit Pro Local", rotate it in Google Cloud and save the new one in the OAuth field (not the key field).

### GQA-03 (P2): "Test PageSpeed key" isn't protected against repeated clicks
- **Page:** `/google/connections`, "PageSpeed Insights key (admin)"
- **Evidence:** three live test requests at 2:09:33, 2:09:36 and 2:09:37 PM (Recent Google requests shows three "Failed" entries; three task rows, all forced).
- **Expected:** one request per confirmed test. The button is disabled while running, and a second test within ~60 s is refused ("A test ran 3 s ago: result above").
- **Root cause:** confirmed. The test bypasses the queue's in-flight check, and the form is still enabled after each round trip.
- **Acceptance:** double and triple clicks produce exactly one Google request (unit test with mocked fetch; E2E double-click).

### GQA-04 (P2): Search Console status doesn't show that it may be outdated
- **Pages:** `/`, `/google`, `/google/search-console`, `/google/inspection`, `/google/sitemaps`, `/audits/new`, `/settings`
- **Evidence:** all say "Search Console API not enabled in Google Cloud", while Cloud Console now lists the API as enabled. Only Connections shows "checked Nov 4, 12:40 PM".
- **Expected:** every status line shows when it was last checked, and after e.g. 30 minutes adds "may be out of date: Retry to check again". No automatic Google calls.
- **Root cause:** confirmed. The status comes from the last stored check by design, but the check's age isn't shown outside Connections.

### GQA-05 (P2): PageSpeed "Latest results" hides a newer failed attempt for the same page
- **Page:** `/google/pagespeed?project=568a8045-37e2-4b2c-b9a6-45be10a63568`
- **Evidence:** home page mobile shows the 10:15 AM result (52, LCP 6.3 s) with no hint that a 2:09 PM attempt failed. Rows don't say they're the "last successful result".
- **Expected:** a column or badge such as "Last successful result · newer attempt failed 2:09 PM (key rejected)", and a heading "Last successful results".
- **Root cause:** confirmed. By design the selector prefers completed results (BUG-03), with no indicator of later failures.

### GQA-06 (P3): Cache reuses are listed as "Completed" Google requests
- **Page:** `/google?project=…` → "Recent Google requests"
- **Evidence:** 8 entries at 11:47 AM marked "Completed" were cache reuses (no Google call); the page never says "from cache".
- **Expected:** "Served from cache (Google result from 10:19 AM)" instead of "Completed".

### GQA-07 (P3): No record of credential changes
- **Evidence:** no record of when the PageSpeed key was replaced between 10:19 and 11:47 AM (older code didn't store it; since 2:04 PM `apiKeySavedAt` is stored but not shown).
- **Expected:** Connections shows "Key last changed Nov 4, 11:2x AM by J. Pajares", with a history entry per credential change (no values stored).

### GQA-08 (P3): The recovery link on the Connections page points to itself
- **Page:** `/google/connections`: "Check the key in Google Connections" inside the PageSpeed card.
- **Expected:** on Connections, link to the Cloud Console Credentials page for project 154245030857 instead, or scroll to the key field.

### Not a WebAudit Pro defect (documented)
- **BUG-10 / 503 on `?_rsc=` (Likely tooling artifact):** 503 appears only for navigations interrupted by a newer click (`/?_rsc`, `/audits?_rsc`, `/issues?_rsc` during a scripted 1.5 s click loop). Clean clicks on the same pages gave 200 in both the extension log and the page's own fetch (`text/x-component`). The server log for the session has no errors. No code change recommended. QA guidance: treat 503 on aborted `?_rsc=` requests in Claude in Chrome as "cancelled".
- **Structured Data double verdicts:** stored results from rules 2026-11-03 (`/brian-wheeler/` Article: "datePublished missing" + "wrong type", "Not eligible"), clearly labelled "Checked with rules 2026-11-03" with an explanatory notice. They'll be replaced by a fresh audit (approval B4) or the display reinterpretation (approval B2).

## D. Google Cloud configuration checklist (administrator, manual)

Project **154245030857** = "My Project 80884", ID `neural-quarter-513607-d5`.
1. **PageSpeed key:** nothing to change in Cloud. Key "WebAudit Pro PageSpeed" exists, application restriction None, API restriction PageSpeed Insights API. **Don't create a new key.**
   - In Cloud Console → APIs & Services → Credentials → API keys, click **Show key** on "WebAudit Pro PageSpeed" and copy it yourself.
   - In WebAudit Pro → Google Connections → "Google Cloud credentials (admin)", paste it into **API key (PageSpeed Insights / CrUX)** and press **Save credentials**. Leave the OAuth fields blank to keep them.
   - Optional security hardening: add an **IP address** application restriction for this computer's public IP.
2. **OAuth client secret:** the value found in the key field starts with `GOCSPX-` and differs from the saved OAuth secret. In Credentials → OAuth 2.0 Client IDs → "WebAudit Pro Local", check whether that secret is still listed as active. If yes, add a new secret, save it in WebAudit Pro's **OAuth client secret** field, test sign-in, then disable or delete the old one.
3. **Search Console API:** already enabled. Nothing to change.
4. **Search Console property access:** make sure the Google account connected in WebAudit Pro (connected Nov 4, 10:05 AM) is an owner or user of the CHM property in Search Console (Settings → Users and permissions).
5. **Quotas:** PageSpeed shows 30 requests in 24 h and 0% errors (requests with invalid keys aren't attributed to the project). No quota problem visible.

## E. UI/UX improvements

| # | Problem (as a non-technical user) | Specific improvement |
|---|---|---|
| UX-G1 | "API key rejected (invalid, expired or deleted)" sends me to Google Cloud, but the real problem is the wrong value pasted in WebAudit Pro | When the saved value's format is wrong, say: "The saved PageSpeed key isn't a Google API key (it looks like an OAuth client secret). Copy the key from Google Cloud → Credentials → API keys → 'WebAudit Pro PageSpeed'." |
| UX-G2 | I can't tell how old "Search Console API not enabled" is | Add "checked 12:40 PM" next to every Search Console status, plus a "Recheck now (1 request)" link for admins |
| UX-G3 | API key and OAuth secret fields sit next to each other with similar placeholders | Label with examples: "API key: starts with AIza, 39 characters"; "OAuth client secret: starts with GOCSPX-"; inline format check while typing |
| UX-G4 | "Test PageSpeed key" can be pressed repeatedly | Disable for 60 s after a test and show the result with its time |
| UX-G5 | Latest results look current | Heading "Last successful results", per-row "newer attempt failed" badge, a "historical" tag on rows older than 24 h |
| UX-G6 | "Completed" for cache reuses | "Served from cache" with the original Google time |
| UX-G7 | On Connections, "Check the key in Google Connections" points to the same page | Use "Open Credentials in Google Cloud (project 154245030857)" there |
| UX-G8 | OAuth connected vs API enabled vs property selected is spread over two cards | One 5-step checklist: credentials saved ✓ → key format OK ✗ → account connected ✓ → Search Console API reachable (checked 12:40, stale) → property selected ✗ |

Answers for a non-technical user: I can see *that* PageSpeed fails and roughly why, but the suggested cause (invalid/expired/deleted key) points me the wrong way. The Cloud project is identified (number in the link and text). OAuth vs Search Console are distinguishable on Connections only. Historical PageSpeed results aren't clearly marked historical. Retry and Test are explained ("one read-only request" / "one request"). Every failure has a recovery path, but PageSpeed's is misleading in this case.

## F. Tests not performed (and why)
- **Pressing "Test PageSpeed key" or "Retry / Test connection":** both make Google requests and need your authorization.
- **Viewing or comparing the actual key value** ("Show key"): would reveal a credential. The yes/no shape checks were used instead.
- **Search Console property listing/selection; Performance, URL Inspection, Sitemaps fetches:** blocked until Retry.
- **New audits** (to see current-rules structured data and new crops): need approval.
- **Saving credentials, changing Cloud settings, rotating secrets:** your action.
- **Mobile/tablet viewport review:** not repeated in this session (covered by the automated UI audit in TEST_RESULTS.md).

## G. Evidence index
| Ref | What | Where |
|---|---|---|
| G1 | Connections page: integration status, PSI and GSC errors (credentials panel not captured) | screenshot `claude-chrome-screenshots-kv9sLW/screenshot-1793773975834-0.jpg`; http://localhost:3000/google/connections?project=568a8045-37e2-4b2c-b9a6-45be10a63568 |
| G2 | Technical details (admin): GSC `HTTP 403 PERMISSION_DENIED [SERVICE_DISABLED, accessNotConfigured]`; PSI `HTTP 400 INVALID_ARGUMENT [API_KEY_INVALID, badRequest]` | same page, collapsed "Technical details (admins)" |
| G3 | Cloud Console enabled APIs: PageSpeed Insights API (30 req, 0% errors, 24 h), Google Search Console API listed as enabled | console.cloud.google.com/apis/dashboard, project neural-quarter-513607-d5 |
| G4 | Cloud key "WebAudit Pro PageSpeed": created Nov 4 10:05:07 AM; app restriction None; API restriction PageSpeed Insights API | Credentials → API key details (not saved, key not shown) |
| G5 | Saved key shape: length 35, starts with AIza = false, starts with GOCSPX- = true, equal to saved OAuth secret = false | local read-only check (no value printed) |
| G6 | Task log: 3 forced PSI tests at 06:09:33/36/37Z; 11:47 batch with 8 "Completed" cache reuses | `/google` Recent Google requests; read-only DB query |
| G7 | 503 only on interrupted navigations; clean clicks 200; server log without errors | extension network log; in-page fetch log; `%TEMP%/webaudit-run/app.log` |
| G8 | Structured Data `/brian-wheeler/` old-rules double verdict + notice | http://localhost:3000/google/structured-data?project=…&run=b7eb48b8-… |
| G9 | Page sweep: 19 pages HTTP 200; PSI/GSC status on Overview, New Audit, Settings, SEO Overview, PageSpeed, SC Performance, Inspection, Sitemaps; no JS errors on pages checked | in-browser checks |

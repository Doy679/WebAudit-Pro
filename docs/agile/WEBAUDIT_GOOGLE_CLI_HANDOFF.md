# Claude CLI Handoff: Google Integrations (from QA 2026-11-04, 2:20–2:40 PM)

Source: `WEBAUDIT_GOOGLE_INTEGRATION_QA_REPORT.md`. No credentials are included. All tests must mock Google (no live calls); live checks need the user's explicit authorization.

## Not for the CLI: user actions in Google Cloud / WebAudit Pro settings
1. Paste the real API key ("WebAudit Pro PageSpeed", project 154245030857) into WebAudit Pro's **API key** field and save. The saved value is currently an OAuth client secret. Then press Test PageSpeed key **once** (authorized).
2. If the misplaced `GOCSPX-` secret is still active on OAuth client "WebAudit Pro Local", rotate it and save the new secret in the **OAuth client secret** field.
3. Press **Retry / Test connection** once (Search Console API is now enabled), then choose the CHM property.

## Sprint G1: Credential correctness and safety (P1)

### G1-1: Validate credential formats on save and before use (GQA-01, GQA-02)
- **Module:** `server/google/config.ts` (`saveGoogleCredentials`), `server/google/psi.ts` (`runPsi`), `server/google/health-status.ts`, `app/(app)/google/connections/page.tsx`
- **Reproduce:** save `GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxxxxxx` as the API key → accepted; health says "API key rejected" only after a live call.
- **Fix:**
  - API key must match `^AIza[0-9A-Za-z_-]{35}$`;
  - targeted errors for `GOCSPX-` ("this is an OAuth client secret") and `.apps.googleusercontent.com` ("this is a client ID");
  - `runPsi` refuses to call Google with a non-key value;
  - `pageSpeedHealth` reports state `invalid-format` ("Saved value is not a Google API key") without any Google call.
- **Tests:** unit tests for each format; health state for a stored GOCSPX value; `runPsi` makes 0 fetch calls with a bad format.
- **Acceptance:**
  - With the current live data, every PageSpeed status reads "Saved PageSpeed key isn't a Google API key (looks like an OAuth client secret)".
  - Saving an invalid value fails with the targeted message.
  - Existing stored values are not modified.

### G1-2: Broader secret redaction (GQA-02)
- **Module:** `server/google/psi.ts` (`redactKey`), `server/google/gsc.ts` technical detail
- **Fix:** also redact `GOCSPX-[A-Za-z0-9_-]+`, `ya29.[A-Za-z0-9._-]+`, `1//[A-Za-z0-9_-]+` (refresh tokens), and any `key=`/`access_token=` value.
- **Tests:** classifier output never contains these patterns.

### G1-3: "Test PageSpeed key" runs once (GQA-03)
- **Module:** `server/google/service.ts` (`testPageSpeedKey`), `app/google-actions.ts`, Connections page
- **Reproduce:** press Test three times quickly → 3 live requests (seen at 2:09:33/36/37 PM).
- **Fix:** refuse while a test is running or within 60 s of the last test (return the previous result); disable the button with "Tested 2:09 PM: result above".
- **Tests:** mocked fetch, 3 rapid calls → 1 fetch; E2E double-click → one task row.

## Sprint G2: Truthful status and history (P2)

### G2-1: Show status age everywhere; mark stale (GQA-04)
- **Module:** `server/google/gsc-status.ts`, `components/google.tsx` (`GscStatusNotice`), Overview, New Audit, Settings, Search Console tabs
- **Fix:** include `checkedAt` in every rendering; after 30 min add "may be out of date. Retry to check again (one request)". No automatic Google call.
- **Tests:** status older than 30 min renders the hint; fresher doesn't.
- **Acceptance:** each screen shows "checked 12:40 PM" and the stale hint today.

### G2-2: Latest results show newer failures (GQA-05)
- **Module:** `server/google/service.ts` (`latestPsiPerKey`), `app/(app)/google/pagespeed/page.tsx`
- **Fix:** return `newerFailure` (time and kind) per URL+device; heading "Last successful results"; badge "newer attempt failed 2:09 PM (key rejected)".
- **Tests:** ok at T1 and error at T2 → row shows the T1 result plus the T2 failure badge.

### G2-3: "Served from cache" instead of "Completed" (GQA-06)
- **Module:** `server/google/service.ts` (`doPsi`: mark task result `cached`), `googleTasks()` + `/google` Recent requests
- **Fix:** store the outcome on the task (`cached` / `fresh` / `failed`); list shows "Served from cache (Google result 10:19 AM)".
- **Tests:** a cache-hit task renders "Served from cache".

### G2-4: Credential change history (GQA-07)
- **Module:** `server/google/config.ts`, Connections page
- **Fix:** record who and when for each credential save (never the value); show "Key last changed … by …".
- **Tests:** save → timestamp and user shown; value never stored in history.

### G2-5: Connections recovery link (GQA-08)
- **Fix:** on Connections, link to Cloud Console Credentials with `?project=` from the stored error, or anchor to the key field.

## Sprint G3: Guided setup (UX)
- **G3-1:** a 5-step checklist card on Connections (UX-G8), all derived from stored state.
- **G3-2:** field labels with format examples and an inline format check (UX-G3).

## No CLI work (documented)
- **BUG-10 503 on `?_rsc=`:** not reproducible except for navigations interrupted by a newer click in the Claude in Chrome network log; server log clean, page fetch 200. Keep the existing E2E guard; no code change.
- **Structured Data old double verdicts:** approval B2/B4 (fresh audit or display reinterpretation), not a code defect.

## Dependencies and blockers
- G1-1 must land before the user re-saves the key, so a second mis-paste is caught.
- Live verification of G1-3, G2-1 and Search Console flows requires authorized Google requests (Test once, Retry once).

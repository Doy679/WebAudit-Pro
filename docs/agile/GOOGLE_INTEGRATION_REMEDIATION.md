# Google Integration Remediation: Sprints G0–G3 (2026-11-04)

Source: `WEBAUDIT_GOOGLE_INTEGRATION_QA_REPORT.md` (read-only browser QA, 2:20–2:40 PM). Commits `1da9b5b` (server) and `dc170c6` (UI).
Rollback: git tag `pre-google-remediation-2026-11-04` (at `d95cfa2`); database backup `data/backups/pre-google-remediation-2026-11-04/`.
No live Google requests, no credential changes, no Google Cloud changes, no historical data changes. Nothing pushed; the running app (port 3000) is still the old build.

**Verification method:**
- Mocked unit/integration tests on an isolated database.
- Production build + E2E on an isolated database (port 3100).
- A read-only preview of the new build (port 3200) on a **copy** of the real database, viewed in Chrome. No worker ran, and the pages make no Google calls. The live database was confirmed untouched (no new table).

## G0: Safe inspection
- Branch `main`, clean except the two QA reports. 0 unpushed commits at start.
- Baseline: TypeScript clean; 300/300 tests passed.
- Checkpoint tag and backup created before any change.

## Status per finding

### GQA-01 (P1): PageSpeed key field accepted an OAuth client secret: **Verified Fixed** (live app needs restart)
- **Root cause:** `saveGoogleCredentials` stored any non-empty API key; `runPsi` sent whatever was stored.
- **Files:**
  - `server/google/credentials.ts` (new: `checkCredential`, `isGoogleApiKey`, `credentialKind`)
  - `server/google/config.ts`, `server/google/psi.ts`, `server/google/service.ts`, `server/google/health-status.ts`
  - `app/(app)/google/connections/page.tsx`, `components/google.tsx`
  - Overview, Settings and New Audit pages
- **Fix:**
  - Every submitted credential is checked before saving; one bad field saves nothing. Targeted messages cover a GOCSPX secret, a client ID, an empty value, a malformed key, and an API key pasted as the secret. Messages never echo the value.
  - `runPsi` refuses non-key values before any request (`invalid-format`). The Test button checks first too.
  - New health state `invalid-format` ("the saved PageSpeed credential isn't a Google API key … appears to be an OAuth client secret"). It's distinct from `failing` (Google rejected a valid-shaped key) and `untested` (valid shape ≠ accepted by Google).
  - The stored value is kept until an admin replaces it.
- **Tests:** google-remediation 1–5; E2E "GQA-01/G3".
- **Browser:** the preview on real data shows the new status on Overview, Settings, New Audit, SEO Overview, PageSpeed and Connections.
- **Remaining:** the user must paste the real key (GOOGLE_CLOUD_USER_ACTIONS §1).

### GQA-02 (P1, security): secret in the wrong field; narrow redaction: **Verified Fixed** (code); user action pending
- **Root cause:** redaction only knew `AIza…` and `key=`, and nothing stopped a secret from being sent as a key.
- **Files:** `credentials.ts` (`redactSecrets`), `psi.ts`, `gsc.ts` (raw messages, token errors, network errors), `service.ts` (task errors, result rows, connection errors).
- **Fix:**
  - Redacts `AIza…` keys, `GOCSPX-…` secrets, `ya29.…` access tokens and `1//…` refresh tokens.
  - Redacts the `key=`, `access_token=`, `refresh_token=` and `client_secret=` URL parameters.
  - A non-key value is never sent (GQA-01).
- **Tests:** google-remediation G1-3 (three tests).
- **Remaining:** the user should check whether the misplaced secret is still active and rotate it (§2).

### GQA-03 (P2): Test PageSpeed key allowed repeats: **Code Fixed: Browser Verification Pending**
- **Root cause:** each submission queued a forced task, with no lock or cooldown.
- **Files:** `service.ts` (`testPageSpeedKey`, `pageSpeedTestState`, `PSI_TEST_COOLDOWN_MS`), `app/google-actions.ts`, Connections page.
- **Fix:**
  - The lock is taken synchronously in the database. Concurrent submissions share one request; within 60 s the previous result is returned ("No new request sent: a test ran at …").
  - The button is disabled while running, during the cooldown, and while the saved value isn't an API key.
  - The page shows the last test result and time, and when the next test is allowed.
- **Tests:** google-remediation 7 (3 rapid submissions → 1 mocked request) and the cooldown/format tests.
- **Browser:** rendering verified in the preview (test hidden for the invalid key). Clicking the button live needs an authorized Google request, so it wasn't done.

### GQA-04 (P2): stale Search Console status: **Verified Fixed** (status logic); API state Blocked: External (needs Retry)
- **Root cause:** the stored last check was shown without its age outside Connections.
- **Files:**
  - `server/db.ts` (`last_success_at`, `last_failure_at`)
  - `gsc-status.ts` (`checkedAt`, `lastSuccessAt`, `lastFailureAt`, `stale`, `freshness`; `GSC_STALE_MS` = 30 min)
  - `service.ts` (`listProperties` records both times)
  - `components/google.tsx` (`GscFreshness`), Overview, Settings, New Audit, Search Console tabs, Connections
- **Fix:**
  - "Last checked … This status may be out of date. Retry to check again." appears wherever the status is shown.
  - Connections lists last successful and last failed checks.
  - Older checks are not given an invented success time.
  - Nothing contacts Google on page load.
- **Tests:** google-remediation 8 + 2.
- **Browser:** the preview shows "Last checked Nov 4, 2026, 12:40 PM. This status may be out of date…" on all screens checked.

### GQA-05 (P2): PageSpeed results hid newer failures: **Verified Fixed**
- **Files:** `service.ts` (`latestPsiPerKey` → `newerFailure`), `app/(app)/google/pagespeed/page.tsx`.
- **Fix:**
  - Heading "Last successful results"; column "Last successful measurement".
  - A row note reads "Newer attempt failed: <time>: <reason>. The result above is the last successful measurement (…), not a current live result."
  - Old measurements are never replaced.
- **Tests:** google-remediation 9.
- **Browser:** the preview shows the home page (mobile) note "Newer attempt failed: Nov 4, 2026, 2:09 PM: API key rejected".

### GQA-06 (P3): cache reuses shown as "Completed": **Verified Fixed**
- **Files:** `db.ts` (`google_tasks.outcome`, `source_fetched_at`), `service.ts` (`doPsi` returns the outcome; `googleTasks` derives it for older tasks, display only, nothing rewritten), `app/(app)/google/page.tsx`.
- **Fix:** shows "Served from cache: original Google measurement at … No request was sent to Google." and "New Google result" for fresh ones.
- **Tests:** google-remediation 10 + the legacy-derivation test.
- **Browser:** the preview shows 8 entries from 11:47 AM as "Served from cache" with original time 10:19 AM.

### GQA-07 (P3): no credential change history: **Verified Fixed** (tracking from now on)
- **Files:** `db.ts` (`credential_events`), `config.ts` (`credentialHistory`, `lastCredentialChange`; admin only), Connections.
- **Fix:** records the type, action (added, replaced or removed), user and time, never the value.
- **Tests:** google-remediation 11; E2E ("Last change: API key added … by E2E Admin").
- **Remaining:** changes before tracking existed aren't known; the page says so instead of guessing.

### GQA-08 (P3): recovery link reloaded the same page: **Verified Fixed**
- **Files:** `credentials.ts` (`cloudCredentialsUrl`), `health-status.ts` (`knownCloudProject`, `cloudAction`, anchor `#google-credentials`), Connections.
- **Fix:** links go to Cloud Console Credentials with `?project=154245030857` (taken from stored Google errors) and to the key field anchor.
- **Tests:** google-remediation 12.
- **Browser:** the preview link reads "Credentials in Google Cloud (project 154245030857)".

### G3: guided setup: **Verified Fixed**
- **Files:** `server/google/setup.ts` (new), Connections.
- **The five steps:**
  1. Key saved
  2. Format valid
  3. Account connected
  4. Search Console API verified
  5. Property selected
- Each step shows its state (Done / To do / Needs attention / Not verified), its status, the check time, why it matters, and a next-action link.
- Field labels: "Google API key: usually starts with AIza", "OAuth client ID: ends with .apps.googleusercontent.com", "OAuth client secret: typically starts with GOCSPX-". Browser `pattern` checks back up the server checks.
- The old "Integration status" card was replaced (no duplicate status cards).
- **Browser:** the preview on real data shows 1 Done, 2 Needs attention, 3 Done, 4 Needs attention (may be out of date), 5 To do.

## Not changed (as instructed)
- BUG-10 503s: no new reproducible defect; the E2E navigation test still passes.
- Stored structured-data double verdicts, historical CWV results, approvals, permissions.

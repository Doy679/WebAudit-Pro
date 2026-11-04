# Google Integration: CLI Handoff After Sprints G1–G3 (2026-11-04)

## State
- Commits (local `main`, **not pushed**):
  - `1da9b5b`: server, credential checks, redaction, key-test lock, statuses, history, checklist model
  - `dc170c6`: UI, checklist, statuses on every screen, protected key test, E2E
  - The docs commit (this file and its companions) comes next.
- Rollback: tag `pre-google-remediation-2026-11-04`, database backup `data/backups/pre-google-remediation-2026-11-04/`.
- Verification:
  - TypeScript clean
  - 322/322 unit + integration tests
  - Production build OK
  - 30/30 E2E
  - Preview on a copy of real data verified in Chrome
- The running app (port 3000) is the **old build**. New database columns and the table are added automatically on first start (additive migration; existing rows untouched).

## Waiting for the user's approval (don't do without it)
1. **Restart the app** onto the new build (`npm start` after `npm run build`; build into `.next`). Needed before the user re-saves the key, so a second mis-paste is caught.
2. **Push** the commits, one push per commit, oldest first (user preference).

## Waiting for the user (external, see GOOGLE_CLOUD_USER_ACTIONS.md)
1. Paste the real API key ("WebAudit Pro PageSpeed") and save → one authorized **Test PageSpeed key**.
2. Check or rotate the misplaced `GOCSPX-` OAuth secret.
3. One authorized **Retry / Test connection** → choose the CHM property.

## After the user's actions: verification to run
| Check | Expected |
|---|---|
| Checklist step 2 after saving the real key | "Not verified" until the test; "Done" after a successful test |
| Test PageSpeed key pressed twice quickly | One new row in Recent Google requests; second press says "No new request sent" |
| PageSpeed status everywhere | "PageSpeed working (last live request …)" |
| Search Console after Retry | "No Search Console property selected", "Last successful check" set, no stale hint |
| Property selected | Checklist step 5 Done; Search Console tabs can fetch (each fetch is a Google request: approval needed) |

## Known limitations / follow-ups (not started)
- **New Audit warning wording:** for `invalid-format` it says "PageSpeed checks will probably fail". More precise would be "won't be sent". Text-only change.
- **Changes before tracking:** credential changes made before today aren't known (the page says so).
- **Test lock and multiple servers:** the lock lives in the database, so it holds across processes. The "share the in-flight result" behaviour is per process; a second server gets "A test is already running".
- **Stale threshold:** fixed at 30 minutes (`GSC_STALE_MS`). Make it a setting if needed.
- **BUG-10 and structured data:** BUG-10 503s need no work (no reproducible defect). Structured-data old double verdicts still await approval B2/B4.

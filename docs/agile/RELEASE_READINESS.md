# Release Readiness (updated 2026-11-04 after the browser-QA sprint)

| Question | Answer |
|---|---|
| Is the local MVP usable? | **Yes.** Running at http://localhost:3000 with the worker online; all journeys A–I pass end to end. |
| Are all eight original milestones functional? | **Yes**, each verified by automated tests (see QA_TEST_REPORT.md) and the P0 Issues crash is fixed on real data. |
| Are the Google integrations configured and verified? | **No.** Structured data works. PageSpeed, CrUX and Search Console are implemented and tested with mocked responses but **not configured and not verified live** (PB-01, needs your Google Cloud credentials). |
| Remaining P0 issues? | **None known.** |
| Remaining P1 issues? | PB-01 Google live verification (blocked on credentials) · PB-02 accessibility findings dominate "high" severity · PB-03 no Content-Security-Policy · PB-04 deployment hardening. |
| Suitable for internal QA use? | **Yes, with caveats:** treat axe "high" counts as volume rather than priority until PB-02; run on a trusted workstation/LAN; take regular backups (`npm run backup` + copy `data/runs`). |
| What prevents production/client deployment? | HTTPS + reverse proxy and process supervision (PB-04), CSP (PB-03), persistent rate limiting and trusted-proxy config (PB-04), retention/storage controls (PB-05), restore procedure (PB-06), live Google verification (PB-01), session policy/MFA for admins (PB-11). |

## Release checklist for internal use
- [x] `npm run build` and `npm start` (web + worker); sidebar shows "Worker online"
- [x] Admin account; team accounts with least-privilege roles
- [x] Backup created and verified (`data/backups/…`)
- [ ] Off-machine copy of `data/` scheduled
- [ ] Google credentials entered and live checks passed (PB-01)

## After the browser-QA sprint (2026-11-04)
| Question | Answer |
|---|---|
| P1 bugs from the QA report | BUG-03 fixed and verified on real data. BUG-01 fixed in code and tested with mocked Google responses; **live Search Console still blocked** until the API is enabled in Google Cloud (external action). |
| P2/P3 bugs | 22 of the remaining 23 fixed with tests; BUG-10 not reproducible (guarded by an E2E test). |
| Historical data | Unchanged: no audits, findings, PageSpeed rows or fingerprints were deleted or rewritten. Forward-only fixes apply to new audits/imports. |
| Still blocking client deployment | Same as before (HTTPS/hosting, CSP, persistent rate limits, storage retention, restore command), plus live Search Console verification. Not production-ready. |
| Human usability testing | Still not done; automated tests show the flows work, not that non-technical users find them easy. |

# QA Test Report (2026-11-03)

All results below are from runs in this session (Windows 11, Node 26.13, Microsoft Edge via Playwright).

## Automated suites (final run)

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | Pass |
| Unit + integration | `npm test` | **221 passed** (17 files), incl. real worker process and real-browser engine runs against local fixtures |
| Production build | `npm run build` | Pass |
| End-to-end | `npm run test:e2e` | **19 passed** on the final run (after the last code change); the run before it, prior to the JSON report fix, also passed 19/19 |

New this sprint: `test/issues-page.test.ts` (15), `test/account.test.ts` (4), fingerprint stability (1), JSON report size check, E2E "P0 regression", E2E "UI audit".

## UX sprint (2026-11-03, after the UX changes)

| Check | Result |
|---|---|
| Unit + integration | **244 passed** (18 files) · typecheck pass · production build pass · E2E **23 passed** (final run, after the last code change) |
| New unit tests (`test/ux.test.ts`) | quick filters (incl. client-approval state), plain-language explanations (+13 axe rules), saved views (privacy, parameter whitelist), onboarding progress and dismissal, dashboard summaries (scoping), report preview (matches report rules, access check) |
| New E2E | UX 1 dashboard + guide (fresh user, hide persists), UX 2 quick filters + saved view + Back keeps filters + plain summary + technical details, UX 3 custom selected-issues report (preview 2 → JSON with exactly 2), UX 4 Help + collapsed advanced settings; client portal explanation assertions |
| UI audit | 17 pages (adds `/help`) × 320/390/768/1024/1440: **0 overflow, 0 critical/serious axe violations** |
| Real-data walkthrough | Copy of the real database (+ real screenshots, read-only), production build, Edge at 390 and 1440 px: dashboard, Issues (750 findings), High priority, issue detail, New Audit, Reports, Help. All HTTP 200 in 0.6–1.4 s; found and fixed BUG-018 |
| Explanation coverage | 2,640 of 2,640 findings in the real database have a specific plain-language explanation |

## Required regression scenarios (Issues P0)

| Scenario | Where | Result |
|---|---|---|
| /issues without parameters | unit + E2E (Tests 4–6) | Pass |
| All parameters empty (exact failing URL) | unit + E2E P0 + real-data copy (HTTP 200, 0.13 s) | Pass |
| Filter by project / run / category / severity / review / provider | `issues-page.test.ts` | Pass |
| Sorting, search, pagination | unit + E2E P0 | Pass |
| Open issue details | E2E Tests 4–7; real-data copy (largest finding, 0.03 s) | Pass |
| Missing optional evidence / malformed persisted data | `issues-page.test.ts` | Pass |
| Unauthorized project access | unit + E2E Test 13 | Pass |
| Large dataset (2,000 findings, < 100 ms/page) | unit | Pass |
| Empty results / page past the end | unit | Pass |
| Hostile parameters | unit + E2E P0 | Pass |

## User journeys (E2E against local fixture sites)

| Journey | Covered by | Result |
|---|---|---|
| A Admin: login → dashboard → projects → runs → issues → reports | first-run, Test 1, 2–3, 4–6, 8–9 | Pass |
| B Website audit with live progress | Tests 2–3, Bug Test 2 | Pass |
| C Findings: search, filter, detail, screenshot, Current vs Proposed, review | P0 test, Tests 4–7 | Pass |
| D Reporting: Excel + PDF downloaded and validated | Tests 8–9 (+ Red River measurement) | Pass |
| E Client approval | Tests 10–11 | Pass |
| F Re-audit comparison | Test 12 | Pass |
| G Google SEO: status, structured data, missing config | Test 15 | Pass |
| H Security: other project's records and downloads | Test 13, Bug Test 8 | Pass |
| I Crash recovery: worker kill/restart, malformed data | worker integration tests, Bug Tests 6–7, malformed-row tests | Pass |

## UI audit (E2E, 16 pages × 320/390/768/1024/1440 px)
- Horizontal overflow: 7 page-widths before → **0** after.
- axe (WCAG 2.1 A/AA) at 390 and 1440 px: 1 critical + 21 serious before → **0** after.

## Known test notes
- E2E "Test 13" failed once early in the session (assertion not captured); not reproduced in 7 later full runs (BUG-017).
- Two test races were fixed in tests (worker restart observed via attempt count; E2E select by field name).
- Google PSI/Search Console are tested with mocked responses only (no credentials).

## Browser-QA sprint (2026-11-04): exact results

| Check | Baseline (before) | Final (after the last code change) |
|---|---|---|
| TypeScript | Pass | Pass |
| Unit + integration | 244 passed (18 files) | **277 passed** (19 files; new `test/qa-sprint.test.ts` + additions to schema, account, google-service, ux tests) |
| Production build | n/a (previous build) | Pass (separate `.next-qa` folder) |
| End-to-end | 23 passed | **25 passed** (new: BUG-10 navigation 5xx/full-reload guard; BUG-22/23 titles + 404) |
| UI audit (17 pages × 5 widths, axe at 390/1440) | 0 overflow, 0 violations | 0 overflow, 0 critical/serious violations |

One intermediate E2E run failed (UX 3): the BUG-17 `required` bulk-action select blocked "Create report from selected". Fixed (`formNoValidate`) and re-run green.

### Real-data copy measurements (production build, `.tmp/qa` copy, never the live DB)
| Measure | Before | After |
|---|---|---|
| PageSpeed "Latest results", CHM home mobile | 59 (oldest run) | **52** (latest, matches SEO Overview) |
| Re-Audit CHM 3 Nov 3:22 PM → 4 Nov 9:32 AM | New 197, Resolved 40 (false), 827 rows | **New 1**, Resolved 0, Still present 570, Not checked before 180 |
| `/reaudit` HTML | 2,279,222 bytes (QA report) | **150 KB** page 1 (197 ms); 189 KB page 3 |
| Quick-filter counts (1,477 findings) | n/a | 8.7 ms (one query) |
| Other pages | n/a | `/` 46 KB 119 ms · `/issues` 294 KB 159 ms · `/audits` 34 KB 38 ms · PageSpeed 59 KB 42 ms · Reports 33 KB 26 ms |
| BUG-10 `?_rsc=` navigation (Edge, Chrome) | QA: 15/20 prefetches 503 | 0 × 5xx in 61 requests; not reproduced |

### Disclosure: unapproved Google requests during testing
While checking pages on the real-data copy, opening **Google Connections** made live read-only Google calls (OAuth token refresh + Search Console `sites.list`), because that page lists properties on load and the copy holds the saved connection. This happened on about three page loads (BUG-10 browser reproduction runs and the final size check). No PageSpeed, CrUX or URL Inspection calls were made; nothing was changed at Google; results were written only to the copy. Outcome recorded on the copy: `HTTP 403 PERMISSION_DENIED [SERVICE_DISABLED, accessNotConfigured]` for Google Cloud project 154245030857, classified by the new code as **"Search Console API not enabled in Google Cloud"**. This confirms the BUG-01 fix against Google's real response; Search Console itself remains blocked until the API is enabled.
Follow-up (backlog): QA/test servers should run with Google calls disabled by default.

### Not verified
- Search Console Performance, URL Inspection and Sitemaps with real data (API disabled).
- Real-user usability testing.
- E01–E24 screenshot evidence (not on this PC).

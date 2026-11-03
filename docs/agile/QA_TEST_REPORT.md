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

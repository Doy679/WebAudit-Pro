# Test Results: Sprint 6 (2026-11-04)

All numbers are from runs in this session (Windows 11, Node 26.13, Microsoft Edge via Playwright). No live Google requests were made by tests (fetch mocked). Mutating tests used isolated temporary databases and local fixture sites.

## Final run (after the last code change, commit a507fbb)

| Check | Baseline (start of Sprint 6) | Final |
|---|---|---|
| TypeScript | Pass | **Pass** |
| Lint | Not configured | Not configured |
| Unit + integration | 277 passed (19 files) | **296 passed (21 files)** |
| Production build | Pass | **Pass** (separate `.next-qa` folder) |
| End-to-end (Playwright, isolated) | 25 passed | **29 passed** |
| Responsive + accessibility audit (17 pages incl. /review × 320/390/768/1024/1440; axe at 390/1440) | 0 overflow, 0 violations | **0 overflow, 0 critical/serious violations** |
| CSP report-only (all sidebar + Google tabs) | n/a | **0 violations** |

New tests: `test/sprint6.test.ts` (PageSpeed classification and health incl. cache hits and key change, Test key confirmation, queue dedupe for the 11:47 pattern, CrUX scope and dry run, project references, review queue incl. 20 classifications, undo, grouped review and permissions, status words, crop source), `test/line-height.browser.test.ts` (real-browser line-height conversions), schema guard (empty verdict → finding), engine integration (empty datePublished; zero-size broken image crop), E2E (prefetch/background requests, review queue by keyboard, account management, live report preview, Structured Data summary, cancelled-run header).

Intermediate failures, all fixed and re-run:
- Engine integration suite crashed: the new "empty" structured-data verdict had no finding mapping (product bug, fixed in efcb5cc).
- E2E "worker stale": heartbeat 5 s vs E2E stale threshold 4 s (test setup; heartbeat now configurable, 1 s in E2E).
- UI audit: `<dl>` with a direct `<span>` child in the new status words (a11y regression, fixed).
- Structured Data summary test assumed a type order (test fixed).

## Browser verification on a copy of the real database (no Google requests)

| Item | Result |
|---|---|
| NEW-01 status on Overview, Connections, SEO Overview, PageSpeed, New Audit, Settings | All show "PageSpeed: last live request failed: API key rejected (Nov 4, 2026, 11:47 AM)" |
| NEW-02 Cloud Console link | Contains `?project=154245030857` |
| NEW-07 Help | Has "API key rejected" troubleshooting |
| BUG-05 CWV-0011 | "Data scope: Whole website (origin-level measurement)" |
| BUG-10 Edge: Overview + Issues loads | 0 `?_rsc=` requests, 0 failed/aborted, 0 × 5xx; Help/Reports/Overview clicks arrive in 150–330 ms, 0 full reloads |
| BUG-11 | Issue page shows `CHM-CNT-0001` |
| BUG-12 | Stored results labelled "Checked with rules 2026-11-03" + explanation |
| BUG-19 CNT-0001 | Opens the 768 px screenshot with the image slot outlined; note "isn't displayed at 320, 390px" |
| BUG-21 never-started audit | "never started" / "Never started" |
| Page sizes | Overview 47 KB · Issues 286 KB · Structured Data **401 KB (still large; NEW-06 open)** · Re-Audit 175 KB · Review Queue 33 KB |

## Not tested (and why)
- Live "Test PageSpeed key" and "Retry / Test connection" (Google requests need approval; key currently rejected; Search Console API disabled).
- Live PageSpeed double-submit against Google (verified with mocks).
- A fresh live audit of CHM to regenerate evidence (needs approval).
- My Websites "finished" label, UX-10 link switcher, "Technical SEO" label: code-level only.
- Real-user usability sessions.

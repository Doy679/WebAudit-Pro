# Bug Register

Severity: S1 crash/data/security · S2 broken feature or wrong data · S3 degraded UX · S4 cosmetic.
Status: Fixed & verified · Open · Won't fix. "Fixed & verified" means a regression test exists and passed.

| ID | Title | Module | Pri | Sev | Root cause | Fix / evidence | Status |
|---|---|---|---|---|---|---|---|
| BUG-001 | `/issues` crashes ("Something went wrong", digest 542859302) | Issues | P0 | S1 | Filter form's `select()` added an "All" option (`value=""`) to **Sort by**; `sp.sort ?? "severity"` kept `""`; `SORTS[""]` → `ORDER BY undefined` → SQLite `no such column: undefined` | Whitelist parser `server/issue-filters.ts`, safe sort fallback in SQL builder, no "All" on Sort. Reproduced and verified on a copy of the real DB (HTTP 200, 0.13 s, 1,380 findings). Tests: `test/issues-page.test.ts`, E2E "P0 regression" | Fixed & verified |
| BUG-002 | One malformed stored finding could crash list/detail/filters | Issues | P1 | S1 | `JSON.parse` on every row; `json_each` on invalid JSON throws | `safeJson`, `jsonArray`; rows flagged `dataWarning` | Fixed & verified |
| BUG-003 | Issue fingerprints unstable between identical audits (94% on CHM) | Engine / Re-audit | P1 | S2 | axe selectors used ids generated per page load by SmartMenus (`#sm-<timestamp>-N`) | 8+ digit runs normalized in fingerprints; re-measured on stored CHM data: 606/606 stable. Test in `engine-v2.test.ts` | Fixed & verified |
| BUG-004 | Audit quality score computed from first 1,000 findings only | Audit results | P1 | S2 | Audit page used `listIssues(pageSize: 1000)` | `runScoreInputs` (all rows, minimal columns). Test with 2,000 findings | Fixed & verified |
| BUG-005 | Client release list silently capped at 1,000 findings | Approvals | P1 | S2 | Same 1,000-row listing | `releasableIssues` (no cap). Test | Fixed & verified |
| BUG-006 | 143 Red River findings have highlight boxes but no annotated crop | Evidence | P2 | S3 | Hard cap of 500 crops per audit | Cap 3,000 (env `WEBAUDIT_MAX_ANNOTATED`). Existing Red River run keeps its crops; new audits get all | Fixed (applies to new audits) |
| BUG-007 | Quick edits after switching project on New Audit could be wiped | New Audit | P2 | S2 | `router.replace` caused a server re-render that remounted the form (intermittent E2E failure) | `history.replaceState` (no round-trip). E2E Bug Tests 1–2 | Fixed & verified |
| BUG-008 | App's own accessibility: 1 critical + 21 serious axe violations | UI | P1 | S2 | slate-400/500 text 2.6:1 / 4.4:1; on-navy accent 3.96:1; link inside `role=tablist` | Theme greys darkened, `accent-300` on navy, tablist fixed. UI audit E2E: 0 violations | Fixed & verified |
| BUG-009 | Horizontal scrolling on Re-Audit (320–1024px), Structured Data and Google Connections (phones) | UI | P2 | S3 | Unbroken URLs in grid cells, table without scroll container, long `<code>` | `min-w-0`/`break-all`, `overflow-x-auto`. UI audit E2E: 0 overflow on 16 pages × 5 widths | Fixed & verified |
| BUG-010 | JSON report 9.2 MB for 750 findings | Reports | P2 | S3 | Raw DB JSON columns copied as strings next to parsed values | Dropped; 2.35 MB (−74%). Test in `reports.test.ts` | Fixed & verified |
| BUG-011 | No way to change or reset a password | Auth | P1 | S2 | Not implemented | Change password (signs out other sessions), admin reset (signs user out). `test/account.test.ts` | Fixed & verified |
| BUG-012 | No backup capability | Ops | P1 | S2 | Not implemented | `npm run backup` / Settings (SQLite `VACUUM INTO`, integrity-checked). Verified on real DB | Fixed & verified (DB only) |
| BUG-013 | Error page showed raw "Server Components render" text | UI | P3 | S3 | `error.tsx` printed `error.message` | Friendly message + digest reference | Fixed |
| BUG-014 | Toggling own account threw an unhandled error | Settings | P3 | S3 | `throw` in a plain form action | Ignored server-side (UI never offers it) | Fixed |
| BUG-015 | Wrong project audited after switching projects | New Audit | P0 | S1 | Hidden project id fixed at page load | Fixed 2026-11-03 (earlier sprint), E2E Bug Tests 1–3 | Fixed & verified |
| BUG-016 | Audits appeared stuck in Pending | Worker | P0 | S2 | Single-audit queue without status/heartbeat visibility | Fixed 2026-11-03 (earlier sprint), worker integration tests | Fixed & verified |
| BUG-017 | E2E "Test 13" failed intermittently | Tests | P3 | S4 | Reproduced 2026-11-03 (line 331): the test counted the "Not found" heading right after `goto`, but Next.js can stream the not-found boundary in after the load event | Test now waits for the heading and asserts no issue content is rendered | Fixed & verified |
| BUG-018 | Issue detail 594 px wide on a 390 px phone (real Red River data) | Issues | P1 | S3 | Page grids had no column template below `xl`, so the implicit column grew to the longest unwrapped URL in "Affected pages"; fixture data has short URLs, so automated tests missed it | `grid-cols-1` (minmax(0,1fr)) on the three two-column page grids | Fixed & verified (real-data walkthrough) |
| BUG-019 | "Bug Tests 6–7" checked the sidebar worker status without reloading | Tests | P3 | S4 | Sidebar status is server-rendered on navigation | Reload before asserting | Fixed & verified |
| BUG-020 | Worker help text told users to run `npm run dev` / `npm run worker` | Worker UI | P2 | S3 | Text written for development | Now says `npm start` and that queued audits are kept | Fixed |

---

## Browser QA 2026-11-04 (source: `browser_qa_2026-11-04/WEBAUDIT_BUG_REGISTER.md`)

Verification: **Verified** = reproduced from code and stored data (copy of the real database, never the live file) · **Not reproduced** = tried and could not trigger. "Forward-only" = applies to new audits/imports; stored history is unchanged (changing it needs approval).

| ID | Pri | Status | Verification and root cause (confirmed in code/data) | Fix | Tests | Commit |
|---|---|---|---|---|---|---|
| BUG-01 | P1 | **Fixed** (live check blocked) | Verified: `gsc.ts` mapped every HTTP 403 to "no permission for this property", including `SERVICE_DISABLED` / `accessNotConfigured` | `classifyGoogleError` (api-disabled, permission, auth, quota, network, transient); Retry / Test connection; admin fix steps; raw Google text admin-only; property list only after a successful listing | `qa-sprint.test.ts` BUG-01 (3) | 8700119 |
| BUG-02 | P2 | **Fixed** | Verified: six screens derived status from different fields | `searchConsoleStatus()` from saved data only, on Overview, Connections, SEO Overview + health cards, Search Console / Inspection / Sitemaps, New Audit, Settings | BUG-02 state walk-through | 8700119 |
| BUG-03 | P1 | **Fixed & verified on real data** | Verified: `new Map()` over a newest-first list kept the oldest row per URL+device | Shared `latestPsiPerKey`; CHM home mobile now 52 (latest), was 59 (first) | 3 tests | 88c7ee2 |
| BUG-04 | P2 | **Fixed** | Verified from tasks: form submitted 12× in 49 s (2× with skip cache) → 120 tasks; only 30 real Google calls, 90 cache reuses each stored as a new row ("12 runs") | In-flight dedupe per URL+device; cache reuse stores no duplicate row for the same context; History counts distinct measurements. No rows deleted | 2 tests + updated cache test | 629ec2e |
| BUG-05 | P2 | **Fixed (forward-only)** | Verified: on all 5 pages the "URL-level" CrUX values equal the origin values exactly; parser ignored PageSpeed's `origin_fallback` | Honour `origin_fallback`; whole-site data → one finding per metric+device "(whole site)". Existing 40 CWV findings unchanged (re-import needs approval) | 2 tests | 0287c22 |
| BUG-06 | P2 | **Fixed** | Verified: summary used the mobile result only | Separate mobile / desktop real-user lines, each labelled "this page" / "whole site" | 1 test | 0287c22 |
| BUG-07 | P2 | **Fixed & verified on real data** | Verified: "New" ignored base-audit coverage | "Not checked before" status from what the base audit actually recorded. CHM 3 Nov → 4 Nov: New 197 → 1 | 2 tests | 05cf366 |
| BUG-08 | P2 | **Fixed for matching** (no history rewrite) | Verified: base audit fingerprinted before the 3 Nov normalisation; `sm-<timestamp>-n` ids broke matches | Compare-time match key recomputed from stored rule/selector/page; false "Resolved" 40 → 0. Stored fingerprints untouched | 1 test | 05cf366 |
| BUG-09 | P2 | **Fixed** (size check pending) | Verified: all 827 rows + images in one response | 50 rows/page, images only for the first 10, evidence only for rows on screen | E2E Test 12 | 05cf366 |
| BUG-10 | P2 | **Not reproduced** | 0 × 5xx in 61 `?_rsc=` requests (Edge + Chrome, real-data copy, prod build); no 503 code path in Next.js or the app; QA-time server log has no 503 | Regression guard: E2E fails on any 5xx or full reload while clicking every sidebar link and Google tab | E2E BUG-10 | d659abc |
| BUG-11 | P2 | **Fixed** (display only) | Verified: codes restart per website | Website named in the ID cell when the list mixes websites. No ID migration | 1 test | 6630fc9 |
| BUG-12 | P2 | **Fixed (forward-only)** | Verified in `validate.ts`: `""` failed presence + type checks; type error on a recommended property blocked eligibility | One verdict per property (missing / empty / invalid); optional invalid → warning; rules version 2026-11-04 | 4 tests | f23ac82 |
| BUG-13 | P3 | **Fixed** | Verified: count included pages with zero items | Count pages with ≥1 item (+ "Pages checked"); empty pages say so | 1 test | f23ac82 |
| BUG-14 | P2 | **Fixed** | Verified: fixed engine category list | Categories (with counts) from the selected audit, incl. Performance and Core Web Vitals | 1 test | f6bab78 |
| BUG-15 | P3 | **Fixed** | Verified | Generate disabled with explanation at 0; server rejects empty reports | 1 test | f6bab78 |
| BUG-16 | P3 | **Fixed** | Verified | Multi-category `types` filter; each card opens its own categories; accessible names "Open Accessibility findings (n)" | 1 test | 09cbbb1 |
| BUG-17 | P3 | **Fixed** | Verified | "Choose an action…" default (required); server needs action + rows, confirmation above 10 | 1 test | e17ccf1 |
| BUG-18 | P3 | **Fixed** | Verified | Buttons per classification with one-line explanation | 1 test | e17ccf1 |
| BUG-19 | P3 | **Fixed (forward-only)** | Verified from evidence: CNT-0001's box is 0×0 at (0,0), i.e. the image isn't laid out at all | Elements <4×4 px with a real position get a 56 px ring + caption; unpositioned elements get no misleading crop and the viewer explains why | 1 test + render check on a copied screenshot | 9192097 |
| BUG-20 | P3 | **Fixed** | Verified: "Started" showed queue time; activity used finish time unlabelled | Queued / Started / Finished / Duration; labelled "finished" vs "queued" | 1 test | 5bc6b8e |
| BUG-21 | P3 | **Fixed** | Verified: records were consistent (2 cancelled while queued, 1 after 22 s with 109 raw findings) but unexplained | Cancellation note (who/when/what was kept), `cancelled_by` stored for new cancellations, one pages format | 1 test | 5bc6b8e |
| BUG-22 | P3 | **Fixed** | Verified | Descriptive titles on issue/audit/project pages | E2E | 036a2ec |
| BUG-23 | P3 | **Fixed** | Verified | Branded root 404 with Overview/Issues/Help | E2E | 036a2ec |
| BUG-24 | P3 | **Fixed** | Verified: 20-page CHM audit took 16 m 28 s | Estimate from this installation's audits (median s per page per screen size) in Help and New Audit | 1 test | 33716a7 |
| BUG-25 | P3 | **Fixed (forward-only)** | Verified from evidence: real computed value on a 668×1 px spacer `<p>`; false positive, not a parser bug | Skip elements shorter than half a line; ratios < 0.5 → Needs review | 3 tests | 1341e0d |

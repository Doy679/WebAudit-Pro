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
| BUG-017 | E2E "Test 13" failed once (assertion not captured) | Tests | P3 | S4 | Unknown, likely timing | Not reproduced in 7 later full runs; watch | Open (monitor) |

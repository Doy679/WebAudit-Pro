# Retest Bug Tracker (Sprint 6, 2026-11-04)

Baseline: `browser_qa_2026-11-04/WEBAUDIT_FINAL_RETEST_REPORT.md` (retest 12:30–12:45 PM). Original evidence is not overwritten.
**"Verified on copy"** = checked in a real browser (Edge, production build) against a copy of the real database, with no Google requests and no changes to the live data.

Important context: the 11:27 audit and the 11:47 PageSpeed requests were processed by the app/worker started at 09:07 (pre-Sprint-5 code); the fixed app went live at 12:02. Several retest failures were old results produced by old code, but each was re-checked rather than assumed.

| ID | Retest | Sprint 6 status | Root cause / reason | Fix (commit) | Evidence |
|---|---|---|---|---|---|
| NEW-01 | P1 new | **Verified Fixed (on copy)**; live key **Blocked: external configuration** | Panels read "configured" plus a success timestamp written only on success; failures were never surfaced. At 11:47 only /gbg-team/ reached Google (6×, HTTP 400 "API key" = invalid/expired/deleted key [Likely]); 24 other "completed" requests were cache reuses | `pageSpeedHealth()` from stored fresh results; error classifier; panels on 7 screens; admin "Test PageSpeed key" with confirmation; Connections no longer calls Google on load (bb19122) | Copy: Overview, Connections, SEO Overview, PageSpeed, New Audit, Settings all show "PageSpeed: last live request failed: API key rejected (Nov 4, 2026, 11:47 AM)"; "Last successful request: 10:19 AM". Unit tests: rejection, disabled API, restrictions, quota, network, cache hit, key change |
| NEW-02 | P3 | **Verified Fixed (on copy)** | Link had no project | `?project=154245030857` from Google's error (bb19122) | Copy: link present |
| NEW-03 | P3 | **Verified Fixed** | = BUG-21 | — | see BUG-21 |
| NEW-04 | P3 | **Verified Fixed (E2E)** | = BUG-15 | — | see BUG-15 |
| NEW-05 | P3 | **Code fixed: browser verification pending** | Two labels for the same category | "Technical SEO" everywhere (20beb98) | Typecheck, UI audit render |
| NEW-06 | P3 | **Still open** | Large pages | Not reduced: `/issues` 286 KB (retest 294 KB); `/google/structured-data` **401 KB (was 355 KB; grew with the new summary)** | Measured on copy |
| NEW-07 | P3 | **Verified Fixed (on copy)** | Missing Help entry | Help troubleshooting entries for key rejected / restricted / API disabled (bb19122) | Copy: Help contains the text |
| BUG-01 | ✅ | Verified Fixed (retest) | — | — | Retest R04 |
| BUG-02 | ✅ (Overview vague) | **Verified Fixed (on copy)** | Overview used its own wording | Overview shows the shared Search Console and PageSpeed statuses (bb19122) | Copy |
| BUG-03 | ✅ | Verified Fixed (retest) | — | — | Retest R02/R03 |
| BUG-04 | 🟡 | **Code fixed: verified with mocked Google; live check needs approval** | 3 submissions in 12 s; the in-flight check didn't cover URLs that had just finished | Queue skips URL+device queued/running or measured within 6 h unless "skip cache"; message explains (78d1349) | Unit: the 11:47 pattern queues 4, not 12; skip-cache once; no Google call |
| BUG-05 | ❌ | **Partially Fixed: history Ready, awaiting approval** | Stored "page" CrUX values identical to site values (origin fallback); fixed importer only affects new results | Issue pages say "Data scope: Whole website (origin-level measurement)" + pages repeating it (aa8e7d2); dry-run report | Copy: CWV-0011 shows the scope. Dry run: High 47→31 (9:32 audit), 42→30 (11:27 audit), awaiting approval |
| BUG-06 | ✅ | Verified Fixed (retest) | — | — | — |
| BUG-07 | ✅ | Verified Fixed (retest) | — | — | — |
| BUG-08 | 🔵 | Likely Fixed (unit tests for volatile ids) | — | — | Retest indirect |
| BUG-09 | ✅ | Verified Fixed (retest) | — | — | 175 KB on copy |
| BUG-10 | 🟡 | **Verified Fixed (mitigation; on copy + E2E)**; QA-tool 503 cause unproven | Server log for the retest window has no errors; no 503 path in Next.js/app; in Playwright prefetches return 200 then are aborted by the router. 19 background renders per Overview were unnecessary anyway (all pages per-user dynamic) | Prefetch off by default via `AppLink` (3d78860) | Copy, Edge: Overview + Issues loads make 0 `?_rsc=` requests, 0 failed, 0 5xx; clicks navigate client-side in 150–330 ms, 0 full reloads. E2E repeated |
| BUG-11 | 🟡 | **Verified Fixed on issue pages (copy)**; export column unit-level | Codes restart per site | `CHM-CNT-0001` references: issue page, mixed lists, Excel last column, JSON (f8f5e95) | Copy: reference shown |
| BUG-12 | ❌ | **Code fixed + verified on a fresh audit (E2E)**; stored results **Ready, awaiting approval** | Retest saw results checked with old rules (2026-11-03) while the page printed the current version. Also found and fixed a **crash**: the new "empty" verdict had no finding mapping, so a new audit of a page with an empty value would fail (efcb5cc) | One verdict per property; per-result rules version + explanation for old results | E2E fixture `datePublished: ""`: one "is empty", no "wrong type", Article not "Not eligible". Copy: "Checked with rules 2026-11-03" + notice |
| BUG-13 | ✅ | Verified Fixed (retest) | — | — | — |
| BUG-14 | ✅ | Verified Fixed (retest) | — | — | — |
| BUG-15 | 🟡 | **Verified Fixed (E2E)** | Preview only refreshed on click | Live preview; Generate disabled while stale/loading; server rejects empty (ffcea28) | E2E stale → refreshed sequence |
| BUG-16/17/18 | ✅ | Verified Fixed (retest) | — | — | — |
| BUG-19 | ❌ | **Verified Fixed (on copy, stored evidence)** + new audits (engine test) | Crops always used the first width (320 px); CNT-0001 is hidden on phones (0×0 at 0,0) but 238×30 at 768+ | Crop from the first width that shows the element; viewer skips misleading old crops and explains (a507fbb, ddfa983) | Copy, Edge: CNT-0001 opens at 768 px with the image slot outlined and "isn't displayed at 320, 390px" |
| BUG-20 | ✅ (polish) | **Code fixed: browser verification pending** | My Websites showed the queue time | "Last audit finished…" (20beb98) | — |
| BUG-21 | 🟡 | **Verified Fixed (on copy + E2E)** | Detail header printed the queue time as "started" | queued / started or "never started" / cancelled; elapsed only when started (a82d937) | Copy: c4bb683b shows "never started" / "Never started" |
| BUG-22 | ✅ (Overview) | **Code fixed** (Overview title); others verified | — | "Overview · WebAudit Pro" (20beb98) | E2E titles |
| BUG-23/24 | ✅ | Verified Fixed (retest) | — | — | — |
| BUG-25 | ❌ suspected false positive | **Verified: measurement correct; finding is legitimate** | Real-browser test: normal/%/unitless/px/inherited all convert correctly; 1.4 px is what the browser uses; the crop shows visible text painted outside a 1 px box. My Sprint 5 rule that would have dropped it was **reverted** | Kept as recommendation, medium, with an overlap explanation (a4f0901) | `test/line-height.browser.test.ts`; crop TYP-0021 |

## UX items

| ID | Status | Evidence |
|---|---|---|
| UX-03 Review Queue | **Verified Fixed (E2E)** | 20 fixture findings classified by keyboard without visiting /issues; progress persists; Undo works (b8cd692) |
| UX-02 Status vocabulary | **Verified (display only)** | Issue page + list show Detected as / Team review / Client / Fix. Stored values and exports unchanged |
| UX-12 Structured Data summary | **Verified Fixed (E2E)** | Summary by type, repeated issues, errors-only filter, collapsible pages (f703a23) |
| UX-19 Team accounts | **Verified Fixed (E2E)** | Role change (user signed out), disable/enable (can't sign in), reset password; own row protected. Last sign-in not tracked, so not shown |
| UX-10 Website selection | **Code fixed: browser verification pending** | ≤6 websites shown as links on Google pages |
| UX-06 Live preview | **Verified Fixed (E2E)** | = BUG-15. Client PDF default needs approval |
| UX-05 Merge near-duplicates | **Ready: awaiting approval** | Changes High counts |
| UX-07 Client preview | **Not started** | Approval tokens are stored hashed, so a preview needs its own internal route |
| UX-01 Guided Google setup | **Partially** | Status, Retry, Test key, fix steps; no 5-step checklist card |

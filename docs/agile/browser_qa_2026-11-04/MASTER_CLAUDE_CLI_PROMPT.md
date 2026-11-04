# WEBAUDIT PRO — VERIFIED QA FINDINGS TO FULL AGILE IMPLEMENTATION

## Mission

Act as the senior engineering lead, Next.js/TypeScript developer, QA automation architect, accessibility and UX specialist, security engineer, and Agile delivery lead for the **existing** WebAudit Pro application.

Project root: `C:\Users\PC\Desktop\Audit Automation`  
Local application: `http://localhost:3000`

**Your task is to use the attached November 4 browser QA evidence to diagnose actual root causes, fix defects, improve the complete user journey, and verify the results with tests and browser rechecks.** Do not rebuild the app, discard the successful engine, or merely write an advisory report.

The Browser Extension audited **read-only** and did **not inspect source code**. Treat its findings as observations, not source-level root-cause proof. Some findings are partially verified or suspected. Treat code paths in the handoff as pointers to search, not known facts. Recheck current status before making changes, as fixes may already have been applied.

### Source of truth

Read these four reports **fully**, before implementation:

- `docs/agile/browser_qa_2026-11-04/WEBAUDIT_BROWSER_QA_REPORT.md`
- `docs/agile/browser_qa_2026-11-04/WEBAUDIT_BUG_REGISTER.md`
- `docs/agile/browser_qa_2026-11-04/WEBAUDIT_UX_IMPROVEMENTS.md`
- `docs/agile/browser_qa_2026-11-04/WEBAUDIT_CLI_HANDOFF.md`

The reports cite screenshot evidence `E01–E24`. **Check whether the evidence directory actually exists locally**; it is not part of this prompt package. Never invent missing screenshots or claim you saw them. Consult current code, existing tests, audit artifacts, logs, and reproducible UI behavior as stronger evidence for source-level changes. If one report duplicates another, reference the same issue ID rather than counting it twice.

## Current context from the QA report

- Two projects: **Capital Home Mortgage** and **RedRiverModularHomes**.
- At observation time: CHM had seven audits; latest CHM run had 20 scanned pages and 727 grouped findings. RRMH had one 80-page run and 750 grouped findings. **1,477 findings combined**, no internal reviews, reports, or approval packages had been created at that time.
- The core browser audit engine and worker were operational on saved runs; they must stay operational.
- Main observed gaps: 25 bug entries, 20 UX improvement entries; two P1 bugs (BUG-01, BUG-03). Other findings include partially verified and suspected issues.
- Google OAuth was connected, PageSpeed had data, but Google Search Console property listing was blocked by Google's `SERVICE_DISABLED` / API-not-enabled response for Google Cloud project `154245030857`. **OAuth success does not imply Search Console API access.** Do not infer property permissions until the API is usable.
- The extension avoided state-changing workflows. Treat report exports, account mutations, approvals, fresh scans and external Google calls as **not yet verified end to end**.

## Operating rules / approval boundaries

1. Preserve all existing audit runs, findings, screenshots, reports, project data, client approvals, Google integration settings, credentials, and review histories. Never delete/merge records or silently rewrite past evidence.
2. Before editing: inspect repository status, ongoing processes and Git history; make a non-destructive backup of database **and relevant data/runs and data/exports artifacts**, verify its paths, then create an appropriate Git checkpoint without overwriting unrelated changes. Do not commit `.env.local`, tokens, credentials, or audit data.
3. Preserve original 8 MVP capabilities: audit engine; dashboard/projects; URL-to-audit; persistent progress; screenshots/evidence; Current-vs-Proposed review; Excel/PDF exports; secure client approval/re-audit. Preserve optional Google integrations and the user-friendly UX improvements already made.
4. **External sites are read-only.** No WordPress/Elementor edits, website changes, form submissions, purchases, password entry on targets, unauthorized scanning, or sending client communications. Restrict crawl targets to authorized domains, and preserve SSRF protections.
5. Run mutation/integration/E2E tests in isolated fixture database and localhost test site. Do not create live audits or PageSpeed/CrUX/Search Console requests without explicit approval; mock external APIs for default tests and use cached results for inspection.
6. Never reveal keys, OAuth secrets, tokens, cookies, passwords, or complete provider credentials in logs, console output or reports. The OAuth client secret was previously exposed in a screenshot: **verify only whether rotation was completed, without printing it**. If not rotated, flag as a security action for the account owner.
7. Get explicit approval **before**: altering historical severity/counts/score or client-facing reports; re-importing/merging origin-level CrUX findings; re-fingerprinting or migrating historical issue IDs; deleting duplicate PSI history; changing report defaults/status vocabulary if existing exports or links depend on them; deploying CSP that may break the app; using external APIs/quotas; changing Google Cloud settings; any data-destructive operation. A safe forward-only code fix with tests may proceed, but preserve historical data until approved.
8. **Google Cloud API enablement is an external user action**, not a source-code bug fix. The in-app error classification, retry UX, and status consistency ARE code fixes. Do not say GSC is fixed end-to-end until `sites.list`/property selection actually succeeds with authorized access.
9. No fabricated timings, accessibility compliance, source analyses, test runs, screenshots, or external API data. Report partial completion and blockers truthfully.

## Agile work plan — implement iteratively

Create/update `docs/agile/PRODUCT_BACKLOG.md`, `BUG_REGISTER.md`, `SPRINT_BOARD.md`, `QA_TEST_REPORT.md`, `UX_IMPROVEMENTS.md`, and `RELEASE_READINESS.md`. Link your work items to the source **BUG-xx** and **UX-xx** IDs. Track: evidence, verification level, root cause (or hypothesis), user impact, priority, story points, status, files, acceptance criteria, tests and any approval dependency.

### Sprint 0 — Establish baseline and reproduce

- Read all four reports. Inspect actual repo architecture (`package.json`, routes, data access, worker, Google adapters, exports, tests), state of Git and production/dev startup; do not presume files exist at suggested paths.
- Verify saved CHM/RRMH record counts without altering them. Document current app/worker health and which older observations still reproduce.
- Reproduce BUG-03, BUG-01/02, and BUG-10 first using stored data and local browser/server logs. Capture safe error details (status codes, sanitized stack trace, SQL query shape) without secrets.
- Run existing typecheck, unit/integration tests, E2E and production build to establish an initial baseline. Keep results exact.
- Create prioritized backlog and a first sprint plan. Begin code fixes rather than stopping at documentation.

### Sprint 1 — High-priority correctness and stability

**BUG-03 (P1): PageSpeed “Latest results” selects the oldest result.**
- PageSpeed table showed CHM home mobile **59 / LCP 9.0s** at **10:07**, while SEO Overview and SEO History showed latest **52 / 6.3s** around **10:15**.
- Find the exact selection/query logic. Implement a deterministic most-recent completed result per normalized URL **and device/strategy**, handling identical timestamps with a stable tie-breaker; share this selector between PageSpeed, SEO Overview, History and exports where applicable.
- Unit-test three runs per URL/device and compare all relevant screens using stored data. Do not present 59 as latest when 52 is the latest saved result.

**BUG-01 (P1) + BUG-02 (P2): Search Console error semantics and inconsistent states.**
- Google returned an API-disabled/not-used response, yet WebAudit Pro said “Your account doesn't have permission for this property.” No actionable retry or property dropdown; six screens disagreed about state.
- Implement structured Google error classification: `SERVICE_DISABLED`/`accessNotConfigured`, property `PERMISSION_DENIED`, unauthenticated/expired credentials, quota, network errors, and transient failures. Do not collapse all 403s into permission errors.
- Create one shared status model: credentials absent → OAuth client configured → account connected → API disabled/error → no matching property → property selected/ready. Expose accurate plain-English next action and admin-only technical details.
- Add a safe “Retry/Test connection” control that checks an authorized read-only API call without exposing tokens; respect quotas. Show a property selector when `sites.list` actually succeeds. If external API still disabled, show external action required and mark real-data verification blocked.
- Add integration tests for status consistency across Overview, Google Connections, SEO Overview, Search Console, New Audit, Settings, and connected-property display.

**BUG-10 (P2, systemic symptom): React Server Component navigation `?_rsc=` returned 503.**
- Browser QA observed 15/20 prefetch failures and click navigation 503s; manual `fetch()` with simulated headers returned 200. Cause unknown.
- Reproduce in browser at current app version, correlate request timing with server and worker logs, middleware, Next.js build state, DB locks/busy errors, and process startup. Fix only the proven cause. Do not mask 503 or force full reloads as “solution.”
- Add E2E assertion that navigating all sidebar and Google tabs has no 5xx, and note any legitimate transient conditions.

**Exit criteria:** actual core routes work, metric sources agree, Search Console errors are truthful with a recovery path, 503s resolved or clearly classified with tested blocker; typecheck/build/tests green.

### Sprint 2 — Data quality, accuracy and reliability

**BUG-04:** There are 12 PSI runs per URL/device and 120 recorded calls in a short window; whether unintended was NOT proven. Trace job source, enqueue timestamps, skip-cache state and retry behavior. Add idempotent in-flight claims, debouncing/disable-while-running, and proper 6-hour cache reuse unless explicitly bypassed. Never delete historical duplicate results without approval. Test double-click, retry, concurrent worker and cache behavior.

**BUG-05 + BUG-06:** Identical real-user metrics across five pages suggest **origin-level CrUX fallback** replicated as URL-level findings. Verify actual provider payload (`loadingExperience` vs `originLoadingExperience`) and persisted provenance. Store **scope=URL vs origin**, device, p75 window and freshness; show “whole-site” whenever applicable. New imports should group true origin-level metrics once per metric/device/site without pretending each page had unique traffic. Show mobile and desktop separately; don't let “INP good” hide poor desktop INP 542 ms or CLS 0.6. **Do not retroactively change counts or high-severity totals without approval.** Unit-test URL vs origin cases.

**BUG-11:** Display IDs (e.g., CNT-0001, A11Y-0001) collide across projects. Show Website in “All” view and a stable unique **presentation identifier** or composite label in mixed-project UI/exports. Preserve internal persistent IDs and existing client links. Historical ID migration needs approval.

**BUG-12 + BUG-13:** Structured-data validator gives both “missing” and “wrong type” for the same `datePublished:""`; page counts include empty item lists. Each property should get a single coherent verdict (missing/empty/invalid), rules should cite versioned Google documentation, eligibility copy should not invent requirements, and zero-item pages should have clear empty states and accurate counts. Test fixtures for missing, empty, invalid, and correct Article schema.

**BUG-21 + BUG-25:** Cancelled audit rows have inconsistent discovered/completed/raw-findings counts and times, and TYP-0019 reports implausible `line-height:0.10`. Distinguish collected-but-not-imported findings and show who/when/reason for cancellation; correct only proven measurement-parsing bugs. Unit-test unitless/%/px/normal line-height and confirm actual computed style if accessible without changing target.

**Exit criteria:** no false source attribution; counts and states explainable; new audit results are consistent, historic records unchanged without approval; tests for data integrity and false positives.

### Sprint 3 — Make the system easy for nontechnical users

User-facing goal: **Add Website → Start Audit → Review Problems → Generate Report → Client Approval → Re-Audit**. Keep advanced evidence accessible to developers but default to simple, actionable information.

- **UX-02:** Simplify confusing “Confirmed / Unverified / Pending / To do” vocabulary (propose “Measured” as rule classification and separate review/implementation status). This may affect saved exports/links; present migration/compatibility plan and request approval before changing persisted semantics.
- **UX-03:** Build review queue (single finding pane, screenshot, keyboard alternatives, next/previous, bulk-group actions with explicit confirmation). Persist progress; test reviewing 20 findings without reloading every detail page. Show review coverage, not misleading completeness.
- **UX-07:** Client approvals blocked state should show reviewed vs eligible counts and link to filtered review queue; provide safe client-view preview in an isolated fixture. Test expiring links and role checks.
- **UX-04/05:** Website column in cross-project issues; Recommendation chip and accurate counts; avoid grouping unrelated issues, and **do not change live counts** for near-duplicate contrast groups until tested and approved.
- **UX-06 + BUG-15:** Make report preview update automatically with debounce and clear loading/error states; disable zero-count Generate buttons and reject empty report server-side. For Client PDF reviewed-only default, secure approval before behavior change and don't silently alter previously saved settings.
- **UX-09:** Audit Runs filtering, sorting, server-side pagination, labelled start/finish/cancel timestamps and cancellation reason. Preserve filter state in URL.
- **UX-10/11 + BUG-16:** Remove needless Show/Select clicks while preserving form inputs; health-card links should open relevant filtered issue views with unique accessible names.
- **BUG-17/18 + UX-20:** Bulk action default must be “Choose an action,” Apply disabled until selected, confirm large batches. Show review actions appropriate to classification, with safe undo where feasible.
- **BUG-19/22/23 + UX-15:** For zero-size broken elements crop a visible ancestor and caption; descriptive document titles on detail pages; branded accessible 404 with routes back into app.
- **BUG-20/24 + UX-13/14:** Label timestamps consistently; align Overview and Help onboarding; replace inaccurate 5–10 min estimate with transparent data-derived range, not a guarantee.
- **UX-17/18/16:** Useful pre-audit approximate duration (clearly estimate) and visible Google check selections; label scope of real-user metrics and explain that CrUX API Off doesn't prevent PSI-provided field data.
- **UX-12:** Structured Data page summary and collapsed sections, error-only filter, grouping, clear no-data statuses.
- **UX-19:** Secure admin user-management flow (role edit, deactivate, password reset if not already implemented), authorization tests, session invalidation and no secrets on screen. Check existing functionality first to avoid rebuilding.

**Exit criteria:** a novice can understand the first screen, start a fixture audit, review priority issues, request a report, and see exactly how to obtain client approval. All controls are functional. Test 320, 390, 768, 1024, 1440px, keyboard navigation, screen readers as practical and automated axe rules; do not claim full WCAG compliance from automation alone.

### Sprint 4 — Re-audit, reporting, Google SEO completeness

**BUG-07:** Re-Audit currently shows **197 “New”** findings including PERF/CWV/SD checks absent from the base run. Add “Not checked in base audit” category; use saved per-run category/provider coverage to distinguish newly detected defects from newly introduced checks. Never call a finding Resolved when source or page wasn't checked. Test run-pair comparisons with unequal check coverage.

**BUG-08:** Volatile SmartMenus IDs (`sm-<timestamp>-<n>`) appear in finding fingerprints. Normalize volatile identifiers in *future matching* with tests showing unchanged fixtures don't oscillate New/Resolved. Protect true uniqueness, avoid accidental merges, and do not re-fingerprint historical records without explicit approval.

**BUG-09 + UX-08:** `/reaudit` returned 2,279,222 bytes of HTML rendering 827 items. Implement server-side status tabs and pagination (~50 rows/page), lazy evidence/screenshots, side-by-side details on demand; prevent selecting the exact same audit as base and comparison. Aim for initial HTML <300 KB and <1.5s locally, measure honestly and document exceptions.

**BUG-14:** Reports must include Performance and Core Web Vitals categories (146 of the then-current 727 CHM findings), consistent naming and counts with audit summaries; generate XLSX/PDF/HTML/JSON from the same filtered source. Validate real files against fixture records and check cross-project isolation, not by emailing clients.

**UX-01:** Guided Google Connections checklist: credentials saved → account connected → Search Console API operational → matching authorized property visible → property selected. Each missing step has a clear action. Technical provider details behind disclosure. Cannot guarantee live API success without enabling API and property access.

After the external API blocker is removed and the user separately authorizes quota-bearing verification, check Search Console Performance, URL Inspection, Sitemaps, saved history, and their report sections. For otherwise blocked workflows, mocks cover correctness and UI displays “Not verified” honestly.

**Exit criteria:** comparisons do not mislabel unmeasured categories as New, reports are accurate and openable, Google status/support steps are clear, and the core client approval pathway works on isolated fixtures.

### Sprint 5 — Security, release hardening and complete verification

- Verify authentication, role/project isolation, session invalidation, approval-link token entropy/expiry/revocation, server-side permissions, safe report file access, login rate limits, audit worker cancellation/recovery, SSRF restrictions and GET/HEAD-only target fetches.
- Test DB+artifact backup and recovery in an isolated environment; no production data deletion.
- Assess CSP and any deployment-specific restrictions; propose rollout plan and request approval before enabling policy that could break scripts/styles.
- Check logs for secrets, manage API quotas, storage lifecycle, worker health and retry limits, Next.js navigation errors, performance under 1,477 finding records.
- Run existing unit/integration, Playwright E2E, typecheck and production build; re-open all app modules (Overview, Projects, New Audit, Audit Runs, Issues, Reports, Client Approvals, Re-Audit, 8 Google tabs, Settings, Help) after changes.
- Test desktop/mobile UI for overflow, accessible labels, visible focus, links, screenshots and error states; clearly distinguish automated checking from human usability testing.

## Required tests (minimum)

- Newest PSI result per URL+device across three saved runs; shared results in Overview/History/Reports.
- Google error mapping `SERVICE_DISABLED`, `PERMISSION_DENIED`, `401`, token refresh, quota, temporary network errors; consistent status on each page.
- In-flight PSI idempotence, six-hour cache, skip-cache path; no unapproved live calls.
- CrUX URL/origin provenance and dedup; separate mobile/desktop CWV states.
- Findings display-ID uniqueness across projects; no cross-project data leaks.
- Structured-data property verdicts and exact pages-with-items counts.
- Re-Audit with different base/after categories, volatile IDs, skipped pages, pagination and same-run prevention.
- Report categories equal actual audit categories, empty report rejected server-side, XLSX/PDF valid and evidence/links correct.
- Bulk action requires an explicit selection; approval/client link workflows tested with fixtures.
- All navigation and Google tabs free of `?_rsc=` 5xx; normal client navigation.
- Core screenshot evidence and Current vs Proposed remain linked to actual findings.
- Existing 8 MVP capabilities and safe crawler behavior regressions remain green.

## Every sprint must produce

1. **Verified bugs fixed**, including original BUG-xx IDs and reproducible before/after evidence.
2. **Files modified**, migrations, and risk/rollback plan.
3. **Test commands and exact results**: tests passing/failing, skipped tests, browser coverage, build state.
4. **Agile board update**: Completed & Tested / In Progress / Blocked / Not Started, with next-priority work.
5. **Unresolved questions and approval gates** only when truly needed; do not block unrelated safe fixes.

## Final deliverable / Definition of Done

- The critical P1 errors are corrected or externally blocked with honest error UI and actionable steps.
- All observed BUG-01 through BUG-25 and UX-01 through UX-20 are triaged, with actual fixes verified for in-scope priorities and explicitly documented deferrals for anything remaining.
- Existing audit data and Google credentials are intact and protected; no new live site scans or client report sends occurred without approval.
- At least one **full isolated-fixture** flow works: create authorized project → audit → inspect issues/evidence → review → export Excel/PDF → client approval → re-audit comparison.
- The app's navigation, user messages and key screens are clear to nontechnical staff and usable on common viewport sizes.
- No false claims of production readiness. State deployment, security, monitoring, and external Google requirements before client deployment.

**START NOW: read the four source reports, inspect current code, create safe checkpoints, reproduce Sprint 1 defects, implement and test the P1 fixes, then work through the prioritized Agile backlog as far as safe and feasible. Do not stop after writing a plan. Report factual sprint outcomes and blockers.**

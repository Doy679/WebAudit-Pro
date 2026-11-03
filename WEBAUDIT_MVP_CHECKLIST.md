# WebAudit Pro MVP Checklist

Statuses: Not Started · In Progress · Blocked · Completed and Tested
Last verified: 2026-11-03. 125 unit/integration tests and 11 end-to-end tests pass (`npm test`, `npm run test:e2e`), and the typecheck and production build are clean.

- [x] 1. Preserve and improve existing audit engine
  - **Status:** Completed and Tested
  - **Source files:** `src/` (engine), `src/checks/content.ts`, `src/checks/site.ts`, `src/checks/components.ts`, `src/report/dedupe.ts` (fingerprint grouping), `src/security/ssrf.ts`, `src/capture/extract.browser.js`, `scripts/recheck.ts`, `docs/rule-accuracy.md`
  - **Tests:** `test/engine-v2.test.ts` (noise fixes, new rules, grouping), `test/checks.test.ts`, `test/dedupe.test.ts`, `test/ssrf.test.ts`, `test/audit.integration.test.ts` (real browser run on the fixture site: new rules, fingerprints, progress, cancel, loopback refused without the test policy). CLI `npm run audit` / `npm run demo` still run.
  - **Acceptance:** the CLI still works; existing tests pass (two tap-target tests were updated for the WCAG 2.2 AA 24px threshold, documented in the test file); repeated issues are grouped into one finding with all pages, viewports and occurrences; evidence is traceable through occurrences and screenshots; false positives can be marked and carry over to later audits; accuracy changes are documented. Re-check on the saved CHM pilot snapshots: 3,874 → 682 findings.
  - **Limitations:** the CHM re-check measures noise reduction, not verified accuracy (no findings have been manually validated yet). Toggle, broken-link, navigation and overlap rules only apply to new scans. Misspelling detection uses a fixed list of common errors, not a full dictionary.

- [x] 2. Build website dashboard and project management
  - **Status:** Completed and Tested
  - **Source files:** `app/(app)/page.tsx`, `app/(app)/projects/**`, `app/(app)/settings/page.tsx`, `components/Nav.tsx`, `server/db.ts`, `server/auth.ts`, `server/permissions.ts`, `server/projects.ts`, `server/stats.ts`
  - **Tests:** `test/server.test.ts` (auth, sessions, roles, project isolation, authorization record, scope); E2E first-run admin setup, Test 1 (create a project and reload), Test 13 (outsider and anonymous access).
  - **Acceptance:** all nine navigation items work; projects keep their settings, design standards, members and history; overview numbers are queried from real data.
  - **Limitations:** SQLite only. The schema is PostgreSQL-compatible, but no Postgres driver is wired in yet. No password-reset flow (an admin creates or disables accounts).

- [x] 3. Add URL input and Start Audit button
  - **Status:** Completed and Tested
  - **Source files:** `app/(app)/audits/new/page.tsx`, `app/actions.ts` (`startAuditAction`), `server/runs.ts` (`createAuditRun`, `normalizeSettings`), `src/security/ssrf.ts`
  - **Tests:** `test/server.test.ts` (outside-domain URL rejected, private address rejected, developer can't start audits), `test/ssrf.test.ts`; E2E Test 2 (pastes the URL, picks settings, clicks Start Audit, and a real scan runs).
  - **Acceptance:** URL, project, max pages, sitemap discovery, URL list, viewports, categories, scan rate and the project's design tokens. Start Audit queues a real engine run.
  - **Limitations:** public pages only (no authenticated audits). DNS-rebinding protection checks every browser request's host with a 30s cache; Chromium resolves DNS separately, so a very short rebinding window remains.

- [x] 4. Implement persistent scan progress
  - **Status:** Completed and Tested
  - **Source files:** `worker/worker.ts`, `worker/audit-job.ts`, `server/runs.ts` (jobs, progress, cancel, orphan recovery), `components/RunProgress.tsx`, `app/api/runs/[id]/route.ts`, `app/(app)/audits/**`
  - **Tests:** `test/server.test.ts` (job claimed exactly once, cancel recorded); `test/audit.integration.test.ts` (progress events, cancel stops the engine); E2E Test 3 (status changes, survives a reload, completion summary) and Test 3b (Cancel Audit from the UI → cancelled).
  - **Acceptance:** Pending / Running / Completed / Failed / Cancelled, with pages discovered/completed/failed/skipped, current URL and viewport, percentage, findings, elapsed time, errors and summary. Runs in a separate worker process, survives a refresh, and a failed page doesn't stop the audit.
  - **Limitations:** one audit at a time per worker (by design, for politeness and memory). A cancelled audit discards partial results. Worker restarts mark in-flight audits as interrupted (failed) rather than resuming them.

- [x] 5. Show issues with screenshot evidence
  - **Status:** Completed and Tested
  - **Source files:** `app/(app)/issues/page.tsx`, `app/(app)/issues/[id]/page.tsx`, `components/EvidenceViewer.tsx`, `server/issues.ts`, `server/files.ts`, `app/api/evidence/**`
  - **Tests:** `test/server.test.ts` (filters, search, isolation); E2E Tests 4–5 (open results, saved annotated screenshot loads, full-page viewport view with highlight).
  - **Acceptance:** every field in the spec is shown; filters cover website, page, category, severity, viewport, status, confidence, assignee and classification; plus search, sort, pagination (server-side, so thousands of findings stay fast) and bulk review. Evidence is served only to project members.
  - **Limitations:** highlight boxes for viewports other than the first come from raw occurrences, so they are capped at 20 per screenshot.

- [x] 6. Implement Current vs Proposed review
  - **Status:** Completed and Tested
  - **Source files:** `app/(app)/issues/[id]/page.tsx`, `server/issues.ts` (`reviewIssue`, `bulkReview`), `issue_events` table
  - **Tests:** `test/server.test.ts` (approve, assign, priority, implementation status, history order, developer can't approve); E2E Tests 6–7 (Current vs Proposed shown, decision and note persist after reload, history recorded).
  - **Acceptance:** Confirm / False positive / Approve / Request revision / Reject / Assign / Notes / Priority, with separate verification, review, implementation and client-decision statuses, timestamped history and shared-template warnings. "Human review required" appears when there is no measured proposal.
  - **Limitations:** notes are append-only (no editing or deleting of earlier notes).

- [x] 7. Generate downloadable Excel and PDF reports
  - **Status:** Completed and Tested
  - **Source files:** `server/reporting/data.ts`, `server/reporting/xlsx.ts`, `server/reporting/html.ts`, `worker/export-job.ts`, `server/exports.ts`, `app/(app)/reports/page.tsx`, `app/api/exports/[id]/route.ts`
  - **Tests:** `test/reports.test.ts` (8 named sheets, styled frozen filtered headers, hyperlinks, filtered export, multi-page PDF, HTML sections, JSON contents, files outside public dirs); E2E Tests 8–9 (generate in the UI, download through the authorized route, open the XLSX and check the PDF header).
  - **Acceptance:** Excel has all 8 sheets; the PDF has all 12 sections, a cover, evidence images and page numbers; HTML and JSON are also available. All are generated from saved data and can be filtered or limited to reviewed findings.
  - **Limitations:** the PDF features at most 25 findings with up to 20 images; the rest go to the technical appendix. Branding is a name only (no logo upload yet).

- [x] 8. Implement secure client approval and re-audit
  - **Status:** Completed and Tested
  - **Source files:** `server/approvals.ts`, `app/(app)/approvals/**`, `app/approve/[token]/page.tsx`, `app/api/portal/**`, `server/compare.ts`, `app/(app)/reaudit/page.tsx`
  - **Tests:** `test/server.test.ts` (only reviewed findings can be released, token stored as a hash, decisions plus audit trail, out-of-package decisions rejected, revoked/expired/invalid links); `test/compare.test.ts` (all six statuses, never "resolved" when a page failed); E2E Tests 10–12 (create a link, client view with evidence, decision persisted in the package log and issue history, unreleased evidence returns 404; second audit after a fix shows the overflow as Resolved).
  - **Acceptance:** private expiring, revocable links; the client approves, rejects, requests revision and comments, with name, email, time, IP and user agent stored. Re-audit classifies New / Still present / Resolved / Reopened / Changed / Unable to verify, with before/after values and screenshots. Neither approval nor re-audit touches the website (E2E Test 14: the fixture site only ever received GET/HEAD).
  - **Limitations:** links are shared manually (no email sending). Rate limiting of client submissions is in-memory per process.

## Additional features (section 4)
- **AI recommendations:** done but optional. "Explain with AI" on findings (Claude API, `claude-opus-5-5`, server-side refusal fallback). The key is stored encrypted and AI output never changes findings. *Not tested against the live API: no key was available in this environment.*
- **Design Standards Manager:** done. Per-project spacing scale, thresholds and recorded standards feed the engine and reports.
- **Team accounts:** done. Admin / PM / QA / Developer / Client with server-side checks and project isolation.
- **Audit history:** done. Every run, finding, decision and export is kept, and runs can be compared.
- **Audit quality score:** done. Documented formula, labelled as an internal indicator.
- **Future (not built):** scheduled scans, regression alerts, email, logo/white-label, retention policies, performance (PSI) integration.

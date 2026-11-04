# Sprint 6: Final Retest Remediation (2026-11-04)

Source: `browser_qa_2026-11-04/WEBAUDIT_FINAL_RETEST_REPORT.md`. Status per item: `RETEST_BUG_TRACKER.md`. Numbers: `TEST_RESULTS.md`. Approvals: `REMAINING_APPROVALS.md`.

## Sprint 0: baseline and data protection
- Backup `data/backups/pre-sprint6-2026-11-04/` (DB via VACUUM INTO, integrity ok: 2 projects, 9 audits, 4,048 findings, 150 PageSpeed results, 0 exports/packages; evidence copy 1.5 GB, byte-identical). Git tag `checkpoint-pre-sprint6`. Baseline: typecheck pass, 277 unit, 25 E2E.
- Found that the 11:27 audit and 11:47 PageSpeed requests ran on the pre-Sprint-5 processes (fixed app went live 12:02), and traced each retest failure in code and data.

## Sprint 1 (P1): NEW-01
Shared PageSpeed health from stored fresh results (cache hits can't count as success), Google error classification, admin "Test PageSpeed key" behind a confirmation, status on 7 screens, Help. Connections stopped calling Google on page load.

## Sprint 2 (P2): BUG-10, BUG-04, BUG-05, BUG-12
Prefetch off by default (documented); queue dedupe within the cache window; CrUX data-scope label + dry run; structured-data per-result rules version, fixture verification, and a **crash fix** for the new "empty" verdict found during testing.

## Sprint 3: partial fixes
BUG-15 live preview + stale guard; BUG-21 detail header; BUG-11 references; BUG-19 crop from a width where the element is shown (root cause found only in real-data verification); BUG-25 verified as a correct measurement and the earlier rule that would drop it reverted.

## Sprint 4: UX
Review Queue (UX-03), plain status words (UX-02, display only), Structured Data summary (UX-12), account management E2E (UX-19), one-click website switch (UX-10), naming and title polish.

## Sprint 5: security and QA
CSP in report-only mode (0 violations in E2E); full regression green; real-data browser verification; flaky E2E heartbeat fixed.

## Corrections to earlier claims
- BUG-25: the previous sprint's "spacer, false positive" conclusion was wrong. The value is real and the text visible. The rule that would have dropped it is reverted.
- BUG-19: the previous marker-only fix did not address the cause (first-width crops).
- BUG-12: the previous fix introduced a crash path for new audits. It was found by a test before any audit hit it, and fixed.
- E2E "client navigation" check verified absence of errors but not arrival; arrival is now verified explicitly on real data.

## Database impact
Additive columns only: `psi_results.error_detail`, plus earlier `google_connections.last_*` and `audit_runs.cancelled_by`. No rows deleted or rewritten; historical findings, counts, timestamps and evidence unchanged.

## Rollback
`git checkout checkpoint-pre-sprint6` (code) + the backup folder above (data). The added columns are ignored by older code.

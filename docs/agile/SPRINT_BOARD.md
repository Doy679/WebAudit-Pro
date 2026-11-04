# Sprint Board (2026-11-03)

Logical work stages, not dates. "Done" follows the Definition of Done: root cause documented, code, passing tests, verified behaviour, docs updated.

## Sprint 0: Discovery and stabilization ✅
- Git checkpoint `checkpoint-pre-sprint`.
- Runtime: local production build (`npm start` = Next.js + worker), SQLite at `data/webaudit.db`, Edge via Playwright.
- Reproduced `/issues` crash from the server log (digest 542859302) and on a snapshot copy of the real DB.
- Baselines recorded (see TECHNICAL_AUDIT.md).

## Sprint 1: Critical fixes ✅
| Item | Status |
|---|---|
| BUG-001 Issues crash | Done: verified on real data copy + E2E |
| BUG-002 Malformed data resilience | Done |
| Project selection (BUG-015) re-verified | Done: E2E Bug Tests 1–3 |
| Worker health (BUG-016) re-verified | Done: worker integration tests, live worker online |

## Sprint 2: Core reliability ✅ (scoped)
| Item | Status |
|---|---|
| BUG-003 Stable fingerprints | Done |
| BUG-004/005 No 1,000-row caps | Done |
| BUG-006 Annotation cap | Done (new audits) |
| BUG-010 JSON report size | Done |
| Data isolation in reports | Verified: Red River Excel has 0 other-project URLs; E2E Bug Test 8 |
| Report generation on 750 findings | Verified: Excel 0.5 s, PDF 2.4 s (150 pages), JSON 0.1 s |

## Sprint 3: UX/UI ✅ (scoped)
| Item | Status |
|---|---|
| BUG-007 Form remount | Done |
| BUG-008 App accessibility | Done: 0 axe violations on 16 pages at 390 and 1440 px |
| BUG-009 Responsive overflow | Done: 0 overflow on 16 pages × 5 widths |
| BUG-013 Error page | Done |
| Larger UX items (saved filters, list ergonomics, notifications) | Moved to backlog PB-07, PB-08, PB-13 |

## Sprint 5: User-friendly UX ✅ (scoped; see UX_BACKLOG.md)
| Item | Status |
|---|---|
| Dashboard redesign, getting-started guide, Help page | Done: UX-01 to UX-03 |
| Guided New Audit (advanced settings collapsed) | Done: UX-04 |
| Issues: quick filters, saved views, preserved filters, plain-language rows | Done: UX-05 to UX-09 |
| Issue detail: plain summary first, technical details collapsed, honest Current vs Proposed, zoom | Done: UX-10 to UX-12 |
| Report workflow with preview; custom selected-issues report | Done: UX-13, UX-14 |
| Simplified client portal | Done: UX-15 |
| Phone overflow on real data | Done: BUG-018 |
| Real-user usability testing | Open: UX-20 |
| Mobile card layout for the Issues table | Open: UX-21 |

## Sprint 4: Security, Google, release readiness (partial)
| Item | Status |
|---|---|
| BUG-011 Password change/reset | Done |
| BUG-012 Backup | Done (DB); restore = PB-06 |
| Security headers, anonymous access, download auth | Verified live |
| CSP | Open: PB-03 |
| Google live verification | Blocked: PB-01 (credentials) |
| Deployment hardening | Open: PB-04 |

## Browser QA sprints (2026-11-04): source `browser_qa_2026-11-04/`

### Sprint 0: Baseline ✅
- Backup: `data/backups/pre-qa-sprint-2026-11-04/` (DB via `VACUUM INTO`, integrity ok, 3,367 findings, 120 PageSpeed results; 1.4 GB evidence copy, byte-identical). Git tag `checkpoint-pre-qa-sprint`.
- Baseline: typecheck pass, unit 244/244, E2E 23/23. Evidence screenshots E01–E24 are **not on this PC**; findings were reproduced from code and stored data instead.
- All reproduction used copies of the database (`.tmp/qa`); the live `data/webaudit.db` was opened read-only only.

### Sprint 1: P1 + navigation ✅
| Item | Status |
|---|---|
| BUG-03 PageSpeed latest | Completed & tested (real-data copy: 52, was 59) |
| BUG-01 Search Console errors | Completed & tested with mocked Google responses; **live check blocked** (Search Console API disabled in Google Cloud project; needs your action) |
| BUG-02 Status consistency | Completed & tested |
| BUG-10 `?_rsc=` 503 | Not reproduced (0/61); E2E guard added |

### Sprint 2: Data quality ✅ (forward-only)
BUG-04, 05, 06, 11, 12, 13, 21, 25: Completed & tested. Historical counts and findings unchanged.

### Sprint 3: UX ✅ (scoped)
BUG-15, 16, 17, 18, 19, 20, 22, 23, 24; UX-04, 07, 09, 11, 13, 14, 15, 16, 17, 19, 20: Completed & tested. UX-01, 06, 12, 18: partly done.

### Sprint 4: Re-Audit and reports ✅ (scoped)
BUG-07, 08, 09, 14; UX-08: Completed & tested (CHM re-audit: New 197 → 1).

### Blocked / needs approval / not started
| Item | Why |
|---|---|
| Search Console live verification (BUG-01 end to end) | Search Console API must be enabled in Google Cloud project 154245030857 (your action), then one approved test call |
| UX-02 status vocabulary | Changes persisted/exported terms: needs approval |
| UX-05 merge near-identical findings; BUG-05 re-import of existing CWV findings | Change client-facing High counts: needs approval |
| UX-06 Client PDF "reviewed only" default | Report default change: needs approval |
| UX-03 review queue | Not started (8 SP) |
| UX-10 apply-on-change selects | Deferred: WCAG 3.2.2 risk |
| UX-12 structured-data summary/filters | Not started |
| CSP, deployment hardening (PB-03/04) | Not started; CSP needs approval |

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

# Technical Audit (2026-11-03)

Statuses: **Working** (verified by tests and/or live check) · **Partially working** · **Broken** · **Not implemented** · **Not verified**.
Data used: a `VACUUM INTO` snapshot of `data/webaudit.db` (7 runs: 3 CHM completed, 3 CHM cancelled, 1 Red River completed) plus the real `data/runs` evidence (read-only). No live websites were scanned for this audit.

## Module status

| # | Module | Status | Evidence | Gaps |
|---|---|---|---|---|
| 1 | Authentication & users | **Working** | `server.test.ts`, `account.test.ts`: scrypt hashes, hashed session tokens, expiry, roles, disabled users, password change (other sessions signed out), admin reset. Live: private pages redirect, APIs 401 | No MFA, no idle timeout, no email reset (PB-11); rate limits in-memory (PB-04) |
| 2 | Dashboard & projects | **Working** | E2E Test 1; isolation tests; overview counts from DB | No archive/delete (PB-12); "Pages scanned" sums all audits |
| 3 | New Audit | **Working** | E2E Bug Tests 1–3 (switching, cross-project rejection, correct record); BUG-007 fixed | — |
| 4 | Worker & queue | **Working** | `worker.integration.test.ts` (real process: online, single instance, pending→running→completed, kill → offline, requeue → completes once, tampered URL rejected); live worker online | One audit at a time (PB-09); restart from page 1 (PB-10) |
| 5 | Audit engine | **Working, precision caveats** | Red River: 80/80 pages, 21,719 raw → 750 grouped; 100% evidence files present; fingerprints unique; CHM fingerprint stability 100% after BUG-003 | 288/289 "high" are axe results, one finding per element (PB-02); 143 Red River findings lack crops (new audits fixed) |
| 6 | Issues & details | **Working** | BUG-001 fixed; `issues-page.test.ts` (filters, sort, search, pagination, 2,000 rows, malformed rows, unauthorized); E2E Journey C; real-data copy HTTP 200 | Saved filters, list ergonomics (PB-07/08) |
| 7 | Reports | **Working** | Red River: Excel 17 sheets/750 rows/0 foreign URLs in 0.5 s; PDF 150 pages in 2.4 s; JSON 2.35 MB; download routes 401 anonymously | Long client PDF (PB-14) |
| 8 | Client approval | **Working** | E2E Tests 10–11; hashed/expiring/revocable tokens; only reviewed findings; decisions change review records only | Manual link sharing (by design) |
| 9 | Re-audit | **Working** | E2E Test 12 (resolved after fix); `compare.test.ts` incl. provider coverage | Transition note for old fingerprints (PB-15) |
| 10 | Google SEO & Performance | **Partially working** | Structured data validator: working (tests + E2E 15). PSI/CrUX/Search Console: code tested with mocked responses; status truthfully "Not configured" | **Not verified live** (PB-01) |

## Performance (snapshot of real DB, averages of 5 runs)

| Measure | Before | After |
|---|---|---|
| Issues list, Red River page 1 | 4.3 ms | 4.3 ms |
| Issues page-1 row payload | 398 KB | 117 KB (−71%) |
| Exact failing `/issues` URL (HTTP, prod build) | crash | 200 in 0.13 s |
| Search "contrast" / viewport filter | 8.2 / 8.0 ms | 8.6 / 8.6 ms (noise) |
| Filter dropdown options | 27.7 ms | 30.8 ms (noise) |
| JSON report (750 findings) | 9.2 MB, +73 MB RSS | 2.35 MB, +38 MB RSS |
| Excel / PDF (750 findings) | — | 0.5 s / 2.4 s |
| Fingerprint stability (identical CHM runs) | 590/630 (94%) | 606/606 (100%) |

Query plan: run-filtered queries use index `issues_run`; `ORDER BY` uses a temp B-tree on ≤2,000 rows (no index justified at this size). No N+1 patterns in list views (one query + count). Storage: 1.2 GB `data/` (Red River run 654 MB of screenshots) → PB-05.

## Security review (non-destructive)

| Area | Finding |
|---|---|
| AuthZ / isolation | Project membership enforced in every server function; outsiders get 404 (not 403) for runs, issues, evidence, exports. Verified in unit, E2E Test 13 and Bug Test 8 |
| SSRF | Every browser request and redirect hop resolved and checked; private/loopback/metadata ranges blocked; loopback only via explicit test flag (`ssrf.test.ts`, 25 tests) |
| Scope | Central exact-host scope check on server, worker and engine (incl. redirects); tampered stored URL rejected by worker |
| CSRF | Server Actions (Next.js Origin check); API routes are GET-only reads |
| XSS | React escaping; report HTML escaped; crawled text never rendered as HTML. **No CSP** (PB-03) |
| Secrets | API key, OAuth secret, refresh tokens AES-256-GCM encrypted with `WEBAUDIT_SECRET`; never sent to the browser or logged |
| Tokens | Session and approval tokens random 32 bytes, stored as SHA-256 |
| Cookies | httpOnly, SameSite=Lax, Secure when `WEBAUDIT_APP_URL` is https |
| Headers | X-Frame-Options DENY, nosniff, Referrer-Policy no-referrer, Permissions-Policy (verified live) |
| Errors | Production pages show a reference digest only |
| Rate limiting | Login and client submissions: in-memory per process (PB-04) |
| Backups | DB backup implemented and verified on real DB; restore manual (PB-06) |

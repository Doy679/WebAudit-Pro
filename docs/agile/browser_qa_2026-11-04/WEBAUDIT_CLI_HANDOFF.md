# CLAUDE CLI IMPLEMENTATION HANDOFF

Source: read-only browser QA of WebAudit Pro at `http://localhost:3000`, 2026-11-04 (Asia/Singapore), Admin account. Full detail: `WEBAUDIT_BUG_REGISTER.md` (BUG-xx) and `WEBAUDIT_UX_IMPROVEMENTS.md` (UX-xx). Screenshots: `evidence/E01–E24`.

**Ground rules for the implementing session**
- No source code was read during the audit. Every "code area" below is a **[Guessing]** pointer based on route names and observed framework signals. Confirm with `grep` before editing.
- Observed stack signals: Next.js App Router with an `(app)` route group (`/_next/static/chunks/app/(app)/layout-*.js`), Server Actions (`$ACTION_ID_*` hidden inputs), Tailwind v4-style CSS (breakpoints 40/48/64/80/96rem), a separate background "worker" (sidebar "Worker online"), `npm start` runs web + worker (Help page), backups in `data/backups` (Settings). The database engine isn't known: "consistent copy … safe while audits run" suggests SQLite [Guessing].
- Don't change client-facing counts, re-fingerprint history, or delete data without the approvals listed in §11.

---

## 1. Confirmed reproducible bugs

| ID | Sev | Title | Status |
|---|---|---|---|
| BUG-01 | P1 | Search Console `SERVICE_DISABLED` shown as "no permission"; no retry / property selector | Verified |
| BUG-03 | P1 | PageSpeed "Latest results" shows oldest run | Verified |
| BUG-02 | P2 | Search Console status inconsistent across 6 screens | Verified |
| BUG-05 | P2 | Origin-level CrUX duplicated per page (identical values on 5 pages) | Verified values / Likely cause |
| BUG-06 | P2 | Real-user CWV summary is mobile-only, unlabelled | Verified |
| BUG-07 | P2 | Re-Audit "New" includes checks the base audit never ran | Verified |
| BUG-09 | P2 | `/reaudit` HTML = 2,279,222 bytes, no pagination | Verified |
| BUG-10 | P2 | Browser `?_rsc=` navigation requests return 503 | Verified symptom, cause unknown |
| BUG-11 | P2 | Display IDs collide across websites | Verified |
| BUG-12 | P2 | SD validator: "missing" + "wrong type" for the same empty property | Verified |
| BUG-14 | P2 | Reports: no Performance / CWV category filter | Verified |
| BUG-13, 15, 16, 17, 18, 20, 21, 22, 23, 24 | P3 | See register | Verified |
| BUG-04 | P2 | 12 PSI runs per URL/device (120 calls) | Partially Verified (unintended-ness Suspected) |
| BUG-08 | P2 | Volatile `sm-<n>-<i>` IDs in fingerprints | Partially Verified |
| BUG-19 | P3 | Highlight crop for zero-size element | Partially Verified |
| BUG-25 | P3 | line-height 0.10 measurement | Suspected |

## 2. Prioritised fixes (do in this order)
1. **BUG-03** (small, high value): fix the "latest per url+device" query on the PageSpeed page. Reuse whatever SEO Overview uses, since it shows the correct latest value (52 / 6.3 s).
2. **BUG-01 + BUG-02**: Google error classification, one shared Search Console status model, Retry/Test button, property dropdown.
3. **BUG-10**: find the source of the 503s on RSC navigation. It may mean server instability that affects everything else.
4. **BUG-04**: dedupe / lock PageSpeed job enqueueing; respect the 6 h cache.
5. **BUG-05 + BUG-06**: store CrUX scope (url vs origin); one site-level finding for origin data; per-device summary.
6. **BUG-07 + BUG-08 + BUG-09**: Re-Audit "not checked before" bucket, fingerprint normalisation, pagination.
7. **BUG-11**: unique display IDs, or a website column/prefix.
8. **BUG-12, 13, 14, 15**: validator and report correctness.
9. P3 polish: BUG-16–25.

## 3. Missing or incomplete features
- **Essential:** Search Console property selection flow (not reachable today: BUG-01), Retry/Test connection, team account edit/deactivate/reset (UX-19), empty-report guard (BUG-15), Re-Audit pagination (BUG-09), Audit Runs filtering/pagination (UX-09), Performance/CWV report categories (BUG-14).
- **Partially implemented:** Search Console Performance / URL Inspection / Sitemaps (pages exist, no data possible until BUG-01 is resolved); CrUX API option (Off); client approval flow (exists, but blocked by the review requirement; end-to-end untested).
- **Optional / future:** review queue mode (UX-03), client-view preview (UX-07), audit duration estimate (UX-17), CSP header, 2FA, scheduled audits.

## 4. UX/UI improvements (implement after the P1/P2 bugs)
High: UX-01, UX-02, UX-03, UX-07, UX-08. Medium: UX-04, 05, 06, 09, 11, 12, 14, 17, 18, 19, 20. Low: UX-10, 13, 15, 16. Detail and acceptance criteria are in `WEBAUDIT_UX_IMPROVEMENTS.md`.

## 5. Affected pages and reproduction steps (condensed)

| Bug | URL | Steps | Observable failure |
|---|---|---|---|
| BUG-01 | `/google/connections?project=568a8045-37e2-4b2c-b9a6-45be10a63568` | Load page | "Access required: your Google account doesn't have permission…" + raw "API has not been used in project 154245030857 … or it is disabled"; no Retry, no property list |
| BUG-02 | `/`, `/google`, `/google/search-console`, `/audits/new` (Advanced), `/settings` | Compare status text | "set up" / "Connected" / "not connected" / "Connect Google" for the same state |
| BUG-03 | `/google/pagespeed?project=568a…` vs `/google/history?project=568a…` vs `/google?project=568a…` | Compare home Mobile row | 59 / 9.0 s / 10:07 vs latest 52 / 6.3 s / 10:15 |
| BUG-04 | `/google/history?project=568a…`; `/google` "Recent Google requests" | Read Runs column / list | Runs = 12 per row; duplicate entries at 10:07 |
| BUG-05 | `/issues/2e172bd5-…`, `/issues/4e95d616-…`, `/issues/ade8a9af-…`, `/issues/73363280-…` | Read "Current" value | All "4.1 s p75 (poor, LCP)" |
| BUG-06 | `/audits/57226d00-02e2-4b57-a54a-62105de0619a` | Performance card | "INP good, CLS good" while desktop INP 542 ms / CLS 0.6 are High findings |
| BUG-07/08/09 | `/reaudit` (CHM, base 3:22 PM, after 9:32 AM) | Compare | New 197 incl. all PERF/CWV/SD; `sm-…` IDs; 2.2 MB HTML |
| BUG-10 | `/` then click sidebar "Help" | DevTools Network | `?_rsc=` requests → 503 (15/20 prefetches; click nav) |
| BUG-11 | `/issues` (Website: All) | Read ID column | CNT-0001 ×2, A11Y-0001…0014 ×2 |
| BUG-12 | `/google/structured-data?project=568a…` | /brian-wheeler/ Article | Warning "datePublished missing" + Error "wrong type" |
| BUG-13 | same | /texas-fha-pre-qualification/, /texas-fha-tru-approval/ | Empty tables; summary says 20 pages with SD |
| BUG-14 | `/reports` | Category dropdown | No Performance / Core Web Vitals |
| BUG-15 | `/reports` | Tick "Only internally reviewed" → Update preview | Preview empty, Generate enabled |
| BUG-16 | `/audits/57226d00-…` | Hover health "Open" links | Same href for 3 cards |
| BUG-17 | `/issues` | Bulk dropdown | Defaults to "Confirm finding" |
| BUG-18 | `/issues/2fb88c98-…` (CNT-0001) | Review panel | Recommendation buttons on a Confirmed finding |
| BUG-20 | `/projects` vs `/` | Compare times | 9:32 vs 9:48 unlabelled; 3 cancels at 3:39 |
| BUG-21 | `/audits/56531528-…`, `/audits/c4bb683b-…`, `/audits` | Read cards | 0 pages but 109 raw findings; no reason; 0 vs 0/20 |
| BUG-22 | `/projects/<id>`, `/audits/<id>`, `/issues/<id>` | Tab title | "WebAudit Pro" |
| BUG-23 | `/this-page-does-not-exist` | Load | Default black Next.js 404 |
| BUG-24 | `/help` vs `/audits/57226d00-…` | Compare | "5–10 minutes" vs 16 m 28 s |
| BUG-25 | Re-Audit/Issues TYP-0019 | Read value | "line-height: 0.10 (1.4px on 14px text)" |

## 6. Evidence references
E01 Connections error (credentials panel cropped out) · E02 Overview · E03 My Websites · E04 Project detail · E05 Audit detail health · E06 Audit Runs · E07 New Audit advanced · E08 Issues list · E09 CWV-0011 · E10 Search "404" · E11 Reports · E12 Empty preview + enabled buttons · E13 Approvals · E14 Re-Audit · E15 SEO Overview · E16 PageSpeed latest results · E17 SEO History first vs latest · E18 Structured Data · E19 SC Performance · E20 URL Inspection · E21 Settings · E22 Help · E23 CNT-0001 evidence/review panel · E24 default 404.

## 7. Expected behaviour and acceptance criteria
Each BUG/UX entry in the register files has its own acceptance criteria. Cross-cutting criteria:
- Two screens never show different values for the same metric, audit and time (PSI, CWV, status).
- No 5xx responses during normal navigation (e2e assertion).
- Every user-visible Google error has a mapped, plain-language message, a next action, and a "Technical details" disclosure.
- No list shows two rows with the same displayed ID.

## 8. Recommended code areas to investigate [Guessing: verify with grep]
| Bug | Where to look | Search terms |
|---|---|---|
| BUG-01/02 | Google OAuth/Search Console client, connections page, shared status helper | `searchconsole`, `webmasters`, `sites.list`, `Access required`, `doesn't have permission`, `not connected` |
| BUG-03 | `app/(app)/google/pagespeed/page.tsx` data loader; PSI results repository | `Latest results`, `pagespeed`, `ORDER BY`, `analysed`, `GROUP BY` |
| BUG-04 | PSI enqueue server action + worker job handler; cache check | `Run PageSpeed Insights`, `skipCache`, `6-hour`, `enqueue`, job table |
| BUG-05/06 | PSI → findings importer; health card component | `loadingExperience`, `originLoadingExperience`, `crux:`, `Real-user Core Web Vitals` |
| BUG-07/08/09 | Re-Audit compare logic, fingerprint function, `app/(app)/reaudit/page.tsx` | `fingerprint`, `Unable to verify`, `Still present`, `Reopened` |
| BUG-10 | `middleware.ts`, custom server (if any), DB access layer error handling, worker DB locks | `503`, `Service Unavailable`, `SQLITE_BUSY`, `busy_timeout`, `NextResponse` |
| BUG-11 | Finding display-ID generator | `padStart(4`, `CNT-`, `A11Y-`, `displayId` |
| BUG-12/13 | Structured-data rules (`rules version 2026-11-03`) and validator | `wrong type`, `Recommended property`, `Not eligible`, `datePublished` |
| BUG-14/15 | `app/(app)/reports/page.tsx` options + generate actions | `structured-data`, `consistency`, `Update preview`, `Generate` |
| BUG-16 | Health card component | `Website Health`, `href={\`/issues?run=` |
| BUG-17/18 | Issues bulk form; issue review panel | `Bulk action`, `Approve recommendation` |
| BUG-20/21 | Overview activity feed, audit run summary | `Recent activity`, `updated_at`, `finished_at`, `Cancelled by a user` |
| BUG-22/23 | `generateMetadata` on detail routes; root `app/not-found.tsx` | `metadata`, `not-found` |
| BUG-25 | Typography check | `line-height`, `getComputedStyle`, `parseFloat` |

## 9. Required regression tests
- **Unit:** latest-PSI selector (3 runs/key → newest); PSI enqueue idempotency (double submit → 1 job); cache hit under 6 h; CrUX scope detection (URL vs origin fixtures); one finding per origin metric; Google error mapper (SERVICE_DISABLED, PERMISSION_DENIED, 401, network); fingerprint normalisation (random `sm-…` IDs → same hash); Re-Audit bucketing when the base audit lacks a category; SD validator single-verdict for `""`; display-ID uniqueness across projects; line-height conversion (`normal`, `%`, unitless, px).
- **Integration:** Search Console status helper returns the same state on all 6 screens for each fixture state; report category list equals the audit category list; empty report rejected server-side.
- **E2E (Playwright):** click through all sidebar links and Google tabs → assert no 5xx and no full document reload; Re-Audit first response size budget; Issues "All" view shows a Website column; health-card links carry category filters.
- **Existing behaviour to protect:** read-only crawling; domain-scope enforcement on New Audit; false positives excluded from reports; secrets never re-displayed; in-app Not found for bad IDs; security headers (X-Frame-Options DENY, nosniff, Referrer-Policy no-referrer, Permissions-Policy, no-store).

## 10. Dependencies and blockers
- **BUG-01 end-to-end verification depends on the user enabling the Search Console API** in Google Cloud project 154245030857, and on the Google account having access to the CHM/RRMH properties. Until then, test with mocked Google responses.
- BUG-05 re-import and BUG-08 re-fingerprinting depend on approval (§11) because they change historical counts.
- BUG-07 needs to know which categories each audit ran. Check whether per-audit categories/Google options are stored. If not, add that first.
- The UX-03 review queue depends on UX-02 (status vocabulary).
- Fixing BUG-10 may change navigation timing. Run the e2e suite afterwards.

## 11. Changes requiring user approval
1. Enabling the Search Console API in Google Cloud (user action, outside the code).
2. Any change to severity or count logic that alters client-facing High counts (BUG-05, UX-05).
3. Re-fingerprinting or migrating existing findings / display IDs (BUG-08, BUG-11).
4. Deleting or merging the duplicate PageSpeed results (BUG-04 cleanup).
5. Running new audits or PageSpeed calls for verification (external requests, API quota).
6. Adding a Content-Security-Policy (could break inline scripts or styles).
7. Changing report defaults (e.g., Client PDF = reviewed only).
8. Renaming status vocabulary (UX-02) if existing exported reports or client links rely on the terms.

## 12. Recommended implementation sequence
- **Sprint 1 (critical/blocked):** BUG-03 → BUG-01 → BUG-02 → BUG-10 (investigation + fix).
- **Sprint 2 (reliability/data correctness):** BUG-04 → BUG-05 → BUG-06 → BUG-11 → BUG-12 → BUG-13 → BUG-21 → BUG-25.
- **Sprint 3 (UX):** UX-02 → UX-03 → UX-07 → UX-04/05 → UX-06 (+BUG-15) → UX-09 → UX-10 → BUG-16/17/18/19/20/22/23.
- **Sprint 4 (Google SEO + reporting):** BUG-07 → BUG-08 → BUG-09/UX-08 → BUG-14 → UX-01 (guided setup) → Search Console property selection + Performance/Inspection/Sitemaps verification once the API is enabled → Google data in reports (untested so far) → UX-12/16/18.
- **Sprint 5 (security/testing/release):** CSP, role/permission tests, approval-link token/expiry tests, login rate limiting check, backup location check, full e2e regression suite, BUG-24/UX-14 docs, UX-19 account management.

**Stop condition for the implementing session:** after each sprint, report what changed and re-run the e2e checks before moving on. Don't run live audits or Google calls without approval (§11.5).

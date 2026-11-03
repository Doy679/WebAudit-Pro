# WebAudit Pro: web application (MVP)

Source: the "WebAudit Pro complete full-stack master prompt" (2026-11-03). Builds on the Phase 1 engine (`docs/design/2026-10-29-webaudit-pro-poc.md`).

## Evidence from the first real run (capitalhomemortgage.com, 20 pages)

3,874 preliminary findings, but only 855 distinct rule + element pairs.
- 2,623 were `tap-target-small` on 2×2px carousel bullets, repeated on every page and viewport.
- 506 were 24–43px targets: AAA guidance, not the WCAG 2.2 AA minimum of 24px.
- 110 `placeholder-link` were `href=""` submenu toggles from the menu plugin.
- 36 `text-clipped` were visually hidden "skip to content" links (screen-reader-only by design).

Engine changes driven by this:
1. Skip visually hidden elements (≤ 2px in either dimension).
2. Tap targets: < 24px → confirmed; 24–43px → recommendation.
3. Submenu toggles (aria-haspopup / aria-expanded / aria-controls) are not placeholder links.
4. Group findings by **fingerprint** = rule + selector with `:nth-of-type()` removed (page path added for page-level rules). One canonical finding lists every affected page, viewport and sibling instance.

New rules: broken images, broken internal links, navigation inconsistency across pages, empty headings, placeholder text, suspected misspellings (needs review), overlapping text (needs review), inconsistent repeated components (recommendation).

## Architecture

```
Browser ──► Next.js app (app/)          server components + server actions, auth, authorization
              │  reads/writes
              ▼
           SQLite (data/webaudit.db, node:sqlite, WAL)   PostgreSQL-compatible schema (TEXT ids, ISO timestamps)
              ▲  claims jobs, writes progress
              │
           Worker (worker/worker.ts, separate process)
              ├─ audit jobs  → existing engine (src/) with progress + cancel hooks
              └─ export jobs → Excel (exceljs), PDF (Playwright page.pdf), HTML, JSON
Evidence & exports: data/runs/<runId>/, data/exports/  (never in public/; served via authorized route)
```

- The web process never imports Playwright. Long work happens only in the worker (`npm run dev` starts both).
- Jobs table = persistent queue. Progress lives on the `audit_runs` row, so a refresh or reconnect just re-reads it. A worker restart marks orphaned runs as failed ("interrupted").
- Cancel sets `cancel_requested`. The engine checks it before every page load and closes the browser.

## Security
- Auth: email + password (scrypt), random session token stored hashed, httpOnly SameSite=Lax cookie. Server actions get Next's built-in Origin check.
- Roles: admin, project manager, QA reviewer, developer, client. Admin sees everything; everyone else only sees projects they are a member of. Clients never see the dashboard, only approval links.
- Scope: each project has one domain plus a recorded authorization (who, when, note). Audits only run on that domain.
- SSRF: the URL must be http(s) with no credentials. Every hostname is resolved, and private, loopback, link-local, CGNAT, metadata and multicast ranges are blocked. Checks run on discovery fetches (with manual redirect checking on each hop) and on every browser request (Playwright route). Loopback is allowed only when `WEBAUDIT_TEST_ALLOW_LOOPBACK=1` (tests).
- Approval links: 32-byte random token, only a SHA-256 hash is stored, expiry + revoke, rate-limited submissions, and the client page only shows the released findings and their evidence.
- Read-only toward audited sites: GET/HEAD only, non-GET requests aborted in the browser, no clicks or form fills.

## Data model (main tables)
users, sessions, projects, project_members, audit_runs, run_pages, issues (verification / review / implementation status, priority, assignee, notes), issue_events (history), jobs, exports, approval_packages, approval_items, client_decisions, app_settings.

## Re-audit comparison
Match by fingerprint between a base run and a new run of the same project:
- **New**: only in the new run.
- **Still present**: in both.
- **Changed**: in both, but the measured value differs.
- **Resolved**: in the base run, absent from the new run, and every affected page was scanned OK.
- **Unable to verify**: affected pages were not scanned OK.
- **Reopened**: absent from the base run but present in an earlier run of the project.

## Quality score (internal indicator)
100 − weighted confirmed findings per scanned page (high 5, medium 2, low 0.5; capped per category), then scaled by coverage (pages OK / pages attempted). Shown with its formula. Not a compliance or SEO guarantee.

## Testing
- Vitest unit tests: rules, grouping, SSRF, auth, permissions, comparison, exports (parse the XLSX, check the PDF).
- Integration: worker + engine against the local fixture site.
- E2E: Playwright drives the real Next app through the 14 scenarios in the prompt.

# WebAudit Pro — Phase 1 POC (Audit Engine)

Source: `Website_Audit_Automation_Proposal.docx`. This doc covers Phase 1 only.

## Goal
Submit a URL (or URL list), scan 10–20 pages at 5 viewports, detect verifiable layout/spacing/typography/a11y/SEO issues, and output `issues.json`, annotated screenshots and a static `report.html`. Read-only. Used to measure the false-positive rate on Capital Home Mortgage pilot pages before committing to the full MVP.

## Decisions
- **Stack:** Node + TypeScript, Playwright, axe-core, vitest. Carries forward to the Next.js/ExcelJS phases.
- **Page input:** robots.txt + sitemap.xml (and sitemap indexes) sampling with a max-page cap, or an exact `--urls` file. Same domain only.
- **Spacing:** `config/tokens.json` (8px scale by default, editable thresholds) plus a learned site baseline. Outliers are *recommendations*, not defects.
- **Run:** CLI, e.g. `npm run audit -- --url https://site.com --max-pages 20`, which writes `runs/<domain>/<timestamp>/`.
- **Checks:** layout/overflow, buttons/tap targets, typography, spacing vs tokens, axe-core accessibility, SEO/technical basics.

## Architecture
```
src/
  cli.ts
  discover/   robots, sitemap, normalize, sample/cap
  capture/    Playwright per viewport → screenshot + PageSnapshot JSON
  checks/     pure fns: PageSnapshot → Issue[] (layout, typography, buttons, spacing, seo, a11y)
  baseline/   site-wide spacing norms
  report/     dedupe, annotate screenshots, issues.json, report.html
config/tokens.json
test/fixtures/
```
Capture and checks are separate, so rules can be re-run on saved snapshots without re-crawling.

## Issue record
`id, type, rule, kind (confirmed|recommendation|needs-review), severity, confidence, location{url, viewports, selector, elementorId}, current, proposed, evidence{screenshot, boxes, computedCss, capturedAt}, recommendation, sharedTemplate, review{status, notes, reviewer}`

## Guardrails
GET only, no form submits or clicks (except an optional cookie-banner dismiss), identifiable User-Agent, robots.txt respected, 1 page at a time with ~1s delay, start domain only, page cap (default 20), 30s per-page timeout, 15,000px screenshot cap. Animations are disabled only in our own browser context.

## Errors
A page failure is logged and the run continues. 2 retries with backoff, and 429 doubles the delay. `run.json` records the run summary.

## Testing
Unit tests for each check (pure functions over fixtures), discovery, normalization, dedupe and IDs. Integration tests run real Playwright against local fixture HTML. Acceptance: a manual pilot run with false-positive review.

## Out of scope (POC)
AI layer, dashboard/DB, Excel/PDF, approval links, authenticated sites.

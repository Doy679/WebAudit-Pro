# WebAudit Pro: Phase 1 POC (audit engine)

Read-only website UX/UI audit. Give it a URL. It samples pages from the sitemap (or takes your exact URL list), renders each page at 320/390/768/1024/1440px with Playwright, measures the DOM, and reports verifiable issues with screenshots.

Design: [`docs/design/2026-10-29-webaudit-pro-poc.md`](docs/design/2026-10-29-webaudit-pro-poc.md)

## Setup

```sh
npm install
npx playwright install chromium
```

## Run an audit

```sh
# Sample up to 20 pages from the sitemap
npm run audit -- --url https://example.com --max-pages 20

# Exact pilot pages (one URL per line, # for comments)
npm run audit -- --url https://example.com --urls pilot-urls.txt

# Faster check at two widths
npm run audit -- --url https://example.com --max-pages 5 --viewports 390,1440
```

Output goes to `runs/<domain>/<timestamp>/`:

| File | What it is |
|---|---|
| `report.html` | Open in a browser. Filter by page, viewport, severity, type and kind. |
| `issues.json` | Every issue record (feeds the later dashboard/Excel/PDF phases). |
| `run.json` | Run summary: pages OK/failed/skipped, counts, settings used. |
| `screenshots/` | Full-page screenshots per page and viewport. |
| `annotated/` | Cropped screenshots with the issue highlighted. |
| `snapshots/` | Raw DOM/CSS measurements, so rules can be re-tuned without re-crawling. |

## What it checks

| Type | Rules | Kind |
|---|---|---|
| Layout | horizontal overflow, clipped text | confirmed |
| Buttons | tap target < 44px (mobile), label wraps, `#`/empty link | confirmed / needs review |
| Typography | font < 12px, tight line height, inverted heading scale | confirmed / recommendation |
| Spacing | section padding outliers vs. site median, snapped to `tokens.json` scale | recommendation |
| Accessibility | axe-core WCAG 2.1 A/AA (390 and 1440px) | violations confirmed, incomplete need review |
| SEO | HTTP errors, redirects, title, meta description, H1, canonical, noindex, lang, duplicate titles, sitemap coverage | confirmed / needs review |

**Confirmed** means measured. **Recommendation** means a design suggestion, not a defect. **Needs review** means a human must check it.

Thresholds, viewports and crawl politeness are set in [`config/tokens.json`](config/tokens.json).

## Guardrails

- GET/HEAD only. Any POST, form submission or beacon from the page is aborted in our browser.
- Same domain only, robots.txt respected, one page load at a time with a 1s delay, and the delay doubles on HTTP 429.
- Animations are frozen only in our own headless copy. The live site is never changed.
- Page cap (default 20), 30s per-page timeout, screenshots capped at 15,000px tall.

## Tests

```sh
npm test          # unit + integration (integration runs Playwright against a local fixture site)
npm run typecheck
```

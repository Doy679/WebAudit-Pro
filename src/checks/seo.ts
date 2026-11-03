import type { PageSnapshot, RawIssue, Severity, IssueKind, Tokens } from "../types.js";
import { makeIssue } from "./issue.js";
import { normalizeUrl } from "../discover/normalize.js";

const same = (a: string, b: string) => normalizeUrl(a) === normalizeUrl(b);

function seo(page: PageSnapshot, rule: string, severity: Severity, title: string, recommendation: string,
  extra: { kind?: IssueKind; current?: string; proposed?: string; confidence?: number } = {}): RawIssue {
  return makeIssue(page, {
    type: "seo",
    rule,
    kind: extra.kind ?? "confirmed",
    severity,
    confidence: extra.confidence ?? 0.95,
    title,
    current: extra.current,
    proposed: extra.proposed,
    recommendation,
  });
}

/** Per-page technical SEO checks. Run once per page (desktop snapshot). */
export function seoChecks(page: PageSnapshot, tokens: Tokens): RawIssue[] {
  const m = page.meta;
  const issues: RawIssue[] = [];

  if (m.status >= 400 || m.status === 0) {
    issues.push(seo(page, "http-error", "high", `Page returns HTTP ${m.status || "no response"}`,
      "Fix or redirect this URL, and update links pointing to it.", { current: `HTTP ${m.status}`, proposed: "HTTP 200" }));
    return issues; // Nothing else on an error page is meaningful.
  }
  if (!same(m.finalUrl, page.url)) {
    issues.push(seo(page, "redirected", "low", "URL redirects", "Link directly to the final URL to avoid an extra redirect.",
      { current: page.url, proposed: m.finalUrl }));
  }

  const title = (m.title ?? "").trim();
  if (!title) {
    issues.push(seo(page, "title-missing", "high", "Missing page title", "Add a unique, descriptive <title>."));
  } else if (title.length < tokens.title.min || title.length > tokens.title.max) {
    issues.push(seo(page, "title-length", "low", "Title length outside recommended range",
      `Aim for ${tokens.title.min}–${tokens.title.max} characters.`,
      { current: `${title.length} chars: "${title}"`, proposed: `${tokens.title.min}–${tokens.title.max} chars` }));
  }

  const desc = (m.metaDescription ?? "").trim();
  if (!desc) {
    issues.push(seo(page, "meta-description-missing", "medium", "Missing meta description",
      "Add a meta description summarizing the page."));
  } else if (desc.length < tokens.metaDescription.min || desc.length > tokens.metaDescription.max) {
    issues.push(seo(page, "meta-description-length", "low", "Meta description length outside recommended range",
      `Aim for ${tokens.metaDescription.min}–${tokens.metaDescription.max} characters.`,
      { current: `${desc.length} chars`, proposed: `${tokens.metaDescription.min}–${tokens.metaDescription.max} chars` }));
  }

  if (m.h1Count === 0) {
    issues.push(seo(page, "h1-missing", "medium", "No H1 heading", "Add one H1 describing the page topic.", { current: "0 H1", proposed: "1 H1" }));
  } else if (m.h1Count > 1) {
    issues.push(seo(page, "h1-multiple", "low", "Multiple H1 headings", "Keep a single H1 and demote the others to H2.",
      { current: `${m.h1Count} H1`, proposed: "1 H1" }));
  }

  if (!m.canonical) {
    issues.push(seo(page, "canonical-missing", "low", "No canonical tag", "Add a self-referencing canonical tag."));
  } else if (!same(m.canonical, m.finalUrl)) {
    issues.push(seo(page, "canonical-mismatch", "medium", "Canonical points to a different URL",
      "Confirm this is intentional; otherwise make the canonical self-referencing.",
      { kind: "needs-review", confidence: 0.7, current: m.canonical, proposed: m.finalUrl }));
  }

  if (/noindex/i.test(m.robotsMeta ?? "")) {
    issues.push(seo(page, "noindex", "high", "Page is set to noindex",
      "Remove noindex if this page should appear in search results.", { current: `robots: ${m.robotsMeta}` }));
  }

  if (!m.lang) {
    issues.push(seo(page, "lang-missing", "low", "Missing html lang attribute", 'Add lang="en" (or the correct language) to <html>.'));
  }

  return issues;
}

/** Checks that need every page: duplicate titles and sitemap coverage. */
export function siteSeoChecks(pages: PageSnapshot[], sitemapUrls: string[] | null): RawIssue[] {
  const issues: RawIssue[] = [];
  const ok = pages.filter((p) => p.meta.status < 400 && p.meta.status !== 0);

  const byTitle = new Map<string, PageSnapshot[]>();
  for (const p of ok) {
    const t = (p.meta.title ?? "").trim().toLowerCase();
    if (t) byTitle.set(t, [...(byTitle.get(t) ?? []), p]);
  }
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    for (const p of group) {
      issues.push(seo(p, "title-duplicate", "medium", "Title shared with other pages",
        `Write a unique title. Also used on: ${group.filter((g) => g !== p).map((g) => g.url).join(", ")}`,
        { current: p.meta.title }));
    }
  }

  if (sitemapUrls) {
    const inSitemap = new Set(sitemapUrls.map((u) => normalizeUrl(u)));
    for (const p of ok) {
      if (!inSitemap.has(normalizeUrl(p.meta.finalUrl)) && !inSitemap.has(normalizeUrl(p.url))) {
        issues.push(seo(p, "not-in-sitemap", "low", "Page missing from sitemap", "Add this indexable page to the XML sitemap."));
      }
    }
  }
  return issues;
}

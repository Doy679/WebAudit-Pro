import type { PageSnapshot, RawIssue } from "../types.js";
import { makeIssue } from "./issue.js";

/**
 * Compares each page's main navigation with the most common navigation across the site.
 * Differences are "needs review": landing pages often hide navigation on purpose.
 */
export function navigationChecks(pages: PageSnapshot[]): RawIssue[] {
  const withNav = pages.filter((p) => p.meta.navLinks?.length);
  if (withNav.length < 3) return [];
  const key = (links: string[]) => [...new Set(links)].sort().join("\n");
  const counts = new Map<string, number>();
  for (const p of withNav) counts.set(key(p.meta.navLinks!), (counts.get(key(p.meta.navLinks!)) ?? 0) + 1);
  const [majorityKey, majorityCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (majorityCount < withNav.length / 2) return []; // no clear standard to compare against
  const standard = new Set(majorityKey.split("\n"));

  const issues: RawIssue[] = [];
  for (const p of withNav) {
    const links = new Set(p.meta.navLinks);
    const missing = [...standard].filter((l) => !links.has(l));
    const extra = [...links].filter((l) => !standard.has(l));
    if (!missing.length && !extra.length) continue;
    const parts = [missing.length ? `missing: ${missing.join(", ")}` : "", extra.length ? `extra: ${extra.join(", ")}` : ""].filter(Boolean);
    issues.push(makeIssue(p, {
      type: "navigation", rule: "navigation-inconsistent", kind: "needs-review", severity: "medium", confidence: 0.6,
      title: "Navigation differs from most pages",
      current: parts.join("; "),
      proposed: `the same ${standard.size} navigation links used on ${majorityCount} of ${withNav.length} pages`,
      recommendation: "Confirm this page should have a different menu; otherwise assign the site's main menu/header template.",
    }));
  }
  return issues;
}

export interface LinkResult {
  url: string;
  status: number; // 0 = no response
  error?: string;
}

/** One finding per broken internal link, listing the pages that link to it. */
export function brokenLinkIssues(
  results: LinkResult[],
  sources: Map<string, string[]>,
  snapshotFor: (url: string) => PageSnapshot | undefined,
): RawIssue[] {
  const issues: RawIssue[] = [];
  for (const r of results) {
    if (r.status > 0 && r.status < 400) continue;
    const from = sources.get(r.url) ?? [];
    const page = snapshotFor(from[0]);
    if (!page) continue;
    const issue = makeIssue(page, {
      type: "content", rule: "broken-internal-link", kind: r.status >= 400 ? "confirmed" : "needs-review",
      severity: r.status === 404 || r.status === 410 ? "high" : "medium", confidence: r.status >= 400 ? 0.9 : 0.5,
      title: r.status ? `Internal link returns HTTP ${r.status}` : "Internal link did not respond",
      current: `${r.url} → ${r.status ? `HTTP ${r.status}` : r.error ?? "no response"}`,
      proposed: "HTTP 200, or update the link to the correct page",
      recommendation: `Fix or redirect ${r.url}, or update the links to it on: ${from.join(", ")}`,
    });
    issue.location.selector = `a[href="${r.url}"]`;
    issues.push(issue);
  }
  return issues;
}

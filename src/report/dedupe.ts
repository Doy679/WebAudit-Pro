import { createHash } from "node:crypto";
import type { Issue, IssueType, RawIssue, Severity } from "../types.js";

const PREFIX: Record<IssueType, string> = {
  seo: "SEO", layout: "LAY", typography: "TYP", buttons: "BTN", spacing: "SPC", a11y: "A11Y",
  content: "CNT", navigation: "NAV", consistency: "CMP",
};
const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const MAX_BOXES = 20;

/** Selector with sibling positions removed, so repeated instances of one component match. */
export const normalizeSelector = (s: string) => s.replace(/:nth-of-type\(\d+\)/g, "").replace(/\s+/g, " ").trim();

/**
 * Stable identity of a finding across pages, viewports and runs.
 * Element rules: rule + normalized selector. Page-level rules (no selector): rule + page path.
 */
export function fingerprint(r: Pick<RawIssue, "rule" | "location">): string {
  const where = r.location.selector ? normalizeSelector(r.location.selector) : `page:${pagePath(r.location.url)}`;
  return createHash("sha1").update(`${r.rule}|${where}`).digest("hex").slice(0, 16);
}

function pagePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/**
 * Merges raw single-viewport findings into canonical findings (one per fingerprint), keeping every
 * page, viewport and instance, then numbers them per type with the worst first.
 */
export function dedupeAndNumber(raw: RawIssue[]): Issue[] {
  const groups = new Map<string, RawIssue[]>();
  for (const r of raw) {
    const fp = fingerprint(r);
    groups.set(fp, [...(groups.get(fp) ?? []), r]);
  }

  const merged = [...groups.entries()].map(([fp, group]): Omit<Issue, "id"> => {
    const worst = [...group].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.confidence - a.confidence)[0];
    const pages = [...new Set(group.map((g) => g.location.url))].sort();
    const primaryUrl = pages.includes(worst.location.url) ? worst.location.url : pages[0];
    // Evidence comes from the primary page: one screenshot per viewport, all instance boxes at the first viewport.
    const onPrimary = group.filter((g) => g.location.url === primaryUrl).sort((a, b) => a.location.viewport - b.location.viewport);
    const firstVp = onPrimary[0].location.viewport;
    const screenshots = [...new Map(onPrimary.map((g) => [g.location.viewport, g.evidence.screenshot])).entries()]
      .map(([viewport, path]) => ({ viewport, path }));
    const boxes = onPrimary.filter((g) => g.location.viewport === firstVp).flatMap((g) => g.evidence.boxes).slice(0, MAX_BOXES);
    const instances = new Set(group.map((g) => `${g.location.url}|${g.location.selector ?? ""}`));

    return {
      type: worst.type,
      rule: worst.rule,
      kind: worst.kind,
      severity: worst.severity,
      confidence: Math.max(...group.map((g) => g.confidence)),
      title: worst.title,
      fingerprint: fp,
      location: {
        url: primaryUrl,
        pages,
        viewports: [...new Set(group.map((g) => g.location.viewport))].sort((a, b) => a - b),
        selector: worst.location.selector,
        elementorId: worst.location.elementorId,
      },
      instanceCount: instances.size,
      occurrences: group.map((g) => ({
        url: g.location.url,
        viewport: g.location.viewport,
        selector: g.location.selector,
        screenshot: g.evidence.screenshot,
        boxes: g.evidence.boxes,
      })),
      current: worst.current,
      proposed: worst.proposed,
      evidence: {
        screenshots,
        boxes,
        computedCss: worst.evidence.computedCss,
        capturedAt: worst.evidence.capturedAt,
      },
      recommendation: worst.recommendation,
      // Element findings repeated on several pages come from a shared template or global widget.
      sharedTemplate: group.some((g) => g.sharedTemplate) || (pages.length > 1 && !!worst.location.selector) || undefined,
      review: { status: "pending", notes: "", reviewer: null },
    };
  });

  merged.sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      a.location.url.localeCompare(b.location.url) ||
      a.rule.localeCompare(b.rule) ||
      (a.location.selector ?? "").localeCompare(b.location.selector ?? ""),
  );

  const counters = new Map<string, number>();
  return merged.map((m) => {
    const prefix = PREFIX[m.type];
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return { id: `${prefix}-${String(n).padStart(4, "0")}`, ...m };
  });
}

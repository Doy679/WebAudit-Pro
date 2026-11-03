import type { Issue, IssueType, RawIssue, Severity } from "../types.js";

const PREFIX: Record<IssueType, string> = { seo: "SEO", layout: "LAY", typography: "TYP", buttons: "BTN", spacing: "SPC", a11y: "A11Y" };
const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** Merges the same rule + selector + URL across viewports, then numbers issues per type, worst first. */
export function dedupeAndNumber(raw: RawIssue[]): Issue[] {
  const groups = new Map<string, RawIssue[]>();
  for (const r of raw) {
    const key = [r.location.url, r.rule, r.location.selector ?? ""].join("|");
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const merged = [...groups.values()].map((group): Omit<Issue, "id"> => {
    const sorted = [...group].sort((a, b) => a.location.viewport - b.location.viewport);
    const worst = [...group].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.confidence - a.confidence)[0];
    const first = sorted[0];
    return {
      type: first.type,
      rule: first.rule,
      kind: first.kind,
      severity: worst.severity,
      confidence: Math.max(...group.map((g) => g.confidence)),
      title: first.title,
      location: {
        url: first.location.url,
        viewports: [...new Set(sorted.map((g) => g.location.viewport))],
        selector: first.location.selector,
        elementorId: first.location.elementorId,
      },
      current: worst.current,
      proposed: worst.proposed,
      evidence: {
        screenshots: sorted.map((g) => ({ viewport: g.location.viewport, path: g.evidence.screenshot })),
        boxes: worst.evidence.boxes,
        computedCss: worst.evidence.computedCss,
        capturedAt: worst.evidence.capturedAt,
      },
      recommendation: worst.recommendation,
      sharedTemplate: group.some((g) => g.sharedTemplate) || undefined,
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

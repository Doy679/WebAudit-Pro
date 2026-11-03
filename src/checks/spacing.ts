import type { PageSnapshot, RawIssue, Tokens } from "../types.js";
import { baselineKey, SPACING_PROPS, type Baseline } from "../baseline/spacing.js";
import { makeIssue, elementorHint } from "./issue.js";

const cssName = (prop: string) => prop.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
const nearest = (scale: number[], v: number) => scale.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

/** Section padding far from the site's own norm. Always a design recommendation, never a defect. */
export function spacingChecks(page: PageSnapshot, baseline: Baseline, tokens: Tokens): RawIssue[] {
  const { minDeviationPx, outlierRatio, minSamples } = tokens.spacing;
  const issues: RawIssue[] = [];

  for (const e of page.elements) {
    if (e.role !== "section" || !e.sectionKind) continue;
    const norms = baseline.get(baselineKey(e.sectionKind, page.viewport));
    if (!norms) continue;

    for (const prop of SPACING_PROPS) {
      const value = e.css[prop];
      const norm = norms[prop];
      if (typeof value !== "number" || !norm || norm.samples < minSamples) continue;
      const diff = Math.abs(value - norm.median);
      const ratio = Math.max(value, norm.median) / Math.max(1, Math.min(value, norm.median));
      if (diff < minDeviationPx || ratio < outlierRatio) continue;

      const target = nearest(tokens.spacingScale, norm.median);
      issues.push(
        makeIssue(page, {
          type: "spacing",
          rule: "section-padding-outlier",
          kind: "recommendation",
          severity: diff >= 48 ? "medium" : "low",
          confidence: Math.min(0.85, 0.5 + norm.samples * 0.05),
          title: `Section ${cssName(prop).replace("padding-", "")} spacing differs from the rest of the site`,
          current: `${cssName(prop)}: ${value}px`,
          proposed: `${cssName(prop)}: ${target}px (token nearest the site median of ${norm.median}px for "${e.sectionKind}" sections at ${page.viewport}px, ${norm.samples} samples)`,
          recommendation: `Align this section's spacing with similar sections for a consistent rhythm.` + elementorHint(e, "Advanced → Padding"),
          element: e,
          computedCss: { [cssName(prop)]: `${value}px` },
        }),
      );
    }
  }
  return issues;
}

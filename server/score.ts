// Audit quality score: an internal indicator, documented so anyone can recompute it.
//   1. Only confirmed findings that are not marked false positive count.
//   2. Deduction per page scanned: high 5, medium 2, low 0.5 points per finding ÷ pages scanned OK.
//      Each category (layout, a11y, seo, …) can deduct at most 25 points, so one noisy rule cannot zero the score.
//   3. Coverage factor: pages scanned OK ÷ pages attempted.
//   score = max(0, 100 − deductions) × coverage, rounded.

const WEIGHT: Record<string, number> = { high: 5, medium: 2, low: 0.5 };
const CATEGORY_CAP = 25;

export interface ScoreInput {
  kind: string;
  severity: string;
  type: string;
  verification_status?: string;
}

export function qualityScore(issues: ScoreInput[], pagesOk: number, pagesAttempted: number) {
  const counted = issues.filter((i) => i.kind === "confirmed" && i.verification_status !== "false_positive");
  const perCategory = new Map<string, number>();
  for (const i of counted) {
    perCategory.set(i.type, (perCategory.get(i.type) ?? 0) + (WEIGHT[i.severity] ?? 0) / Math.max(pagesOk, 1));
  }
  const deductions = [...perCategory.values()].reduce((s, d) => s + Math.min(d, CATEGORY_CAP), 0);
  const coverage = pagesAttempted ? pagesOk / pagesAttempted : 0;
  const score = Math.round(Math.max(0, 100 - deductions) * coverage);
  return {
    score,
    coverage,
    deductions: Math.round(deductions * 10) / 10,
    byCategory: Object.fromEntries([...perCategory.entries()].map(([k, v]) => [k, Math.round(Math.min(v, CATEGORY_CAP) * 10) / 10])),
    explanation:
      "Internal quality indicator, not a guarantee of accessibility, SEO or compliance. " +
      "100 minus weighted confirmed findings per scanned page (high 5, medium 2, low 0.5; max 25 per category), multiplied by scan coverage.",
  };
}

import { describe, it, expect } from "vitest";
import { dedupeAndNumber } from "../src/report/dedupe.js";
import type { RawIssue } from "../src/types.js";

function raw(over: Partial<RawIssue> & { viewport: number; selector?: string; url?: string }): RawIssue {
  const { viewport, selector, url, ...rest } = over;
  return {
    type: "buttons",
    rule: "tap-target-small",
    kind: "confirmed",
    severity: "medium",
    confidence: 0.9,
    title: "Tap target too small",
    current: "30px tall",
    proposed: "at least 44px",
    recommendation: "Increase padding",
    location: { url: url ?? "https://example.com/", viewport, selector: selector ?? ".cta" },
    evidence: { screenshot: `screenshots/home/${viewport}.png`, boxes: [{ x: 0, y: 0, w: 80, h: 30 }], capturedAt: "t" },
    ...rest,
  };
}

describe("dedupeAndNumber", () => {
  it("merges the same rule + selector + url across viewports", () => {
    const issues = dedupeAndNumber([raw({ viewport: 390 }), raw({ viewport: 320 }), raw({ viewport: 768 })]);
    expect(issues).toHaveLength(1);
    expect(issues[0].location.viewports).toEqual([320, 390, 768]);
    expect(issues[0].evidence.screenshots.map((s) => s.viewport)).toEqual([320, 390, 768]);
  });

  it("keeps the highest severity and confidence when merging", () => {
    const [issue] = dedupeAndNumber([raw({ viewport: 390, severity: "low", confidence: 0.5 }), raw({ viewport: 320, severity: "high", confidence: 0.8 })]);
    expect(issue.severity).toBe("high");
    expect(issue.confidence).toBe(0.8);
  });

  it("keeps different selectors and pages separate", () => {
    const issues = dedupeAndNumber([
      raw({ viewport: 390 }), raw({ viewport: 390, selector: ".other" }), raw({ viewport: 390, url: "https://example.com/b" }),
    ]);
    expect(issues).toHaveLength(3);
  });

  it("assigns stable type-prefixed IDs, high severity first", () => {
    const issues = dedupeAndNumber([
      raw({ viewport: 390, severity: "low" }),
      raw({ viewport: 390, type: "seo", rule: "http-error", severity: "high", selector: undefined }),
      raw({ viewport: 390, type: "spacing", rule: "section-padding-outlier", selector: ".s1" }),
    ]);
    expect(issues.map((i) => i.id)).toEqual(["SEO-0001", "SPC-0001", "BTN-0001"]);
  });

  it("starts every issue as pending review", () => {
    const [issue] = dedupeAndNumber([raw({ viewport: 390 })]);
    expect(issue.review).toEqual({ status: "pending", notes: "", reviewer: null });
  });
});

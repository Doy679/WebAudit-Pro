import type { ElementSnapshot, PageSnapshot, RawIssue, Tokens } from "../types.js";
import { makeIssue, elementorHint } from "./issue.js";

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function typographyChecks(page: PageSnapshot, tokens: Tokens): RawIssue[] {
  const issues: RawIssue[] = [];

  for (const e of page.elements) {
    const fs = e.css.fontSize;
    if (!fs || !(e.text ?? "").trim()) continue;

    if ((e.role === "text" || e.role === "link" || e.role === "button") && fs < tokens.minFontSizePx) {
      issues.push(
        makeIssue(page, {
          type: "typography",
          rule: "font-too-small",
          kind: "confirmed",
          severity: "medium",
          confidence: 0.9,
          title: "Text too small to read",
          current: `font-size: ${fs}px`,
          proposed: `font-size: ${tokens.minFontSizePx}px or larger`,
          recommendation: "Increase the font size for readability." + elementorHint(e, "Style → Typography → Size"),
          element: e,
        }),
      );
    }

    const lh = e.css.lineHeight;
    if (e.role === "text" && lh && fs <= 20 && lh / fs < tokens.bodyLineHeightMin) {
      issues.push(
        makeIssue(page, {
          type: "typography",
          rule: "line-height-tight",
          kind: "recommendation",
          severity: "low",
          confidence: 0.7,
          title: "Body text lines are cramped",
          current: `line-height: ${(lh / fs).toFixed(2)} (${lh}px on ${fs}px text)`,
          proposed: `line-height: ${tokens.bodyLineHeightMin}–1.6`,
          recommendation: "Increase line height for paragraphs." + elementorHint(e, "Style → Typography → Line-Height"),
          element: e,
        }),
      );
    }
  }

  // Heading scale: a lower-level heading should not be bigger than a higher one.
  const byLevel = new Map<number, ElementSnapshot[]>();
  for (const e of page.elements) {
    const m = e.role === "heading" && e.tag.match(/^h([1-6])$/i);
    if (m && e.css.fontSize) byLevel.set(+m[1], [...(byLevel.get(+m[1]) ?? []), e]);
  }
  const levels = [...byLevel.keys()].sort();
  for (let i = 0; i < levels.length - 1; i++) {
    const hi = levels[i], lo = levels[i + 1];
    const hiSize = median(byLevel.get(hi)!.map((e) => e.css.fontSize!));
    const offenders = byLevel.get(lo)!.filter((e) => e.css.fontSize! > hiSize + 1);
    for (const e of offenders) {
      issues.push(
        makeIssue(page, {
          type: "typography",
          rule: "heading-scale-inverted",
          kind: "recommendation",
          severity: "medium",
          confidence: 0.75,
          title: `H${lo} is larger than H${hi}`,
          current: `h${lo} ${e.css.fontSize}px vs h${hi} ${hiSize}px`,
          proposed: `h${lo} smaller than ${hiSize}px`,
          recommendation:
            "Keep a consistent heading scale (H1 > H2 > H3) so the page hierarchy is clear." +
            elementorHint(e, "Style → Typography → Size, or change the HTML tag"),
          element: e,
        }),
      );
    }
  }

  return issues;
}

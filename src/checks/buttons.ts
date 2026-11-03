import type { PageSnapshot, RawIssue, Tokens } from "../types.js";
import { makeIssue, elementorHint, isVisuallyHidden } from "./issue.js";

const TAP_AA_MIN = 24;

export function buttonChecks(page: PageSnapshot, tokens: Tokens): RawIssue[] {
  const issues: RawIssue[] = [];
  const min = tokens.tapTargetMinPx;
  const mobile = page.viewport <= tokens.tapTargetMobileMaxViewport;

  for (const e of page.elements) {
    if (e.role !== "button" && e.role !== "link") continue;
    if (isVisuallyHidden(e)) continue;
    const label = (e.text ?? "").slice(0, 40);

    const minSide = Math.min(e.box.w, e.box.h);
    if (mobile && minSide < min) {
      // WCAG 2.2 AA (2.5.8) requires 24px; 44px is the AAA / platform guideline.
      const failsAA = minSide < TAP_AA_MIN;
      issues.push(
        makeIssue(page, {
          type: "buttons",
          rule: failsAA ? "tap-target-small" : "tap-target-below-44",
          kind: failsAA ? "confirmed" : "recommendation",
          severity: failsAA ? "medium" : "low",
          confidence: failsAA ? 0.9 : 0.75,
          title: failsAA ? "Tap target below the 24px minimum" : `Tap target smaller than the recommended ${min}px`,
          current: `${Math.round(e.box.w)}×${Math.round(e.box.h)}px`,
          proposed: failsAA ? `at least ${TAP_AA_MIN}×${TAP_AA_MIN}px (WCAG 2.2 AA), ideally ${min}×${min}px` : `${min}×${min}px (WCAG AAA / mobile guideline)`,
          recommendation:
            `Increase padding on "${label}" so it is easier to tap on mobile.` +
            elementorHint(e, "Style → Padding"),
          element: e,
        }),
      );
    }

    if (e.role === "button" && (e.lineCount ?? 1) > 1) {
      issues.push(
        makeIssue(page, {
          type: "buttons",
          rule: "button-text-wraps",
          kind: "confirmed",
          severity: "low",
          confidence: 0.85,
          title: "Button label wraps",
          current: `"${label}" renders on ${e.lineCount} lines`,
          proposed: "single line",
          recommendation:
            "Shorten the label, reduce font size or let the button grow wider at this viewport." +
            elementorHint(e, "Style → Typography / Button width"),
          element: e,
        }),
      );
    }

    const href = e.href?.trim();
    if (e.role === "button" && !e.toggle && href !== undefined && (href === "" || href === "#")) {
      issues.push(
        makeIssue(page, {
          type: "buttons",
          rule: "placeholder-link",
          kind: "needs-review",
          severity: "medium",
          confidence: 0.6,
          title: "Button links nowhere",
          current: `href="${href}"`,
          proposed: "a real destination URL (or confirm it opens a popup)",
          recommendation: `Check where "${label}" should go and set its link.` + elementorHint(e, "Content → Link"),
          element: e,
        }),
      );
    }
  }
  return issues;
}

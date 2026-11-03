import type { PageSnapshot, RawIssue, Tokens } from "../types.js";
import { makeIssue, elementorHint } from "./issue.js";

export function buttonChecks(page: PageSnapshot, tokens: Tokens): RawIssue[] {
  const issues: RawIssue[] = [];
  const min = tokens.tapTargetMinPx;
  const mobile = page.viewport <= tokens.tapTargetMobileMaxViewport;

  for (const e of page.elements) {
    if (e.role !== "button" && e.role !== "link") continue;
    const label = (e.text ?? "").slice(0, 40);

    if (mobile && e.box.w > 0 && e.box.h > 0 && (e.box.w < min || e.box.h < min)) {
      issues.push(
        makeIssue(page, {
          type: "buttons",
          rule: "tap-target-small",
          kind: "confirmed",
          severity: "medium",
          confidence: 0.9,
          title: "Tap target too small",
          current: `${Math.round(e.box.w)}×${Math.round(e.box.h)}px`,
          proposed: `at least ${min}×${min}px`,
          recommendation:
            `Increase padding on "${label}" so it is at least ${min}px in both directions on mobile.` +
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
    if (e.role === "button" && href !== undefined && (href === "" || href === "#")) {
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

import type { PageSnapshot, RawIssue, Tokens } from "../types.js";
import { makeIssue, elementorHint, isVisuallyHidden } from "./issue.js";

const CLIPS = new Set(["hidden", "clip"]);
const TEXTUAL = new Set(["text", "heading", "button", "link"]);

export function layoutChecks(page: PageSnapshot, _tokens: Tokens): RawIssue[] {
  const issues: RawIssue[] = [];
  const vw = page.viewport;

  if (page.docWidth > vw + 1) {
    // Widest element sticking out past the viewport is the most likely culprit.
    const culprit = page.elements
      .filter((e) => e.box.x + e.box.w > vw + 1)
      .sort((a, b) => b.box.x + b.box.w - (a.box.x + a.box.w))[0];
    issues.push(
      makeIssue(page, {
        type: "layout",
        rule: "horizontal-overflow",
        kind: "confirmed",
        severity: "high",
        confidence: 0.95,
        title: "Page scrolls sideways",
        current: `document width ${page.docWidth}px at ${vw}px viewport`,
        proposed: `document width ≤ ${vw}px`,
        recommendation:
          "Constrain the widest element (max-width: 100%, remove fixed widths or negative margins) so the page does not scroll horizontally." +
          elementorHint(culprit, "Advanced → Width / Custom width"),
        element: culprit,
      }),
    );
  }

  for (const e of page.elements) {
    if (!TEXTUAL.has(e.role) || !e.scroll || isVisuallyHidden(e)) continue;
    const clipsX = CLIPS.has(e.css.overflowX ?? "") && e.scroll.sw > e.scroll.cw + 1;
    const clipsY = CLIPS.has(e.css.overflowY ?? "") && e.scroll.sh > e.scroll.ch + 1;
    if (!clipsX && !clipsY) continue;
    issues.push(
      makeIssue(page, {
        type: "layout",
        rule: "text-clipped",
        kind: "confirmed",
        severity: "medium",
        confidence: 0.85,
        title: "Text is cut off",
        current: clipsY
          ? `content height ${e.scroll.sh}px in ${e.scroll.ch}px box`
          : `content width ${e.scroll.sw}px in ${e.scroll.cw}px box`,
        proposed: "box grows with its content (no fixed height / overflow hidden)",
        recommendation:
          `Remove the fixed height or overflow:hidden on "${(e.text ?? "").slice(0, 40)}" so the full text shows.` +
          elementorHint(e, "Advanced → Overflow / Height"),
        element: e,
      }),
    );
  }

  return issues;
}

import type { ElementSnapshot, PageSnapshot, RawIssue } from "../types.js";
import { makeIssue, elementorHint, isVisuallyHidden } from "./issue.js";

/** Component signature: last selector step with Elementor IDs and :nth-of-type removed, e.g. "a.elementor-button.elementor-size-md". */
function signature(e: ElementSnapshot): string | null {
  const last = e.selector.split(">").pop()!.trim().replace(/:nth-of-type\(\d+\)/g, "").replace(/\.elementor-element-[0-9a-f]+/g, "");
  return last.includes(".") ? last : null; // a bare tag is too generic to compare
}

const describeVariant = (e: ElementSnapshot) => `${Math.round(e.box.h)}px tall, ${e.css.fontSize ?? "?"}px text`;

/**
 * Buttons sharing a component class should render the same size at the same viewport.
 * Pages using a minority size are flagged as a recommendation.
 */
export function componentChecks(pages: PageSnapshot[]): RawIssue[] {
  const groups = new Map<string, { page: PageSnapshot; el: ElementSnapshot }[]>();
  for (const p of pages) {
    for (const e of p.elements) {
      if (e.role !== "button" || isVisuallyHidden(e)) continue;
      const sig = signature(e);
      if (!sig) continue;
      const key = `${sig}@${p.viewport}`;
      groups.set(key, [...(groups.get(key) ?? []), { page: p, el: e }]);
    }
  }

  const issues: RawIssue[] = [];
  for (const members of groups.values()) {
    if (members.length < 3) continue;
    const variant = (m: { el: ElementSnapshot }) => `${Math.round(m.el.box.h / 4) * 4}|${m.el.css.fontSize ?? ""}`;
    const counts = new Map<string, number>();
    for (const m of members) counts.set(variant(m), (counts.get(variant(m)) ?? 0) + 1);
    if (counts.size < 2) continue;
    const [standardKey, standardCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (standardCount / members.length < 0.6) continue; // no clear standard
    const standard = members.find((m) => variant(m) === standardKey)!;
    for (const m of members.filter((m) => variant(m) !== standardKey)) {
      issues.push(makeIssue(m.page, {
        type: "consistency", rule: "inconsistent-component", kind: "recommendation", severity: "low", confidence: 0.65,
        title: "Button differs from the same component elsewhere",
        current: describeVariant(m.el),
        proposed: `${describeVariant(standard.el)} (used by ${standardCount} of ${members.length} instances at ${m.page.viewport}px)`,
        recommendation: "Use the global button style so this button matches the others." + elementorHint(m.el, "Style → Typography / Padding, or apply the global style"),
        element: m.el,
      }));
    }
  }
  return issues;
}

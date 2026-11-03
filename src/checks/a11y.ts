import type { PageSnapshot, RawIssue, Severity } from "../types.js";
import { makeIssue } from "./issue.js";

/** Minimal shape of axe-core results that we use. */
export interface AxeLike {
  violations: AxeRule[];
  incomplete: AxeRule[];
}
interface AxeRule {
  id: string;
  impact?: string | null;
  help: string;
  helpUrl: string;
  nodes: { target: unknown[]; failureSummary?: string }[];
}

const SEVERITY: Record<string, Severity> = { critical: "high", serious: "high", moderate: "medium", minor: "low" };
const MAX_NODES_PER_RULE = 10;
const PAGE_LEVEL = new Set(["html", "body", "head"]);

/** Violations become confirmed issues; "incomplete" (axe couldn't decide) need human review. */
export function a11yIssues(page: PageSnapshot, axe: AxeLike): RawIssue[] {
  const issues: RawIssue[] = [];
  const add = (rule: AxeRule, kind: "confirmed" | "needs-review") => {
    for (const node of rule.nodes.slice(0, MAX_NODES_PER_RULE)) {
      const selector = node.target.map(String).join(" ");
      // Page-level targets would highlight the whole screenshot, which shows nothing useful.
      const match = PAGE_LEVEL.has(selector) ? undefined : page.elements.find((e) => e.selector === selector);
      const issue = makeIssue(page, {
        type: "a11y",
        rule: `axe:${rule.id}`,
        kind,
        severity: SEVERITY[rule.impact ?? ""] ?? "medium",
        confidence: kind === "confirmed" ? 0.85 : 0.5,
        title: rule.help,
        current: node.failureSummary?.replace(/\s+/g, " ").trim(),
        recommendation: `${rule.help}. Guidance: ${rule.helpUrl}`,
        element: match,
      });
      issue.location.selector = selector;
      issues.push(issue);
    }
  };
  for (const r of axe.violations) add(r, "confirmed");
  for (const r of axe.incomplete) add(r, "needs-review");
  return issues;
}

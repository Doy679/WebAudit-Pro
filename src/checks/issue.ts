import type { ElementSnapshot, IssueKind, IssueType, PageSnapshot, RawIssue, Severity } from "../types.js";

interface IssueInput {
  type: IssueType;
  rule: string;
  kind: IssueKind;
  severity: Severity;
  confidence: number;
  title: string;
  current?: string;
  proposed?: string;
  recommendation: string;
  element?: ElementSnapshot;
  computedCss?: Record<string, unknown>;
}

/** Builds a single-viewport issue tied to a page snapshot (and optionally one element). */
export function makeIssue(page: PageSnapshot, input: IssueInput): RawIssue {
  const { element, computedCss, ...rest } = input;
  return {
    ...rest,
    sharedTemplate: element?.sharedTemplate || undefined,
    location: {
      url: page.url,
      viewport: page.viewport,
      selector: element?.selector,
      elementorId: element?.elementorId,
    },
    evidence: {
      screenshot: page.screenshot,
      boxes: element ? [element.box] : [],
      computedCss: computedCss ?? (element ? { ...element.css } : undefined),
      capturedAt: page.capturedAt,
    },
  };
}

/** Elementor-specific hint appended to recommendations when we know the widget. */
export function elementorHint(element: ElementSnapshot | undefined, setting: string): string {
  if (!element?.elementorId) return "";
  return ` In Elementor: edit element ${element.elementorId} → ${setting}.`;
}

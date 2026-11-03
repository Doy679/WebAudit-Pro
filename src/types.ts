// Shared data shapes for the audit engine.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One measured element on a page at one viewport. */
export interface ElementSnapshot {
  selector: string;
  tag: string;
  role: "section" | "heading" | "button" | "link" | "text" | "input" | "image" | "other";
  box: Box;
  text?: string;
  elementorId?: string;
  /** True when the element lives in a header/footer/global template shared across pages. */
  sharedTemplate?: boolean;
  /** Section type hint used for spacing comparisons, e.g. "hero", "section". */
  sectionKind?: string;
  css: {
    paddingTop?: number;
    paddingBottom?: number;
    marginTop?: number;
    marginBottom?: number;
    fontSize?: number;
    lineHeight?: number; // px
    whiteSpace?: string;
    overflowX?: string;
    overflowY?: string;
  };
  /** scrollWidth/scrollHeight vs clientWidth/clientHeight, to detect clipping. */
  scroll?: { sw: number; cw: number; sh: number; ch: number };
  /** Number of rendered text lines (buttons only). */
  lineCount?: number;
  /** Link target (links/buttons only). */
  href?: string;
  /** Menu/accordion toggle (aria-haspopup, aria-expanded or aria-controls): an empty href is intended. */
  toggle?: boolean;
  /** Image failed to load (images only). */
  broken?: boolean;
  src?: string;
  /** Selector of another text element this one visibly overlaps. */
  overlaps?: string;
}

export interface PageMeta {
  status: number;
  finalUrl: string;
  title?: string;
  metaDescription?: string;
  canonical?: string;
  robotsMeta?: string;
  h1Count: number;
  lang?: string;
  /** Absolute hrefs of the header/main navigation links. */
  navLinks?: string[];
  /** Absolute same-site hrefs found on the page (for broken-link checks). */
  links?: string[];
}

export interface PageSnapshot {
  url: string;
  viewport: number;
  capturedAt: string;
  screenshot: string; // path relative to run dir
  docWidth: number;
  docHeight: number;
  meta: PageMeta;
  elements: ElementSnapshot[];
}

export type IssueType = "layout" | "typography" | "buttons" | "spacing" | "a11y" | "seo" | "content" | "navigation" | "consistency";
export type IssueKind = "confirmed" | "recommendation" | "needs-review";
export type Severity = "high" | "medium" | "low";
export type ReviewStatus = "pending" | "approved" | "revision-requested" | "rejected";

export interface Issue {
  id: string;
  type: IssueType;
  rule: string;
  kind: IssueKind;
  severity: Severity;
  confidence: number;
  title: string;
  /** Stable identity across runs: rule + selector without :nth-of-type (+ page path for page-level rules). */
  fingerprint: string;
  location: {
    url: string;
    /** Every page where this finding occurs (shared components list many). */
    pages: string[];
    viewports: number[];
    selector?: string;
    elementorId?: string;
  };
  /** Number of distinct element instances (page + selector) behind this finding. */
  instanceCount: number;
  /** Every raw occurrence, for traceability. */
  occurrences: { url: string; viewport: number; selector?: string; screenshot: string; boxes: Box[] }[];
  current?: string;
  proposed?: string;
  evidence: {
    screenshots: { viewport: number; path: string }[];
    /** Cropped screenshot with the issue's boxes drawn on it. */
    annotated?: string;
    boxes: Box[];
    computedCss?: Record<string, unknown>;
    capturedAt: string;
  };
  recommendation: string;
  sharedTemplate?: boolean;
  review: { status: ReviewStatus; notes: string; reviewer: string | null };
}

/** An issue before ID assignment and dedupe. Single viewport. */
export type RawIssue = Omit<Issue, "id" | "location" | "evidence" | "review" | "fingerprint" | "instanceCount" | "occurrences"> & {
  location: { url: string; viewport: number; selector?: string; elementorId?: string };
  evidence: { screenshot: string; boxes: Box[]; computedCss?: Record<string, unknown>; capturedAt: string };
};

export interface Tokens {
  viewports: number[];
  a11yViewports: number[];
  spacingScale: number[];
  spacing: { minDeviationPx: number; outlierRatio: number; minSamples: number };
  tapTargetMinPx: number;
  tapTargetMobileMaxViewport: number;
  bodyLineHeightMin: number;
  minFontSizePx: number;
  title: { min: number; max: number };
  metaDescription: { min: number; max: number };
  crawl: {
    maxPages: number;
    delayMs: number;
    pageTimeoutMs: number;
    maxScreenshotHeight: number;
    retries: number;
    userAgent: string;
    /** Max internal links to check per audit (HEAD requests). */
    maxLinkChecks?: number;
    /** Installed browser to drive ("msedge", "chrome"), or "" for Playwright's bundled Chromium. */
    browserChannel?: string;
  };
}

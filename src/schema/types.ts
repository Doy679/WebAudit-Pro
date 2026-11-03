// Raw structured data captured from a rendered page (see src/capture/structured.browser.js).
export interface MicroNode {
  selector?: string;
  types: string[];
  id?: string;
  props: Record<string, (string | MicroNode)[]>;
}

export interface StructuredDataCapture {
  jsonld: { index: number; text: string }[];
  microdata: MicroNode[];
  rdfa: MicroNode[];
  /** Visible page text (bounded), used to check that marked-up content is shown to users. */
  visibleText: string;
}

export type SdRuleId =
  | "syntax" | "too-large" | "missing-type" | "context" | "required" | "required-one-of" | "recommended"
  | "type" | "reference" | "duplicate" | "visible-content";

export interface SdIssue {
  ruleId: SdRuleId;
  severity: "error" | "warning";
  property: string;
  message: string;
  current: string | null;
  expected: string | null;
  docUrl?: string;
}

export interface SdItem {
  format: "json-ld" | "microdata" | "rdfa";
  /** "json-ld block 2" or the element selector for microdata/RDFa. */
  source: string;
  types: string[];
  name: string | null;
  /** Google Search feature this type is a candidate for, or null when Google documents no rich result for it. */
  googleFeature: string | null;
  /** invalid: unparseable · errors/warnings: parsed with issues · valid: structurally valid. */
  status: "valid" | "warnings" | "errors" | "invalid";
  /** Internal candidate check only; never an official Rich Results Test verdict. */
  eligibility: "candidate" | "missing-required" | "no-google-feature" | "invalid";
  issues: SdIssue[];
  snippet: string;
}

export interface SdResult {
  rulesVersion: string;
  items: SdItem[];
}

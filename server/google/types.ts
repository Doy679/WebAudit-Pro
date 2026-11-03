// Shared shapes for Google integrations. Every value carries its source; nothing is filled in when Google omits it.

export type Strategy = "mobile" | "desktop";
export type CwvCategory = "good" | "needs-improvement" | "poor";

export interface LabMetric { value: number; unit: "ms" | "unitless"; display: string; score: number | null }
export interface FieldMetric { p75: number; unit: "ms" | "unitless"; category: CwvCategory }
export type FieldKey = "lcp" | "inp" | "cls" | "fcp" | "ttfb";

export interface FieldData {
  /** psi-crux: CrUX data embedded in a PageSpeed response. crux-api: queried from the Chrome UX Report API. */
  source: "psi-crux" | "crux-api";
  scope: "url" | "origin";
  overall?: CwvCategory | null;
  period?: string;
  metrics: Partial<Record<FieldKey, FieldMetric>>;
}

export interface LhAudit {
  id: string;
  title: string;
  description: string;
  score: number | null;
  displayValue?: string;
  savingsMs?: number;
  savingsBytes?: number;
  metricSavings?: Record<string, number>;
  /** Up to 5 offending resources (url + bytes/ms) from the audit's details table. */
  items: { url?: string; totalBytes?: number; wastedBytes?: number; wastedMs?: number }[];
}

export interface PsiResult {
  requestedUrl: string;
  finalUrl: string;
  strategy: Strategy;
  analysisTimestamp: string;
  fetchTime: string;
  lighthouseVersion: string;
  scores: { performance: number | null; accessibility: number | null; bestPractices: number | null; seo: number | null };
  lab: Partial<Record<"lcp" | "fcp" | "cls" | "tbt" | "si", LabMetric>>;
  field: FieldData | null;
  originField: FieldData | null;
  opportunities: LhAudit[];
  diagnostics: LhAudit[];
  failedChecks: { accessibility: LhAudit[]; bestPractices: LhAudit[]; seo: LhAudit[] };
  runWarnings: string[];
}

/** A finding produced by an external provider, before it is stored with an issue code. */
export interface ProviderFinding {
  provider: "psi" | "crux" | "gsc" | "schema";
  type: "performance" | "cwv" | "structured-data" | "indexing" | "search-console" | "seo";
  kind: "confirmed" | "recommendation" | "needs-review";
  severity: "high" | "medium" | "low";
  confidence: number;
  rule: string;
  metricKey: string;
  title: string;
  url: string;
  current: string | null;
  proposed: string | null;
  recommendation: string;
  evidence: string;
  sourceRef: string;
  providerTimestamp: string;
  strategy?: Strategy;
  docUrl?: string;
}

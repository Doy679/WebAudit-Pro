import type { PageSnapshot, RawIssue } from "../types.js";
import { makeIssue } from "../checks/issue.js";
import { FEATURES, LOCAL_BUSINESS_TYPES, RULES_VERSION, featureFor, type FeatureRule, type ValueKind } from "./rules.js";
import type { MicroNode, SdIssue, SdItem, SdResult, StructuredDataCapture } from "./types.js";

export { RULES_VERSION };

const MAX_BLOCK_BYTES = 500_000;
const MAX_ITEMS = 100;

export const richResultsTestUrl = (url: string) => `https://search.google.com/test/rich-results?url=${encodeURIComponent(url)}`;

/** Internal normalized node: every property is a list of strings or nested nodes. */
interface Node { types: string[]; id?: string; props: Record<string, (string | number | boolean | Node)[]> }

const typeName = (t: string) => t.replace(/^https?:\/\/schema\.org\//i, "").replace(/^schema:/, "").trim();

function fromJson(value: unknown): Node | string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return value as string | number | boolean;
  if (Array.isArray(value)) return null; // handled by caller
  const o = value as Record<string, unknown>;
  const rawType = o["@type"];
  const node: Node = { types: (Array.isArray(rawType) ? rawType : rawType ? [rawType] : []).map((t) => typeName(String(t))), props: {} };
  if (typeof o["@id"] === "string") node.id = o["@id"];
  for (const [k, v] of Object.entries(o)) {
    if (k.startsWith("@")) continue;
    const list = (Array.isArray(v) ? v : [v]).map(fromJson).filter((x): x is Node | string | number | boolean => x !== null);
    node.props[k] = list;
  }
  // A bare {"@id": "..."} is a reference; keep it recognizable.
  if (!node.types.length && node.id && !Object.keys(node.props).length) node.props = {};
  return node;
}

const fromMicro = (m: MicroNode): Node => ({
  types: m.types.map((t) => typeName(t.split("/").pop() ?? t)),
  id: m.id,
  props: Object.fromEntries(Object.entries(m.props).map(([k, vs]) => [k, vs.map((v) => (typeof v === "string" ? v : fromMicro(v)))])),
});

function lineCol(text: string, pos: number) {
  const before = text.slice(0, pos);
  const line = before.split("\n").length;
  return { line, column: pos - before.lastIndexOf("\n") };
}

const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && "props" in v;
const isRef = (v: unknown): v is Node => isNode(v) && !!v.id && !v.types.length && !Object.keys(v.props).length;
const textOf = (v: unknown): string => (isNode(v) ? "" : String(v));
const firstText = (n: Node, prop: string) => {
  const v = n.props[prop]?.[0];
  return v === undefined ? null : isNode(v) ? (textOf(v.props.name?.[0] ?? "") || null) : String(v);
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
function checkKind(kind: ValueKind, v: unknown): string | null {
  switch (kind) {
    case "date": return typeof v === "string" && ISO_DATE.test(v.trim()) ? null : "an ISO 8601 date, e.g. 2026-11-03 or 2026-11-03T09:00-07:00";
    case "url": return typeof v === "string" && /^https?:\/\//i.test(v.trim()) ? null : "an absolute URL (https://…)";
    case "url-or-object": return isNode(v) || (typeof v === "string" && /^https?:\/\//i.test(v.trim())) ? null : "an absolute URL or an ImageObject";
    case "number": return Number.isFinite(Number(v)) && !isNode(v) && String(v).trim() !== "" ? null : "a number";
    case "integer": return Number.isInteger(Number(v)) && !isNode(v) ? null : "a whole number";
    case "object": return isNode(v) ? null : "a nested object (e.g. PostalAddress, Place, Organization)";
    default: return null;
  }
}

const has = (n: Node, prop: string) => (n.props[prop] ?? []).some((v) => (isNode(v) ? true : String(v).trim() !== ""));
const norm = (s: string) => s.toLowerCase().replace(/&amp;/g, "&").replace(/[\s ]+/g, " ").replace(/[“”"'’]/g, "").trim();

function featureIssues(n: Node, rule: FeatureRule, visible: string, path = ""): SdIssue[] {
  const issues: SdIssue[] = [];
  const p = (prop: string) => (path ? `${path}.${prop}` : prop);
  for (const req of rule.required) {
    const options = req.split("|");
    if (options.some((o) => has(n, o))) continue;
    issues.push({
      ruleId: options.length > 1 ? "required-one-of" : "required", severity: "error", property: p(options.join(" | ")),
      message: options.length > 1 ? `Needs at least one of ${options.join(", ")}` : `Missing required property "${req}"`,
      current: "missing", expected: options.length > 1 ? `one of: ${options.join(", ")}` : `a value for ${req}`, docUrl: rule.docUrl,
    });
  }
  for (const rec of rule.recommended) {
    const options = rec.split("|");
    if (options.some((o) => has(n, o))) continue;
    issues.push({ ruleId: "recommended", severity: "warning", property: p(options.join(" | ")), message: `Recommended property "${options.join(" or ")}" is missing`, current: "missing", expected: `add ${options.join(" or ")}`, docUrl: rule.docUrl });
  }
  for (const [prop, kind] of Object.entries(rule.valueTypes)) {
    for (const v of n.props[prop] ?? []) {
      if (isRef(v)) continue;
      const expected = checkKind(kind, v);
      if (expected) issues.push({ ruleId: "type", severity: "error", property: p(prop), message: `"${prop}" has the wrong type`, current: isNode(v) ? `object (${v.types.join(", ") || "untyped"})` : JSON.stringify(v).slice(0, 120), expected, docUrl: rule.docUrl });
    }
  }
  if (visible) {
    for (const prop of rule.visible ?? []) {
      const val = firstText(n, prop);
      if (val && val.length >= 4 && !norm(visible).includes(norm(val))) {
        issues.push({ ruleId: "visible-content", severity: "warning", property: p(prop), message: `Marked-up ${prop} isn't found in the visible page text`, current: val.slice(0, 160), expected: "structured data that matches content users can see", docUrl: rule.docUrl });
      }
    }
  }
  return issues;
}

/** Nested checks Google documents for specific features. */
function nestedIssues(n: Node, rule: FeatureRule, visible: string): SdIssue[] {
  const issues: SdIssue[] = [];
  if (rule.feature === "Breadcrumb") {
    const items = (n.props.itemListElement ?? []).filter(isNode);
    items.forEach((li, i) => {
      const at = `itemListElement[${i}]`;
      if (!has(li, "position")) issues.push({ ruleId: "required", severity: "error", property: `${at}.position`, message: "ListItem is missing position", current: "missing", expected: "1, 2, 3…", docUrl: rule.docUrl });
      else if (checkKind("integer", li.props.position[0])) issues.push({ ruleId: "type", severity: "error", property: `${at}.position`, message: "position must be a whole number", current: String(li.props.position[0]), expected: "a whole number (1, 2, 3…)", docUrl: rule.docUrl });
      const named = has(li, "name") || (isNode(li.props.item?.[0]) && has(li.props.item[0] as Node, "name"));
      if (!named) issues.push({ ruleId: "required", severity: "error", property: `${at}.name`, message: "ListItem is missing name", current: "missing", expected: "the breadcrumb label", docUrl: rule.docUrl });
      if (i < items.length - 1 && !has(li, "item")) issues.push({ ruleId: "required", severity: "error", property: `${at}.item`, message: "ListItem is missing item (only the last crumb may omit it)", current: "missing", expected: "the URL of this breadcrumb", docUrl: rule.docUrl });
    });
  }
  if (rule.feature === "FAQ") {
    (n.props.mainEntity ?? []).filter(isNode).forEach((q, i) => {
      const at = `mainEntity[${i}]`;
      if (!has(q, "name")) issues.push({ ruleId: "required", severity: "error", property: `${at}.name`, message: "Question is missing name (the question text)", current: "missing", expected: "the full question", docUrl: rule.docUrl });
      const answer = q.props.acceptedAnswer?.find(isNode);
      if (!answer || !has(answer, "text")) issues.push({ ruleId: "required", severity: "error", property: `${at}.acceptedAnswer.text`, message: "Question is missing acceptedAnswer.text", current: "missing", expected: "the full answer text", docUrl: rule.docUrl });
      const name = firstText(q, "name");
      if (visible && name && !norm(visible).includes(norm(name))) issues.push({ ruleId: "visible-content", severity: "warning", property: `${at}.name`, message: "FAQ question isn't found in the visible page text", current: name.slice(0, 160), expected: "questions that are visible on the page", docUrl: rule.docUrl });
    });
  }
  if (rule.feature === "Product snippet") {
    (n.props.offers ?? []).filter(isNode).forEach((o, i) => {
      if (!o.types.includes("AggregateOffer") && !has(o, "price")) issues.push({ ruleId: "required", severity: "error", property: `offers[${i}].price`, message: "Offer is missing price", current: "missing", expected: "the price as a number", docUrl: rule.docUrl });
      else if (has(o, "price") && checkKind("number", o.props.price[0])) issues.push({ ruleId: "type", severity: "error", property: `offers[${i}].price`, message: "price must be a number", current: String(o.props.price[0]), expected: "a number without currency symbols, e.g. 199.00", docUrl: rule.docUrl });
      if (!has(o, "priceCurrency")) issues.push({ ruleId: "recommended", severity: "warning", property: `offers[${i}].priceCurrency`, message: "Offer is missing priceCurrency", current: "missing", expected: "ISO 4217 code, e.g. USD", docUrl: rule.docUrl });
    });
  }
  return issues;
}

function collectIds(n: Node, ids: Set<string>) {
  if (n.id && (n.types.length || Object.keys(n.props).length)) ids.add(n.id);
  for (const vs of Object.values(n.props)) for (const v of vs) if (isNode(v)) collectIds(v, ids);
}

function referenceIssues(n: Node, ids: Set<string>, path = ""): SdIssue[] {
  const out: SdIssue[] = [];
  for (const [prop, vs] of Object.entries(n.props)) {
    for (const v of vs) {
      if (!isNode(v)) continue;
      const at = path ? `${path}.${prop}` : prop;
      if (isRef(v)) {
        if (!ids.has(v.id!) && (v.id!.startsWith("#") || !/^https?:\/\//.test(v.id!))) {
          out.push({ ruleId: "reference", severity: "warning", property: at, message: `Reference ${v.id} doesn't match any @id on the page`, current: v.id!, expected: "an @id defined elsewhere in this page's structured data" });
        }
      } else out.push(...referenceIssues(v, ids, at));
    }
  }
  return out;
}

function finishItem(item: Omit<SdItem, "status" | "eligibility">): SdItem {
  const errors = item.issues.some((i) => i.severity === "error");
  const invalid = item.issues.some((i) => i.ruleId === "syntax" || i.ruleId === "too-large");
  const requiredMissing = item.issues.some((i) => i.ruleId === "required" || i.ruleId === "required-one-of" || (i.ruleId === "type" && i.severity === "error"));
  return {
    ...item,
    status: invalid ? "invalid" : errors ? "errors" : item.issues.length ? "warnings" : "valid",
    eligibility: invalid ? "invalid" : !item.googleFeature ? "no-google-feature" : requiredMissing ? "missing-required" : "candidate",
  };
}

/** Parses and validates every structured-data item on a page. Never claims an official Google verdict. */
export function validateStructuredData(c: StructuredDataCapture): SdResult {
  const nodes: { node: Node; format: SdItem["format"]; source: string; snippet: string; preIssues: SdIssue[] }[] = [];
  const broken: SdItem[] = [];

  for (const block of c.jsonld) {
    const source = `json-ld block ${block.index + 1}`;
    const snippet = block.text.trim().slice(0, 400);
    if (block.text.length > MAX_BLOCK_BYTES) {
      broken.push(finishItem({ format: "json-ld", source, types: [], name: null, googleFeature: null, snippet: snippet.slice(0, 120), issues: [{ ruleId: "too-large", severity: "error", property: "(block)", message: `JSON-LD block is ${Math.round(block.text.length / 1024)} KB; blocks over ${MAX_BLOCK_BYTES / 1000} KB are not parsed`, current: `${block.text.length} bytes`, expected: "a smaller JSON-LD block" }] }));
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(block.text);
    } catch (e) {
      const pos = Number(/position (\d+)/.exec((e as Error).message)?.[1] ?? 0);
      const { line, column } = lineCol(block.text, pos);
      broken.push(finishItem({ format: "json-ld", source, types: [], name: null, googleFeature: null, snippet, issues: [{ ruleId: "syntax", severity: "error", property: "(block)", message: `Invalid JSON at line ${line}, column ${column}: ${(e as Error).message.replace(/ in JSON at position \d+.*$/, "")}`, current: block.text.split("\n")[line - 1]?.trim().slice(0, 160) ?? "", expected: "valid JSON (check commas, quotes and brackets)" }] }));
      continue;
    }
    const roots = Array.isArray(parsed) ? parsed : [parsed];
    for (const root of roots) {
      const r = root as Record<string, unknown>;
      const ctx = String(r?.["@context"] ?? "");
      const pre: SdIssue[] = ctx && !/schema\.org/i.test(ctx) ? [{ ruleId: "context", severity: "warning", property: "@context", message: "@context is not schema.org", current: ctx.slice(0, 120), expected: "https://schema.org" }] : [];
      const graph = Array.isArray(r?.["@graph"]) ? (r["@graph"] as unknown[]) : [root];
      for (const g of graph) {
        const node = fromJson(g);
        if (isNode(node)) nodes.push({ node, format: "json-ld", source, snippet, preIssues: pre });
      }
    }
  }
  for (const m of c.microdata) nodes.push({ node: fromMicro(m), format: "microdata", source: m.selector ?? "microdata", snippet: "", preIssues: [] });
  for (const m of c.rdfa) nodes.push({ node: fromMicro(m), format: "rdfa", source: m.selector ?? "rdfa", snippet: "", preIssues: [] });

  const ids = new Set<string>();
  nodes.forEach(({ node }) => collectIds(node, ids));
  const visible = c.visibleText ?? "";

  const items: SdItem[] = nodes.slice(0, MAX_ITEMS).map(({ node, format, source, snippet, preIssues }) => {
    const rule = featureFor(node.types);
    const issues: SdIssue[] = [...preIssues];
    if (!node.types.length) issues.push({ ruleId: "missing-type", severity: "error", property: "@type", message: "Item has no @type", current: "missing", expected: "a schema.org type, e.g. Organization" });
    if (rule) issues.push(...featureIssues(node, rule, visible), ...nestedIssues(node, rule, visible));
    // Nested review/rating objects follow the Review snippet rules too.
    for (const prop of ["aggregateRating", "review"]) {
      for (const child of (node.props[prop] ?? []).filter((v): v is Node => isNode(v) && !isRef(v))) {
        const childRule = featureFor(child.types.length ? child.types : [prop === "review" ? "Review" : "AggregateRating"]);
        if (childRule && childRule !== rule) issues.push(...featureIssues(child, childRule, "", prop).filter((i) => i.ruleId !== "recommended"));
      }
    }
    issues.push(...referenceIssues(node, ids));
    return finishItem({ format, source, types: node.types, name: firstText(node, "name") ?? firstText(node, "headline"), googleFeature: rule?.feature ?? null, issues, snippet });
  });

  // Conflicting duplicates: the same entity type described more than once with different names.
  const DEDUPE = ["Organization", "WebSite", "BreadcrumbList", ...LOCAL_BUSINESS_TYPES];
  const seen = new Map<string, SdItem>();
  for (const item of items) {
    const t = item.types.find((x) => DEDUPE.includes(x));
    if (!t) continue;
    const prev = seen.get(t);
    if (!prev) { seen.set(t, item); continue; }
    if (t === "BreadcrumbList" || (prev.name && item.name && norm(prev.name) !== norm(item.name))) {
      item.issues.push({ ruleId: "duplicate", severity: "warning", property: "@type", message: `${t} is described more than once${t === "BreadcrumbList" ? "" : ` with different names ("${prev.name}" and "${item.name}")`}`, current: `${item.source} and ${prev.source}`, expected: `one consistent ${t} entity (link with @id)` });
      Object.assign(item, finishItem(item));
    }
  }

  return { rulesVersion: RULES_VERSION, items: [...broken, ...items] };
}

const KIND: Record<string, { kind: RawIssue["kind"]; severity: RawIssue["severity"]; confidence: number }> = {
  syntax: { kind: "confirmed", severity: "high", confidence: 0.95 },
  "too-large": { kind: "needs-review", severity: "medium", confidence: 0.6 },
  "missing-type": { kind: "confirmed", severity: "medium", confidence: 0.9 },
  required: { kind: "confirmed", severity: "medium", confidence: 0.85 },
  "required-one-of": { kind: "confirmed", severity: "medium", confidence: 0.85 },
  type: { kind: "confirmed", severity: "medium", confidence: 0.8 },
  recommended: { kind: "recommendation", severity: "low", confidence: 0.7 },
  context: { kind: "recommendation", severity: "low", confidence: 0.7 },
  reference: { kind: "needs-review", severity: "low", confidence: 0.55 },
  duplicate: { kind: "needs-review", severity: "medium", confidence: 0.6 },
  "visible-content": { kind: "needs-review", severity: "medium", confidence: 0.5 },
};

/** Structured-data findings for the issue pipeline. Recommended-property gaps are only reported for Google features. */
export function structuredDataIssues(page: PageSnapshot, result: SdResult): RawIssue[] {
  const out: RawIssue[] = [];
  for (const item of result.items) {
    const typeLabel = item.types.join("/") || "Untyped item";
    for (const issue of item.issues) {
      if (issue.ruleId === "recommended" && !item.googleFeature) continue;
      const m = KIND[issue.ruleId];
      const rule = FEATURES.find((f) => f.feature === item.googleFeature);
      const raw = makeIssue(page, {
        type: "structured-data", rule: `schema:${issue.ruleId}`, kind: m.kind, severity: m.severity, confidence: m.confidence,
        title: `${typeLabel}: ${issue.message}`,
        current: issue.property === "(block)" ? issue.current ?? undefined : `${issue.property}: ${issue.current ?? "missing"}`,
        proposed: issue.expected ?? undefined,
        recommendation:
          `${issue.ruleId === "visible-content" ? "Make sure structured data describes content users can see on this page. " : ""}` +
          `Fix ${typeLabel} (${item.source}).${rule ? ` Google documentation: ${rule.docUrl}.` : ""}${rule?.note ? ` Note: ${rule.note}` : ""}` +
          ` Then confirm with Google's Rich Results Test: ${richResultsTestUrl(page.url)}. Passing these internal checks does not guarantee a rich result.`,
        computedCss: { format: item.format, source: item.source, schemaType: typeLabel, property: issue.property, rulesVersion: result.rulesVersion, ...(item.snippet ? { snippet: item.snippet.slice(0, 300) } : {}) },
      });
      raw.location.selector = issue.property === "(block)" ? `${item.format} ${item.source}` : `${item.format} ${typeLabel}.${issue.property.replace(/\[\d+\]/g, "[]")}`;
      out.push(raw);
    }
  }
  return out;
}

import { describe, it, expect } from "vitest";
import { validateStructuredData, structuredDataIssues, RULES_VERSION, richResultsTestUrl } from "../src/schema/validate";
import type { StructuredDataCapture } from "../src/schema/types";
import { page } from "./helpers";

const capture = (over: Partial<StructuredDataCapture>): StructuredDataCapture => ({ jsonld: [], microdata: [], rdfa: [], visibleText: "", ...over });
const ld = (obj: unknown, index = 0) => ({ index, text: typeof obj === "string" ? obj : JSON.stringify(obj) });

describe("structured data validation", () => {
  it("reports JSON-LD syntax errors with a line and column", () => {
    const r = validateStructuredData(capture({ jsonld: [ld('{\n  "@context": "https://schema.org",\n  "@type": "Organization",\n  "name": "CHM",\n}')] }));
    expect(r.items[0].status).toBe("invalid");
    const issue = r.items[0].issues[0];
    expect(issue.ruleId).toBe("syntax");
    expect(issue.message).toMatch(/line 5/);
  });

  it("detects types from JSON-LD, @graph, microdata and RDFa", () => {
    const r = validateStructuredData(capture({
      jsonld: [ld({ "@context": "https://schema.org", "@graph": [{ "@type": "WebSite", name: "CHM", url: "https://chm.com/" }, { "@type": "Organization", name: "CHM", url: "https://chm.com/" }] })],
      microdata: [{ selector: "div.crumbs", types: ["https://schema.org/BreadcrumbList"], props: { itemListElement: [{ types: ["https://schema.org/ListItem"], props: { position: ["1"], name: ["Home"], item: ["https://chm.com/"] } }] } }],
      rdfa: [{ selector: "div.person", types: ["Person"], props: { name: ["Brian Wheeler"] } }],
    }));
    expect(r.items.map((i) => i.types.join("+"))).toEqual(["WebSite", "Organization", "BreadcrumbList", "Person"]);
    expect(r.items.map((i) => i.format)).toEqual(["json-ld", "json-ld", "microdata", "rdfa"]);
  });

  it("separates schema validity from Google feature candidacy (a type is not automatically eligible)", () => {
    const r = validateStructuredData(capture({ jsonld: [ld({ "@context": "https://schema.org", "@type": "Service", name: "FHA loans" })] }));
    expect(r.items[0].status).toBe("valid");
    expect(r.items[0].googleFeature).toBeNull();
    expect(r.items[0].eligibility).toBe("no-google-feature");
  });

  it("flags missing required properties for documented Google features and links the docs", () => {
    const r = validateStructuredData(capture({ jsonld: [ld({ "@context": "https://schema.org", "@type": "Event", name: "Homebuyer seminar" })] }));
    const item = r.items[0];
    expect(item.googleFeature).toBe("Event");
    expect(item.eligibility).toBe("missing-required");
    const required = item.issues.filter((i) => i.severity === "error").map((i) => i.property);
    expect(required).toEqual(expect.arrayContaining(["startDate", "location"]));
    expect(item.issues[0].docUrl).toContain("developers.google.com/search/docs/appearance/structured-data/event");
  });

  it("checks recommended properties, value types and nested breadcrumb items", () => {
    const r = validateStructuredData(capture({
      jsonld: [
        ld({ "@context": "https://schema.org", "@type": "LocalBusiness", name: "Capital Home Mortgage", address: "123 Main" }),
        ld({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: "first", name: "Home" }] }, 1),
        ld({ "@context": "https://schema.org", "@type": "Article", headline: "Rates", datePublished: "last Tuesday" }, 2),
      ],
    }));
    const [biz, crumbs, article] = r.items;
    expect(biz.issues.some((i) => i.property === "telephone" && i.severity === "warning")).toBe(true);
    expect(biz.issues.some((i) => i.property === "address" && i.ruleId === "type")).toBe(true);
    expect(crumbs.issues.some((i) => i.property === "itemListElement[0].position" && i.ruleId === "type")).toBe(true);
    expect(crumbs.issues.some((i) => i.property === "itemListElement[0].item")).toBe(false); // the last crumb may omit "item"
    expect(article.issues.some((i) => i.property === "datePublished" && i.ruleId === "type")).toBe(true);
  });

  it("requires one of review, aggregateRating or offers for Product snippets", () => {
    const r = validateStructuredData(capture({ jsonld: [ld({ "@context": "https://schema.org", "@type": "Product", name: "Home loan" })] }));
    expect(r.items[0].issues.some((i) => i.ruleId === "required-one-of" && i.property === "offers | review | aggregateRating")).toBe(true);
  });

  it("flags unresolved @id references and conflicting duplicate entities", () => {
    const r = validateStructuredData(capture({
      jsonld: [
        ld({ "@context": "https://schema.org", "@type": "Organization", name: "Capital Home Mortgage", logo: { "@id": "#logo" } }),
        ld({ "@context": "https://schema.org", "@type": "Organization", name: "CHM Lending LLC" }, 1),
      ],
    }));
    expect(r.items[0].issues.some((i) => i.ruleId === "reference" && i.property === "logo")).toBe(true);
    expect(r.items.flatMap((i) => i.issues).some((i) => i.ruleId === "duplicate")).toBe(true);
  });

  it("flags marked-up names that are not visible on the page for human review", () => {
    const r = validateStructuredData(capture({
      jsonld: [ld({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Can I get an FHA loan with a 580 score?", acceptedAnswer: { "@type": "Answer", text: "Yes." } }] })],
      visibleText: "Frequently asked questions. Rates and terms vary.",
    }));
    const issue = r.items[0].issues.find((i) => i.ruleId === "visible-content")!;
    expect(issue.severity).toBe("warning");
    expect(issue.current).toContain("580 score");
  });

  it("refuses oversized JSON-LD blocks instead of parsing them", () => {
    const huge = `{"@type":"Thing","name":"${"x".repeat(600_000)}"}`;
    const r = validateStructuredData(capture({ jsonld: [ld(huge)] }));
    expect(r.items[0].issues[0].ruleId).toBe("too-large");
  });

  it("is versioned and builds an official Rich Results Test link", () => {
    expect(RULES_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(richResultsTestUrl("https://chm.com/a?b=1")).toBe("https://search.google.com/test/rich-results?url=https%3A%2F%2Fchm.com%2Fa%3Fb%3D1");
  });
});

describe("structured data findings", () => {
  it("maps errors to findings with schema type, property, docs and the Rich Results Test action", () => {
    const p = page({ url: "https://chm.com/seminar", viewport: 1440 });
    const result = validateStructuredData(capture({ jsonld: [ld({ "@context": "https://schema.org", "@type": "Event", name: "Seminar" })] }));
    const issues = structuredDataIssues(p, result);
    const missing = issues.find((i) => i.rule === "schema:required" && i.current?.includes("startDate"))!;
    expect(missing.type).toBe("structured-data");
    expect(missing.kind).toBe("confirmed");
    expect(missing.location.selector).toBe("json-ld Event.startDate");
    expect(missing.recommendation).toContain("Rich Results Test");
    expect(missing.title).toContain("Event");
  });

  it("does not create findings for schema types with no Google feature and no errors", () => {
    const p = page({ url: "https://chm.com/" });
    const result = validateStructuredData(capture({ jsonld: [ld({ "@context": "https://schema.org", "@type": "WebSite", name: "CHM", url: "https://chm.com/" })] }));
    expect(structuredDataIssues(p, result)).toEqual([]);
  });
});

describe("BUG-12: one verdict per property", () => {
  const article = (datePublished?: unknown) => validateStructuredData(capture({ jsonld: [ld({
    "@context": "https://schema.org", "@type": "Article", headline: "Meet Brian", author: { "@type": "Person", name: "Brian" }, image: "https://example.com/a.jpg",
    dateModified: "2026-10-01", ...(datePublished === undefined ? {} : { datePublished }),
  })] })).items[0];
  const about = (item: ReturnType<typeof article>) => item.issues.filter((i) => i.property === "datePublished");

  it("an empty value is reported once, as empty, and doesn't make Article ineligible", () => {
    const item = article("");
    expect(about(item)).toHaveLength(1);
    expect(about(item)[0]).toMatchObject({ ruleId: "empty", severity: "warning", message: expect.stringMatching(/is empty/) });
    expect(item.eligibility).toBe("candidate"); // Google's Article docs list no required properties
  });

  it("missing, invalid and correct values each get exactly one coherent verdict", () => {
    expect(about(article())).toEqual([expect.objectContaining({ ruleId: "recommended", severity: "warning" })]);
    expect(about(article("last Tuesday"))).toEqual([expect.objectContaining({ ruleId: "type", severity: "warning" })]);
    expect(article("last Tuesday").eligibility).toBe("candidate");
    expect(about(article("2026-09-30"))).toEqual([]);
  });

  it("an invalid value on a required property still blocks eligibility", () => {
    const r = validateStructuredData(capture({ jsonld: [ld({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: "" })] })).items[0];
    expect(r.issues.filter((i) => i.property === "itemListElement")).toEqual([expect.objectContaining({ ruleId: "empty", severity: "error" })]);
    expect(r.eligibility).toBe("missing-required");
  });

  it("cites the versioned rules", () => {
    expect(RULES_VERSION).toMatch(/^2026-11-04/);
  });
});

import { describe, it, expect } from "vitest";
import { layoutChecks } from "../src/checks/layout.js";
import { buttonChecks } from "../src/checks/buttons.js";
import { typographyChecks } from "../src/checks/typography.js";
import { seoChecks, siteSeoChecks } from "../src/checks/seo.js";
import { buildBaseline } from "../src/baseline/spacing.js";
import { spacingChecks } from "../src/checks/spacing.js";
import { a11yIssues } from "../src/checks/a11y.js";
import { el, page, tokens } from "./helpers.js";

const rules = (issues: { rule: string }[]) => issues.map((i) => i.rule);

describe("layout checks", () => {
  it("flags horizontal overflow when the document is wider than the viewport", () => {
    const p = page({
      viewport: 390,
      docWidth: 520,
      elements: [el({ selector: ".wide-table", box: { x: 0, y: 900, w: 520, h: 300 } })],
    });
    const issues = layoutChecks(p, tokens);
    const overflow = issues.find((i) => i.rule === "horizontal-overflow")!;
    expect(overflow.kind).toBe("confirmed");
    expect(overflow.severity).toBe("high");
    expect(overflow.current).toContain("520px");
    expect(overflow.location.selector).toBe(".wide-table");
  });

  it("does not flag overflow on a page that fits", () => {
    expect(rules(layoutChecks(page({ viewport: 390, docWidth: 390 }), tokens))).not.toContain("horizontal-overflow");
  });

  it("flags text clipped by overflow hidden", () => {
    const p = page({
      elements: [el({
        selector: ".card h3", role: "heading", text: "Refinance your home",
        css: { overflowX: "hidden", overflowY: "hidden" },
        scroll: { sw: 100, cw: 100, sh: 64, ch: 32 },
      })],
    });
    const issue = layoutChecks(p, tokens).find((i) => i.rule === "text-clipped")!;
    expect(issue.kind).toBe("confirmed");
    expect(issue.location.selector).toBe(".card h3");
  });

  it("ignores scroll overflow on elements that are visibly scrollable", () => {
    const p = page({
      elements: [el({
        selector: ".scroller", role: "text", css: { overflowX: "auto" },
        scroll: { sw: 900, cw: 300, sh: 50, ch: 50 },
      })],
    });
    expect(rules(layoutChecks(p, tokens))).not.toContain("text-clipped");
  });
});

describe("button checks", () => {
  it("flags small tap targets on mobile viewports only", () => {
    const btn = el({ selector: ".cta", role: "button", text: "Apply", box: { x: 0, y: 0, w: 80, h: 20 } });
    expect(rules(buttonChecks(page({ viewport: 390, elements: [btn] }), tokens))).toContain("tap-target-small");
    expect(rules(buttonChecks(page({ viewport: 1440, elements: [btn] }), tokens))).not.toContain("tap-target-small");
  });

  it("flags button labels that wrap to more than one line", () => {
    const btn = el({ selector: ".cta", role: "button", text: "Get Pre-Approved Today", lineCount: 2, box: { x: 0, y: 0, w: 120, h: 60 } });
    const issue = buttonChecks(page({ viewport: 390, elements: [btn] }), tokens).find((i) => i.rule === "button-text-wraps")!;
    expect(issue.current).toContain("2 lines");
  });

  it("flags empty or placeholder link targets for review", () => {
    const btn = el({ selector: ".cta", role: "button", text: "Learn more", href: "#", box: { x: 0, y: 0, w: 200, h: 50 } });
    const issue = buttonChecks(page({ elements: [btn] }), tokens).find((i) => i.rule === "placeholder-link")!;
    expect(issue.kind).toBe("needs-review");
  });
});

describe("typography checks", () => {
  it("flags font sizes below the minimum", () => {
    const p = page({ elements: [el({ selector: "footer p", role: "text", text: "Legal", css: { fontSize: 10, lineHeight: 15 } })] });
    expect(rules(typographyChecks(p, tokens))).toContain("font-too-small");
  });

  it("flags tight body line height as a recommendation", () => {
    const p = page({ elements: [el({ selector: ".intro p", role: "text", text: "Body copy", css: { fontSize: 16, lineHeight: 17 } })] });
    const issue = typographyChecks(p, tokens).find((i) => i.rule === "line-height-tight")!;
    expect(issue.kind).toBe("recommendation");
  });

  it("flags inverted heading scale (h2 larger than h1)", () => {
    const p = page({
      elements: [
        el({ selector: "h1", tag: "h1", role: "heading", text: "Title", css: { fontSize: 32, lineHeight: 40 } }),
        el({ selector: ".s2 h2", tag: "h2", role: "heading", text: "Sub", css: { fontSize: 44, lineHeight: 52 } }),
      ],
    });
    expect(rules(typographyChecks(p, tokens))).toContain("heading-scale-inverted");
  });

  it("passes a sensible heading scale", () => {
    const p = page({
      elements: [
        el({ selector: "h1", tag: "h1", role: "heading", text: "Title", css: { fontSize: 48, lineHeight: 56 } }),
        el({ selector: "h2", tag: "h2", role: "heading", text: "Sub", css: { fontSize: 32, lineHeight: 40 } }),
      ],
    });
    expect(rules(typographyChecks(p, tokens))).not.toContain("heading-scale-inverted");
  });
});

describe("spacing baseline + checks", () => {
  const section = (url: string, pt: number, id: string) =>
    page({
      url,
      viewport: 1440,
      elements: [el({ selector: `.elementor-element-${id}`, role: "section", sectionKind: "section", elementorId: id, css: { paddingTop: pt, paddingBottom: 48 } })],
    });

  const pages = [
    section("https://example.com/a", 48, "a1"),
    section("https://example.com/b", 48, "b1"),
    section("https://example.com/c", 50, "c1"),
    section("https://example.com/d", 96, "d1"),
  ];

  it("learns the median padding per section kind and viewport", () => {
    const baseline = buildBaseline(pages);
    expect(baseline.get("section@1440")?.paddingTop).toEqual({ median: 49, samples: 4 });
  });

  it("recommends snapping an outlier to the nearest token near the site median", () => {
    const baseline = buildBaseline(pages);
    const issues = spacingChecks(pages[3], baseline, tokens);
    expect(issues).toHaveLength(1);
    const [issue] = issues;
    expect(issue.rule).toBe("section-padding-outlier");
    expect(issue.kind).toBe("recommendation");
    expect(issue.current).toBe("padding-top: 96px");
    expect(issue.proposed).toContain("48px");
    expect(issue.location.elementorId).toBe("d1");
  });

  it("does not flag values close to the median", () => {
    expect(spacingChecks(pages[2], buildBaseline(pages), tokens)).toEqual([]);
  });

  it("stays silent when there are too few samples", () => {
    const few = pages.slice(2);
    expect(spacingChecks(few[1], buildBaseline(few), tokens)).toEqual([]);
  });
});

describe("seo checks", () => {
  it("passes a healthy page", () => {
    expect(seoChecks(page(), tokens)).toEqual([]);
  });

  it("flags HTTP errors as high severity", () => {
    const issue = seoChecks(page({ meta: { status: 404, finalUrl: "https://example.com/", h1Count: 1 } }), tokens)
      .find((i) => i.rule === "http-error")!;
    expect(issue.severity).toBe("high");
  });

  it("flags missing title, missing h1, multiple h1 and noindex", () => {
    expect(rules(seoChecks(page({ meta: { status: 200, finalUrl: "https://example.com/", title: "", h1Count: 0 } }), tokens)))
      .toEqual(expect.arrayContaining(["title-missing", "h1-missing"]));
    expect(rules(seoChecks(page({ meta: { status: 200, finalUrl: "https://example.com/", h1Count: 3, robotsMeta: "noindex, follow" } }), tokens)))
      .toEqual(expect.arrayContaining(["h1-multiple", "noindex"]));
  });

  it("flags a canonical pointing at a different URL for review", () => {
    const issue = seoChecks(page({ meta: { status: 200, finalUrl: "https://example.com/", h1Count: 1, canonical: "https://example.com/other/" } }), tokens)
      .find((i) => i.rule === "canonical-mismatch")!;
    expect(issue.kind).toBe("needs-review");
  });

  it("treats a canonical that only differs by trailing slash or case of host as matching", () => {
    expect(rules(seoChecks(page({ url: "https://example.com/about/", meta: { status: 200, finalUrl: "https://example.com/about/", h1Count: 1, canonical: "https://EXAMPLE.com/about/" } }), tokens)))
      .not.toContain("canonical-mismatch");
  });

  it("flags duplicate titles across pages and pages missing from the sitemap", () => {
    const a = page({ url: "https://example.com/a" });
    const b = page({ url: "https://example.com/b" });
    const issues = siteSeoChecks([a, b], ["https://example.com/a"]);
    expect(rules(issues)).toContain("title-duplicate");
    expect(issues.find((i) => i.rule === "not-in-sitemap")!.location.url).toBe("https://example.com/b");
  });

  it("skips the sitemap check when no sitemap was found", () => {
    expect(rules(siteSeoChecks([page()], null))).not.toContain("not-in-sitemap");
  });
});

describe("a11y (axe results → issues)", () => {
  const axe = {
    violations: [{
      id: "color-contrast", impact: "serious", help: "Elements must meet minimum color contrast ratio thresholds",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.10/color-contrast",
      nodes: [{ target: [".hero .btn"], failureSummary: "Fix: contrast 2.1:1, expected 4.5:1" }],
    }],
    incomplete: [{
      id: "color-contrast", impact: "serious", help: "Contrast over background image", helpUrl: "",
      nodes: [{ target: [".banner h2"], failureSummary: "Background image" }],
    }],
  };

  it("maps violations to confirmed issues with severity from impact", () => {
    const issues = a11yIssues(page({ viewport: 390 }), axe);
    const v = issues.find((i) => i.location.selector === ".hero .btn")!;
    expect(v.kind).toBe("confirmed");
    expect(v.severity).toBe("high");
    expect(v.rule).toBe("axe:color-contrast");
  });

  it("does not draw a box for page-level targets like <html>", () => {
    const p = page({ viewport: 390, elements: [el({ selector: "html", box: { x: 0, y: 0, w: 390, h: 3000 } })] });
    const [issue] = a11yIssues(p, {
      violations: [{ id: "html-has-lang", impact: "serious", help: "html needs lang", helpUrl: "", nodes: [{ target: ["html"] }] }],
      incomplete: [],
    });
    expect(issue.evidence.boxes).toEqual([]);
  });

  it("maps incomplete results to needs-review", () => {
    const issues = a11yIssues(page({ viewport: 390 }), axe);
    const undecided = issues.find((i) => i.location.selector === ".banner h2")!;
    expect(undecided.kind).toBe("needs-review");
    // A "serious" impact that axe could not decide is capped at medium (found on the CHM pilot: 184 of 212 "high").
    expect(undecided.severity).toBe("medium");
  });
});

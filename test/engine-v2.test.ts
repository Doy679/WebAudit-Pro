import { describe, it, expect } from "vitest";
import { buttonChecks } from "../src/checks/buttons.js";
import { layoutChecks } from "../src/checks/layout.js";
import { contentChecks } from "../src/checks/content.js";
import { navigationChecks, brokenLinkIssues } from "../src/checks/site.js";
import { componentChecks } from "../src/checks/components.js";
import { fingerprint, dedupeAndNumber } from "../src/report/dedupe.js";
import { el, page, tokens } from "./helpers.js";

const rules = (issues: { rule: string }[]) => issues.map((i) => i.rule);

// Noise found in the capitalhomemortgage.com pilot run (3,874 findings, 855 distinct).
describe("noise reduction from the CHM pilot", () => {
  it("ignores visually hidden (≤2px) controls such as skip links and carousel bullets", () => {
    const bullet = el({ selector: ".bullets > div:nth-of-type(3)", role: "button", text: "", box: { x: 0, y: 0, w: 2, h: 2 } });
    const skip = el({ selector: "a.skip-link", role: "link", text: "Skip to content", box: { x: 0, y: 0, w: 1, h: 1 },
      css: { overflowX: "hidden", overflowY: "hidden" }, scroll: { sw: 120, cw: 1, sh: 89, ch: 1 } });
    const p = page({ viewport: 390, elements: [bullet, skip] });
    expect(buttonChecks(p, tokens)).toEqual([]);
    expect(rules(layoutChecks(p, tokens))).not.toContain("text-clipped");
  });

  it("splits tap targets into WCAG AA failures (<24px) and AAA recommendations (24–43px)", () => {
    const tiny = el({ selector: ".tiny", role: "link", text: "Go", box: { x: 0, y: 0, w: 30, h: 20 } });
    const small = el({ selector: ".small", role: "button", text: "Apply", box: { x: 0, y: 0, w: 191, h: 31 } });
    const issues = buttonChecks(page({ viewport: 390, elements: [tiny, small] }), tokens);
    const aa = issues.find((i) => i.location.selector === ".tiny")!;
    const aaa = issues.find((i) => i.location.selector === ".small")!;
    expect([aa.rule, aa.kind]).toEqual(["tap-target-small", "confirmed"]);
    expect([aaa.rule, aaa.kind]).toEqual(["tap-target-below-44", "recommendation"]);
  });

  it("does not treat submenu toggles with an empty href as placeholder links", () => {
    const toggle = el({ selector: "#sm-1", role: "button", text: "Loans", href: "", toggle: true, box: { x: 0, y: 0, w: 120, h: 48 } });
    expect(rules(buttonChecks(page({ elements: [toggle] }), tokens))).not.toContain("placeholder-link");
  });
});

describe("content checks", () => {
  it("flags broken images as confirmed", () => {
    const img = el({ selector: "img.hero", role: "image", broken: true, src: "https://example.com/missing.jpg", box: { x: 0, y: 0, w: 300, h: 0 } });
    const issue = contentChecks(page({ elements: [img] }), tokens).find((i) => i.rule === "broken-image")!;
    expect(issue.kind).toBe("confirmed");
    expect(issue.current).toContain("missing.jpg");
  });

  it("flags empty headings and leftover placeholder text", () => {
    const issues = contentChecks(page({
      elements: [
        el({ selector: "h2.empty", tag: "h2", role: "heading", text: "" }),
        el({ selector: ".intro p", role: "text", text: "Lorem ipsum dolor sit amet" }),
      ],
    }), tokens);
    expect(rules(issues)).toEqual(expect.arrayContaining(["empty-heading", "placeholder-text"]));
  });

  it("flags common misspellings for human review, with the suggested word", () => {
    const issue = contentChecks(page({ elements: [el({ selector: "p.copy", role: "text", text: "You will recieve your loan estimate soon." })] }), tokens)
      .find((i) => i.rule === "suspected-misspelling")!;
    expect(issue.kind).toBe("needs-review");
    expect(issue.current).toContain("recieve");
    expect(issue.proposed).toContain("receive");
  });

  it("does not flag correctly spelled text", () => {
    expect(contentChecks(page({ elements: [el({ selector: "p", role: "text", text: "You will receive your estimate." })] }), tokens)).toEqual([]);
  });

  it("flags overlapping text for human review", () => {
    const a = el({ selector: ".a", role: "heading", text: "Title", overlaps: ".b" });
    expect(contentChecks(page({ elements: [a] }), tokens).find((i) => i.rule === "overlapping-content")!.kind).toBe("needs-review");
  });
});

describe("site-level checks", () => {
  const nav = (url: string, links: string[]) => page({ url, meta: { status: 200, finalUrl: url, h1Count: 1, navLinks: links } });

  it("flags pages whose main navigation differs from most pages", () => {
    const home = ["https://example.com/", "https://example.com/loans/", "https://example.com/contact/"];
    const issues = navigationChecks([nav("https://example.com/a", home), nav("https://example.com/b", home), nav("https://example.com/c", home.slice(0, 2))]);
    expect(issues).toHaveLength(1);
    expect(issues[0].location.url).toBe("https://example.com/c");
    expect(issues[0].current).toContain("missing: https://example.com/contact/");
    expect(issues[0].kind).toBe("needs-review");
  });

  it("reports broken internal links once, listing the pages that link to them", () => {
    const issues = brokenLinkIssues(
      [{ url: "https://example.com/old", status: 404 }, { url: "https://example.com/ok", status: 200 }],
      new Map([["https://example.com/old", ["https://example.com/a", "https://example.com/b"]]]),
      (u) => page({ url: u }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("broken-internal-link");
    expect(issues[0].recommendation).toContain("https://example.com/b");
  });
});

describe("repeated component consistency", () => {
  it("recommends unifying a component rendered at different sizes across pages", () => {
    const btn = (url: string, h: number, fs: number) =>
      page({ url, viewport: 1440, elements: [el({ selector: "div.cta > a.elementor-button.elementor-size-md", role: "button", text: "Apply", box: { x: 0, y: 0, w: 160, h }, css: { fontSize: fs } })] });
    const issues = componentChecks([btn("https://example.com/a", 48, 16), btn("https://example.com/b", 48, 16), btn("https://example.com/c", 64, 20)]);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("inconsistent-component");
    expect(issues[0].kind).toBe("recommendation");
    expect(issues[0].location.url).toBe("https://example.com/c");
  });
});

describe("fingerprint grouping", () => {
  const raw = (url: string, selector: string | undefined, viewport = 390, rule = "tap-target-small") =>
    buttonChecksStub(url, selector, viewport, rule);

  it("ignores :nth-of-type so sibling instances share a fingerprint", () => {
    expect(fingerprint(raw("https://e.com/", ".dots > div:nth-of-type(3)")))
      .toBe(fingerprint(raw("https://e.com/x", ".dots > div:nth-of-type(90)")));
  });

  it("is stable when a plugin generates element IDs per page load (SmartMenus #sm-<timestamp>-N on the CHM pilot)", () => {
    expect(fingerprint(raw("https://e.com/", "#sm-1793682731580727-1", 390, "axe:aria-valid-attr-value")))
      .toBe(fingerprint(raw("https://e.com/", "#sm-17936905811318271-1", 390, "axe:aria-valid-attr-value")));
    // Different menu items stay different.
    expect(fingerprint(raw("https://e.com/", "#sm-1793682731580727-1", 390, "axe:aria-valid-attr-value")))
      .not.toBe(fingerprint(raw("https://e.com/", "#sm-1793682731580727-3", 390, "axe:aria-valid-attr-value")));
    // Short numbers (h2, col-50, elementor ids) are not touched.
    expect(fingerprint(raw("https://e.com/", ".elementor-element-1a2b3c4 h2", 390))).not.toBe(fingerprint(raw("https://e.com/", ".elementor-element-1a2b3c5 h2", 390)));
  });

  it("keeps page-level findings (no selector) per page", () => {
    expect(fingerprint(raw("https://e.com/a", undefined, 1440, "h1-missing")))
      .not.toBe(fingerprint(raw("https://e.com/b", undefined, 1440, "h1-missing")));
  });

  it("collapses a shared component into one finding with all pages, viewports and instances", () => {
    const issues = dedupeAndNumber([
      raw("https://e.com/a", ".dots > div:nth-of-type(1)"), raw("https://e.com/a", ".dots > div:nth-of-type(2)"),
      raw("https://e.com/b", ".dots > div:nth-of-type(1)", 320), raw("https://e.com/c", ".dots > div:nth-of-type(1)", 768),
    ]);
    expect(issues).toHaveLength(1);
    const [i] = issues;
    expect(i.location.pages).toEqual(["https://e.com/a", "https://e.com/b", "https://e.com/c"]);
    expect(i.location.viewports).toEqual([320, 390, 768]);
    expect(i.instanceCount).toBe(4);
    expect(i.sharedTemplate).toBe(true);
    expect(i.occurrences).toHaveLength(4);
  });
});

function buttonChecksStub(url: string, selector: string | undefined, viewport: number, rule: string) {
  return {
    type: "buttons" as const, rule, kind: "confirmed" as const, severity: "medium" as const, confidence: 0.9, title: "t",
    recommendation: "r", location: { url, viewport, selector },
    evidence: { screenshot: `s/${viewport}.png`, boxes: [{ x: 0, y: 0, w: 10, h: 10 }], capturedAt: "t" },
  };
}

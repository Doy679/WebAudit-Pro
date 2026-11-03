import { describe, it, expect } from "vitest";
import { normalizeUrl, isSameSite } from "../src/discover/normalize.js";
import { parseRobots, isAllowed } from "../src/discover/robots.js";
import { parseSitemap } from "../src/discover/sitemap.js";
import { samplePages } from "../src/discover/sample.js";

describe("normalizeUrl", () => {
  it("lowercases host, drops fragment and tracking params", () => {
    expect(normalizeUrl("HTTPS://Example.COM/About/?utm_source=x&gclid=1&page=2#top"))
      .toBe("https://example.com/About/?page=2");
  });

  it("resolves relative links against a base", () => {
    expect(normalizeUrl("../contact", "https://example.com/a/b/")).toBe("https://example.com/a/contact");
  });

  it("treats bare domain and trailing slash root as the same", () => {
    expect(normalizeUrl("https://example.com")).toBe("https://example.com/");
  });

  it("returns null for non-http schemes", () => {
    expect(normalizeUrl("mailto:a@b.com")).toBeNull();
    expect(normalizeUrl("javascript:void(0)")).toBeNull();
  });
});

describe("isSameSite", () => {
  it("matches with or without www", () => {
    expect(isSameSite("https://www.example.com/x", "https://example.com/")).toBe(true);
    expect(isSameSite("https://other.com/x", "https://example.com/")).toBe(false);
  });
});

describe("robots", () => {
  const robots = parseRobots(`
User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php
Disallow: /private
Sitemap: https://example.com/sitemap_index.xml
`);

  it("applies the * group to our crawler", () => {
    expect(isAllowed(robots, "https://example.com/wp-admin/edit.php")).toBe(false);
    expect(isAllowed(robots, "https://example.com/private/page")).toBe(false);
    expect(isAllowed(robots, "https://example.com/about")).toBe(true);
  });

  it("longest match wins, so Allow can override Disallow", () => {
    expect(isAllowed(robots, "https://example.com/wp-admin/admin-ajax.php")).toBe(true);
  });

  it("collects sitemap URLs", () => {
    expect(robots.sitemaps).toEqual(["https://example.com/sitemap_index.xml"]);
  });

  it("allows everything when robots.txt is empty", () => {
    expect(isAllowed(parseRobots(""), "https://example.com/anything")).toBe(true);
  });
});

describe("parseSitemap", () => {
  it("parses a urlset", () => {
    const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://example.com/</loc></url>
      <url><loc> https://example.com/about/ </loc></url></urlset>`;
    expect(parseSitemap(xml)).toEqual({ kind: "urlset", locs: ["https://example.com/", "https://example.com/about/"] });
  });

  it("parses a sitemap index", () => {
    const xml = `<sitemapindex><sitemap><loc>https://example.com/page-sitemap.xml</loc></sitemap></sitemapindex>`;
    expect(parseSitemap(xml)).toEqual({ kind: "index", locs: ["https://example.com/page-sitemap.xml"] });
  });

  it("decodes XML entities in locs", () => {
    const xml = `<urlset><url><loc>https://example.com/?a=1&amp;b=2</loc></url></urlset>`;
    expect(parseSitemap(xml).locs).toEqual(["https://example.com/?a=1&b=2"]);
  });
});

describe("samplePages", () => {
  it("always includes the start URL first, dedupes, and caps", () => {
    const urls = ["https://example.com/a", "https://example.com/a", "https://example.com/b", "https://example.com/c"];
    expect(samplePages("https://example.com/", urls, 3)).toEqual([
      "https://example.com/", "https://example.com/a", "https://example.com/b",
    ]);
  });

  it("spreads the sample across top-level sections instead of taking the first N", () => {
    const urls = [
      ...Array.from({ length: 10 }, (_, i) => `https://example.com/blog/post-${i}`),
      "https://example.com/loans/fha",
      "https://example.com/about",
    ];
    const picked = samplePages("https://example.com/", urls, 4);
    expect(picked).toContain("https://example.com/loans/fha");
    expect(picked).toContain("https://example.com/about");
    expect(picked).toHaveLength(4);
  });
});

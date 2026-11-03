const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

export function parseSitemap(xml: string): { kind: "urlset" | "index"; locs: string[] } {
  const kind = /<sitemapindex[\s>]/i.test(xml) ? "index" : "urlset";
  const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/gi)].map((m) => decode(m[1].trim()));
  return { kind, locs };
}

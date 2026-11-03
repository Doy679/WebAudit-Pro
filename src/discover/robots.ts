export interface Robots {
  rules: { allow: boolean; path: string }[];
  sitemaps: string[];
}

/** Parses robots.txt, keeping only the rules for `User-agent: *` (our crawler has no named group). */
export function parseRobots(text: string): Robots {
  const robots: Robots = { rules: [], sitemaps: [] };
  let agents: string[] = [];
  let inRules = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, key, value] = m;
    const k = key.toLowerCase();
    if (k === "sitemap") {
      robots.sitemaps.push(value);
    } else if (k === "user-agent") {
      if (inRules) agents = [];
      inRules = false;
      agents.push(value.toLowerCase());
    } else if (k === "allow" || k === "disallow") {
      inRules = true;
      if (agents.includes("*") && value) robots.rules.push({ allow: k === "allow", path: value });
    }
  }
  return robots;
}

function matches(rulePath: string, path: string): boolean {
  const anchored = rulePath.endsWith("$");
  const pattern = rulePath
    .replace(/\$$/, "")
    .replace(/[.+?^{}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp("^" + pattern + (anchored ? "$" : "")).test(path);
}

/** Longest matching rule wins; Allow wins ties. */
export function isAllowed(robots: Robots, url: string): boolean {
  const u = new URL(url);
  const path = u.pathname + u.search;
  let best: { allow: boolean; len: number } | null = null;
  for (const rule of robots.rules) {
    if (!matches(rule.path, path)) continue;
    const len = rule.path.length;
    if (!best || len > best.len || (len === best.len && rule.allow)) best = { allow: rule.allow, len };
  }
  return best ? best.allow : true;
}

// Re-runs the current rules on a saved run's snapshots (no crawling) and compares counts with the original issues.json.
// Usage: npx tsx scripts/recheck.ts runs/<domain>/<timestamp>
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Issue, PageSnapshot, RawIssue, Tokens } from "../src/types.js";
import { layoutChecks } from "../src/checks/layout.js";
import { buttonChecks } from "../src/checks/buttons.js";
import { typographyChecks } from "../src/checks/typography.js";
import { contentChecks } from "../src/checks/content.js";
import { spacingChecks } from "../src/checks/spacing.js";
import { buildBaseline } from "../src/baseline/spacing.js";
import { seoChecks, siteSeoChecks } from "../src/checks/seo.js";
import { componentChecks } from "../src/checks/components.js";
import { dedupeAndNumber } from "../src/report/dedupe.js";

const runDir = resolve(process.argv[2] ?? "");
const tokens = JSON.parse(await readFile(resolve("config/tokens.json"), "utf8")) as Tokens;
const old = JSON.parse(await readFile(join(runDir, "issues.json"), "utf8")) as Issue[];

const snapshots: PageSnapshot[] = [];
for (const slug of await readdir(join(runDir, "snapshots"))) {
  for (const f of await readdir(join(runDir, "snapshots", slug))) {
    if (/^\d+\.json$/.test(f)) snapshots.push(JSON.parse(await readFile(join(runDir, "snapshots", slug, f), "utf8")));
  }
}
const ok = snapshots.filter((s) => s.meta.status > 0 && s.meta.status < 400);

const raw: RawIssue[] = [];
for (const s of ok) raw.push(...layoutChecks(s, tokens), ...buttonChecks(s, tokens), ...typographyChecks(s, tokens), ...contentChecks(s, tokens));
const baseline = buildBaseline(ok);
for (const s of ok) raw.push(...spacingChecks(s, baseline, tokens));
const widest = new Map<string, PageSnapshot>();
for (const s of snapshots) if (!widest.has(s.url) || s.viewport > widest.get(s.url)!.viewport) widest.set(s.url, s);
for (const s of widest.values()) raw.push(...seoChecks(s, tokens));
raw.push(...siteSeoChecks([...widest.values()], null), ...componentChecks(ok));

// The original run did not keep raw axe output, so its accessibility findings are re-grouped as they were.
for (const i of old.filter((i) => i.type === "a11y")) {
  for (const vp of i.location.viewports) {
    raw.push({
      type: i.type, rule: i.rule, kind: i.kind, severity: i.severity, confidence: i.confidence, title: i.title,
      current: i.current, proposed: i.proposed, recommendation: i.recommendation,
      location: { url: i.location.url, viewport: vp, selector: i.location.selector },
      evidence: { screenshot: "", boxes: i.evidence.boxes, capturedAt: i.evidence.capturedAt },
    });
  }
}

const grouped = dedupeAndNumber(raw);
const tally = (xs: { rule: string; kind: string }[], key: "rule" | "kind") =>
  xs.reduce<Record<string, number>>((m, x) => ({ ...m, [x[key]]: (m[x[key]] ?? 0) + 1 }), {});
const before = tally(old, "rule"), after = tally(grouped, "rule");
const rules = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort((a, b) => (before[b] ?? 0) - (before[a] ?? 0));

console.log(`| Rule | Before | After |\n|---|---:|---:|`);
for (const r of rules) console.log(`| \`${r}\` | ${before[r] ?? 0} | ${after[r] ?? 0} |`);
console.log(`| **Total** | **${old.length}** | **${grouped.length}** |`);
console.log(`\nRaw single-viewport findings after the new rules: ${raw.length}`);
console.log("By kind before:", JSON.stringify(tally(old, "kind")));
console.log("By kind after: ", JSON.stringify(tally(grouped, "kind")));
console.log("Shared across ≥ 2 pages:", grouped.filter((g) => g.location.pages.length > 1).length);

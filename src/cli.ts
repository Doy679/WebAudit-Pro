import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import type { Tokens } from "./types.js";
import { runAudit } from "./audit.js";

const HELP = `WebAudit Pro (POC): read-only website UX/UI audit

Usage:
  npm run audit -- --url https://example.com [--max-pages 20]
  npm run audit -- --url https://example.com --urls pilot-urls.txt

Options:
  --url <url>          Start URL (required). Only this domain is scanned.
  --urls <file>        Text file with one URL per line (skips sitemap sampling).
  --max-pages <n>      Page cap (default from config/tokens.json).
  --viewports <list>   Comma-separated widths, e.g. 390,1440 (default from config).
  --tokens <file>      Alternative tokens.json.
  --out <dir>          Output folder (default: runs).
  --help               Show this help.
`;

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      urls: { type: "string" },
      "max-pages": { type: "string" },
      viewports: { type: "string" },
      tokens: { type: "string", default: "config/tokens.json" },
      out: { type: "string", default: "runs" },
      help: { type: "boolean" },
    },
  });
  if (values.help || !values.url) {
    console.log(HELP);
    process.exit(values.help ? 0 : 1);
  }

  const tokens = JSON.parse(await readFile(resolve(values.tokens!), "utf8")) as Tokens;
  if (values.viewports) tokens.viewports = values.viewports.split(",").map((v) => parseInt(v, 10)).filter((v) => v > 0);

  const urls = values.urls
    ? (await readFile(resolve(values.urls), "utf8")).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    : undefined;
  const maxPages = values["max-pages"] ? parseInt(values["max-pages"], 10) : urls?.length;

  await runAudit({ startUrl: values.url, urls, maxPages, outDir: resolve(values.out!), tokens });
}

main().catch((e) => {
  console.error(`Audit failed: ${(e as Error).message}`);
  process.exit(1);
});

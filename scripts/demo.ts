// Runs a full audit against the local fixture site (no live sites touched) and prints the report path.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Tokens } from "../src/types.js";
import { runAudit } from "../src/audit.js";
import { startFixtureServer } from "../test/fixtureServer.js";

const tokens = JSON.parse(await readFile(resolve("config/tokens.json"), "utf8")) as Tokens;
const server = await startFixtureServer();
// The demo audits a local fixture site, so it opts into the test-only loopback policy explicitly.
try {
  await runAudit({ startUrl: server.origin + "/", outDir: resolve("runs/demo"), tokens: { ...tokens, crawl: { ...tokens.crawl, delayMs: 200 } }, policy: { allowLoopback: true } });
} finally {
  await server.close();
}

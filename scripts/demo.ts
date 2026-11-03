// Runs a full audit against the local fixture site (no live sites touched) and prints the report path.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Tokens } from "../src/types.js";
import { runAudit } from "../src/audit.js";
import { startFixtureServer } from "../test/fixtureServer.js";

const tokens = JSON.parse(await readFile(resolve("config/tokens.json"), "utf8")) as Tokens;
const server = await startFixtureServer();
try {
  await runAudit({ startUrl: server.origin + "/", outDir: resolve("runs/demo"), tokens: { ...tokens, crawl: { ...tokens.crawl, delayMs: 200 } } });
} finally {
  await server.close();
}

// The web app and the worker open a new database at the same moment. Migrations check a column and then add it,
// so without a lock two processes could both try to add it ("duplicate column name"), and the loser crashed.
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tsx = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const open = (dir: string) => new Promise<{ code: number | null; err: string }>((resolve) => {
  const p = spawn(process.execPath, [tsx, "-e", "import('./server/db.ts').then((m) => { m.getDb(); console.log('ok'); });"], {
    cwd: process.cwd(), env: { ...process.env, WEBAUDIT_DATA_DIR: dir, WEBAUDIT_SECRET: "test-secret-test-secret-test-secret-1234" },
  });
  let err = "";
  p.stderr.on("data", (d: Buffer) => { err += d.toString(); });
  p.on("close", (code) => resolve({ code, err }));
});

describe("database start-up", () => {
  it("several processes opening a brand-new database at once all migrate successfully", async () => {
    for (let round = 0; round < 3; round++) {
      const dir = mkdtempSync(join(tmpdir(), "webaudit-migrate-"));
      try {
        const results = await Promise.all(Array.from({ length: 6 }, () => open(dir)));
        const failed = results.filter((r) => r.code !== 0);
        expect(failed.map((r) => r.err.split("\n").find((l) => /Error|duplicate/i.test(l)) ?? r.err.slice(0, 200))).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }, 120_000);
});

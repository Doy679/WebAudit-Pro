// Regression tests for the 2026-11-04 browser QA findings (BUG-xx / UX-xx in docs/agile/browser_qa_2026-11-04).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { User } from "../server/auth";

const dir = mkdtempSync(join(tmpdir(), "webaudit-qa-"));
process.env.WEBAUDIT_DATA_DIR = dir;
process.env.WEBAUDIT_SECRET = "test-secret-test-secret-test-secret-1234";

const { closeDb, run, newId } = await import("../server/db");
const auth = await import("../server/auth");
const projects = await import("../server/projects");
const g = await import("../server/google/service");
const perms = await import("../server/permissions");

let admin: User, outsider: User;
let projectId: string;

const psi = (url: string, strategy: "mobile" | "desktop", fetchedAt: string, score: number, status: "ok" | "error" = "ok") =>
  run(`INSERT INTO psi_results (id, project_id, url, strategy, status, fetched_at, result_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    newId(), projectId, url, strategy, status, fetchedAt, status === "ok" ? JSON.stringify({ scores: { performance: score } }) : null);

beforeAll(() => {
  admin = auth.createUser({ email: "admin@example.com", name: "Admin", password: "correct horse battery", role: "admin" });
  outsider = auth.createUser({ email: "pm@example.com", name: "Other PM", password: "correct horse battery", role: "pm" });
  projectId = projects.createProject(admin, { name: "CHM", baseUrl: "https://capitalhomemortgage.com", authorizationConfirmed: true, authorizationNote: "pilot" }).id;
});
afterAll(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

describe("BUG-03: latest PageSpeed result per URL + device", () => {
  it("returns the newest completed result for each URL and device, not the oldest", () => {
    const home = "https://capitalhomemortgage.com/";
    psi(home, "mobile", "2026-11-04T02:07:00.000Z", 59); // oldest (what the PageSpeed table wrongly showed)
    psi(home, "mobile", "2026-11-04T02:10:00.000Z", 55);
    psi(home, "mobile", "2026-11-04T02:15:00.000Z", 52); // newest
    psi(home, "desktop", "2026-11-04T02:07:00.000Z", 72);
    psi(home, "desktop", "2026-11-04T02:16:00.000Z", 80);
    const latest = g.latestPsiPerKey(admin, projectId);
    const pick = (s: string) => latest.find((r) => r.url === home && r.strategy === s)!;
    expect(latest).toHaveLength(2);
    expect(pick("mobile").result!.scores.performance).toBe(52);
    expect(pick("mobile").fetched_at).toBe("2026-11-04T02:15:00.000Z");
    expect(pick("desktop").result!.scores.performance).toBe(80);
  });

  it("breaks identical timestamps by insertion order and prefers a completed result over a newer failure", () => {
    const u = "https://capitalhomemortgage.com/clarksville/";
    psi(u, "mobile", "2026-11-04T03:00:00.000Z", 40);
    psi(u, "mobile", "2026-11-04T03:00:00.000Z", 41); // same timestamp, inserted later
    psi(u, "mobile", "2026-11-04T03:05:00.000Z", 0, "error");
    const r = g.latestPsiPerKey(admin, projectId).find((x) => x.url === u)!;
    expect(r.status).toBe("ok");
    expect(r.result!.scores.performance).toBe(41);
  });

  it("shows the failure when a URL has never succeeded, and checks project access", () => {
    const u = "https://capitalhomemortgage.com/broken/";
    psi(u, "desktop", "2026-11-04T04:00:00.000Z", 0, "error");
    expect(g.latestPsiPerKey(admin, projectId).find((x) => x.url === u)?.status).toBe("error");
    expect(() => g.latestPsiPerKey(outsider, projectId)).toThrow(perms.ForbiddenError);
  });
});

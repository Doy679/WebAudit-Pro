import { describe, it, expect } from "vitest";
import { compareRuns, type CompareIssue } from "../server/compare";
import { qualityScore } from "../server/score";

const issue = (fingerprint: string, pages: string[], current = "80px", over: Partial<CompareIssue> = {}): CompareIssue =>
  ({ id: fingerprint, code: fingerprint.toUpperCase(), fingerprint, title: fingerprint, rule: "r", severity: "medium", kind: "confirmed", pages, current, ...over });

describe("compareRuns", () => {
  const ok = new Set(["https://e.com/a", "https://e.com/b"]);

  it("classifies new, still present, changed, resolved, unable to verify and reopened", () => {
    const base = [
      issue("same", ["https://e.com/a"]),
      issue("changed", ["https://e.com/a"], "80px"),
      issue("fixed", ["https://e.com/b"]),
      issue("unverifiable", ["https://e.com/c"]),
    ];
    const latest = [
      issue("same", ["https://e.com/a"]),
      issue("changed", ["https://e.com/a"], "64px"),
      issue("brand-new", ["https://e.com/a"]),
      issue("back-again", ["https://e.com/b"]),
    ];
    const result = compareRuns(base, latest, ok, new Set(["back-again"]));
    const status = Object.fromEntries(result.map((r) => [r.fingerprint, r.status]));
    expect(status).toEqual({
      same: "still_present", changed: "changed", fixed: "resolved", unverifiable: "unable_to_verify",
      "brand-new": "new", "back-again": "reopened",
    });
    expect(result.find((r) => r.fingerprint === "changed")).toMatchObject({ before: "80px", after: "64px" });
  });

  it("never marks an issue resolved when one of its pages failed in the new run", () => {
    const [r] = compareRuns([issue("x", ["https://e.com/a", "https://e.com/z"])], [], ok, new Set());
    expect(r.status).toBe("unable_to_verify");
  });
});

describe("qualityScore", () => {
  it("is 100 with no confirmed findings and full coverage", () => {
    expect(qualityScore([], 10, 10).score).toBe(100);
  });

  it("deducts by severity per page, ignores false positives, and scales by coverage", () => {
    const issues = [
      { kind: "confirmed", severity: "high", type: "layout", verification_status: "unverified" },
      { kind: "confirmed", severity: "high", type: "layout", verification_status: "false_positive" },
      { kind: "recommendation", severity: "high", type: "spacing", verification_status: "unverified" },
    ];
    const full = qualityScore(issues, 1, 1);
    expect(full.score).toBe(95);
    expect(qualityScore(issues, 1, 2).score).toBeLessThan(full.score);
    expect(full.explanation).toMatch(/internal/i);
  });
});

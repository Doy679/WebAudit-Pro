import { randomBytes, createHash } from "node:crypto";
import { all, get, run, newId, now, tx } from "./db";
import type { User } from "./auth";
import { assertCan, assertProjectAccess, NotFoundError, projectScope } from "./permissions";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export type Decision = "approved" | "rejected" | "revision_requested";
const DECISIONS: Decision[] = ["approved", "rejected", "revision_requested"];

export function createPackage(user: User, input: { projectId: string; runId: string; issueIds: string[]; title: string; message?: string; expiresInDays: number }) {
  assertCan(user, "approval:manage");
  assertProjectAccess(user, input.projectId);
  if (!input.title.trim()) throw new Error("Give the approval package a title.");
  if (!input.issueIds.length) throw new Error("Select at least one finding to release.");
  if (!get("SELECT 1 FROM audit_runs WHERE id = ? AND project_id = ?", input.runId, input.projectId)) throw new NotFoundError("Audit run not found in this project.");

  const rows = all<{ id: string; code: string; verification_status: string; review_status: string }>(
    `SELECT id, code, verification_status, review_status FROM issues WHERE run_id = ? AND id IN (${input.issueIds.map(() => "?").join(",")})`,
    input.runId, ...input.issueIds);
  if (rows.length !== new Set(input.issueIds).size) throw new Error("Some selected findings are not part of this audit run.");
  // Client-facing claims require an explicit internal review first.
  const unreviewed = rows.filter((r) => r.verification_status === "false_positive" || (r.verification_status !== "confirmed" && r.review_status !== "approved"));
  if (unreviewed.length) {
    throw new Error(`Only internally reviewed findings (confirmed or approved, not false positives) can be released. Review first: ${unreviewed.map((r) => r.code).slice(0, 10).join(", ")}`);
  }

  const token = randomBytes(32).toString("base64url");
  const id = newId();
  const days = Math.min(Math.max(input.expiresInDays, -1), 90);
  const expires = new Date(Date.now() + days * 86_400_000).toISOString();
  tx(() => {
    run(`INSERT INTO approval_packages (id, project_id, run_id, title, message, token_hash, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, input.projectId, input.runId, input.title.trim(), (input.message ?? "").trim(), sha256(token), expires, user.id, now());
    for (const r of rows) run("INSERT INTO approval_items (package_id, issue_id) VALUES (?, ?)", id, r.id);
  });
  return { packageId: id, token };
}

export function revokePackage(user: User, packageId: string) {
  assertCan(user, "approval:manage");
  const p = get<{ project_id: string }>("SELECT project_id FROM approval_packages WHERE id = ?", packageId);
  if (!p) throw new NotFoundError("Approval package not found.");
  assertProjectAccess(user, p.project_id);
  run("UPDATE approval_packages SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL", now(), user.id, packageId);
}

export interface PackageSummary {
  id: string; project_id: string; project_name: string; run_id: string; title: string; created_at: string; expires_at: string;
  revoked_at: string | null; submitted_at: string | null; items: number; decided: number; created_by_name: string;
}

export function listPackages(user: User, projectId?: string): PackageSummary[] {
  const scope = projectScope(user, "ap.project_id");
  return all<PackageSummary>(
    `SELECT ap.id, ap.project_id, p.name AS project_name, ap.run_id, ap.title, ap.created_at, ap.expires_at, ap.revoked_at, ap.submitted_at,
       (SELECT COUNT(*) FROM approval_items ai WHERE ai.package_id = ap.id) AS items,
       (SELECT COUNT(DISTINCT d.issue_id) FROM client_decisions d WHERE d.package_id = ap.id) AS decided,
       u.name AS created_by_name
     FROM approval_packages ap JOIN projects p ON p.id = ap.project_id JOIN users u ON u.id = ap.created_by
     WHERE ${scope.sql} ${projectId ? "AND ap.project_id = ?" : ""} ORDER BY ap.created_at DESC`,
    ...scope.params, ...(projectId ? [projectId] : []));
}

export function packageDecisions(user: User, packageId: string) {
  const p = get<{ project_id: string }>("SELECT project_id FROM approval_packages WHERE id = ?", packageId);
  if (!p) throw new NotFoundError("Approval package not found.");
  assertProjectAccess(user, p.project_id);
  return all<{ code: string; title: string; decision: string; comment: string; client_name: string; client_email: string; created_at: string; issue_id: string }>(
    `SELECT i.code, i.title, i.id AS issue_id, d.decision, d.comment, d.client_name, d.client_email, d.created_at
     FROM client_decisions d JOIN issues i ON i.id = d.issue_id WHERE d.package_id = ? ORDER BY d.created_at DESC`, packageId);
}

export type PackageStatus = "open" | "expired" | "revoked" | "invalid";

export interface PackageView {
  status: PackageStatus;
  package?: { id: string; title: string; message: string; expires_at: string; submitted_at: string | null; project_name: string; base_url: string; run_created_at: string };
  issues: {
    id: string; code: string; title: string; severity: string; kind: string; url: string; pages: string[]; viewports: number[];
    current_value: string | null; proposed_value: string | null; recommendation: string; shared_template: number; run_id: string;
    evidence: { annotated?: string; screenshots: { viewport: number; path: string }[] };
    decision: { decision: string; comment: string } | null;
  }[];
}

/** What a client sees for a token. Only released findings and their evidence. */
export function openPackage(token: string): PackageView {
  if (!token || token.length > 100) return { status: "invalid", issues: [] };
  const p = get<{ id: string; title: string; message: string; expires_at: string; revoked_at: string | null; submitted_at: string | null; project_name: string; base_url: string; run_created_at: string }>(
    `SELECT ap.id, ap.title, ap.message, ap.expires_at, ap.revoked_at, ap.submitted_at, pr.name AS project_name, pr.base_url, r.created_at AS run_created_at
     FROM approval_packages ap JOIN projects pr ON pr.id = ap.project_id JOIN audit_runs r ON r.id = ap.run_id WHERE ap.token_hash = ?`, sha256(token));
  if (!p) return { status: "invalid", issues: [] };
  if (p.revoked_at) return { status: "revoked", issues: [] };
  if (p.expires_at < now()) return { status: "expired", issues: [] };
  const issues = all<Record<string, unknown>>(
    `SELECT i.id, i.code, i.title, i.severity, i.kind, i.url, i.pages_json, i.viewports_json, i.current_value, i.proposed_value,
       i.recommendation, i.shared_template, i.run_id, i.evidence_json,
       (SELECT d.decision || '|' || d.comment FROM client_decisions d WHERE d.issue_id = i.id AND d.package_id = ? ORDER BY d.created_at DESC LIMIT 1) AS last
     FROM approval_items ai JOIN issues i ON i.id = ai.issue_id WHERE ai.package_id = ?
     ORDER BY CASE i.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, i.code`, p.id, p.id,
  ).map((r) => {
    const ev = JSON.parse(r.evidence_json as string);
    const last = r.last as string | null;
    return {
      id: r.id as string, code: r.code as string, title: r.title as string, severity: r.severity as string, kind: r.kind as string,
      url: r.url as string, pages: JSON.parse(r.pages_json as string), viewports: JSON.parse(r.viewports_json as string),
      current_value: r.current_value as string | null, proposed_value: r.proposed_value as string | null,
      recommendation: r.recommendation as string, shared_template: r.shared_template as number, run_id: r.run_id as string,
      evidence: { annotated: ev.annotated, screenshots: ev.screenshots },
      decision: last ? { decision: last.split("|")[0], comment: last.slice(last.indexOf("|") + 1) } : null,
    };
  });
  const { revoked_at: _r, ...pkg } = p;
  return { status: "open", package: pkg, issues };
}

/** Evidence file for a released finding (client view). Returns the run id + relative path, or null. */
export function packageEvidence(token: string, issueId: string, which: "annotated" | number): { runId: string; path: string } | null {
  const view = openPackage(token);
  if (view.status !== "open") return null;
  const issue = view.issues.find((i) => i.id === issueId);
  if (!issue) return null;
  const path = which === "annotated" ? issue.evidence.annotated : issue.evidence.screenshots.find((s) => s.viewport === which)?.path;
  return path ? { runId: issue.run_id, path } : null;
}

export function submitDecisions(
  token: string,
  client: { name: string; email: string },
  decisions: { issueId: string; decision: Decision; comment: string }[],
  meta: { ip?: string; userAgent?: string },
) {
  const view = openPackage(token);
  if (view.status === "expired") throw new Error("This approval link has expired. Ask your project contact for a new link.");
  if (view.status !== "open") throw new Error("This approval link is no longer valid.");
  const name = client.name.trim();
  const email = client.email.trim().toLowerCase();
  if (!name || name.length > 200) throw new Error("Enter your name.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid email address.");
  if (!decisions.length) throw new Error("Choose a decision for at least one finding.");
  const allowed = new Map(view.issues.map((i) => [i.id, i]));
  for (const d of decisions) {
    if (!allowed.has(d.issueId)) throw new Error("A decision refers to a finding that is not part of this package.");
    if (!DECISIONS.includes(d.decision)) throw new Error("Unknown decision.");
    if ((d.comment ?? "").length > 5000) throw new Error("Comments are limited to 5,000 characters.");
  }
  const ts = now();
  const label = `Client: ${name} <${email}>`;
  tx(() => {
    for (const d of decisions) {
      run(`INSERT INTO client_decisions (id, package_id, issue_id, decision, comment, client_name, client_email, ip, user_agent, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(), view.package!.id, d.issueId, d.decision, (d.comment ?? "").trim(), name, email, meta.ip ?? null, meta.userAgent?.slice(0, 300) ?? null, ts);
      run(`INSERT INTO issue_events (id, issue_id, user_id, actor_label, action, from_value, to_value, note, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
        newId(), d.issueId, label, `client_${d.decision}`, allowed.get(d.issueId)!.decision?.decision ?? null, d.decision, (d.comment ?? "").trim() || null, ts);
    }
    run("UPDATE approval_packages SET submitted_at = ? WHERE id = ?", ts, view.package!.id);
  });
}

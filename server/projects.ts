import { all, get, run, newId, now, tx } from "./db";
import type { User } from "./auth";
import { assertCan, assertProjectAccess, projectScope } from "./permissions";

export interface ProjectSettings {
  maxPages?: number;
  viewports?: number[];
  categories?: string[];
  delayMs?: number;
  useSitemap?: boolean;
  /** Design standards: overrides merged into config/tokens.json for this project's audits. */
  tokens?: Record<string, unknown>;
}

export interface Project {
  id: string;
  name: string;
  base_url: string;
  domain: string;
  authorized_by: string;
  authorized_at: string;
  authorization_note: string;
  settings: ProjectSettings;
  created_at: string;
  updated_at: string;
}

type ProjectRow = Omit<Project, "settings"> & { settings_json: string };
const toProject = (r: ProjectRow): Project => {
  const { settings_json, ...rest } = r;
  return { ...rest, settings: JSON.parse(settings_json) };
};

export { bareHost } from "./scope";
import { bareHost, urlInProjectScope } from "./scope";

export function parseSiteUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim().match(/^https?:\/\//i) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    throw new Error("Enter a valid website address, e.g. https://example.com");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https websites can be audited.");
  if (url.username || url.password) throw new Error("Website addresses with embedded credentials are not allowed.");
  if (!url.hostname.includes(".") && url.hostname !== "localhost") throw new Error("Enter the full domain, including its ending (e.g. .com).");
  return url;
}

/** True when the URL is on the project's domain (with or without www). Subdomains are a separate scope. */
export const isInScope = (project: Pick<Project, "domain">, url: string) => urlInProjectScope(project, url);

export function createProject(
  user: User,
  input: { name: string; baseUrl: string; authorizationConfirmed: boolean; authorizationNote: string; settings?: ProjectSettings },
): Project {
  assertCan(user, "project:create");
  if (!input.name.trim()) throw new Error("Enter a project name.");
  if (!input.authorizationConfirmed) throw new Error("Confirm that you are authorized to audit this website.");
  if (!input.authorizationNote.trim()) throw new Error("Describe the authorization (e.g. client contract or written approval).");
  const url = parseSiteUrl(input.baseUrl);
  const id = newId();
  const ts = now();
  tx(() => {
    run(`INSERT INTO projects (id, name, base_url, domain, authorized_by, authorized_at, authorization_note, settings_json, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, input.name.trim(), url.origin + "/", bareHost(url.hostname), user.id, ts, input.authorizationNote.trim(),
      JSON.stringify(input.settings ?? {}), user.id, ts, ts);
    run("INSERT INTO project_members (project_id, user_id) VALUES (?, ?)", id, user.id);
  });
  return getProject(user, id);
}

export function getProject(user: User, id: string): Project {
  assertProjectAccess(user, id);
  return toProject(get<ProjectRow>("SELECT * FROM projects WHERE id = ?", id)!);
}

export interface ProjectSummary extends Project {
  runs: number;
  last_run_at: string | null;
  last_status: string | null;
  open_findings: number;
}

export function listProjects(user: User): ProjectSummary[] {
  const scope = projectScope(user, "p.id");
  return all<ProjectRow & { runs: number; last_run_at: string | null; last_status: string | null; open_findings: number }>(
    `SELECT p.*,
       (SELECT COUNT(*) FROM audit_runs r WHERE r.project_id = p.id) AS runs,
       (SELECT MAX(created_at) FROM audit_runs r WHERE r.project_id = p.id) AS last_run_at,
       (SELECT status FROM audit_runs r WHERE r.project_id = p.id ORDER BY created_at DESC LIMIT 1) AS last_status,
       (SELECT COUNT(*) FROM issues i WHERE i.run_id = (SELECT id FROM audit_runs r WHERE r.project_id = p.id AND r.status = 'completed' ORDER BY created_at DESC LIMIT 1)
          AND i.verification_status != 'false_positive') AS open_findings
     FROM projects p WHERE ${scope.sql} ORDER BY p.name`, ...scope.params,
  ).map((r) => ({ ...toProject(r), runs: r.runs, last_run_at: r.last_run_at, last_status: r.last_status, open_findings: r.open_findings }));
}

export function updateProject(user: User, id: string, patch: { name?: string; settings?: ProjectSettings; authorizationNote?: string }): Project {
  assertCan(user, "project:edit");
  const current = getProject(user, id);
  if (patch.name !== undefined && !patch.name.trim()) throw new Error("Enter a project name.");
  run("UPDATE projects SET name = ?, settings_json = ?, authorization_note = ?, updated_at = ? WHERE id = ?",
    patch.name?.trim() ?? current.name,
    JSON.stringify({ ...current.settings, ...(patch.settings ?? {}) }),
    patch.authorizationNote?.trim() || current.authorization_note,
    now(), id);
  return getProject(user, id);
}

export function addMember(user: User, projectId: string, memberId: string) {
  assertCan(user, "project:edit");
  assertProjectAccess(user, projectId);
  run("INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)", projectId, memberId);
}

export function removeMember(user: User, projectId: string, memberId: string) {
  assertCan(user, "project:edit");
  assertProjectAccess(user, projectId);
  run("DELETE FROM project_members WHERE project_id = ? AND user_id = ?", projectId, memberId);
}

export function projectMembers(user: User, projectId: string) {
  assertProjectAccess(user, projectId);
  return all<{ id: string; name: string; email: string; role: string }>(
    `SELECT u.id, u.name, u.email, u.role FROM project_members m JOIN users u ON u.id = m.user_id
     WHERE m.project_id = ? AND u.disabled = 0 ORDER BY u.name`, projectId);
}

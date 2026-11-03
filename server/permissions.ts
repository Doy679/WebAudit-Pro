import { all, get } from "./db";
import type { Role, User } from "./auth";

export class ForbiddenError extends Error {
  constructor(message = "You don't have access to this.") {
    super(message);
  }
}
export class NotFoundError extends Error {
  constructor(message = "Not found.") {
    super(message);
  }
}

export type Action =
  | "dashboard:view" | "project:create" | "project:edit" | "audit:start" | "audit:cancel"
  | "issue:review" | "issue:implement" | "export:create" | "approval:manage" | "users:manage" | "settings:manage";

const MATRIX: Record<Role, Action[]> = {
  admin: ["dashboard:view", "project:create", "project:edit", "audit:start", "audit:cancel", "issue:review", "issue:implement", "export:create", "approval:manage", "users:manage", "settings:manage"],
  pm: ["dashboard:view", "project:create", "project:edit", "audit:start", "audit:cancel", "issue:review", "issue:implement", "export:create", "approval:manage"],
  qa: ["dashboard:view", "audit:start", "audit:cancel", "issue:review", "export:create"],
  developer: ["dashboard:view", "issue:implement", "export:create"],
  // Clients only ever use approval links; they have no dashboard access.
  client: [],
};

export const can = (user: User, action: Action) => MATRIX[user.role].includes(action);

export function assertCan(user: User, action: Action) {
  if (!can(user, action)) throw new ForbiddenError();
}

export function canAccessProject(user: User, projectId: string): boolean {
  if (!can(user, "dashboard:view")) return false;
  if (user.role === "admin") return !!get("SELECT 1 FROM projects WHERE id = ?", projectId);
  return !!get("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?", projectId, user.id);
}

export function assertProjectAccess(user: User, projectId: string) {
  if (!get("SELECT 1 FROM projects WHERE id = ?", projectId)) throw new NotFoundError("Project not found.");
  if (!canAccessProject(user, projectId)) throw new ForbiddenError();
}

/** SQL fragment + params restricting a `project_id` column to the user's projects. */
export function projectScope(user: User, column = "project_id"): { sql: string; params: string[] } {
  if (!can(user, "dashboard:view")) return { sql: "0", params: [] };
  if (user.role === "admin") return { sql: "1", params: [] };
  return { sql: `${column} IN (SELECT project_id FROM project_members WHERE user_id = ?)`, params: [user.id] };
}

export const accessibleProjectIds = (user: User) => {
  const scope = projectScope(user, "id");
  return all<{ id: string }>(`SELECT id FROM projects WHERE ${scope.sql}`, ...scope.params).map((r) => r.id);
};

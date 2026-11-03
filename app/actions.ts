"use server";

import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authenticate, changePassword, createSession, createUser, destroySession, resetPassword, setUserDisabled, userCount, ROLES, type Role } from "@/server/auth";
import { backupDatabase } from "@/server/backup";
import { deleteView, saveView } from "@/server/saved-views";
import { dismissOnboarding } from "@/server/onboarding";
import { addMember, createProject, removeMember, updateProject, type ProjectSettings } from "@/server/projects";
import { ActiveAuditError, createAuditRun, requestCancel } from "@/server/runs";
import { bulkReview, reviewIssue, type ReviewAction } from "@/server/issues";
import { createExport, type ExportFormat, type ExportFilters } from "@/server/exports";
import { createPackage, revokePackage, submitDecisions, type Decision } from "@/server/approvals";
import { assertCan } from "@/server/permissions";
import { DEFAULT_AI_MODEL, deleteSetting, encryptSecret, setSetting } from "@/server/settings";
import { getIssue } from "@/server/issues";
import { explainFinding } from "@/server/ai";
import { requireUser, setSessionCookie, clearSessionCookie, SESSION_COOKIE } from "@/app/lib/session";
import { cookies } from "next/headers";

export type ActionState = { error?: string; ok?: string; link?: string } | undefined;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string) => (fd.get(k) ? Number(fd.get(k)) : undefined);

/** Runs an action and turns thrown errors into a message for the form (redirects pass through). */
async function attempt(fn: () => Promise<ActionState | void> | ActionState | void): Promise<ActionState> {
  try {
    return (await fn()) ?? undefined;
  } catch (e) {
    unstable_rethrow(e);
    return { error: (e as Error).message || "Something went wrong." };
  }
}

// Simple in-memory rate limiter (per process) for login and client submissions.
const hits = new Map<string, number[]>();
function rateLimit(key: string, max: number, windowMs: number) {
  const t = Date.now();
  const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
  if (recent.length >= max) throw new Error("Too many attempts. Wait a few minutes and try again.");
  hits.set(key, [...recent, t]);
}
const clientIp = async () => (await headers()).get("x-forwarded-for")?.split(",")[0].trim() || "local";

// ── Auth ────────────────────────────────────────────────────────────────

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    rateLimit(`login:${await clientIp()}`, 10, 10 * 60_000);
    const user = authenticate(str(fd, "email"), String(fd.get("password") ?? ""));
    if (!user) return { error: "Email or password is incorrect." };
    if (user.role === "client") return { error: "Client accounts use the approval link they were sent, not the dashboard." };
    await setSessionCookie(createSession(user.id));
    redirect("/");
  });
}

export async function logoutAction() {
  const jar = await cookies();
  destroySession(jar.get(SESSION_COOKIE)?.value);
  await clearSessionCookie();
  redirect("/login");
}

/** First-run only: creates the initial admin when there are no users yet. */
export async function setupAdminAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    if (userCount() > 0) return { error: "Setup is already complete. Sign in instead." };
    if (String(fd.get("password")) !== String(fd.get("confirm"))) return { error: "The passwords don't match." };
    const user = createUser({ email: str(fd, "email"), name: str(fd, "name"), password: String(fd.get("password") ?? ""), role: "admin" });
    await setSessionCookie(createSession(user.id));
    redirect("/");
  });
}

// ── Projects ────────────────────────────────────────────────────────────

export async function createProjectAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser("project:create");
    const project = createProject(user, {
      name: str(fd, "name"),
      baseUrl: str(fd, "baseUrl"),
      authorizationConfirmed: fd.get("authorized") === "on",
      authorizationNote: str(fd, "authorizationNote"),
    });
    redirect(`/projects/${project.id}`);
  });
}

export async function updateProjectAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser("project:edit");
    const id = str(fd, "projectId");
    const settings: ProjectSettings = {
      maxPages: num(fd, "maxPages"),
      delayMs: num(fd, "delayMs"),
      viewports: fd.getAll("viewports").map(Number),
      categories: fd.getAll("categories").map(String),
    };
    updateProject(user, id, { name: str(fd, "name"), settings, authorizationNote: str(fd, "authorizationNote") });
    revalidatePath(`/projects/${id}`);
    return { ok: "Project settings saved." };
  });
}

/** Design standards: validated numbers merged into the engine tokens for this project. */
export async function saveStandardsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser("project:edit");
    const id = str(fd, "projectId");
    const list = (k: string) => str(fd, k).split(/[\s,]+/).filter(Boolean).map(Number);
    const spacing = list("spacingScale");
    if (spacing.some((n) => !Number.isFinite(n) || n < 0 || n > 400)) throw new Error("Spacing values must be numbers between 0 and 400.");
    const tokens = {
      spacingScale: spacing.length ? [...new Set(spacing)].sort((a, b) => a - b) : undefined,
      tapTargetMinPx: num(fd, "tapTargetMinPx"),
      minFontSizePx: num(fd, "minFontSizePx"),
      bodyLineHeightMin: num(fd, "bodyLineHeightMin"),
      spacing: { minDeviationPx: num(fd, "minDeviationPx") ?? 16, outlierRatio: num(fd, "outlierRatio") ?? 1.5, minSamples: num(fd, "minSamples") ?? 3 },
      standards: {
        fontFamilies: str(fd, "fontFamilies"),
        headingScale: str(fd, "headingScale"),
        containerWidths: str(fd, "containerWidths"),
        colors: str(fd, "colors"),
        buttonHeights: str(fd, "buttonHeights"),
        borderRadius: str(fd, "borderRadius"),
        breakpoints: str(fd, "breakpoints"),
      },
    };
    updateProject(user, id, { settings: { tokens } });
    revalidatePath(`/projects/${id}`);
    return { ok: "Design standards saved. They apply to the next audit." };
  });
}

export async function addMemberAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser("project:edit");
    addMember(user, str(fd, "projectId"), str(fd, "userId"));
    revalidatePath(`/projects/${str(fd, "projectId")}`);
    return { ok: "Member added." };
  });
}

export async function removeMemberAction(fd: FormData) {
  const user = await requireUser("project:edit");
  removeMember(user, str(fd, "projectId"), str(fd, "userId"));
  revalidatePath(`/projects/${str(fd, "projectId")}`);
}

// ── Audits ──────────────────────────────────────────────────────────────

export async function startAuditAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    return await startAudit(fd);
  } catch (e) {
    unstable_rethrow(e);
    // Point the user at the audit that's already queued instead of creating a duplicate.
    if (e instanceof ActiveAuditError) return { error: e.message, link: `/audits/${e.runId}` };
    return { error: (e as Error).message || "The audit could not be started." };
  }
}

async function startAudit(fd: FormData): Promise<ActionState> {
  {
    const user = await requireUser("audit:start");
    const urls = str(fd, "urls").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    const runId = await createAuditRun(user, str(fd, "projectId"), {
      startUrl: str(fd, "startUrl"),
      maxPages: num(fd, "maxPages"),
      useSitemap: fd.get("useSitemap") === "on",
      urls: urls.length ? urls : undefined,
      viewports: fd.getAll("viewports").map(Number),
      categories: fd.getAll("categories").map(String),
      delayMs: num(fd, "delayMs"),
      google: {
        psiMobile: fd.get("psiMobile") === "on", psiDesktop: fd.get("psiDesktop") === "on", psiMaxUrls: num(fd, "psiMaxUrls"),
        gscPerformance: fd.get("gscPerformance") === "on", gscSitemaps: fd.get("gscSitemaps") === "on", inspectMaxUrls: num(fd, "inspectMaxUrls"),
      },
    });
    redirect(`/audits/${runId}`);
  }
}

export async function cancelAuditAction(fd: FormData) {
  const user = await requireUser("audit:cancel");
  requestCancel(user, str(fd, "runId"));
  revalidatePath(`/audits/${str(fd, "runId")}`);
}

// ── Review ──────────────────────────────────────────────────────────────

function reviewFromForm(fd: FormData): ReviewAction {
  const action = str(fd, "action");
  const note = str(fd, "note") || undefined;
  switch (action) {
    case "assign": return { action, assigneeId: str(fd, "assigneeId") || null, note };
    case "priority": return { action, priority: (str(fd, "priority") || null) as "high" | "medium" | "low" | null, note };
    case "implementation": return { action, status: str(fd, "status") as "todo" | "in_progress" | "done" | "wont_fix", note };
    case "note": return { action, note: note ?? "" };
    case "confirm": case "false_positive": case "unverify": case "approve": case "request_revision": case "reject":
      return { action, note };
    default: throw new Error("Unknown review action.");
  }
}

export async function reviewAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const id = str(fd, "issueId");
    reviewIssue(user, id, reviewFromForm(fd));
    revalidatePath(`/issues/${id}`);
    return { ok: "Saved." };
  });
}

export async function bulkReviewAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const ids = fd.getAll("ids").map(String);
    const n = bulkReview(user, ids, reviewFromForm(fd));
    revalidatePath("/issues");
    return { ok: `Updated ${n} finding${n === 1 ? "" : "s"}.` };
  });
}

// ── Reports ─────────────────────────────────────────────────────────────

export async function createExportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser("export:create");
    const filters: ExportFilters = {
      kind: str(fd, "kind") || undefined,
      severity: str(fd, "severity") || undefined,
      type: str(fd, "type") || undefined,
      reviewedOnly: fd.get("reviewedOnly") === "on",
      excludeFalsePositives: true,
      ids: fd.getAll("ids").map(String).filter(Boolean),
    };
    if (!filters.ids?.length) delete filters.ids;
    createExport(user, { runId: str(fd, "runId"), format: str(fd, "format") as ExportFormat, filters });
    revalidatePath("/reports");
    return { ok: "Report queued. It will appear below when it's ready." };
  });
}

// ── Client approvals ────────────────────────────────────────────────────

export async function createApprovalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser("approval:manage");
    const { token } = createPackage(user, {
      projectId: str(fd, "projectId"),
      runId: str(fd, "runId"),
      issueIds: fd.getAll("ids").map(String),
      title: str(fd, "title"),
      message: str(fd, "message"),
      expiresInDays: num(fd, "expiresInDays") ?? 14,
    });
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
    revalidatePath("/approvals");
    return { ok: "Approval link created. Copy it now: it is shown only once.", link: `${origin}/approve/${token}` };
  });
}

export async function revokeApprovalAction(fd: FormData) {
  const user = await requireUser("approval:manage");
  revokePackage(user, str(fd, "packageId"));
  revalidatePath("/approvals");
}

/** Public: submitted from the client approval page. The token is the only credential. */
export async function submitClientDecisionsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const token = str(fd, "token");
    rateLimit(`client:${token.slice(0, 16)}`, 20, 60 * 60_000);
    const decisions = fd.getAll("issueIds").map(String).flatMap((issueId) => {
      const decision = str(fd, `decision:${issueId}`) as Decision;
      return decision ? [{ issueId, decision, comment: str(fd, `comment:${issueId}`) }] : [];
    });
    const h = await headers();
    submitDecisions(token, { name: str(fd, "clientName"), email: str(fd, "clientEmail") }, decisions,
      { ip: await clientIp(), userAgent: h.get("user-agent") ?? undefined });
    revalidatePath(`/approve/${token}`);
    return { ok: `Thank you. ${decisions.length} decision${decisions.length === 1 ? "" : "s"} recorded.` };
  });
}

// ── Settings ────────────────────────────────────────────────────────────

export async function createUserAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser("users:manage");
    assertCan(user, "users:manage");
    const role = str(fd, "role") as Role;
    if (!ROLES.includes(role)) throw new Error("Choose a role.");
    const created = createUser({ email: str(fd, "email"), name: str(fd, "name"), password: String(fd.get("password") ?? ""), role });
    revalidatePath("/settings");
    return { ok: `Account created for ${created.email}. Share the password with them through a secure channel.` };
  });
}

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    if (String(fd.get("next")) !== String(fd.get("confirm"))) return { error: "The new passwords don't match." };
    const jar = await cookies();
    changePassword(user, String(fd.get("current") ?? ""), String(fd.get("next") ?? ""), jar.get(SESSION_COOKIE)?.value);
    return { ok: "Password changed. Other devices were signed out." };
  });
}

export async function resetPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const admin = await requireUser("users:manage");
    resetPassword(admin, str(fd, "userId"), String(fd.get("password") ?? ""));
    return { ok: "Password reset. The user was signed out everywhere; share the new password through a secure channel." };
  });
}

export async function backupAction(_: ActionState): Promise<ActionState> {
  return attempt(async () => {
    await requireUser("settings:manage");
    const { file } = backupDatabase();
    return { ok: `Database backup written to ${file}. Copy data/runs and data/exports separately for screenshots and reports.` };
  });
}

export async function toggleUserAction(fd: FormData) {
  const user = await requireUser("users:manage");
  const id = str(fd, "userId");
  if (id === user.id) return; // the UI never offers this; ignore rather than crash the page
  setUserDisabled(id, str(fd, "disable") === "1");
  revalidatePath("/settings");
}

export async function saveAiSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    await requireUser("settings:manage");
    setSetting("ai.enabled", fd.get("enabled") === "on" ? "1" : "0");
    setSetting("ai.model", str(fd, "model") || DEFAULT_AI_MODEL);
    const key = str(fd, "apiKey");
    if (fd.get("removeKey") === "on") deleteSetting("ai.key");
    else if (key) setSetting("ai.key", encryptSecret(key));
    revalidatePath("/settings");
    return { ok: "AI settings saved." };
  });
}

export async function saveBrandAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    await requireUser("settings:manage");
    const name = str(fd, "brandName");
    if (name.length > 80) throw new Error("Keep the brand name under 80 characters.");
    setSetting("brand.name", name || "WebAudit Pro");
    revalidatePath("/settings");
    return { ok: "Branding saved. It appears on new reports." };
  });
}

/** Optional AI explanation for one finding. Read-only: never changes the finding. */
export type ExplainState = { error?: string; text?: string } | undefined;

export async function explainIssueAction(_: ExplainState, fd: FormData): Promise<ExplainState> {
  try {
    const user = await requireUser();
    const issue = getIssue(user, str(fd, "issueId"));
    return { text: await explainFinding(issue) };
  } catch (e) {
    unstable_rethrow(e);
    return { error: (e as Error).message };
  }
}

// ---- Per-user UI: saved Issues views and the Getting started checklist ----

export async function saveViewAction(fd: FormData) {
  const user = await requireUser();
  const query = str(fd, "query");
  const v = saveView(user, str(fd, "name") || "My view", query);
  redirect(`/issues?${v.query}`);
}

export async function deleteViewAction(fd: FormData) {
  const user = await requireUser();
  deleteView(user, str(fd, "viewId"));
  revalidatePath("/issues");
}

export async function setOnboardingAction(fd: FormData) {
  const user = await requireUser();
  dismissOnboarding(user, str(fd, "show") !== "1");
  revalidatePath("/");
  if (str(fd, "show") === "1") redirect("/");
}

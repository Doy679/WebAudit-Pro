"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireUser } from "@/app/lib/session";
import { saveGoogleCredentials } from "@/server/google/config";
import { bindProperty, disconnect, presetRange, queueGsc, queuePsi, setProjectLimits, testPageSpeedKey, testSearchConsole } from "@/server/google/service";
import type { ActionState } from "@/app/actions";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const lines = (fd: FormData, k: string) => str(fd, k).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

async function attempt(fn: () => Promise<ActionState | void> | ActionState | void): Promise<ActionState> {
  try {
    return (await fn()) ?? undefined;
  } catch (e) {
    unstable_rethrow(e);
    return { error: (e as Error).message || "Something went wrong." };
  }
}

export async function saveGoogleCredentialsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser("settings:manage");
    saveGoogleCredentials({
      apiKey: str(fd, "apiKey"), removeApiKey: fd.get("removeApiKey") === "on",
      oauthClientId: str(fd, "oauthClientId"), oauthClientSecret: str(fd, "oauthClientSecret"), removeOauth: fd.get("removeOauth") === "on",
      cruxEnabled: fd.get("cruxEnabled") === "on",
    }, user);
    revalidatePath("/google", "layout");
    return { ok: "Google credentials saved (secrets are stored encrypted)." };
  });
}

export async function bindPropertyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser("project:edit");
    await bindProperty(user, str(fd, "projectId"), str(fd, "connectionId"), str(fd, "property"));
    revalidatePath("/google", "layout");
    return { ok: "Search Console property selected for this project." };
  });
}

export async function setGoogleLimitsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser("project:edit");
    setProjectLimits(user, str(fd, "projectId"), { psiMaxUrls: Number(fd.get("psiMaxUrls")), inspectionMaxUrls: Number(fd.get("inspectionMaxUrls")) });
    revalidatePath("/google", "layout");
    return { ok: "Limits saved." };
  });
}

export async function disconnectGoogleAction(fd: FormData) {
  const user = await requireUser();
  await disconnect(user, str(fd, "connectionId"));
  revalidatePath("/google", "layout");
  redirect("/google/connections?disconnected=1");
}

export async function queuePsiAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser("audit:start");
    const strategies = fd.getAll("strategy").map(String) as ("mobile" | "desktop")[];
    const { queued, alreadyQueued, recentlyMeasured } = queuePsi(user, str(fd, "projectId"), { urls: lines(fd, "urls"), strategies, runId: str(fd, "runId") || undefined, force: fd.get("force") === "on" });
    revalidatePath("/google/pagespeed");
    const skipped = (alreadyQueued ? ` ${alreadyQueued} already waiting in the queue ${alreadyQueued === 1 ? "was" : "were"} not added again.` : "")
      + (recentlyMeasured ? ` ${recentlyMeasured} measured in the last 6 hours ${recentlyMeasured === 1 ? "was" : "were"} skipped (tick "Skip the 6-hour cache" to measure again).` : "");
    if (!queued.length) return { ok: `Nothing new to queue.${skipped} Results appear below when ready.` };
    return { ok: `${queued.length} PageSpeed request${queued.length === 1 ? "" : "s"} queued. Each takes about 10–40 seconds at Google; results under 6 hours old are reused unless you skip the cache.${skipped}` };
  });
}

export async function queueGscPerformanceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser("audit:start");
    const preset = str(fd, "preset");
    const range = preset === "custom" ? { startDate: str(fd, "startDate"), endDate: str(fd, "endDate") } : presetRange(Number(preset) || 28);
    queueGsc(user, str(fd, "projectId"), { kind: "performance", range });
    revalidatePath("/google/search-console");
    return { ok: `Search Console data for ${range.startDate} to ${range.endDate} requested.` };
  });
}

export async function queueSitemapsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser("audit:start");
    queueGsc(user, str(fd, "projectId"), { kind: "sitemaps" });
    revalidatePath("/google/sitemaps");
    return { ok: "Sitemap status requested from Search Console." };
  });
}

export async function queueInspectionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser("audit:start");
    const ids = queueGsc(user, str(fd, "projectId"), { kind: "inspection", urls: lines(fd, "urls"), runId: str(fd, "runId") || undefined });
    revalidatePath("/google/inspection");
    return { ok: `${ids.length} URL inspection${ids.length === 1 ? "" : "s"} queued.` };
  });
}

/** Retry / Test connection (BUG-01): one read-only Search Console call; the result feeds the shared status. */
export async function testSearchConsoleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser();
    const projectId = str(fd, "projectId") || undefined;
    const r = await testSearchConsole(user, str(fd, "connectionId"), projectId);
    revalidatePath("/", "layout");
    if (!r.ok) return { error: r.message };
    return { ok: `Search Console is working. ${r.properties} matching propert${r.properties === 1 ? "y" : "ies"} found${projectId ? " for this website" : ""}.` };
  });
}

/** NEW-01: one live PageSpeed request, only after an admin ticks the confirmation. */
export async function testPageSpeedKeyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return attempt(async () => {
    const user = await requireUser("settings:manage");
    const r = await testPageSpeedKey(user, str(fd, "projectId"), fd.get("confirm") === "on");
    revalidatePath("/", "layout");
    // GQA-03: a repeat within the cooldown (or while a test runs) gets the earlier result, not a new request.
    const prefix = r.reused && r.kind !== "busy" ? `No new request sent: a test ran at ${new Date(r.at).toLocaleTimeString("en-US", { timeStyle: "short" })}. Result: ` : "";
    return r.ok ? { ok: `${prefix}${r.message}` } : { error: `${prefix}${r.message}` };
  });
}

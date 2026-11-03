"use client";

import Link from "next/link";
import { useActionState, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/app/actions";
import { bareHost, hostInScope } from "@/server/scope";
import { btn, cx, hint, input, label, Notice } from "./ui";
import { CATEGORIES, VIEWPORTS } from "./constants";

export interface AuditProjectOption {
  id: string;
  name: string;
  domain: string;
  baseUrl: string;
  defaults: { maxPages: number; delayMs: number; viewports: number[]; categories: string[] };
  hasStandards: boolean;
  google: { psiReady: boolean; psiMax: number; gscReady: boolean; property: string | null; inspectMax: number };
}

export interface WorkerInfo { state: string; label: string; detail: string }

type Form = {
  url: string; maxPages: number; delayMs: number; viewports: number[]; categories: string[]; useSitemap: boolean; urls: string;
  psiMobile: boolean; psiDesktop: boolean; psiMaxUrls: number; gscPerformance: boolean; gscSitemaps: boolean; inspectMaxUrls: number;
};

/** All project-specific fields come from the selected project's saved defaults. */
const defaultsFor = (p: AuditProjectOption): Form => ({
  url: p.baseUrl, maxPages: p.defaults.maxPages, delayMs: p.defaults.delayMs, viewports: p.defaults.viewports, categories: p.defaults.categories,
  useSitemap: true, urls: "", psiMobile: false, psiDesktop: false, psiMaxUrls: Math.min(5, p.google.psiMax), gscPerformance: false, gscSitemaps: false, inspectMaxUrls: 0,
});

function scopeProblem(p: AuditProjectOption, value: string): string | null {
  const v = value.trim();
  if (!v) return "Enter the website URL to audit.";
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return "Enter a full address starting with https://";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "Only http and https addresses can be audited.";
  if (!hostInScope(u.hostname, p)) return `This URL belongs to ${bareHost(u.hostname)}, not ${p.domain}. Correct the URL or select the matching project.`;
  return null;
}

/**
 * New Audit form. Switching project resets every project-specific field (URL included) to that project's
 * saved defaults; changing other options never touches the URL. The server re-validates everything.
 */
export function NewAuditForm({ projects, initialProjectId, worker, action }: {
  projects: AuditProjectOption[];
  initialProjectId: string;
  worker: WorkerInfo;
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(initialProjectId);
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const [f, setF] = useState<Form>(() => defaultsFor(project));
  const [state, formAction] = useActionState(action, undefined);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const urlProblem = scopeProblem(project, f.url);
  const listProblem = useMemo(() => f.urls.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((u) => scopeProblem(project, u)).find(Boolean) ?? null, [f.urls, project]);
  const toggle = (k: "viewports" | "categories", v: number | string) =>
    setF((prev) => ({ ...prev, [k]: (prev[k] as (number | string)[]).includes(v) ? (prev[k] as (number | string)[]).filter((x) => x !== v) : [...(prev[k] as (number | string)[]), v] }));

  function switchProject(id: string) {
    const next = projects.find((p) => p.id === id);
    if (!next) return;
    setProjectId(id);
    setF(defaultsFor(next));
    router.replace(`/audits/new?project=${id}`, { scroll: false }); // keeps the selection on back/refresh
  }

  const blocked = !!urlProblem || !!listProblem || !f.viewports.length;

  return (
    <form action={formAction} className="space-y-5" data-testid="new-audit-form">
      <input type="hidden" name="projectId" value={project.id} />

      <div>
        <label htmlFor="projectId-select" className={label}>Project</label>
        <select id="projectId-select" value={project.id} onChange={(e) => switchProject(e.target.value)} className={`${input} mt-1`}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.domain})</option>)}
        </select>
      </div>

      <div className="rounded-md border border-navy-100 bg-navy-50 px-3 py-2 text-sm" data-testid="audit-target">
        Auditing <strong>{project.name}</strong> · authorized domain <strong data-testid="authorized-domain">{project.domain}</strong>
      </div>

      <div>
        <label htmlFor="startUrl" className={label}>Website URL</label>
        <input id="startUrl" name="startUrl" type="url" required value={f.url} onChange={(e) => set("url", e.target.value)}
          aria-invalid={!!urlProblem} aria-describedby="startUrl-help"
          className={cx(input, "mt-1", urlProblem && "border-sev-high ring-1 ring-sev-high")} />
        <p id="startUrl-help" className={urlProblem ? "mt-1 text-xs font-medium text-sev-high" : hint} data-testid="url-scope-message">
          {urlProblem ?? <>Must be on {project.domain}, the domain this project is authorized for. Public pages only.</>}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="maxPages" className={label}>Maximum pages</label>
          <input id="maxPages" name="maxPages" type="number" min={1} max={200} value={f.maxPages} onChange={(e) => set("maxPages", Number(e.target.value))} className={`${input} mt-1`} />
        </div>
        <div>
          <label htmlFor="delayMs" className={label}>Scan rate: delay between page loads (ms)</label>
          <input id="delayMs" name="delayMs" type="number" min={500} max={10000} step={100} value={f.delayMs} onChange={(e) => set("delayMs", Number(e.target.value))} className={`${input} mt-1`} />
          <p className={hint}>One page at a time. 1000 ms ≈ 1 page load per second.</p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="useSitemap" checked={f.useSitemap} onChange={(e) => set("useSitemap", e.target.checked)} /> Discover pages from robots.txt and sitemap.xml</label>

      <div>
        <label htmlFor="urls" className={label}>Specific URLs (optional)</label>
        <textarea id="urls" name="urls" rows={4} value={f.urls} onChange={(e) => set("urls", e.target.value)} placeholder={`One URL per line, e.g.\n${project.baseUrl}about/`}
          className={cx(input, "mt-1 font-mono text-xs", listProblem && "border-sev-high")} />
        <p className={listProblem ? "mt-1 text-xs font-medium text-sev-high" : hint}>{listProblem ?? "When filled, only these pages are scanned (sitemap sampling is skipped)."}</p>
      </div>

      <fieldset>
        <legend className={label}>Viewports</legend>
        <div className="mt-1 flex flex-wrap gap-4 text-sm">
          {VIEWPORTS.map((v) => <label key={v} className="flex items-center gap-1"><input type="checkbox" name="viewports" value={v} checked={f.viewports.includes(v)} onChange={() => toggle("viewports", v)} />{v}px</label>)}
        </div>
      </fieldset>

      <fieldset>
        <legend className={label}>Audit categories</legend>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          {CATEGORIES.map((c) => (
            <label key={c.value} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="categories" value={c.value} checked={f.categories.includes(c.value)} onChange={() => toggle("categories", c.value)} className="mt-1" />
              <span><span className="font-medium">{c.label}</span><span className="block text-xs text-slate-500">{c.hint}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-700">Google SEO & Performance (optional, runs after the crawl)</legend>
        <p className="mb-2 text-xs text-slate-500">External Google services with quotas, so they are never run for every crawled page automatically. Results are linked to this audit.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="psiMobile" checked={f.psiMobile} disabled={!project.google.psiReady} onChange={(e) => set("psiMobile", e.target.checked)} /> PageSpeed Mobile</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="psiDesktop" checked={f.psiDesktop} disabled={!project.google.psiReady} onChange={(e) => set("psiDesktop", e.target.checked)} /> PageSpeed Desktop</label>
          <label className="flex items-center gap-2 text-sm">PageSpeed pages: <input type="number" name="psiMaxUrls" min={1} max={project.google.psiMax} value={f.psiMaxUrls} onChange={(e) => set("psiMaxUrls", Number(e.target.value))} className={`${input} w-20 py-1`} /></label>
          <span className="text-xs text-slate-500">{project.google.psiReady ? "Start page first, then other scanned pages." : "Needs a Google API key (Google Connections)."}</span>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="gscPerformance" checked={f.gscPerformance} disabled={!project.google.gscReady} onChange={(e) => set("gscPerformance", e.target.checked)} /> Search Console data (last 28 days)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="gscSitemaps" checked={f.gscSitemaps} disabled={!project.google.gscReady} onChange={(e) => set("gscSitemaps", e.target.checked)} /> Search Console sitemaps</label>
          <label className="flex items-center gap-2 text-sm">URL inspections: <input type="number" name="inspectMaxUrls" min={0} max={project.google.inspectMax} value={f.inspectMaxUrls} disabled={!project.google.gscReady} onChange={(e) => set("inspectMaxUrls", Number(e.target.value))} className={`${input} w-20 py-1`} /></label>
          <span className="text-xs text-slate-500" data-testid="gsc-property">{project.google.gscReady ? `Property ${project.google.property}` : `Search Console not connected for ${project.name}.`}</span>
        </div>
      </fieldset>

      <p className="text-sm text-slate-600">
        Design standards: {project.hasStandards ? <>{project.name}&apos;s <Link className="text-accent-600 underline" href={`/projects/${project.id}`}>approved tokens</Link></> : <>default baseline (<Link className="text-accent-600 underline" href={`/projects/${project.id}`}>set approved tokens</Link>)</>}.
      </p>

      <WorkerNotice worker={worker} />
      {state?.error && <Notice tone="error">{state.error}{state.link && <> <Link className="underline" href={state.link}>Open that audit</Link></>}</Notice>}

      <div className="flex flex-wrap items-center gap-3">
        <StartButton disabled={blocked} />
        <button type="button" className={btn.secondary} onClick={() => setF(defaultsFor(project))}>Reset to project defaults</button>
      </div>
    </form>
  );
}

function StartButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  const clicked = useRef(false);
  if (!pending) clicked.current = false;
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
      data-testid="start-audit"
      onClick={(e) => {
        // Guard against a double click landing before the form reports "pending".
        if (clicked.current) e.preventDefault();
        clicked.current = true;
      }}
      className={btn.primary}
    >
      {pending ? "Starting audit…" : "Start Audit"}
    </button>
  );
}

export function WorkerNotice({ worker }: { worker: WorkerInfo }) {
  const tone = worker.state === "online" ? "ok" : worker.state === "starting" ? "info" : "warn";
  return (
    <div data-testid="worker-status" data-state={worker.state}>
      <Notice tone={tone}>
        <strong>{worker.label}.</strong> {worker.detail}
        {worker.state !== "online" && worker.state !== "starting" && " You can still start the audit: it stays queued and begins automatically when the worker is running."}
      </Notice>
    </div>
  );
}

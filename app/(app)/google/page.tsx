import Link from "next/link";
import { requireUser } from "@/app/lib/session";
import { googleStatus } from "@/server/google/config";
import { googleTasks, projectGoogle } from "@/server/google/service";
import { websiteHealth } from "@/server/health";
import { GoogleTabs, ProjectPicker } from "@/components/google";
import { WebsiteHealth } from "@/components/WebsiteHealth";
import { Card, Empty, fmtDate, Notice, PageHeader, StatusPill } from "@/components/ui";
import { selectProject } from "./shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Google SEO & Performance" };

const TASK_LABEL: Record<string, string> = { psi: "PageSpeed", gsc_performance: "Search Console performance", gsc_sitemaps: "Sitemaps", gsc_inspect: "URL inspection" };

export default async function GoogleOverviewPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { projects, project } = selectProject(user, sp.project);
  if (!project) return (<><PageHeader title="Google SEO & Performance" /><Empty title="Add a website first" /></>);
  const status = googleStatus();
  const pg = projectGoogle(user, project.id);
  const health = websiteHealth(user, project.id);
  const tasks = googleTasks(user, project.id, 15);

  return (
    <>
      <PageHeader title="Google SEO & Performance" subtitle="PageSpeed Insights, structured data and Search Console beside WebAudit Pro's own audit, each labelled with its source and date." />
      <GoogleTabs active="" project={project.id} />
      <ProjectPicker projects={projects} selected={project.id} />

      {(!status.apiKeyConfigured || !status.oauthConfigured || !pg.gsc_property) && (
        <div className="mb-4"><Notice tone="warn">
          Integration status: PageSpeed {status.apiKeyConfigured ? "configured" : "not configured"} · Search Console {status.oauthConfigured ? (pg.gsc_property ? "connected" : "not connected for this website") : "not configured"}.{" "}
          <Link className="underline" href={`/google/connections?project=${project.id}`}>Set up Google Connections</Link>. Areas without data show “Not run” or “Not connected” rather than estimates.
        </Notice></div>
      )}

      <WebsiteHealth {...health} />
      {health.run && <p className="mt-2 text-xs text-slate-500">Based on the audit of {fmtDate(health.run.created_at)} and the latest Google results for its start page ({health.run.start_url}).</p>}

      <Card title="Recent Google requests" className="mt-6">
        {tasks.length ? (
          <ul className="divide-y divide-slate-100 text-sm">
            {tasks.map((t) => {
              const p = JSON.parse(t.payload_json);
              return (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{TASK_LABEL[t.type]}{p.url ? `: ${p.url}` : ""}{p.strategy ? ` (${p.strategy})` : ""}{p.range ? `: ${p.range.startDate} to ${p.range.endDate}` : ""}</span>
                  <span className="flex items-center gap-2 text-xs text-slate-500">{fmtDate(t.created_at)} <StatusPill status={t.status} /></span>
                  {t.error && <span className="w-full text-xs text-sev-high">{t.error}</span>}
                </li>
              );
            })}
          </ul>
        ) : <p className="text-sm text-slate-500">No Google requests yet.</p>}
      </Card>
    </>
  );
}

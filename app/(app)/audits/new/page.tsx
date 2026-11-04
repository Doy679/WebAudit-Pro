import Link from "next/link";
import { requireUser } from "@/app/lib/session";
import { listProjects } from "@/server/projects";
import { googleStatus } from "@/server/google/config";
import { projectGoogle } from "@/server/google/service";
import { workerStatus } from "@/server/worker-status";
import { searchConsoleStatus } from "@/server/google/gsc-status";
import { startAuditAction } from "@/app/actions";
import { NewAuditForm, type AuditProjectOption } from "@/components/NewAuditForm";
import { Card, Empty, PageHeader } from "@/components/ui";
import { CATEGORIES, VIEWPORTS } from "@/components/constants";

export const dynamic = "force-dynamic";
export const metadata = { title: "New Audit" };

export default async function NewAuditPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const user = await requireUser("audit:start");
  const projects = listProjects(user);
  const { project: requested } = await searchParams;

  if (!projects.length) {
    return (
      <>
        <PageHeader title="New Audit" />
        <Empty title="Add a website first">Audits run inside a project. <Link href="/projects/new" className="text-accent-600 underline">Add website</Link></Empty>
      </>
    );
  }

  const g = googleStatus();
  // Every project's saved defaults go to the form, so switching project updates all fields without a reload.
  const options: AuditProjectOption[] = projects.map((p) => {
    const s = p.settings;
    const pg = projectGoogle(user, p.id);
    return {
      id: p.id, name: p.name, domain: p.domain, baseUrl: p.base_url,
      defaults: {
        maxPages: s.maxPages ?? 20, delayMs: s.delayMs ?? 1000,
        viewports: s.viewports?.length ? s.viewports : VIEWPORTS,
        categories: s.categories?.length ? s.categories : CATEGORIES.map((c) => c.value),
      },
      hasStandards: !!s.tokens,
      google: { psiReady: g.apiKeyConfigured, psiMax: pg.psi_max_urls, gscReady: !!(pg.gsc_property && pg.connection_id), property: pg.gsc_property, inspectMax: pg.inspection_max_urls, gscLabel: searchConsoleStatus(user, p.id).label },
    };
  });
  const initial = options.find((o) => o.id === requested) ?? options[0];
  const w = workerStatus();

  return (
    <>
      <PageHeader title="New Audit" subtitle="Choose the website, check the address and press Start Audit. It runs in the background; you can leave this page. Read-only: nothing on the website is changed." />
      <Card className="max-w-3xl">
        {/* key: a different ?project= remounts the form with that project's defaults */}
        <NewAuditForm key={initial.id} projects={options} initialProjectId={initial.id} worker={{ state: w.state, label: w.label, detail: w.detail }} action={startAuditAction} />
      </Card>
    </>
  );
}

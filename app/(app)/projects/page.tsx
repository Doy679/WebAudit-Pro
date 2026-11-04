import Link from "next/link";
import { requireUser } from "@/app/lib/session";
import { listProjects } from "@/server/projects";
import { can } from "@/server/permissions";
import { btn, Empty, fmtDate, PageHeader, StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Websites" };

export default async function ProjectsPage() {
  const user = await requireUser();
  const projects = listProjects(user);
  return (
    <>
      <PageHeader
        title="My Websites"
        subtitle="Each website is a project with its own authorization, settings, audits, findings and reports."
        actions={can(user, "project:create") ? <Link href="/projects/new" className={btn.primary}>Add website</Link> : undefined}
      />
      {projects.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-accent-500">
              <div className="font-semibold text-navy-900">{p.name}</div>
              <div className="truncate text-sm text-slate-600">{p.domain}</div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div><dt className="text-slate-500">Audits</dt><dd className="tabular font-semibold">{p.runs}</dd></div>
                <div><dt className="text-slate-500">Open findings</dt><dd className="tabular font-semibold">{p.open_findings}</dd></div>
                <div><dt className="text-slate-500">Last audit</dt><dd>{p.last_status ? <StatusPill status={p.last_status} /> : "–"}</dd></div>
              </dl>
              {p.last_run_at && <div className="mt-2 text-xs text-slate-500">Last audit queued {fmtDate(p.last_run_at)}</div>}
            </Link>
          ))}
        </div>
      ) : (
        <Empty title="No websites yet">
          {can(user, "project:create") ? <>Add one with <Link href="/projects/new" className="text-accent-600 underline">Add website</Link>.</> : "Ask a project manager to add you to a project."}
        </Empty>
      )}
    </>
  );
}

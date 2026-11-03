import Link from "next/link";
import { requireUser } from "@/app/lib/session";
import { listProjects } from "@/server/projects";
import { startAuditAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { Card, Empty, hint, input, label, PageHeader } from "@/components/ui";
import { CATEGORIES, VIEWPORTS } from "@/components/constants";

export const dynamic = "force-dynamic";
export const metadata = { title: "New Audit" };

export default async function NewAuditPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const user = await requireUser("audit:start");
  const projects = listProjects(user);
  const { project: selectedId } = await searchParams;
  const selected = projects.find((p) => p.id === selectedId) ?? projects[0];

  if (!projects.length) {
    return (
      <>
        <PageHeader title="New Audit" />
        <Empty title="Add a website first">Audits run inside a project. <Link href="/projects/new" className="text-accent-600 underline">Add website</Link></Empty>
      </>
    );
  }

  const s = selected.settings;
  const viewports = s.viewports?.length ? s.viewports : VIEWPORTS;
  const categories = s.categories?.length ? s.categories : CATEGORIES.map((c) => c.value);

  return (
    <>
      <PageHeader title="New Audit" subtitle="Read-only: pages are loaded with GET requests only. No forms are submitted and nothing on the website changes." />
      <Card className="max-w-3xl">
        {/* Switching project reloads defaults for that project. */}
        <form method="get" className="mb-5 flex flex-wrap items-end gap-2 border-b border-slate-100 pb-5">
          <div className="min-w-0 flex-1">
            <label htmlFor="project" className={label}>Project</label>
            <select id="project" name="project" defaultValue={selected.id} className={`${input} mt-1`}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.domain})</option>)}
            </select>
          </div>
          <button className="rounded-md border border-slate-300 px-3 py-2 text-sm">Load defaults</button>
        </form>

        <ActionForm action={startAuditAction} className="space-y-5" resetKey={selected.id}>
          <input type="hidden" name="projectId" value={selected.id} />
          <div>
            <label htmlFor="startUrl" className={label}>Website URL</label>
            <input id="startUrl" name="startUrl" type="url" required defaultValue={selected.base_url} className={`${input} mt-1`} />
            <p className={hint}>Must be on {selected.domain}, the domain this project is authorized for. Public pages only.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="maxPages" className={label}>Maximum pages</label>
              <input id="maxPages" name="maxPages" type="number" min={1} max={200} defaultValue={s.maxPages ?? 20} className={`${input} mt-1`} />
            </div>
            <div>
              <label htmlFor="delayMs" className={label}>Scan rate: delay between page loads (ms)</label>
              <input id="delayMs" name="delayMs" type="number" min={500} max={10000} step={100} defaultValue={s.delayMs ?? 1000} className={`${input} mt-1`} />
              <p className={hint}>One page at a time. 1000 ms ≈ 1 page load per second.</p>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="useSitemap" defaultChecked /> Discover pages from robots.txt and sitemap.xml</label>

          <div>
            <label htmlFor="urls" className={label}>Specific URLs (optional)</label>
            <textarea id="urls" name="urls" rows={4} placeholder={`One URL per line, e.g.\n${selected.base_url}loans/fha/`} className={`${input} mt-1 font-mono text-xs`} />
            <p className={hint}>When filled, only these pages are scanned (sitemap sampling is skipped).</p>
          </div>

          <fieldset>
            <legend className={label}>Viewports</legend>
            <div className="mt-1 flex flex-wrap gap-4 text-sm">
              {VIEWPORTS.map((v) => <label key={v} className="flex items-center gap-1"><input type="checkbox" name="viewports" value={v} defaultChecked={viewports.includes(v)} />{v}px</label>)}
            </div>
          </fieldset>

          <fieldset>
            <legend className={label}>Audit categories</legend>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              {CATEGORIES.map((c) => (
                <label key={c.value} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="categories" value={c.value} defaultChecked={categories.includes(c.value)} className="mt-1" />
                  <span><span className="font-medium">{c.label}</span><span className="block text-xs text-slate-500">{c.hint}</span></span>
                </label>
              ))}
            </div>
          </fieldset>

          <p className="text-sm text-slate-600">
            Design standards: {s.tokens ? <>this project&apos;s <Link className="text-accent-600 underline" href={`/projects/${selected.id}`}>approved tokens</Link></> : <>default baseline (<Link className="text-accent-600 underline" href={`/projects/${selected.id}`}>set approved tokens</Link>)</>}.
          </p>

          <Submit>Start Audit</Submit>
        </ActionForm>
      </Card>
    </>
  );
}

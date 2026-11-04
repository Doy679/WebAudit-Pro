import Link from "@/components/AppLink";
import type { Metadata } from "next";
import { orNotFound, requireUser } from "@/app/lib/session";
import { getProject, projectMembers } from "@/server/projects";
import { listRuns } from "@/server/runs";
import { listUsers, ROLE_LABELS } from "@/server/auth";
import { can } from "@/server/permissions";
import { addMemberAction, removeMemberAction, saveStandardsAction, updateProjectAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { btn, Card, Empty, fmtDate, hint, input, label, PageHeader, StatusPill } from "@/components/ui";
import { CATEGORIES, VIEWPORTS } from "@/components/constants";
import tokensJson from "@/config/tokens.json";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    return { title: getProject(await requireUser(), (await params).id).name };
  } catch {
    return { title: "Not found" };
  }
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const project = orNotFound(() => getProject(user, id));
  const runs = listRuns(user, { projectId: id, limit: 20 });
  const members = projectMembers(user, id);
  const editable = can(user, "project:edit");
  const candidates = editable ? listUsers().filter((u) => !u.disabled && u.role !== "client" && !members.some((m) => m.id === u.id)) : [];
  const s = project.settings;
  const t = (s.tokens ?? {}) as Record<string, unknown> & { spacing?: Record<string, number>; standards?: Record<string, string> };
  const viewports = s.viewports?.length ? s.viewports : VIEWPORTS;
  const categories = s.categories?.length ? s.categories : CATEGORIES.map((c) => c.value);

  return (
    <>
      <PageHeader
        title={project.name}
        subtitle={<>Scope: <strong>{project.domain}</strong> · authorized {fmtDate(project.authorized_at)}: {project.authorization_note}</>}
        actions={
          <>
            {can(user, "audit:start") && <Link href={`/audits/new?project=${id}`} className={btn.primary}>Start audit</Link>}
            <Link href={`/issues?project=${id}`} className={btn.secondary}>Findings</Link>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Audit history">
          {runs.length ? (
            <ul className="divide-y divide-slate-100">
              {runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <Link href={`/audits/${r.id}`} className="text-navy-800 hover:underline">{fmtDate(r.created_at)}</Link>
                  <span className="flex items-center gap-2 text-xs text-slate-600">
                    {r.pages_done} pages · {r.findings} findings <StatusPill status={r.status} />
                  </span>
                </li>
              ))}
            </ul>
          ) : <Empty title="No audits yet" />}
        </Card>

        <Card title="Team">
          <ul className="divide-y divide-slate-100">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span><span className="font-medium">{m.name}</span> <span className="text-slate-500">· {ROLE_LABELS[m.role as keyof typeof ROLE_LABELS]}</span></span>
                {editable && m.id !== user.id && (
                  <form action={removeMemberAction}>
                    <input type="hidden" name="projectId" value={id} /><input type="hidden" name="userId" value={m.id} />
                    <button className={btn.ghost}>Remove</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {editable && candidates.length > 0 && (
            <ActionForm action={addMemberAction} className="mt-3 flex flex-wrap gap-2">
              <input type="hidden" name="projectId" value={id} />
              <label htmlFor="userId" className="sr-only">Add member</label>
              <select id="userId" name="userId" className={`${input} w-auto flex-1`}>
                {candidates.map((u) => <option key={u.id} value={u.id}>{u.name} ({ROLE_LABELS[u.role]})</option>)}
              </select>
              <Submit variant="secondary">Add member</Submit>
            </ActionForm>
          )}
        </Card>

        <Card title="Project settings">
          <ActionForm action={updateProjectAction} className="space-y-4">
            <input type="hidden" name="projectId" value={id} />
            <fieldset disabled={!editable} className="space-y-4">
              <div><label htmlFor="name" className={label}>Name</label><input id="name" name="name" defaultValue={project.name} className={`${input} mt-1`} /></div>
              <div><label htmlFor="authorizationNote" className={label}>Authorization note</label><input id="authorizationNote" name="authorizationNote" defaultValue={project.authorization_note} className={`${input} mt-1`} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label htmlFor="maxPages" className={label}>Default max pages</label><input id="maxPages" name="maxPages" type="number" min={1} max={200} defaultValue={s.maxPages ?? 20} className={`${input} mt-1`} /></div>
                <div><label htmlFor="delayMs" className={label}>Delay between page loads (ms)</label><input id="delayMs" name="delayMs" type="number" min={500} max={10000} step={100} defaultValue={s.delayMs ?? 1000} className={`${input} mt-1`} /></div>
              </div>
              <fieldset>
                <legend className={label}>Default viewports</legend>
                <div className="mt-1 flex flex-wrap gap-3 text-sm">
                  {VIEWPORTS.map((v) => <label key={v} className="flex items-center gap-1"><input type="checkbox" name="viewports" value={v} defaultChecked={viewports.includes(v)} />{v}px</label>)}
                </div>
              </fieldset>
              <fieldset>
                <legend className={label}>Default audit categories</legend>
                <div className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
                  {CATEGORIES.map((c) => <label key={c.value} className="flex items-center gap-2"><input type="checkbox" name="categories" value={c.value} defaultChecked={categories.includes(c.value)} />{c.label}</label>)}
                </div>
              </fieldset>
              {editable && <Submit>Save settings</Submit>}
            </fieldset>
          </ActionForm>
        </Card>

        <Card title="Design standards">
          <p className="mb-3 text-sm text-slate-600">Approved values used to judge consistency. Numeric values drive the checks; the descriptive fields are recorded as the project&apos;s reference and appear in reports.</p>
          <ActionForm action={saveStandardsAction} className="space-y-3">
            <input type="hidden" name="projectId" value={id} />
            <fieldset disabled={!editable} className="space-y-3">
              <div>
                <label htmlFor="spacingScale" className={label}>Spacing scale (px)</label>
                <input id="spacingScale" name="spacingScale" defaultValue={((t.spacingScale as number[]) ?? tokensJson.spacingScale).join(", ")} className={`${input} mt-1`} />
                <p className={hint}>Padding, margins and gaps are snapped to these values in proposals.</p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Num name="tapTargetMinPx" label="Min tap target (px)" value={(t.tapTargetMinPx as number) ?? tokensJson.tapTargetMinPx} />
                <Num name="minFontSizePx" label="Min font size (px)" value={(t.minFontSizePx as number) ?? tokensJson.minFontSizePx} />
                <Num name="bodyLineHeightMin" label="Min body line height" value={(t.bodyLineHeightMin as number) ?? tokensJson.bodyLineHeightMin} step={0.05} />
                <Num name="minDeviationPx" label="Spacing deviation (px)" value={t.spacing?.minDeviationPx ?? tokensJson.spacing.minDeviationPx} />
                <Num name="outlierRatio" label="Spacing outlier ratio" value={t.spacing?.outlierRatio ?? tokensJson.spacing.outlierRatio} step={0.1} />
                <Num name="minSamples" label="Min samples for baseline" value={t.spacing?.minSamples ?? tokensJson.spacing.minSamples} />
              </div>
              {[
                ["fontFamilies", "Font families", "e.g. Montserrat (headings), Open Sans (body)"],
                ["headingScale", "Heading scale", "e.g. H1 48 / H2 36 / H3 28 / H4 22 px"],
                ["containerWidths", "Container widths", "e.g. 1200px boxed, 1440px full"],
                ["colors", "Brand colors", "e.g. #0F1F3D navy, #F2A900 gold"],
                ["buttonHeights", "Button dimensions", "e.g. 48px tall, 24px horizontal padding"],
                ["borderRadius", "Border radius", "e.g. 6px buttons, 12px cards"],
                ["breakpoints", "Responsive breakpoints", "e.g. 767 / 1024 px (Elementor defaults)"],
              ].map(([name, text, ph]) => (
                <div key={name}>
                  <label htmlFor={name} className={label}>{text}</label>
                  <input id={name} name={name} defaultValue={t.standards?.[name] ?? ""} placeholder={ph} className={`${input} mt-1`} />
                </div>
              ))}
              {editable && <Submit>Save design standards</Submit>}
            </fieldset>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

function Num({ name, label: text, value, step }: { name: string; label: string; value: number; step?: number }) {
  return (
    <div>
      <label htmlFor={name} className={label}>{text}</label>
      <input id={name} name={name} type="number" step={step ?? 1} defaultValue={value} className={`${input} mt-1`} />
    </div>
  );
}

import { requireUser } from "@/app/lib/session";
import { createProjectAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { Card, hint, input, label, PageHeader } from "@/components/ui";

export const metadata = { title: "Add website" };

export default async function NewProjectPage() {
  await requireUser("project:create");
  return (
    <>
      <PageHeader title="Add website" subtitle="Audits only run on this website's domain, and only after you record who authorized it." />
      <Card className="max-w-2xl">
        <ActionForm action={createProjectAction} className="space-y-4">
          <div>
            <label htmlFor="name" className={label}>Project name</label>
            <input id="name" name="name" required placeholder="Capital Home Mortgage" className={`${input} mt-1`} />
          </div>
          <div>
            <label htmlFor="baseUrl" className={label}>Website address</label>
            <input id="baseUrl" name="baseUrl" required placeholder="https://capitalhomemortgage.com" className={`${input} mt-1`} />
            <p className={hint}>The domain (with or without www) becomes this project&apos;s audit scope. Subdomains need their own project.</p>
          </div>
          <div>
            <label htmlFor="authorizationNote" className={label}>Authorization</label>
            <textarea id="authorizationNote" name="authorizationNote" required rows={2} placeholder="e.g. SEO retainer contract signed 2026-09-01; client approved audits by email" className={`${input} mt-1`} />
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" name="authorized" className="mt-1" required />
            <span>I confirm we are authorized by the site owner to run read-only audits of this website. Your name and the time are recorded.</span>
          </label>
          <Submit>Add website</Submit>
        </ActionForm>
      </Card>
    </>
  );
}

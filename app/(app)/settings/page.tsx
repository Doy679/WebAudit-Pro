import { requireUser } from "@/app/lib/session";
import { listUsers, ROLE_LABELS, ROLES } from "@/server/auth";
import { can } from "@/server/permissions";
import { aiSettings, getSetting } from "@/server/settings";
import { backupAction, changePasswordAction, createUserAction, resetPasswordAction, saveAiSettingsAction, saveBrandAction, toggleUserAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { btn, Card, fmtDate, hint, input, label, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

const ROLE_HELP: Record<string, string> = {
  admin: "Everything, including users and settings",
  pm: "Projects, audits, review, reports, client approvals",
  qa: "Start audits, review findings, reports",
  developer: "View findings, update implementation status, reports",
  client: "No dashboard access; uses approval links only",
};

export default async function SettingsPage() {
  const user = await requireUser();
  const admin = can(user, "settings:manage");
  const users = can(user, "users:manage") ? listUsers() : [];
  const ai = aiSettings();

  return (
    <>
      <PageHeader title="Settings" subtitle={`Signed in as ${user.name} (${user.email}) · ${ROLE_LABELS[user.role]}`} />
      <Card title="Your account" className="mb-6 max-w-xl">
        <ActionForm action={changePasswordAction} className="space-y-3" resetKey="pw">
          <div><label htmlFor="pw-current" className={label}>Current password</label><input id="pw-current" name="current" type="password" required autoComplete="current-password" className={`${input} mt-1`} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label htmlFor="pw-next" className={label}>New password</label><input id="pw-next" name="next" type="password" minLength={10} required autoComplete="new-password" className={`${input} mt-1`} /></div>
            <div><label htmlFor="pw-confirm" className={label}>Confirm new password</label><input id="pw-confirm" name="confirm" type="password" minLength={10} required autoComplete="new-password" className={`${input} mt-1`} /></div>
          </div>
          <p className={hint}>At least 10 characters. Changing it signs you out on other devices.</p>
          <Submit variant="secondary">Change password</Submit>
        </ActionForm>
      </Card>
      {!admin ? (
        <Card><p className="text-sm text-slate-600">Only admins can change application settings. Ask an admin to update your account or project access.</p></Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card title="Team accounts">
            <ul className="divide-y divide-slate-100 text-sm">
              {users.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className={u.disabled ? "text-slate-400 line-through" : ""}>
                    <span className="font-medium">{u.name}</span> · {u.email} · {ROLE_LABELS[u.role]} <span className="text-xs text-slate-400">since {fmtDate(u.created_at)}</span>
                  </span>
                  {u.id !== user.id && (
                    <span className="flex flex-wrap items-center gap-1">
                      <form action={toggleUserAction}>
                        <input type="hidden" name="userId" value={u.id} /><input type="hidden" name="disable" value={u.disabled ? "0" : "1"} />
                        <button className={btn.ghost}>{u.disabled ? "Enable" : "Disable"}</button>
                      </form>
                      <details className="text-xs">
                        <summary className="cursor-pointer text-accent-600">Reset password</summary>
                        <ActionForm action={resetPasswordAction} className="mt-1 flex flex-wrap gap-1">
                          <input type="hidden" name="userId" value={u.id} />
                          <label htmlFor={`reset-${u.id}`} className="sr-only">New password for {u.name}</label>
                          <input id={`reset-${u.id}`} name="password" type="password" minLength={10} required autoComplete="new-password" placeholder="New password (10+ chars)" className={`${input} w-48 py-1`} />
                          <Submit variant="secondary">Reset</Submit>
                        </ActionForm>
                      </details>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <ActionForm action={createUserAction} className="mt-4 space-y-3 border-t border-slate-100 pt-4">
              <h3 className="text-sm font-semibold text-navy-900">Add an account</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label htmlFor="u-name" className={label}>Name</label><input id="u-name" name="name" required className={`${input} mt-1`} /></div>
                <div><label htmlFor="u-email" className={label}>Email</label><input id="u-email" name="email" type="email" required className={`${input} mt-1`} /></div>
                <div><label htmlFor="u-password" className={label}>Temporary password</label><input id="u-password" name="password" type="password" minLength={10} required autoComplete="new-password" className={`${input} mt-1`} /></div>
                <div>
                  <label htmlFor="u-role" className={label}>Role</label>
                  <select id="u-role" name="role" defaultValue="qa" className={`${input} mt-1`}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}: {ROLE_HELP[r]}</option>)}
                  </select>
                </div>
              </div>
              <p className={hint}>New accounts only see projects they are added to (on each project&apos;s page).</p>
              <Submit variant="secondary">Create account</Submit>
            </ActionForm>
          </Card>

          <div className="space-y-6">
            <Card title="Integrations">
              <p className="text-sm text-slate-600">Google PageSpeed Insights, Chrome UX Report and Search Console credentials and connections.</p>
              <a href="/google/connections" className="mt-2 inline-block text-sm text-accent-600 underline">Connect Google Search Console →</a>
            </Card>
            <Card title="Backup">
              <p className="mb-2 text-sm text-slate-600">Writes a consistent copy of the database to data/backups (safe while audits run). Also available as <code className="text-xs">npm run backup</code>.</p>
              <ActionForm action={backupAction}><Submit variant="secondary">Create backup now</Submit></ActionForm>
            </Card>
            <Card title="Report branding">
              <ActionForm action={saveBrandAction} className="space-y-3">
                <div>
                  <label htmlFor="brandName" className={label}>Agency name on reports</label>
                  <input id="brandName" name="brandName" defaultValue={getSetting("brand.name") ?? "WebAudit Pro"} className={`${input} mt-1`} />
                </div>
                <Submit variant="secondary">Save branding</Submit>
              </ActionForm>
            </Card>

            <Card title="AI recommendations (optional)">
              <ActionForm action={saveAiSettingsAction} className="space-y-3">
                <p className="text-sm text-slate-600">
                  Adds an &ldquo;Explain with AI&rdquo; button to findings. It explains saved measurements in plain language and suggests a fix; it never changes a finding or the website.
                  Everything else works without a key.
                </p>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={ai.enabled} /> Enable AI explanations</label>
                <div>
                  <label htmlFor="model" className={label}>Claude model</label>
                  <input id="model" name="model" defaultValue={ai.model} className={`${input} mt-1`} />
                </div>
                <div>
                  <label htmlFor="apiKey" className={label}>Anthropic API key</label>
                  <input id="apiKey" name="apiKey" type="password" autoComplete="off" placeholder={ai.hasKey ? "Saved (leave blank to keep)" : "sk-ant-…"} className={`${input} mt-1`} />
                  <p className={hint}>Stored encrypted (AES-256-GCM) with the server secret from .env.local. It is never shown again.</p>
                </div>
                {ai.hasKey && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="removeKey" /> Remove the saved key</label>}
                <Submit variant="secondary">Save AI settings</Submit>
              </ActionForm>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

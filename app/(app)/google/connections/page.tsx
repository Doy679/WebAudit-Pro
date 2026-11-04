import { requireUser } from "@/app/lib/session";
import { can } from "@/server/permissions";
import { googleStatus } from "@/server/google/config";
import { listConnections, listProperties, projectGoogle } from "@/server/google/service";
import { propertyMatchesDomain } from "@/server/google/gsc";
import { bindPropertyAction, disconnectGoogleAction, saveGoogleCredentialsAction, setGoogleLimitsAction, testSearchConsoleAction } from "@/app/google-actions";
import { searchConsoleStatus } from "@/server/google/gsc-status";
import { ActionForm, Submit } from "@/components/forms";
import { GoogleTabs, GscStatusNotice } from "@/components/google";
import { btn, Card, fmtDate, hint, input, label, Notice, PageHeader } from "@/components/ui";
import { selectProject } from "../shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Google Connections" };

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ project?: string; connected?: string; disconnected?: string; error?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const status = googleStatus();
  const admin = can(user, "settings:manage");
  const connections = listConnections(user);
  const { projects, project } = selectProject(user, sp.project);
  const pg = project ? projectGoogle(user, project.id) : null;

  // Properties are listed from Google for the user's own connection (cached; a failure is remembered for 2 minutes).
  let properties: { siteUrl: string; permissionLevel: string }[] = [];
  let listed = false;
  if (connections[0] && project && can(user, "project:edit")) {
    try {
      properties = (await listProperties(user, connections[0].id)).filter((p) => propertyMatchesDomain(p.siteUrl, project.domain));
      listed = true;
    } catch {
      // Recorded on the connection; shown through the shared status below.
    }
  }
  const gsc = searchConsoleStatus(user, project?.id);

  return (
    <>
      <PageHeader title="Google Connections" subtitle="Credentials and Search Console access used by the Google SEO & Performance suite. Every connection is read-only." />
      <GoogleTabs active="connections" project={project?.id} />
      {sp.connected && <div className="mb-4"><Notice tone="ok">Google Search Console connected. Choose a property for each website below.</Notice></div>}
      {sp.disconnected && <div className="mb-4"><Notice tone="ok">Google disconnected. Tokens were deleted and access was revoked at Google.</Notice></div>}
      {sp.error && <div className="mb-4"><Notice tone="error">{sp.error}</Notice></div>}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Integration status">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">PageSpeed Insights API</dt>
            <dd data-testid="psi-status">{status.apiKeyConfigured ? <>Configured ({status.apiKeySource}){status.lastApiCheck ? ` · last success ${fmtDate(status.lastApiCheck.slice(3))}` : " · not yet used"}</> : <span className="text-sev-med">Not configured: add an API key</span>}</dd>
            <dt className="text-slate-500">Chrome UX Report API</dt>
            <dd>{status.cruxEnabled ? "Enabled (uses the same API key)" : "Off (optional extra history). Basic real-user data still comes from PageSpeed."}</dd>
            <dt className="text-slate-500">Search Console OAuth</dt>
            <dd data-testid="oauth-status">{status.oauthConfigured ? "Client configured" : <span className="text-sev-med">Not configured: add an OAuth client</span>}</dd>
            <dt className="text-slate-500">Your Google connection</dt>
            <dd>{connections[0] ? <>Connected {fmtDate(connections[0].created_at)}</> : "Not connected"}</dd>
            <dt className="text-slate-500">Search Console</dt>
            <dd data-testid="gsc-status-label">{gsc.label}{gsc.checkedAt ? <span className="text-xs text-slate-500"> · checked {fmtDate(gsc.checkedAt)}</span> : null}</dd>
            <dt className="text-slate-500">Rich Results Test</dt>
            <dd>No public API. WebAudit Pro validates structured data internally and links to Google&apos;s official test.</dd>
          </dl>
        </Card>

        <Card title="Your Google account (Search Console)">
          <p className="mb-3 text-sm text-slate-600">
            Signing in with Google grants read-only Search Console access (<code className="text-xs">webmasters.readonly</code>). WebAudit Pro never sees your Google password,
            never submits sitemaps or changes Search Console, and your WebAudit Pro login doesn&apos;t grant anyone else your Google access.
          </p>
          {connections.length ? (
            <ul className="space-y-2 text-sm">
              {connections.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-2">
                  <span>Connected by {c.owner} on {fmtDate(c.created_at)}</span>
                  <form action={disconnectGoogleAction}>
                    <input type="hidden" name="connectionId" value={c.id} />
                    <button className={btn.danger}>Disconnect Google</button>
                  </form>
                </li>
              ))}
            </ul>
          ) : status.oauthConfigured ? (
            <a href="/api/google/oauth/start" className={btn.primary} data-testid="connect-google">Connect Google Search Console</a>
          ) : (
            <p className="text-sm text-sev-med">An admin needs to add the Google OAuth client below before you can connect.</p>
          )}
        </Card>

        {project && can(user, "project:edit") && (
          <Card title={`Project settings: ${project.name}`}>
            <form method="get" className="mb-4 flex gap-2">
              <label htmlFor="project" className="sr-only">Website</label>
              <select id="project" name="project" defaultValue={project.id} className={`${input} flex-1`}>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className={btn.secondary}>Show</button>
            </form>
            <p className="mb-2 text-sm">Search Console property: <strong data-testid="bound-property">{pg?.gsc_property ?? "none selected"}</strong>{pg?.gsc_property && pg.connection_owner ? ` (via ${pg.connection_owner}'s connection)` : ""}{pg?.gsc_property && !pg.connection_id ? <span className="text-sev-med"> · connection removed: reconnect and select again</span> : null}</p>
            {connections[0] && (
              <div className="mb-3 space-y-2">
                {gsc.state !== "ready" && <GscStatusNotice status={{ ...gsc, action: undefined }} />}
                {gsc.errorKind === "api-disabled" && admin && (
                  <p className="text-sm text-slate-700">
                    Fix: in Google Cloud Console open <em>APIs &amp; Services → Library</em>, find <strong>Google Search Console API</strong> and press <strong>Enable</strong>
                    {" "}(<a className="text-accent-600 underline" href="https://console.cloud.google.com/apis/library/searchconsole.googleapis.com" target="_blank" rel="noopener noreferrer">open it</a>). Wait a few minutes, then press Retry.
                  </p>
                )}
                <ActionForm action={testSearchConsoleAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="connectionId" value={connections[0].id} />
                  <input type="hidden" name="projectId" value={project.id} />
                  <Submit variant="secondary">Retry / Test connection</Submit>
                  <span className={hint}>Makes one read-only request to Google.</span>
                </ActionForm>
              </div>
            )}
            {connections[0] ? (
              !listed ? null : properties.length ? (
                <ActionForm action={bindPropertyAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="projectId" value={project.id} />
                  <input type="hidden" name="connectionId" value={connections[0].id} />
                  <div className="min-w-0 flex-1">
                    <label htmlFor="property" className={label}>Authorized property for {project.domain}</label>
                    <select id="property" name="property" defaultValue={pg?.gsc_property ?? undefined} className={`${input} mt-1`}>
                      {properties.map((p) => <option key={p.siteUrl} value={p.siteUrl} disabled={p.permissionLevel === "siteUnverifiedUser"}>{p.siteUrl} ({p.permissionLevel}{p.permissionLevel === "siteUnverifiedUser" ? ": no access" : ""})</option>)}
                    </select>
                  </div>
                  <Submit variant="secondary">Use this property</Submit>
                </ActionForm>
              ) : <Notice tone="warn">Your Google account has no Search Console property for {project.domain}. Access required: ask the property owner to add your Google account in Search Console.</Notice>
            ) : <p className="text-sm text-slate-500">Connect Google to choose a property.</p>}

            <ActionForm action={setGoogleLimitsAction} className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
              <input type="hidden" name="projectId" value={project.id} />
              <div><label htmlFor="psiMaxUrls" className={label}>PageSpeed URLs per request</label><input id="psiMaxUrls" name="psiMaxUrls" type="number" min={1} max={50} defaultValue={pg?.psi_max_urls ?? 10} className={`${input} mt-1`} /></div>
              <div><label htmlFor="inspectionMaxUrls" className={label}>URL inspections per request</label><input id="inspectionMaxUrls" name="inspectionMaxUrls" type="number" min={1} max={200} defaultValue={pg?.inspection_max_urls ?? 20} className={`${input} mt-1`} /></div>
              <p className={`${hint} col-span-2`}>Google allows 2,000 URL inspections per property per day; WebAudit Pro also enforces that daily cap.</p>
              <div className="col-span-2"><Submit variant="secondary">Save limits</Submit></div>
            </ActionForm>
          </Card>
        )}

        {admin && (
          <Card title="Google Cloud credentials (admin)">
            <ActionForm action={saveGoogleCredentialsAction} className="space-y-3">
              <p className="text-sm text-slate-600">
                Create these in Google Cloud Console → APIs &amp; Services. Enable the PageSpeed Insights API, Google Search Console API and (optional) Chrome UX Report API.
                Secrets are stored encrypted and never shown again.
              </p>
              <div>
                <label htmlFor="apiKey" className={label}>API key (PageSpeed Insights / CrUX)</label>
                <input id="apiKey" name="apiKey" type="password" autoComplete="off" placeholder={status.apiKeyConfigured ? "Saved (leave blank to keep)" : "AIza…"} className={`${input} mt-1`} />
              </div>
              {status.apiKeyConfigured && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="removeApiKey" /> Remove the saved API key</label>}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="cruxEnabled" defaultChecked={status.cruxEnabled} /> Also query the Chrome UX Report API for real-user data</label>
              <div>
                <label htmlFor="oauthClientId" className={label}>OAuth client ID (Web application)</label>
                <input id="oauthClientId" name="oauthClientId" autoComplete="off" placeholder="…apps.googleusercontent.com" className={`${input} mt-1`} />
              </div>
              <div>
                <label htmlFor="oauthClientSecret" className={label}>OAuth client secret</label>
                <input id="oauthClientSecret" name="oauthClientSecret" type="password" autoComplete="off" placeholder={status.oauthConfigured ? "Saved (leave blank to keep)" : "GOCSPX-…"} className={`${input} mt-1`} />
                <p className={hint}>Authorized redirect URI to add in Google Cloud: <code className="select-all break-all">{status.redirectUri}</code></p>
              </div>
              {status.oauthConfigured && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="removeOauth" /> Remove the OAuth client</label>}
              <Submit>Save credentials</Submit>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}

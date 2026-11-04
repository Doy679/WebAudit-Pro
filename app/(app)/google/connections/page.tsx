import { requireUser } from "@/app/lib/session";
import { can } from "@/server/permissions";
import { googleStatus, lastCredentialChange, type CredentialEvent } from "@/server/google/config";
import { cachedProperties, listConnections, pageSpeedTestState, projectGoogle, PSI_TEST_COOLDOWN_MS } from "@/server/google/service";
import { knownCloudProject, pageSpeedHealth } from "@/server/google/health-status";
import { cloudCredentialsUrl } from "@/server/google/credentials";
import { propertyMatchesDomain } from "@/server/google/gsc";
import { setupChecklist, type SetupStep } from "@/server/google/setup";
import { bindPropertyAction, disconnectGoogleAction, saveGoogleCredentialsAction, setGoogleLimitsAction, testPageSpeedKeyAction, testSearchConsoleAction } from "@/app/google-actions";
import { searchConsoleStatus } from "@/server/google/gsc-status";
import { ActionForm, Submit } from "@/components/forms";
import { GoogleTabs, GscStatusNotice, PsiHealthNotice } from "@/components/google";
import { btn, Card, cx, fmtDate, hint, input, label, Notice, PageHeader } from "@/components/ui";
import { selectProject } from "../shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Google Connections" };

const STEP_STYLE: Record<SetupStep["state"], [string, string]> = {
  done: ["Done", "bg-ok-bg text-ok"],
  todo: ["To do", "bg-slate-100 text-slate-700"],
  problem: ["Needs attention", "bg-sev-high-bg text-sev-high"],
  unverified: ["Not verified", "bg-sev-med-bg text-sev-med"],
};
const CREDENTIAL_WORDS: Record<CredentialEvent["credential"], string> = { apiKey: "API key", oauthClientId: "OAuth client ID", oauthClientSecret: "OAuth client secret" };
const changeLine = (e?: CredentialEvent) =>
  e ? `Last change: ${CREDENTIAL_WORDS[e.credential]} ${e.action} on ${fmtDate(e.created_at)}${e.changed_by ? ` by ${e.changed_by}` : ""}.` : "No change recorded since change tracking started (Nov 4, 2026); earlier changes weren't recorded.";

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ project?: string; connected?: string; disconnected?: string; error?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const status = googleStatus();
  const admin = can(user, "settings:manage");
  const connections = listConnections(user);
  const { projects, project } = selectProject(user, sp.project);
  const pg = project ? projectGoogle(user, project.id) : null;

  // Opening this page never calls Google: properties come from the last Retry / Test (kept for an hour).
  const cached = connections[0] && project && can(user, "project:edit") ? cachedProperties(user, connections[0].id) : null;
  const listed = !!cached;
  const properties = (cached ?? []).filter((p) => project && propertyMatchesDomain(p.siteUrl, project.domain));
  const gsc = searchConsoleStatus(user, project?.id);
  const psiHealth = pageSpeedHealth(user);
  const steps = setupChecklist(user, project?.id);
  const test = admin ? pageSpeedTestState() : null;
  const coolingDown = !!test?.nextAllowedAt && Date.parse(test.nextAllowedAt) > Date.now();
  // GQA-08: Google Cloud links use the project named in Google's stored errors.
  const cloudProject = (gsc.detail.match(/project (\d+)/) ?? [])[1] ?? (admin ? knownCloudProject() : null);
  const credentialsUrl = cloudCredentialsUrl(cloudProject);
  const keyChange = admin ? lastCredentialChange(user, "apiKey") : undefined;
  const oauthChange = admin ? [lastCredentialChange(user, "oauthClientSecret"), lastCredentialChange(user, "oauthClientId")].filter(Boolean).sort((a, b) => b!.created_at.localeCompare(a!.created_at))[0] : undefined;

  return (
    <>
      <PageHeader title="Google Connections" subtitle="Credentials and Search Console access used by the Google SEO & Performance suite. Every connection is read-only." />
      <GoogleTabs active="connections" project={project?.id} />
      {sp.connected && <div className="mb-4"><Notice tone="ok">Google Search Console connected. Choose a property for each website below.</Notice></div>}
      {sp.disconnected && <div className="mb-4"><Notice tone="ok">Google disconnected. Tokens were deleted and access was revoked at Google.</Notice></div>}
      {sp.error && <div className="mb-4"><Notice tone="error">{sp.error}</Notice></div>}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Setup checklist">
          <ol className="space-y-3" data-testid="setup-checklist">
            {steps.map((s, i) => (
              <li key={s.id} className="rounded-md border border-slate-200 p-3 text-sm" data-testid={`setup-step-${s.id}`} data-state={s.state}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-navy-900">{i + 1}. {s.title}</span>
                  <span className={cx("rounded px-1.5 py-0.5 text-xs font-semibold", STEP_STYLE[s.state][1])}>{STEP_STYLE[s.state][0]}</span>
                </div>
                <p className="mt-1 text-slate-800">{s.status}{s.checkedAt ? <span className="text-xs text-slate-500"> · checked {fmtDate(s.checkedAt)}</span> : null}</p>
                <p className="mt-1 text-xs text-slate-500">{s.why}</p>
                {s.next && (admin || !s.next.href.includes("#google-credentials")) && (
                  <a href={s.next.href} className="mt-1 inline-block text-xs font-medium text-accent-600 underline">{s.next.label}</a>
                )}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-slate-500">
            Chrome UX Report API: {status.cruxEnabled ? "on (uses the same API key)" : "off (optional; basic real-user data still comes from PageSpeed)"}.
            Rich Results Test has no public API: WebAudit Pro validates structured data internally and links to Google&apos;s official test.
            Opening this page never contacts Google.
          </p>
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
          {connections[0] && (
            <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs" data-testid="gsc-checks">
              <dt className="text-slate-500">Last successful check</dt><dd>{gsc.lastSuccessAt ? fmtDate(gsc.lastSuccessAt) : "None recorded"}</dd>
              <dt className="text-slate-500">Last failed check</dt><dd>{gsc.lastFailureAt ? fmtDate(gsc.lastFailureAt) : "None recorded"}</dd>
            </dl>
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
            <p id="search-console-property" className="mb-2 text-sm">Search Console property: <strong data-testid="bound-property">{pg?.gsc_property ?? "none selected"}</strong>{pg?.gsc_property && pg.connection_owner ? ` (via ${pg.connection_owner}'s connection)` : ""}{pg?.gsc_property && !pg.connection_id ? <span className="text-sev-med"> · connection removed: reconnect and select again</span> : null}</p>
            {connections[0] && (
              <div id="search-console-retry" className="mb-3 space-y-2">
                {gsc.state !== "ready" && <GscStatusNotice status={{ ...gsc, action: undefined }} />}
                {gsc.errorKind === "api-disabled" && admin && (
                  <p className="text-sm text-slate-700">
                    Fix: in Google Cloud Console open <em>APIs &amp; Services → Library</em>, find <strong>Google Search Console API</strong> and press <strong>Enable</strong>
                    {" "}(<a className="text-accent-600 underline" href={`https://console.cloud.google.com/apis/library/searchconsole.googleapis.com${cloudProject ? `?project=${cloudProject}` : ""}`} target="_blank" rel="noopener noreferrer">open it{cloudProject ? ` in project ${cloudProject}` : ""}</a>). If it&apos;s already enabled, the status above is from an older check: press Retry.
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
            {connections[0] && !listed && gsc.state !== "api-error" && (
              <p className="mb-2 text-sm text-slate-600" data-testid="properties-not-loaded">Press <strong>Retry / Test connection</strong> to load your Search Console properties (one read-only request to Google).</p>
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
          <Card title="PageSpeed Insights key (admin)">
            <div id="pagespeed-test" className="space-y-3">
              <PsiHealthNotice health={psiHealth} />
              {test?.last && (
                <p className="text-sm" data-testid="psi-last-test">
                  Last key test: <strong className={test.last.ok ? "text-ok" : "text-sev-high"}>{test.last.ok ? "worked" : "failed"}</strong> at {fmtDate(test.last.at)}.{" "}
                  {coolingDown ? `Another test is allowed after ${new Date(test.nextAllowedAt!).toLocaleTimeString("en-US", { timeStyle: "medium" })} (one test per ${PSI_TEST_COOLDOWN_MS / 1000} seconds).` : ""}
                </p>
              )}
              {test?.running && <Notice>A key test is running. Its result appears here when it finishes.</Notice>}
              {status.apiKeyConfigured && project && psiHealth.state !== "invalid-format" && (
                <ActionForm action={testPageSpeedKeyAction} className="space-y-2">
                  <input type="hidden" name="projectId" value={project.id} />
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="confirm" required className="mt-1" />
                    <span>I understand this sends <strong>one</strong> PageSpeed request to Google for {project.base_url} (uses API quota).</span>
                  </label>
                  <Submit variant="secondary" disabled={coolingDown || !!test?.running} title={coolingDown ? "A test ran less than a minute ago" : undefined}>Test PageSpeed key</Submit>
                </ActionForm>
              )}
              {psiHealth.state === "invalid-format" && (
                <p className="text-sm text-slate-700" data-testid="psi-test-hidden">Testing is off until a Google API key is saved: the current value would be refused before reaching Google.</p>
              )}
              <p className={hint}>
                If the key is rejected: open <a className="text-accent-600 underline" href={credentialsUrl} target="_blank" rel="noopener noreferrer" data-testid="cloud-credentials-link">Credentials in Google Cloud{cloudProject ? ` (project ${cloudProject})` : ""} ↗</a>.
                Check the key exists, is restricted to the PageSpeed Insights API, and has no website (referrer) restriction, then paste it in <a className="text-accent-600 underline" href="#google-credentials">the API key field below</a>.
              </p>
            </div>
          </Card>
        )}

        {admin && (
          <Card title="Google Cloud credentials (admin)">
            <ActionForm action={saveGoogleCredentialsAction} className="space-y-3">
              <div id="google-credentials" className="scroll-mt-4" />
              <p className="text-sm text-slate-600">
                These are three different credentials from Google Cloud Console → APIs &amp; Services → Credentials. Each value is checked before saving, stored encrypted and never shown again.
                Enable the PageSpeed Insights API, Google Search Console API and (optional) Chrome UX Report API in the same project.
              </p>
              <div>
                <label htmlFor="apiKey" className={label}>Google API key: usually starts with AIza</label>
                <input id="apiKey" name="apiKey" type="password" autoComplete="off" spellCheck={false} pattern="AIza[0-9A-Za-z_\-]{35}"
                  title="A Google API key starts with AIza and is 39 characters long (Credentials → API keys). OAuth client IDs and secrets go in the fields below."
                  placeholder={status.apiKeyConfigured ? "Saved (leave blank to keep)" : "AIza… (39 characters)"} className={`${input} mt-1`} />
                <p className={hint}>Used for PageSpeed Insights and Chrome UX Report. From <em>Credentials → API keys</em>. {changeLine(keyChange)}</p>
              </div>
              {status.apiKeyConfigured && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="removeApiKey" /> Remove the saved API key</label>}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="cruxEnabled" defaultChecked={status.cruxEnabled} /> Also query the Chrome UX Report API for real-user data</label>
              <div>
                <label htmlFor="oauthClientId" className={label}>OAuth client ID: ends with .apps.googleusercontent.com</label>
                <input id="oauthClientId" name="oauthClientId" autoComplete="off" spellCheck={false} pattern="[0-9]+-[0-9A-Za-z_\-]+\.apps\.googleusercontent\.com"
                  title="The OAuth client ID ends with .apps.googleusercontent.com (Credentials → OAuth 2.0 Client IDs)."
                  placeholder={status.oauthConfigured ? "Saved (leave blank to keep)" : "…apps.googleusercontent.com"} className={`${input} mt-1`} />
              </div>
              <div>
                <label htmlFor="oauthClientSecret" className={label}>OAuth client secret: typically starts with GOCSPX-</label>
                <input id="oauthClientSecret" name="oauthClientSecret" type="password" autoComplete="off" spellCheck={false} pattern="[0-9A-Za-z_\-]{16,}"
                  title="The client secret is shown on the OAuth client in Credentials (typically starts with GOCSPX-). It is not the API key."
                  placeholder={status.oauthConfigured ? "Saved (leave blank to keep)" : "GOCSPX-…"} className={`${input} mt-1`} />
                <p className={hint}>Used only for Search Console sign-in; never paste it in the API key field. {changeLine(oauthChange)}</p>
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

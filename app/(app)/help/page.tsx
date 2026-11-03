import Link from "next/link";
import { requireUser } from "@/app/lib/session";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Help" };

const STEPS = [
  { title: "Add your website", href: "/projects/new", link: "Add a website", body: "Go to My Websites → Add website. Enter the site's address and confirm you're authorized to audit it (it's your site, or the owner asked you to). Audits only ever read public pages." },
  { title: "Start an audit", href: "/audits/new", link: "New Audit", body: "Choose the website and press Start Audit. The defaults suit most sites: up to 20 pages, five screen sizes from phone to desktop, and every check type. Open Advanced settings only if you need to change them." },
  { title: "Wait for it to finish", href: "/audits", link: "Audit Runs", body: "The audit runs in the background, one page at a time, so it doesn't overload the website. A 20-page audit usually takes 5–10 minutes. You can leave the page; progress is saved. The sidebar shows whether the background worker is running." },
  { title: "Review the issues", href: "/issues?quick=high", link: "High-priority issues", body: "Start with the High priority quick filter. Each issue explains what's wrong, where, why it matters and what to change, with a screenshot. Mark each one Confirmed, or False positive if the audit got it wrong." },
  { title: "Download a report", href: "/reports", link: "Reports", body: "Choose the audit, what to include and the report type: Excel for developers (every detail and a fix tracker), PDF for clients (readable summary). A preview tells you how many findings it will contain." },
  { title: "Ask your client for approval", href: "/approvals", link: "Client Approvals", body: "Pick reviewed findings and create a private link. Copy it and send it yourself. Nothing is emailed automatically. The client approves, requests changes or rejects each item, and their decisions appear on each issue." },
  { title: "Check the fixes", href: "/reaudit", link: "Re-Audit", body: "After the developers fix things, run the audit again and compare the two runs on the Re-Audit page: resolved, still present and new issues." },
];

const TERMS: [string, string][] = [
  ["Severity", "How much an issue affects visitors. High: fix soon. Medium: fix in the next round. Low: polish."],
  ["Confirmed / Recommendation / Needs review", "Confirmed issues were measured (for example, the page is 423px wide on a 390px phone). Recommendations are improvements based on your design standards. Needs review means the audit isn't sure, so a person should look."],
  ["Verification", "Your team's judgement: Verified (it's real) or False positive (the audit was wrong). False positives are left out of reports."],
  ["Viewport / screen size", "The width of the browser window the page was tested at. 320–390px are phones, 768px a tablet, 1024–1440px laptops and desktops."],
  ["Selector", "A developer's address for the element on the page (like .header .menu-button). Shown under Technical details."],
  ["Accessibility (a11y)", "Whether people with disabilities can use the site, for example with a screen reader or keyboard only. Checked with the axe-core standard (WCAG 2.1 AA)."],
  ["Shared component", "Something that appears on many pages (header, footer, a widget). Fixing it once fixes it everywhere."],
  ["Worker", "The background process that runs audits and creates reports. If it's offline, audits wait in the queue and start when it runs again."],
  ["PageSpeed / Search Console", "Optional Google data. It needs a Google API key or a connected Google account (Google SEO & Performance → Connections). Audits work without it."],
];

const PROBLEMS: [string, string][] = [
  ["My audit says “Waiting to start”", "The background worker isn't running. Your audit is saved in the queue. Start the app with npm start (web and worker together) and it begins automatically."],
  ["The URL is rejected", "Each website project only allows its own domain. Check you selected the right website, or add the other site as a new project."],
  ["Google data says “not configured”", "Nothing is wrong with your audit. An admin can add a Google API key and connect Search Console under Google SEO & Performance → Connections."],
  ["A report failed", "Your audit data isn't affected. Generate the report again; if it keeps failing, give your administrator the time it happened so they can check the server log."],
  ["I can't see a website or page", "You only see websites you're a member of. Ask an admin or project manager to add you."],
];

export default async function HelpPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Help & getting started" subtitle="How to go from a website address to a client-approved list of fixes. No technical knowledge needed." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title="Step by step">
          <ol className="space-y-4">
            {STEPS.map((s, n) => (
              <li key={s.title} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-900 text-sm font-semibold text-white" aria-hidden="true">{n + 1}</span>
                <div>
                  <h2 className="font-semibold text-navy-900">{s.title}</h2>
                  <p className="mt-0.5 text-sm text-slate-700">{s.body}</p>
                  <Link href={s.href} className="text-sm text-accent-600 underline">{s.link}</Link>
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <div className="space-y-6">
          <Card title="Words you'll see">
            <dl className="space-y-3 text-sm">
              {TERMS.map(([t, d]) => <div key={t}><dt className="font-semibold text-navy-900">{t}</dt><dd className="text-slate-700">{d}</dd></div>)}
            </dl>
          </Card>
          <Card title="Common problems">
            <dl className="space-y-3 text-sm">
              {PROBLEMS.map(([t, d]) => <div key={t}><dt className="font-semibold text-navy-900">{t}</dt><dd className="text-slate-700">{d}</dd></div>)}
            </dl>
          </Card>
          <Card title="Safety">
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              <li>Audits only read public pages. They never submit forms, log in or change anything on a website.</li>
              <li>Reports and approval links are never sent automatically. You decide who gets them.</li>
              <li>Client approval records a decision; it doesn&apos;t change the website.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

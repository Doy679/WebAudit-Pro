# WebAudit Pro — Browser QA & Handoff Report

**Date:** 2026-11-04 (Asia/Singapore) · **Target:** `http://localhost:3000` · **Account:** J. Pajares (Admin) · **Method:** Claude in Chrome, read-only navigation, DOM/network inspection, same-origin GET requests. **No records were created, changed or deleted.** No secrets were read or recorded (the credentials panel is cropped out of the evidence).

**Data in the app at test time:** 2 websites. Capital Home Mortgage (CHM): 7 audits, latest 20 pages / 727 findings. RedRiverModularHomes (RRMH): 1 audit, 80 pages / 750 findings. 1,477 findings in total; 0 reviewed; 0 reports; 0 approval packages.

**Evidence labels:** Verified · Partially Verified · Suspected · Not Tested. Confidence tags [Certain]/[Likely]/[Guessing] are used where they matter. Screenshots: `evidence/E01–E24`.

**Companion files:** `WEBAUDIT_BUG_REGISTER.md` (section C), `WEBAUDIT_UX_IMPROVEMENTS.md` (section D), `WEBAUDIT_CLI_HANDOFF.md` (section I). They are also included in full below.

---

## A. Executive Summary

**Most important finding:** Search Console is blocked, and the app misdiagnoses why. Google OAuth is connected, but every Search Console call fails because the **Search Console API is disabled in Google Cloud project 154245030857**. That is Google's own error text. The app labels it as "your Google account doesn't have permission for this property" and offers no retry or property selector (BUG-01, P1). Other screens disagree with each other about whether Search Console is "set up", "connected" or "not connected" (BUG-02). Clearing the blocker needs a manual step in Google Cloud Console. The app's error handling also needs a code fix.

**Second:** the app shows conflicting performance data. The PageSpeed page's "Latest results" table shows the **oldest** of 12 runs (home mobile 59 / LCP 9.0 s), while SEO Overview and SEO History show the actual latest (52 / 6.3 s) (BUG-03, P1). Each URL/device was run **12 times in about 12 minutes** (120 API calls; BUG-04). Real-user (CrUX) values are identical across all 5 tested pages, which strongly suggests whole-site data copied onto each page. That copying creates 20 of CHM's 47 High findings (BUG-05).

**Third:** client-side navigation requests return **HTTP 503** (15 of 20 prefetches on Overview; sidebar clicks), so the app falls back to full reloads (BUG-10). The cause wasn't found from the browser.

**Overall assessment**
- **Functionality [Likely good for core crawl]:** Audits complete, findings are grouped with evidence, and counts reconcile exactly across views (727 = 94 confirmed + 430 recommendations + 203 review; category totals match; Re-Audit buckets reconcile). Domain-scope and authorization messaging is clear.
- **Stability:** No app console errors were seen (the 2 console exceptions came from a password-manager extension). The 503s on navigation requests are the main stability concern.
- **Usability:** The plain-language copy is a real strength (issue detail "What's wrong / Where / Why it matters / What to change", onboarding guide, Help glossary). The weaknesses are volume (727+ findings, all needing individual review before a client approval), overlapping status vocabulary, and the Google setup experience.
- **Google integration:** PageSpeed works but has selection/duplication bugs. Structured data validation works but has contradictory verdicts (BUG-12). Search Console is non-functional (blocked).
- **Not tested (would mutate data):** adding a website, starting/cancelling audits, review actions, report generation/download, approval packages and the client link page, fresh re-audit, PageSpeed runs, credential/limit saves, account creation, password change, backup, branding, AI settings, sign-out. Responsive layout at phone width wasn't visually tested: the window resize had no effect in this environment.

**Beginner flow (Add Website → Start Audit → Review → Report → Client Approval → Re-Audit):**
1. **Add Website** — clear form with an authorization checkbox and domain-scope explanation. *Submission Not Tested.*
2. **Start Audit** — clear, with good defaults and a "Worker online" indicator. It gives no time estimate (a 20-page audit took 16 m 28 s; Help says 5–10 min).
3. **Review Findings** — **the main friction point.** 727 findings for one 20-page site, 336 High across both sites, and no review queue. The bulk action defaults to "Confirm finding". "Confirmed / Unverified / Pending" appear together.
4. **Generate Report** — clear 4-step layout. The preview needs a manual refresh, Generate is enabled for empty output, and there's no Performance category. *Generation Not Tested.*
5. **Client Approval** — blocked until findings are reviewed (by design). The blocked message doesn't give a count or a filtered link. *Package creation Not Tested.*
6. **Re-Audit** — the comparison works and reconciles, but "New (197)" is mostly checks the base audit never ran, and the page is 2.2 MB.

A beginner can follow steps 1–2 and 4 unaided. Steps 3 and 5 are realistic only for a patient expert with the current tools.

**Original MVP milestones** — the milestone list wasn't provided. This mapping is inferred from the app's own navigation and Help [Guessing]:

| # | Inferred milestone | Status observed |
|---|---|---|
| 1 | Projects + authorization/domain scope | Works (view); create Not Tested |
| 2 | Audit engine + background worker | Works (completed runs, worker online); new run Not Tested |
| 3 | Findings: grouping, evidence, plain-language detail | Works; ID collisions, over-fragmentation, CWV duplication |
| 4 | Internal review workflow | UI present; actions Not Tested; vocabulary/defaults issues |
| 5 | Reports (Excel/PDF/HTML/JSON) | UI present; generation Not Tested; filter gaps |
| 6 | Client approvals (private expiring links) | UI present; blocked by 0 reviewed; Not Tested |
| 7 | Re-audit comparison | Works; misclassification, fingerprint churn, size |
| 8 | Google SEO & Performance suite | PSI works with bugs; SD works with bugs; Search Console blocked |

---

## B. Page-by-Page Audit

Legend: ✅ works · ❌ fails · ⚠️ confusing/missing. A11y = accessibility. Responsive: **Not Tested visually** on all pages. The window resize didn't take effect. Static check: CSS includes breakpoints at 40/48/64/80/96rem, and a "Menu" button with `aria-expanded` exists [Partially Verified that responsive styles exist].

Static a11y scan (server HTML fetched for 19 routes): no unlabeled form controls, no `<img>` without `alt`, no links without an accessible name. The 7 routes checked for headings each had exactly one `<h1>`. `lang="en"` is set. No skip-to-content link was found on `/issues`. The Audit Runs and Issues tables have `<th>` without `scope` (simple tables, low impact). Colour contrast, focus visibility and keyboard-only operation of the app's own UI were **Not Tested**.

### 1. Overview — `/`
- **Purpose:** status across websites, onboarding, next actions.
- ✅ 5-step guide with done markers; KPI tiles (336 High = 47 + 289 across sites ✔); worker status; recent activity; "View issues" / "Audit again".
- ❌ "Search Console: set up" although it can't be used (BUG-02). Navigation prefetches return 503 (BUG-10).
- ⚠️ "Last audit 9:48 AM" is a finish time, while other pages show start times (BUG-20). Three cancellations are listed at the same 3:39 PM time (BUG-20). The guide has 5 steps vs 7 in Help (UX-14). Whether "Audit again" asks for confirmation before starting a run is Not Tested.
- **Evidence:** E02 · **Status:** Verified

### 2. My Websites — `/projects`, project detail `/projects/<id>`, add `/projects/new`
- **Purpose:** manage websites, settings, design standards, audit history.
- ✅ Cards with audits/open findings/last run; project detail shows authorization note, audit history, project settings, design standards; add form has an authorization checkbox and scope explanation.
- ⚠️ "Last run" shows the start time (BUG-20). The detail page `<title>` is generic (BUG-22). "Team" lists members, but there's no visible add-member control on the project page even though Settings says "added on each project's page" [Partially Verified: control not seen; it may only appear when other accounts exist]. No breadcrumb back to My Websites. No delete/archive (may be intentional).
- **Not Tested:** add website, save settings/design standards.
- **Evidence:** E03, E04 · **Status:** Verified (view)

### 3. New Audit — `/audits/new`
- **Purpose:** start a read-only audit.
- ✅ Project dropdown, domain-scope hint, Advanced settings with clear explanations of every check type and viewport, worker status. Labels are correctly associated (verified in the DOM).
- ⚠️ No time estimate (UX-17). The Search Console options are disabled with "Search Console not connected", which is misleading (BUG-02). "Design standards: default baseline", yet the project page shows values entered.
- **Not Tested:** Start Audit; off-domain URL validation on submit.
- **Evidence:** E07 · **Status:** Verified (view)

### 4. Audit Runs — `/audits`, detail `/audits/<id>`
- **Purpose:** history and per-run results.
- ✅ The detail page has progress, page counts, a 7-area health grid, completion summary, quality-score explanation, by-category list and per-page table. All totals reconcile.
- ❌ Health "Open" links aren't filtered (BUG-16). The CWV summary is mobile-only (BUG-06). Cancelled-run inconsistencies (BUG-21).
- ⚠️ The list has no filters/sort/pagination (UX-09). "Not connected: Search Console not connected" repeats itself.
- **Evidence:** E05, E06 · **Status:** Verified

### 5. Issues — `/issues`, detail `/issues/<id>`
- **Purpose:** triage, review, assign.
- ✅ Quick filters work (counts: High 336, Mobile 996, Desktop 896, A11y 657, SEO 124, Layout 83, Confirmed 533, Needs review 396, Awaiting client 0, with a clear empty state). Search works ("404" → 2 results). Pagination (50/page). "Create report from selected" appears when filtering. Detail pages are clear, with evidence crops and full-page screenshots per viewport. Invalid IDs show a friendly Not found.
- ❌ Duplicate display IDs across websites (BUG-11). Bulk default "Confirm finding" (BUG-17). Recommendation buttons on non-recommendations (BUG-18). Zero-size highlight (BUG-19). Possible false positive TYP-0019 (BUG-25).
- ⚠️ Status vocabulary (UX-02). No Website column (UX-04). Near-duplicate findings (UX-05).
- **Not Tested:** all review/assign/priority/implementation saves, saved views, sort options other than default, "More filters".
- **Evidence:** E08, E09, E10, E23 · **Status:** Verified (view, filters, search)

### 6. Reports — `/reports`
- **Purpose:** build Excel/PDF/HTML/JSON reports.
- ✅ Clear 4-step layout; the preview count works (727 = 47 High / 274 Medium / 406 Low); the "reviewed only" preview correctly reports empty.
- ❌ No Performance/CWV category (BUG-14). Generate enabled for an empty report (BUG-15).
- ⚠️ Preview needs a manual "Update preview" (UX-06).
- **Not Tested:** generating and downloading any report; Google data inside reports.
- **Evidence:** E11, E12 · **Status:** Partially Verified

### 7. Client Approvals — `/approvals`
- **Purpose:** release reviewed findings via a private link.
- ✅ Correctly refuses to package unreviewed findings; empty state shown.
- ⚠️ The blocked message has no count or filtered link (UX-07). An extra "Select" click is needed (UX-10).
- **Not Tested:** package creation, the client-facing link page, expiry, client decisions.
- **Evidence:** E13 · **Status:** Partially Verified

### 8. Re-Audit — `/reaudit`
- **Purpose:** compare two audits.
- ✅ Buckets reconcile (All 827; New 197 + Still present 530 = 727; Still present 530 + Unable 60 + Resolved 40 = 630); the matching rule is explained in plain language.
- ❌ BUG-07 (not-measured shown as New), BUG-08 (volatile IDs), BUG-09 (2.2 MB page).
- ⚠️ The same audit can be chosen as both base and comparison (UX-08). "Run fresh audit with the same settings" is one click (Not Tested).
- **Evidence:** E14 · **Status:** Verified

### 9. Google SEO & Performance
**9a. SEO Overview — `/google`** ✅ health grid, recent Google requests. ❌ Duplicate request entries (BUG-04); mobile-only CWV (BUG-06); "not connected" banner (BUG-02). Evidence E15. Verified.

**9b. PageSpeed Insights — `/google/pagespeed`** ✅ URL list pre-filled from the audit, mobile/desktop toggles, cache option, results table with lab and real-user columns. ❌ "Latest results" shows the oldest run (BUG-03). ⚠️ Per-request limit 10 URLs; "about 10–40 s" each, with no progress indicator observed (run Not Tested). Evidence E16. Verified.

**9c. Structured Data — `/google/structured-data`** ✅ Per-page items with format, validity, Google candidate check, issue list with docs links, honest disclaimer that it isn't Google's Rich Results Test, "Open in Google Rich Results Test" links. ❌ Contradictory verdicts (BUG-12); wrong page count and empty tables (BUG-13). ⚠️ Very long page (UX-12). Evidence E18. Verified.

**9d. Search Console Performance — `/google/search-console`** ❌ Only a banner: "isn't connected … Connect Google and select the property" (BUG-02). No data possible (BUG-01). Evidence E19. Verified (blocked state).

**9e. URL Inspection — `/google/inspection`** Same banner plus "No URLs inspected yet". Inspect action Not Tested (blocked). Evidence E20.

**9f. Sitemaps — `/google/sitemaps`** Same banner only. Not Tested (blocked).

**9g. Google Connections — `/google/connections`** ✅ Clear read-only scope statement (webmasters.readonly); secrets masked as "Saved (leave blank to keep)"; redirect URI shown; per-project limits. ❌ BUG-01 (misdiagnosed error, no retry, no property selector). ⚠️ Admin credentials and per-project settings share one page; "Chrome UX Report API: Off" wording (UX-16). **Not Tested:** Disconnect, Save limits, Save credentials. Evidence E01. Verified.

**9h. SEO History & Reports — `/google/history`** ✅ First-vs-latest PSI with "normal variation" labelling (a good, honest design); structured data by audit; links to compare/report. Reveals the 12 runs per URL (BUG-04). Search Console sections are empty (blocked). Evidence E17. Verified.

### 10. Settings — `/settings`
- ✅ Password change (min 10 chars, signs out other devices), add account with role descriptions, integrations link, backup, report branding, optional AI settings with encrypted-key statement.
- ⚠️ No edit/deactivate/reset for accounts (UX-19). "Connect Google Search Console →" although connected (BUG-02). No list of existing backups.
- **Not Tested:** every save/create action.
- **Evidence:** E21 · **Status:** Verified (view)

### 11. Help — `/help`
- ✅ 7-step guide, glossary, common problems, safety statements; plain language.
- ⚠️ The duration estimate is wrong (BUG-24); no troubleshooting for the Search Console API error; step count differs from Overview (UX-14).
- **Evidence:** E22 · **Status:** Verified

### 12. Error / edge routes
- `/issues/<unknown uuid>`, `/audits/not-a-real-id` → friendly in-app "Not found" ✅.
- `/this-page-does-not-exist` → default Next.js 404, no app shell ❌ (BUG-23, E24).

---

## C. Bug Register — WebAudit Pro (browser QA, 2026-11-04)

Environment: `http://localhost:3000`, signed in as Admin (J. Pajares), Chrome + Claude in Chrome extension. Projects present: **Capital Home Mortgage** (CHM, `568a8045-…`) and **RedRiverModularHomes** (RRMH, `ce463608-…`). All testing was read-only; no records were created, changed or deleted.

Evidence files are in `evidence/` next to this report (E01–E24). Values quoted below were read directly from the rendered pages.

**Evidence labels:** Verified = reproduced/observed directly · Partially Verified = symptom observed, part of the claim inferred · Suspected = inference from indirect evidence · Not Tested.
**Root causes are hypotheses** unless stated otherwise; no source code was inspected.

### Summary table

| ID | Title | Module | Sev | Evidence |
|---|---|---|---|---|
| BUG-01 | Search Console "API disabled" error is shown as a permission problem; no retry, no property selector | Google Connections | P1 | Verified |
| BUG-02 | Search Console status contradicts itself across 6 screens | Overview, Connections, SEO pages, New Audit, Settings | P2 | Verified |
| BUG-03 | PageSpeed "Latest results" table shows the **oldest** run, not the latest | PageSpeed Insights | P1 | Verified |
| BUG-04 | 12 PageSpeed runs per URL/device in 12 minutes (120 API calls); duplicates queued at the same minute | PageSpeed / worker | P2 | Partially Verified |
| BUG-05 | Site-wide (origin) CrUX values duplicated as per-page "real-user" findings; inflates High count | Findings / PageSpeed import | P2 | Partially Verified |
| BUG-06 | "Real-user Core Web Vitals" summary is mobile-only but unlabeled; hides poor desktop CLS/INP | Audit detail, SEO Overview | P2 | Verified |
| BUG-07 | Re-Audit labels findings as "New" when the base audit never ran that check | Re-Audit | P2 | Verified |
| BUG-08 | Re-Audit fingerprints include auto-generated element IDs → false New/Resolved churn | Re-Audit / fingerprinting | P2 | Partially Verified |
| BUG-09 | Re-Audit page returns ~2.2 MB HTML with all 827 items and screenshots, no pagination | Re-Audit | P2 | Verified |
| BUG-10 | Client-side navigation requests (`?_rsc=`) return HTTP 503; app falls back to full page reloads | Whole app (routing) | P2 | Verified (symptom) |
| BUG-11 | Issue IDs are not unique across websites (CNT-0001, A11Y-0001… appear twice) | Issues | P2 | Verified |
| BUG-12 | Structured-data validator reports a property as both "missing" and "wrong type"; Article marked ineligible for "required" properties | Structured Data | P2 | Verified (contradiction) / Likely (rule) |
| BUG-13 | "Pages with structured data: 20" although 2 pages have no items; empty tables have no empty-state text | Structured Data, Audit detail | P3 | Verified |
| BUG-14 | Report category filter has no Performance / Core Web Vitals option (146 of 727 CHM findings) | Reports | P2 | Verified |
| BUG-15 | Report "Generate" buttons stay enabled when preview says the report would be empty | Reports | P3 | Verified (state); result Not Tested |
| BUG-16 | Website Health "Open" links for 3 different areas all open the same unfiltered list; 7 links named "Open" | Audit detail, SEO Overview | P3 | Verified |
| BUG-17 | Bulk action defaults to "Confirm finding" | Issues | P3 | Verified (default); Apply Not Tested |
| BUG-18 | Review panel offers "Approve/Reject recommendation" on findings that are not recommendations | Issue detail | P3 | Verified |
| BUG-19 | Evidence highlight for a broken (0×0) image is a dot in the crop corner; crop doesn't show the problem | Issue detail | P3 | Partially Verified |
| BUG-20 | Timestamps mean different things on different screens without labels | Overview, My Websites, Audit Runs | P3 | Verified (values); cause Suspected |
| BUG-21 | Cancelled-audit records are internally inconsistent and give no reason | Audit Runs, Audit detail | P3 | Verified |
| BUG-22 | Detail pages all have the generic `<title>` "WebAudit Pro" | Project/Audit/Issue detail, Not found | P3 | Verified |
| BUG-23 | Unknown routes show the unstyled default Next.js 404 (black page, no navigation) | Routing | P3 | Verified |
| BUG-24 | Help says a 20-page audit takes 5–10 min; observed 16 m 28 s | Help | P3 | Verified |
| BUG-25 | Suspicious measurement: "line-height: 0.10 (1.4px on 14px text)" | Audit engine (Typography) | P3 | Suspected |

---

### BUG-01 — Search Console "API disabled" error shown as a permission problem; no recovery path
- **Module:** Google SEO & Performance → Google Connections
- **Severity:** P1 (blocks all Search Console features: Performance, URL Inspection, Sitemaps, GSC audit options, GSC data in reports)
- **Reproduction:**
  1. Open `/google/connections?project=568a8045-37e2-4b2c-b9a6-45be10a63568` (also reproduces for `ce463608-…`).
  2. Read the "Project settings" card.
- **Expected:** The app says what actually failed and how to fix it, for example: "The Google Search Console API is turned off in your Google Cloud project. An admin needs to enable it (link), wait a few minutes, then press **Retry**." After that, a property dropdown appears.
- **Actual:** "Search Console property: none selected" followed by **"Access required: your Google account doesn't have permission for this Search Console property"**, then Google's raw error in parentheses: *Google Search Console API has not been used in project 154245030857 before or it is disabled. Enable it by visiting …*. There is no Retry/Test button, and no property selector. The only buttons on the page are Show, Save limits, Save credentials and Disconnect Google.
- **Evidence:** E01; page text captured 10:37 and again for RRMH.
- **Reproducibility:** 2/2 projects, every load.
- **User impact:** Users are told their account lacks permission, so they will try to fix property access in Search Console. The real blocker is a disabled API in Google Cloud. The Google OAuth connection works ("Connected Nov 4, 2026, 10:05 AM"), but Search Console still can't be used.
- **What is confirmed vs hypothesis:**
  - [Certain] Google returned an "API not used / disabled" error for GCP project 154245030857. The text is Google's own message, shown verbatim.
  - [Certain] The app's wording ("doesn't have permission for this property") doesn't match that error.
  - [Not Tested] Whether the Google account has access to the CHM/RRMH properties. This can't be known until the API is enabled.
  - Hypothesis: the error mapper treats every HTTP 403 from Google as "no property permission". Google uses 403 for both `PERMISSION_DENIED` and `SERVICE_DISABLED`/`accessNotConfigured`.
- **Recommended investigation:** Find the code that calls `sites.list` (Search Console API, `webmasters/v3` or `searchconsole/v1`) and the error-to-message mapping. Log the structured error (`error.status`, `error.details[].reason`) without tokens.
- **Acceptance criteria:**
  - `SERVICE_DISABLED` / `accessNotConfigured` shows an "API not enabled" message with the Cloud Console link and project number. This is admin-only text.
  - `PERMISSION_DENIED` on a property shows a separate "account lacks access to property X" message.
  - Network or token errors show a third message.
  - A **Retry / Test connection** button re-queries without a reload.
  - After a successful `sites.list`, a property dropdown lists the accessible properties matching the project domain, and the user can save a choice.
  - The raw Google message sits behind a "Technical details" disclosure.
- **Note:** Clearing the blocker itself needs the user to act in Google Cloud Console. See "Changes requiring user approval" in the handoff.

### BUG-02 — Search Console status contradicts itself across screens
- **Module:** Overview, Google Connections, SEO Overview, Search Console/URL Inspection/Sitemaps, New Audit, Settings
- **Severity:** P2
- **Reproduction / Actual (each Verified):**
  - Overview → System status: "PageSpeed: set up · **Search Console: set up**" (E02).
  - Google Connections → "Search Console OAuth: Client configured", "Your Google connection: **Connected**" (E01).
  - SEO Overview banner: "Search Console **not connected** for this website. Set up Google Connections." Health cards: "Not connected: Search Console not connected" (E15).
  - Search Console Performance: "Search Console isn't connected … **Connect Google and select the property**" (E19).
  - New Audit → Advanced → GSC checkboxes are disabled with "Search Console not connected for Capital Home Mortgage".
  - Settings → Integrations link reads "**Connect** Google Search Console →" even though the account is already connected.
- **Expected:** Every screen shows one status from the same model: *Not configured → OAuth client configured → Account connected → API error (specific) → Property not selected → Ready*. Each status links to the one next action.
- **User impact:** A user who already connected Google is told to "Connect Google" again. The Overview shows "set up" even though nothing works.
- **Hypothesis:** Each screen works out its own status from different fields (OAuth client present / token present / property id present).
- **Acceptance criteria:** One shared status helper drives all six places. With the current data, every place shows "Google account connected — Search Console API not enabled in Google Cloud (action needed)". The health-card text no longer repeats itself ("Not connected: Search Console not connected").

### BUG-03 — PageSpeed "Latest results" table shows the oldest run
- **Module:** Google SEO & Performance → PageSpeed Insights
- **Severity:** P1 (client-facing metric is wrong and contradicts other screens and, probably, reports)
- **Reproduction:**
  1. Open `/google/pagespeed?project=568a8045-…`. Read the "Latest results" row for `capitalhomemortgage.com` Mobile.
  2. Open `/google/history?project=568a8045-…` (SEO History) → "PageSpeed: first vs latest".
  3. Open `/google?project=…` (SEO Overview) → Performance card.
- **Actual:**
  - PageSpeed "Latest results": home Mobile **Perf 59, LCP 9.0 s**, analysed **10:07 AM** (E16).
  - SEO History: home Mobile **59 → 52**, LCP −2699 ms, latest **10:15 AM**; 12 runs (E17).
  - SEO Overview: Performance score (mobile) **52**, LCP (mobile, lab) **6.3 s** (E15).
  - All 10 rows in "Latest results" match the **first** column of SEO History (72, 59, 73, 82, 82, 57, 92, 55, 73, 59). None matches the latest column. The newest timestamp in the table is 10:10, while Google Connections reports "PageSpeed last success 10:19 AM".
- **Expected:** The table shows the most recent completed result per URL + device, and its numbers match SEO Overview and SEO History "latest".
- **Hypothesis:** The query picks the first row per (url, device), e.g. ascending sort or `GROUP BY` without an ordered window.
- **Recommended investigation:** Look at the data loader for the PageSpeed page. Compare it with the query SEO Overview uses (which is correct).
- **Acceptance criteria:** With current data, the home Mobile row shows 52 / 6.3 s and a 10:15 AM timestamp. A unit test with 3 runs per key returns the newest. Report exports use the same "latest" selector (regression test).

### BUG-04 — Excess / duplicate PageSpeed API runs
- **Module:** PageSpeed Insights / background worker
- **Severity:** P2 (API quota, cost, noise in history)
- **Actual:**
  - SEO History lists **12 runs** for each of 10 URL+device pairs (= 120 API requests), with latest results from 10:15–10:19 (E17).
  - SEO Overview "Recent Google requests" lists the same URL+device more than once, all queued at **10:07 AM** (e.g., `/fresh-start-home-mortgages/ (desktop)` twice in the visible 15 rows).
  - The page says results are cached for 6 hours ("Skip the 6-hour cache" option), yet repeat runs happened within minutes.
- **Evidence status:** Verified that the runs exist. **Suspected** that they were unintended: the user may have pressed Run repeatedly, or "Skip cache" may have been ticked.
- **Hypotheses:** (a) the Run button has no in-flight lock, so double submits enqueue duplicates; (b) the job enqueues one job per audit plus one per manual request; (c) a retry loop re-enqueues completed jobs; (d) the cache key includes a value that changes per request.
- **Recommended investigation:** Query the Google-request/job table: count rows per (url, strategy) on 2026-11-04 10:00–10:20, with `created_at`, trigger source, and the `skipCache` flag.
- **Acceptance criteria:** Pressing Run twice quickly creates one job per URL+device. A cached result less than 6 h old is reused unless "Skip cache" is ticked. Duplicate queued jobs for the same key are merged. A test covers double submit.

### BUG-05 — Site-wide CrUX data duplicated as per-page "real-user" findings
- **Module:** PageSpeed import → Findings (CWV-xxxx)
- **Severity:** P2 (inflates High-priority counts shown to clients; misattributes data)
- **Actual:** For the 5 pages PageSpeed was run on (home, /brian-wheeler/, /centennial-homes/, /clarksville/, /fresh-start-home-mortgages/), every real-user value is **identical**: LCP mobile 4.1 s, LCP desktop 10.5 s, CLS desktop 0.6, INP desktop 542 ms, FCP mobile 3.6 s / desktop 6.5 s, TTFB mobile 3.2 s / desktop 5.4 s (Re-Audit list + issue detail CWV-0003/0011/0019/0027). That makes 40 CWV findings, 20 of them **High**. CHM has 47 High in total.
- **Evidence status:** Identical values: Verified. That these are origin-level (whole-site) values: **[Likely]**. PageSpeed returns `originLoadingExperience` when a URL has too little traffic for URL-level data, and pages like `/brian-wheeler/` are unlikely to qualify. Issue detail says only "Real-user measurements (Chrome UX Report, 28 days)" and doesn't say URL vs origin.
- **Expected:** If PSI returns origin-level data, the app creates **one site-level finding per metric/device**, labelled "whole site (origin) data", and doesn't repeat it per page.
- **Acceptance criteria:** The import stores whether the data is URL-level or origin-level. Origin data produces at most one finding per metric+device per audit. Issue detail shows the scope. The CHM High count drops accordingly once data is re-imported (needs approval: changes client-facing counts).

### BUG-06 — Real-user CWV summary is mobile-only and unlabeled
- **Module:** Audit detail / SEO Overview → Performance card
- **Severity:** P2
- **Actual:** "Real-user Core Web Vitals: CLS good, TTFB poor, FCP poor, **INP good**, LCP poor" (E05, E15). The same audit has High findings "Poor real-user CLS on **desktop**" (0.6) and "Poor real-user INP on desktop" (542 ms).
- **Expected:** Show mobile and desktop separately, or label the card "(mobile)" and add a desktop line.
- **Acceptance criteria:** No poor desktop metric can show as "good" on a summary card.

### BUG-07 — Re-Audit treats "not measured before" as "New"
- **Module:** Re-Audit
- **Severity:** P2 (makes the site look like it regressed; misleading in client comparisons)
- **Reproduction:** `/reaudit` → Website CHM → base Nov 3 3:22 PM, comparison Nov 4 9:32 AM (defaults) → Compare.
- **Actual:** New **197**. This includes every PERF-, CWV- and SD- finding, each with BEFORE "–". SEO History shows structured data "Not available" for the 3:22 PM audit, and PageSpeed ran only on Nov 4. Totals check out: 197 + 530 = 727 latest; 530 + 60 + 40 = 630 base.
- **Expected:** A separate bucket, "Not checked in base audit", for findings whose check category/source didn't run in the base audit. These are left out of "New".
- **Acceptance criteria:** With the current data, PERF/CWV/SD findings move to the new bucket. "New" contains only categories both audits ran. A unit test covers a base audit missing a category.

### BUG-08 — Re-Audit fingerprints include auto-generated IDs
- **Module:** Re-Audit / finding fingerprinting
- **Severity:** P2
- **Actual:** "New" includes A11Y-0028…0033 (aria-controls="sm-17937559783053635-2", "-12", …), A11Y-0044…0053 and A11Y-0154…0163 ("…same id attribute: sm-17937559519296848-9" / "sm-1793756549708874-9"). `sm-<long number>-n` IDs look like run-time generated menu IDs (SmartMenus-style) that change on every page load.
- **Evidence status:** Verified that these appear as "New" with volatile IDs. **Suspected** that matching earlier findings were counted as "Resolved"/"Unable to verify". The Resolved list was not reviewed because the page output was too large (BUG-09).
- **Hypothesis:** The fingerprint ("rule + element") includes the axe failure message or a selector containing these IDs.
- **Acceptance criteria:** Fingerprints normalise volatile tokens (long numeric runs, hashed class names) before hashing. Two consecutive scans of an unchanged page produce 0 New / 0 Resolved for these rules (regression test using fixture HTML with random IDs).

### BUG-09 — Re-Audit page renders everything at once
- **Module:** Re-Audit
- **Severity:** P2 (performance)
- **Actual:** `GET /reaudit` returned **2,279,222 bytes** of HTML (measured with fetch). The page holds all 827 comparison items with before/after screenshots. The text extract was 156,612 characters. There's no pagination or lazy loading. Other pages were 16–74 KB.
- **Acceptance criteria:** The first response is under ~300 KB. Items are paginated or virtualised (e.g., 50 per page). Screenshots use lazy loading (`loading="lazy"`). The status tabs (New/Still present/…) filter on the server.

### BUG-10 — Client-side navigation requests return HTTP 503
- **Module:** Whole app (Next.js routing / server)
- **Severity:** P2 (every click becomes a full page reload; slower; a sign of server instability)
- **Reproduction:**
  1. Clear the network log, load `/` (Overview), wait 5 s.
  2. Look at the `?_rsc=` prefetch requests. **Actual:** `/projects`, `/audits/new`, `/audits`, `/issues` and `/reports` return 200. Every request after them (`/approvals`, `/reaudit`, `/google`, `/settings`, `/help`, both project pages, `/google/connections`, 7 audit pages) returns **503**. Reproduced on 2 loads.
  3. Click the sidebar link **Help**. **Actual:** `GET /help?_rsc=jbzne` → **503**. The Help page still appears, which looks like Next.js falling back to a full document load.
- **Not reproduced:** Calling the same URLs with `fetch()` (20 in parallel, with `RSC`, `Next-Router-Prefetch`, `Next-Url` and `Next-Router-State-Tree` headers) returned 200 every time. So the trigger is something specific to the browser router's requests, or to timing.
- **Root cause:** Unknown. Hypotheses: (a) middleware or a custom server/proxy returns 503 for requests with certain headers (e.g., `Sec-Purpose: prefetch`, which `fetch` can't set); (b) a concurrency limiter or DB-busy guard (e.g., SQLite lock while the worker writes) maps errors to 503; (c) build-ID / deployment mismatch between the served HTML and the running server.
- **Recommended investigation:** Check server logs at the time of a reproduction. Grep for `503` / `Service Unavailable` in `middleware.ts`, any custom server, and the DB access layer. Check whether the worker holds DB write locks. Test with `next start` vs `npm start` (web + worker).
- **Acceptance criteria:** Loading Overview produces no 5xx responses. Sidebar clicks use client-side navigation (no full document request). An e2e test asserts no 5xx during navigation of all sidebar links.

### BUG-11 — Issue IDs are not unique across websites
- **Module:** Issues (All websites view), reports/approvals by ID
- **Severity:** P2
- **Actual:** In `/issues` (Website: All), `CNT-0001` appears twice (CHM `/brian-wheeler/` "Image fails to load", and RRMH `/blog/the-complete-guide-…` "Internal link returns HTTP 404"). `A11Y-0001` to `A11Y-0014` also appear twice each (E08). The table has no Website column. The Page column shows only a path for non-home pages.
- **Expected:** IDs unique wherever they're shown together, or a Website column, plus a project prefix in exports.
- **Acceptance criteria:** No two rows in any list or report share a displayed ID. The Website column is visible in the "All" view. Search by ID returns one result per website, with the website shown.

### BUG-12 — Structured-data validator contradictions
- **Module:** Structured Data
- **Severity:** P2
- **Actual (Verified):** For the Article block on /brian-wheeler/, /greg-bailey/, /sandy-nichols/ and /social-media/, the same property is reported both as *Warning "Recommended property 'datePublished' is missing"* and as *Error "'datePublished' has the wrong type (expected an ISO 8601 date)"*. The value is `datePublished: ""` (seen in Re-Audit). The item is labelled "Article: Not eligible: missing or invalid required properties" (E18).
- **Second issue [Likely, verify against current Google docs]:** Google's Article structured-data documentation lists no required properties (only recommended ones). "Not eligible … required properties" may therefore be wrong. An empty `datePublished` is still worth flagging as an invalid value.
- **Acceptance criteria:** A property gets exactly one verdict: missing, empty or invalid type. An empty string is reported once, as "empty value". Eligibility wording follows the rules file, and the rules file cites the Google doc it encodes.

### BUG-13 — Structured-data page count and empty states
- **Severity:** P3
- **Actual:** The audit summary says "Pages with structured data **20**". On the Structured Data page, `/texas-fha-pre-qualification/` and `/texas-fha-tru-approval/` show table headers with **no rows** and no message.
- **Acceptance criteria:** The count includes only pages with at least one item. A page with no items shows "No structured data found on this page", or is hidden behind a filter.

### BUG-14 — Report category filter is missing Performance / Core Web Vitals
- **Module:** Reports
- **Severity:** P2
- **Actual:** The Category options are Layout, Spacing, Typography, Buttons & tap targets, Accessibility, SEO & metadata, Content & links, Navigation, Component consistency, Structured data. There is no **Performance** (106 CHM findings) and no **Core Web Vitals** (40). "Technical SEO" on the audit page is called "SEO & metadata" here.
- **Acceptance criteria:** Report categories match the categories in the audit's "By category" list. A Performance-only report can be previewed, and its count is 146 for the current CHM audit.

### BUG-15 — Generate buttons enabled for an empty report
- **Severity:** P3
- **Reproduction:** `/reports` → tick "Only internally reviewed findings" → Update preview.
- **Actual:** The preview says "No findings match these options, so the report would be empty…". All four Generate buttons still have `disabled=false` (E12). Generating was **Not Tested** (it would create records).
- **Acceptance criteria:** When the preview count is 0, the Generate buttons are disabled and explain why. The server also rejects empty generation.

### BUG-16 — Website Health "Open" links aren't specific
- **Severity:** P3
- **Actual:** On `/audits/57226d00-…`, the "Open" links for Design & Responsive, Accessibility and Technical SEO all point to `/issues?run=57226d00-…` with no category filter. Both Search Console cards point to Connections. The page has seven links all named "Open" (WCAG 2.4.4 link purpose).
- **Acceptance criteria:** Each link applies the matching category filter. Each has an accessible name such as "Open Accessibility findings (184)".

### BUG-17 — Bulk action defaults to "Confirm finding"
- **Severity:** P3
- **Actual:** On `/issues`, the "With selected" dropdown starts at "Confirm finding" (E08). Pressing Apply after selecting rows would confirm them with no deliberate choice. Apply was not pressed.
- **Acceptance criteria:** Default is a placeholder ("Choose an action…"). Apply is disabled until an action and at least one row are chosen. Bulk actions on more than 10 rows show a confirmation with the count.

### BUG-18 — Review actions don't match the finding's class
- **Severity:** P3
- **Actual:** CNT-0001 (class **Confirmed**, "Image fails to load") offers Confirm finding, Mark false positive, **Approve recommendation**, Request revision, **Reject recommendation**, Add note only (E23). CWV-0011 (Confirmed) shows the same set.
- **Acceptance criteria:** Confirmed / Needs review → Confirm, False positive, Note. Recommendation → Approve, Request revision, Reject, Note. Or the actions are explained if they're intentionally shared.

### BUG-19 — Evidence highlight for zero-size elements
- **Severity:** P3 · **Partially Verified** (visual only)
- **Actual:** In CNT-0001 "Image fails to load" (/brian-wheeler/), the "Highlighted crop" shows the page header and hero. The red outline is a tiny mark in the crop's top-left corner (E23), so the broken image itself isn't identifiable.
- **Acceptance criteria:** For elements with a bounding box under 4×4 px, the crop centres on the nearest visible ancestor and adds a caption ("element has no visible size — outlined parent").

### BUG-20 — Timestamps mean different things without labels
- **Severity:** P3
- **Actual:** CHM latest audit: My Websites "Last run Nov 4, **9:32 AM**" (start). Overview "Last audit Nov 4, **9:48 AM**" (finish). Audit duration was 16 m 28 s. Overview "Recent activity" shows three CHM cancellations all at **3:39 PM**. Yet the audit started 3:27 PM shows elapsed 0 m 22 s (ended about 3:27). Only the 3:33 PM one (6 m 21 s) plausibly ended at 3:39. The 3:29 PM run's detail page was not opened.
- **Hypothesis:** Recent activity uses `updated_at`, which a later batch update touched, instead of `finished_at`.
- **Acceptance criteria:** Each timestamp is labelled (Started / Finished / Cancelled). Recent activity uses the event's own time.

### BUG-21 — Cancelled-audit records are inconsistent
- **Severity:** P3
- **Actual:** Audit `56531528-…` (cancelled): Pages completed **0** but Raw findings **109**, with the note "Pages scanned so far were not imported". Audit `c4bb683b-…`: elapsed 6 m 21 s, 0 pages discovered, **no cancellation message**. Audit Runs shows Pages "0" for two cancelled runs and "0/20" for the third (E06).
- **Acceptance criteria:** Raw findings for a cancelled run show "109 (not imported)" or 0. Every cancelled run shows who/why/when. The Pages column uses one format.

### BUG-22 — Generic page titles on detail pages
- **Severity:** P3 (WCAG 2.4.2; tabs and history are hard to tell apart)
- **Actual:** The `<title>` is "WebAudit Pro" on `/projects/<id>`, `/audits/<id>`, `/issues/<id>` and the in-app Not found page. List pages have specific titles.
- **Acceptance criteria:** Titles like "CWV-0011 · Capital Home Mortgage · WebAudit Pro", "Audit Nov 4 9:32 AM · Capital Home Mortgage · WebAudit Pro", "Not found · WebAudit Pro".

### BUG-23 — Unstyled default 404 for unknown routes
- **Severity:** P3
- **Actual:** `/this-page-does-not-exist` shows the default Next.js black "404 | This page could not be found." page with no app navigation (E24). In-app missing records (`/issues/<bad id>`, `/audits/not-a-real-id`) correctly show a friendly "Not found" with "Back to overview".
- **Acceptance criteria:** A root `not-found` page uses the app shell and offers Overview/Help links.

### BUG-24 — Help understates audit duration
- **Severity:** P3
- **Actual:** Help step 3 says "A 20-page audit usually takes 5–10 minutes". The latest CHM 20-page audit (5 viewports, 1000 ms delay) took **16 m 28 s**. RRMH's 80-page audit took 54 m 33 s.
- **Acceptance criteria:** Help states a formula or range based on observed data (pages × viewports × delay). New Audit shows an estimate before Start.

### BUG-25 — Suspicious line-height measurement
- **Severity:** P3 · **Suspected**
- **Actual:** TYP-0019 "Body text lines are cramped", /janice-stowers-mortgage-team/: "line-height: 0.10 (1.4px on 14px text)", in both base and latest audits. Text with a 1.4 px line-height would overlap almost completely, so this is more likely a measurement or parsing error (e.g., `line-height` given as a percentage, or `normal`) than a real site defect.
- **Recommended investigation:** Open the page at the reported viewport and read the element's computed `line-height`. Check how the engine converts `%` / unitless / `normal` values.
- **Acceptance criteria:** Unitless, `%`, `px` and `normal` line-heights convert correctly (unit tests). This finding either reproduces with a real computed value or disappears.

---

## D. UX/UI Improvement Register — WebAudit Pro (browser QA, 2026-11-04)

Priority: **High** = blocks or misleads a beginner on the main flow · **Medium** = adds noticeable friction · **Low** = polish.
Every item below comes from something observed in the app (evidence refs E01–E24 in `evidence/`). "Proposed solution" is a recommendation, not an observed behaviour.

| ID | Page | Priority | Problem (short) |
|---|---|---|---|
| UX-01 | Google Connections | High | No guided setup / no way to retry; raw Google error is the only guidance |
| UX-02 | Issues, Issue detail | High | Four status words at once ("Confirmed" + "Unverified" + "Pending" + "To do") confuse beginners |
| UX-03 | Issues | High | 727–1477 findings, no review queue; reviewing everything before a client approval isn't realistic |
| UX-04 | Issues | Medium | All-websites view has no Website column; no "Recommendations" quick filter; chips show no counts |
| UX-05 | Issues | Medium | Near-identical findings are listed separately (e.g., 6 contrast findings with the same colours) |
| UX-06 | Reports | Medium | Preview needs a manual "Update preview" click; defaults include all unreviewed findings |
| UX-07 | Client Approvals | High | Blocked state gives no count or filtered link; client view can't be previewed |
| UX-08 | Re-Audit | High | 827 items on one page; "New" mixes real regressions with checks that never ran |
| UX-09 | Audit Runs | Medium | No filter, sort, search or pagination; cancelled runs show no reason |
| UX-10 | Google pages, Approvals, Connections | Low | Extra "Show"/"Select" click needed after choosing a website |
| UX-11 | Audit detail, SEO Overview | Medium | Health "Open" links are generic and unfiltered |
| UX-12 | Structured Data | Medium | Very long page with no summary, filter or collapse |
| UX-13 | Overview, My Websites, Audit Runs | Low | Unlabelled timestamps (start vs finish) |
| UX-14 | Overview, Help | Medium | Onboarding is 5 steps on Overview, 7 in Help; Help has no Search Console API troubleshooting |
| UX-15 | Global | Low | Default 404 page and generic detail-page titles |
| UX-16 | Google Connections | Low | "Chrome UX Report API: Off" while real-user CrUX data is shown (via PageSpeed) |
| UX-17 | New Audit | Medium | No time estimate before Start; Google options hidden under Advanced |
| UX-18 | Issue detail (CWV) | Medium | Real-user metrics don't say whether they're page-level or whole-site |
| UX-19 | Settings | Medium | Team accounts can be added but not edited, deactivated or reset |
| UX-20 | Issues (bulk), Issue detail | Medium | Risky defaults and class-irrelevant buttons (see BUG-17/18) |

---

#### UX-01 — Guided Search Console setup with live checks
- **Page:** `/google/connections`
- **Problem:** The page mixes admin credentials, a per-project selector, limits and an error banner. The only guidance for the real blocker is Google's raw English error inside a permission message (E01). There's no Retry.
- **Solution:** A 5-step checklist card with live status ticks: ① Google Cloud credentials saved → ② Google account connected → ③ Search Console API enabled (checked by a test call) → ④ Account can see a property matching *capitalhomemortgage.com* → ⑤ Property selected. Each failed step gets one plain sentence and one button (e.g., "Open Google Cloud Console", "Retry check"). Raw errors go under "Technical details".
- **Benefit:** A non-technical admin can fix the integration without reading API errors.
- **Acceptance criteria:** With the current state, steps ①② show done, ③ shows "Not enabled", and the Retry button works without a page reload. Keyboard and screen-reader accessible (status announced via `role="status"`).

#### UX-02 — Simplify status vocabulary
- **Pages:** `/issues`, `/issues/<id>`
- **Problem:** One row shows class **Confirmed**, Verification **Unverified**, Review **Pending**, Implementation **To do** (E08, E09). "Confirmed but unverified" reads as a contradiction to a client or PM.
- **Solution:** Rename class "Confirmed" to **"Measured"** (Help already defines it as "measured"). Merge Verification + Review into one **Review status**: Not reviewed / Accepted / False positive / Sent to client / Client approved / Client rejected. Keep Implementation separate.
- **Acceptance criteria:** No screen shows two words that read as opposites for the same finding. The Help glossary matches the UI labels exactly.

#### UX-03 — A review queue mode
- **Page:** `/issues`
- **Problem:** CHM's latest audit has 727 findings (336 High across both sites). Client approval only accepts reviewed findings ("No findings in this audit are ready to release", E13). Reviewing them one detail page at a time isn't practical.
- **Solution:** A "Review queue" view: one finding at a time with evidence, keyboard shortcuts (C = confirm, F = false positive, N = next), "apply to all findings with this rule on this site", and progress (e.g., "34 / 336 high-priority reviewed").
- **Acceptance criteria:** A reviewer can work through 20 findings without opening a new page. Progress persists. Overview onboarding step 3 shows progress.

#### UX-04 — Issues list: website column, counts, missing filter
- **Problem:** IDs repeat across websites (BUG-11). Rows for non-home pages show only a path. There's no quick filter for Recommendations (548 of 1477 rows). Chips don't show counts. Counts seen: High 336, Mobile 996, Desktop 896, Accessibility 657, SEO 124, Layout 83, Confirmed 533, Needs review 396, Awaiting client 0.
- **Solution:** Add a Website column when Website = All. Show counts on chips. Add a "Recommendations" chip. Make the "Awaiting client" empty state explain how items get there.
- **Acceptance criteria:** Chip counts match the "Showing x of N" total after clicking.

#### UX-05 — Merge near-identical findings
- **Problem:** A11Y-0001…0006 (CHM) all report contrast 3.47 (#858585 on #f8f8f8, 12 px bold) across the same 13 pages, as six separate High findings. The same happens with A11Y-0011…0020 (#fff on #00a6e2).
- **Solution:** Group by rule + failure signature (colours/size) as well as by element. Show "6 elements" inside one finding.
- **Acceptance criteria:** The fix is one action for the developer, and the High count reflects distinct problems.

#### UX-06 — Reports: live preview and safer defaults
- **Page:** `/reports`
- **Problem:** The preview updates only after pressing "Update preview". The default includes all 727 unreviewed findings, while the PDF tip says "include reviewed findings only". Generate stays enabled for empty output (BUG-15). Performance/CWV categories are missing (BUG-14).
- **Solution:** Auto-update the preview when an option changes. Make "Only reviewed" the default for the **Client PDF**, with a visible warning when unreviewed findings are included. Disable Generate at 0. Add "Your reports" status with a spinner and errors.
- **Acceptance criteria:** Changing any filter updates the count within 1 s, without a button. A Client PDF can't include unreviewed findings without an explicit tick.

#### UX-07 — Client Approvals: explain and preview
- **Page:** `/approvals`
- **Problem:** The only message is "No findings in this audit are ready to release. Confirm findings or approve recommendations in Issues first." The "Issues" link opens the whole audit, not a review filter. There's no preview of what the client will see.
- **Solution:** Show "0 of 727 findings are ready. 336 high-priority findings need review →" linking to the review queue (UX-03), plus a "Preview client page" button once a package exists.
- **Acceptance criteria:** The link opens Issues filtered to the audit and to unreviewed status.

#### UX-08 — Re-Audit: paginate and separate "not measured before"
- **Page:** `/reaudit`
- **Problem:** A 2.2 MB page (BUG-09). "New (197)" is mostly checks the base audit never ran (BUG-07). The base and comparison dropdowns both offer the same audit (Nov 4 9:32 can be chosen for both).
- **Solution:** Server-side tabs with 50 items per page. Collapse screenshots by default. Add a "Not checked before" tab. Stop the same audit being picked on both sides. Add a summary sentence ("40 fixed, 530 still present, 0 real regressions").
- **Acceptance criteria:** The page loads in under 1.5 s locally. Choosing the same audit twice is impossible or warned.

#### UX-09 — Audit Runs: filter, sort, explain
- **Page:** `/audits`
- **Problem:** A plain table (E06) with no filters, sorting or paging. Cancelled runs give no reason. Pages format differs ("0" vs "0/20").
- **Solution:** Website/status filters, sortable columns, pagination, a "Cancelled by J. Pajares at 3:39 PM" tooltip, an elapsed-time column.
- **Acceptance criteria:** Filters persist in the URL.

#### UX-10 — Remove the extra "Show"/"Select" click
- **Pages:** all Google subpages, `/google/connections`, `/approvals`
- **Problem:** Changing the Website dropdown does nothing until you press "Show" (or "Select" on Approvals).
- **Solution:** Apply on change (keep a submit button inside `<noscript>`/progressive enhancement).
- **Acceptance criteria:** Selecting a website updates the page and the URL `?project=` in one action.

#### UX-11 — Specific health-card links
- See BUG-16. Each card links to its own filtered list, and the link text names the area and count.

#### UX-12 — Structured Data page structure
- **Problem:** Every page's full item table is expanded. Organization warnings (8 per page) repeat on about 16 pages (E18).
- **Solution:** A summary table at the top (type × pages × errors/warnings), a "Show errors only" filter, collapsed page sections, and a "same issue on N pages" grouping.
- **Acceptance criteria:** Errors (4) are reachable in one click from the top.

#### UX-13 — Label timestamps
- See BUG-20. Use "Started 9:32 AM · Finished 9:48 AM (16 m)" everywhere.

#### UX-14 — Consistent onboarding and troubleshooting
- **Problem:** The Overview guide has 5 steps (E02); Help has 7 (E22). Help troubleshooting covers "Google data says 'not configured'", but the app actually shows "not connected" / "Access required …", and there's no entry for "Search Console API not enabled". Help's duration estimate is wrong (BUG-24).
- **Solution:** One step list shared by Overview and Help. Add troubleshooting entries using the exact on-screen messages.
- **Acceptance criteria:** Every error string a user can see in Google pages has a matching Help entry.

#### UX-15 — Branded 404 and descriptive titles
- See BUG-22 and BUG-23.

#### UX-16 — Clarify CrUX vs PageSpeed real-user data
- **Problem:** Connections shows "Chrome UX Report API: Off (optional)" (E01). Findings and PageSpeed tables still show real-user ("REAL USERS: poor") data that comes through PageSpeed.
- **Solution:** Change the label to "Chrome UX Report API (extra history): Off — basic real-user data still comes from PageSpeed".

#### UX-17 — Time estimate and visible Google options on New Audit
- **Problem:** The summary line says "…no Google checks", but Google options are only inside Advanced settings, and there's no duration estimate before Start.
- **Solution:** Show "Estimated time: ~16 min for 20 pages × 5 screen sizes" and a visible "Add PageSpeed (5 pages, ~10 API calls)" toggle.

#### UX-18 — Scope label on real-user metrics
- See BUG-05. Show "Whole-site data (Google didn't have enough visits for this page)" when applicable.

#### UX-19 — Team account management
- **Page:** `/settings`
- **Problem:** "Team accounts" lists users and has "Add an account", but there are no visible controls to change a role, deactivate an account or reset a password (E21).
- **Solution:** Edit role, deactivate/reactivate, send a reset/temporary password, and show last sign-in.
- **Acceptance criteria:** An admin can remove a departed user's access without database access.

#### UX-20 — Safer review controls
- See BUG-17 (bulk default) and BUG-18 (class-irrelevant buttons). Also add confirmation and undo for bulk actions.

---

## E. Missing Features and Product Gaps

### Essential (fix before relying on the product with clients)
| Gap | Type | Evidence |
|---|---|---|
| Search Console property selection is unreachable; no Retry/Test connection | Incomplete Google integration | BUG-01, E01 |
| One shared integration status model | Inconsistent | BUG-02 |
| Review at scale (queue, group actions, progress) | Missing; blocks approvals in practice | UX-03, E13 |
| Re-Audit pagination and a "not checked before" bucket | Partially implemented | BUG-07, BUG-09 |
| Unique finding IDs across websites | Defect in core data model | BUG-11 |
| Report category parity (Performance, CWV) and empty-report guard | Reporting gap | BUG-14, BUG-15 |
| Team account edit / deactivate / reset password | Missing security/account workflow | UX-19, E21 |
| PageSpeed job de-duplication / cache enforcement | Reliability / quota | BUG-04 |

### Partially implemented / exists but confusing
- **Search Console Performance, URL Inspection, Sitemaps:** pages and copy exist; no data can be fetched (blocked).
- **Real-user (CrUX) data:** shown, but scope (page vs site) isn't identified; the CrUX API toggle is Off.
- **Client approvals:** UI exists; can't be used until findings are reviewed, and there's no preview of the client page.
- **Health cards:** "Open" links aren't specific.
- **Audit Runs:** history only; no filtering or reasons.
- **Onboarding:** 5 vs 7 steps; Help troubleshooting doesn't match on-screen messages.

### Features with no clear next action
- Overview "Needs your review: 396" has no direct link to a review queue (tile link not verified).
- Approvals blocked message → generic Issues link.
- Search Console banners → "Connect Google" (already connected).

### Optional future enhancements (not required for MVP)
Duration estimate before audits · scheduled re-audits · email/Slack notification when an audit or report finishes · audit log export · 2FA · client-view preview · trend charts per metric · CSV import of URL lists.

---

## F. Security and Performance Observations

### Security (passive observation only; no intrusive testing)
| Observation | Status | Assessment |
|---|---|---|
| `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, no `X-Powered-By`, `Cache-Control: private, no-cache, no-store` on authenticated pages | Verified (on `/issues`) | Good baseline |
| No `Content-Security-Policy` header | Verified | P3. Add a CSP (needs approval; may affect inline scripts) |
| No HSTS | Verified | Expected on `http://localhost`. Required on any HTTPS deployment |
| Secrets fields masked ("Saved (leave blank to keep)"); OAuth client ID shown in plain text | Verified | Client IDs aren't secret by design. Acceptable |
| Raw Google error exposes the GCP project number in the UI | Verified | Low sensitivity. Show it only to admins, inside "Technical details" |
| Malformed `Next-Router-State-Tree` header → generic HTTP 500 page (no stack trace) | Verified | Framework behaviour. Low risk. Note for log noise |
| "Encrypted (AES-256-GCM)" storage of API keys | Not Tested (claim only) | Verify in code review |
| Role-based access (PM/QA/Developer/Client), project membership isolation | Not Tested | Needs test accounts (would create records) |
| Client approval link token entropy, expiry, revocation | Not Tested | No packages exist |
| Login rate limiting, session timeout, CSRF on server actions | Not Tested | Next.js Server Actions include an origin check by default [Likely] |
| Backups written to `data/backups` | Not Tested | Confirm the folder is outside any static/public path and is git-ignored |

### Performance
| Observation | Status |
|---|---|
| `/reaudit` HTML 2,279,222 bytes; other pages 16–74 KB (e.g., `/audits/<id>` 73.5 KB, `/issues/<id>` 48 KB) | Verified |
| `?_rsc=` navigation requests return 503 → full reloads | Verified symptom |
| 120 PageSpeed API calls in about 12 min for 10 URL+device pairs | Verified (count) |
| Audit durations: CHM 20 pages × 5 viewports, 1000 ms delay = 16 m 28 s; RRMH 80 pages = 54 m 33 s (21,719 raw findings) | Verified |
| 20 parallel same-origin page fetches completed in under 0.7 s (server responsive under light load) | Verified |

---

## G. Agile Backlog

Complexity: S (≤ 0.5 day) · M (1–2 days) · L (3–5 days) · XL (> 1 week). [Guessing] estimates without code access.

| ID | Task | Pri | User impact | Evidence | Recommended solution | Depends on | Acceptance criteria | Cx | Sprint |
|---|---|---|---|---|---|---|---|---|---|
| WA-01 | Fix PSI "Latest results" selection | P1 | Wrong scores shown | BUG-03, E16/E17 | Latest-per-key query shared with Overview | — | Home mobile row = 52 / 6.3 s | S | 1 |
| WA-02 | Classify Google API errors; Retry/Test; property dropdown | P1 | Search Console unusable, misdiagnosed | BUG-01, E01 | Map `SERVICE_DISABLED`/`PERMISSION_DENIED`/auth/network; retry action | User enables API to verify end to end | Specific message + working Retry; dropdown after success | M | 1 |
| WA-03 | Unified integration status helper | P2 | Contradictory guidance | BUG-02 | Single state machine used by 6 screens | WA-02 | Same status everywhere | M | 1 |
| WA-04 | Investigate/fix 503 on RSC navigation | P2 | Slow nav, instability signal | BUG-10 | Server logs, middleware, DB lock handling | — | 0 × 5xx in e2e nav | M–L | 1 |
| WA-05 | De-duplicate PSI jobs; enforce cache | P2 | API quota, noisy history | BUG-04, E17 | In-flight lock, unique job key, cache check | — | Double submit → 1 job | M | 2 |
| WA-06 | CrUX scope (URL vs origin) + single site-level findings | P2 | Inflated High count | BUG-05 | Store scope; dedupe | Approval (counts change) | ≤ 1 finding per origin metric/device | M | 2 |
| WA-07 | Per-device real-user summary | P2 | Hides poor desktop CWV | BUG-06 | Split mobile/desktop | WA-06 | No poor metric shown as good | S | 2 |
| WA-08 | Unique display IDs / website column | P2 | Ambiguous references | BUG-11 | Project prefix or global sequence | Approval (migration) | No duplicate IDs in any list | M | 2 |
| WA-09 | SD validator single verdict; Article eligibility rule review | P2 | Contradictory advice | BUG-12 | One verdict per property; check rules vs Google docs | — | `""` → one "empty value" finding | S–M | 2 |
| WA-10 | SD page count + empty states | P3 | Misleading count | BUG-13 | Count pages with ≥ 1 item | — | Count = 18 for current CHM audit (if 2 pages have none) | S | 2 |
| WA-11 | Cancelled-run consistency + reasons; timestamp labels | P3 | Confusing history | BUG-20/21 | Store/display finished_at, cancelled_by | — | Labels everywhere; reason shown | S | 2 |
| WA-12 | Verify line-height measurement | P3 | Possible false positives | BUG-25 | Unit-test conversions | — | Real computed value or finding removed | S | 2 |
| WA-13 | Status vocabulary redesign | High | Beginner confusion | UX-02 | Measured / Review status / Implementation | Approval (wording) | No contradictory pairs | M | 3 |
| WA-14 | Review queue mode | High | Approvals impractical | UX-03 | Queue with shortcuts and group actions | WA-13 | 20 reviews without page loads | L | 3 |
| WA-15 | Approvals guidance + client preview | High | Dead end | UX-07 | Count + filtered link + preview | WA-14 | Link opens unreviewed filter | S–M | 3 |
| WA-16 | Issues list: website column, chip counts, Recommendations chip, merge near-duplicates | Med | Triage friction | UX-04/05 | As described | WA-08 | Counts match | M | 3 |
| WA-17 | Reports live preview, safe Client-PDF default, disable empty | Med | Wrong/empty reports | UX-06, BUG-15 | As described | — | Generate disabled at 0 | S | 3 |
| WA-18 | Bulk default placeholder + confirm; class-specific review buttons | Med | Accidental mass changes | BUG-17/18 | As described | — | Apply disabled until chosen | S | 3 |
| WA-19 | Audit Runs filters/sort/pagination | Med | History hard to use | UX-09 | Server-side filters | — | Filters in URL | S–M | 3 |
| WA-20 | Auto-apply website selectors; specific health links | Low | Extra clicks | UX-10/11, BUG-16 | As described | — | One action per change | S | 3 |
| WA-21 | Titles, branded 404, zero-size highlight | Low | Polish, a11y | BUG-19/22/23 | As described | — | Titles per page | S | 3 |
| WA-22 | Re-Audit "not checked before" bucket | P2 | False regressions | BUG-07 | Per-audit category/source record | Stored audit options | New excludes unmeasured | M | 4 |
| WA-23 | Fingerprint normalisation | P2 | False New/Resolved | BUG-08 | Strip volatile IDs | Approval (history) | Unchanged page → 0 churn | M | 4 |
| WA-24 | Re-Audit pagination + lazy images | P2 | 2.2 MB page | BUG-09 | Server tabs, 50/page | — | < 300 KB first response | M | 4 |
| WA-25 | Report categories incl. Performance/CWV | P2 | Can't make perf report | BUG-14 | Derive from audit categories | — | Perf report previewable (146) | S | 4 |
| WA-26 | Guided Search Console setup checklist | High | Self-service setup | UX-01 | Live checklist | WA-02/03 | Each step has status + action | M | 4 |
| WA-27 | Verify GSC Performance / Inspection / Sitemaps + Google data in reports | P1 once unblocked | Feature completeness | BUG-01 | E2E with a real property | User enables API; property access | Data visible and in reports | M | 4 |
| WA-28 | SD page summary/filter; CrUX labelling copy | Med | Readability | UX-12/16/18 | As described | WA-06 | Errors reachable in 1 click | S–M | 4 |
| WA-29 | CSP header | P3 | Defence in depth | §F | Report-only first, then enforce | Approval | No CSP violations in e2e | M | 5 |
| WA-30 | Role/permission + approval-link security tests | P2 | Unverified access control | §F | Automated tests with seeded test users | Isolated test DB | All roles behave per Settings descriptions | L | 5 |
| WA-31 | Account management (edit/deactivate/reset) | Med | Offboarding risk | UX-19 | Admin actions + audit log | — | Deactivated user can't sign in | M | 5 |
| WA-32 | E2E regression suite + docs fixes | P2 | Release confidence | §I.9, BUG-24, UX-14 | Playwright suite in CI | Isolated env | Suite green; Help matches UI | L | 5 |

---

## H. Recommended Development Order

**Sprint 1 — Critical bugs and blocked workflows:** WA-01 (PSI latest), WA-02 (Google error classification + retry + property selector), WA-03 (status model), WA-04 (503 investigation). *In parallel, user action: enable the Search Console API in Google Cloud project 154245030857 and confirm the account's property access.*

**Sprint 2 — Reliability and functional correctness:** WA-05 (PSI dedupe), WA-06/07 (CrUX scope and per-device summary), WA-08 (unique IDs), WA-09/10 (SD validator), WA-11 (run history), WA-12 (line-height check).

**Sprint 3 — User-friendly UX/UI:** WA-13 (vocabulary) → WA-14 (review queue) → WA-15 (approvals guidance) → WA-16/17/18/19/20/21.

**Sprint 4 — Google SEO and reporting:** WA-22/23/24 (Re-Audit), WA-25 (report categories), WA-26 (guided setup), WA-27 (end-to-end Search Console + Google data in reports, once unblocked), WA-28.

**Sprint 5 — Security, testing, release readiness:** WA-29 (CSP), WA-30 (role and link security tests), WA-31 (account management), WA-32 (e2e suite, docs).

Rationale: Sprint 1 fixes things that show wrong numbers or block a whole module. Sprint 2 fixes data correctness, so the UX work in Sprint 3 isn't built on inflated or duplicated data. Re-Audit work sits in Sprint 4 because BUG-07 depends on per-audit metadata and BUG-08 needs approval to change history.

---

## I. CLAUDE CLI IMPLEMENTATION HANDOFF

Source: read-only browser QA of WebAudit Pro at `http://localhost:3000`, 2026-11-04 (Asia/Singapore), Admin account. Full detail: `WEBAUDIT_BUG_REGISTER.md` (BUG-xx) and `WEBAUDIT_UX_IMPROVEMENTS.md` (UX-xx). Screenshots: `evidence/E01–E24`.

**Ground rules for the implementing session**
- No source code was read during the audit. Every "code area" below is a **[Guessing]** pointer based on route names and observed framework signals. Confirm with `grep` before editing.
- Observed stack signals: Next.js App Router with an `(app)` route group (`/_next/static/chunks/app/(app)/layout-*.js`), Server Actions (`$ACTION_ID_*` hidden inputs), Tailwind v4-style CSS (breakpoints 40/48/64/80/96rem), a separate background "worker" (sidebar "Worker online"), `npm start` runs web + worker (Help page), backups in `data/backups` (Settings). The database engine isn't known: "consistent copy … safe while audits run" suggests SQLite [Guessing].
- Don't change client-facing counts, re-fingerprint history, or delete data without the approvals listed in §11.

---

### 1. Confirmed reproducible bugs

| ID | Sev | Title | Status |
|---|---|---|---|
| BUG-01 | P1 | Search Console `SERVICE_DISABLED` shown as "no permission"; no retry / property selector | Verified |
| BUG-03 | P1 | PageSpeed "Latest results" shows oldest run | Verified |
| BUG-02 | P2 | Search Console status inconsistent across 6 screens | Verified |
| BUG-05 | P2 | Origin-level CrUX duplicated per page (identical values on 5 pages) | Verified values / Likely cause |
| BUG-06 | P2 | Real-user CWV summary is mobile-only, unlabelled | Verified |
| BUG-07 | P2 | Re-Audit "New" includes checks the base audit never ran | Verified |
| BUG-09 | P2 | `/reaudit` HTML = 2,279,222 bytes, no pagination | Verified |
| BUG-10 | P2 | Browser `?_rsc=` navigation requests return 503 | Verified symptom, cause unknown |
| BUG-11 | P2 | Display IDs collide across websites | Verified |
| BUG-12 | P2 | SD validator: "missing" + "wrong type" for the same empty property | Verified |
| BUG-14 | P2 | Reports: no Performance / CWV category filter | Verified |
| BUG-13, 15, 16, 17, 18, 20, 21, 22, 23, 24 | P3 | See register | Verified |
| BUG-04 | P2 | 12 PSI runs per URL/device (120 calls) | Partially Verified (unintended-ness Suspected) |
| BUG-08 | P2 | Volatile `sm-<n>-<i>` IDs in fingerprints | Partially Verified |
| BUG-19 | P3 | Highlight crop for zero-size element | Partially Verified |
| BUG-25 | P3 | line-height 0.10 measurement | Suspected |

### 2. Prioritised fixes (do in this order)
1. **BUG-03** (small, high value): fix the "latest per url+device" query on the PageSpeed page. Reuse whatever SEO Overview uses, since it shows the correct latest value (52 / 6.3 s).
2. **BUG-01 + BUG-02**: Google error classification, one shared Search Console status model, Retry/Test button, property dropdown.
3. **BUG-10**: find the source of the 503s on RSC navigation. It may mean server instability that affects everything else.
4. **BUG-04**: dedupe / lock PageSpeed job enqueueing; respect the 6 h cache.
5. **BUG-05 + BUG-06**: store CrUX scope (url vs origin); one site-level finding for origin data; per-device summary.
6. **BUG-07 + BUG-08 + BUG-09**: Re-Audit "not checked before" bucket, fingerprint normalisation, pagination.
7. **BUG-11**: unique display IDs, or a website column/prefix.
8. **BUG-12, 13, 14, 15**: validator and report correctness.
9. P3 polish: BUG-16–25.

### 3. Missing or incomplete features
- **Essential:** Search Console property selection flow (not reachable today: BUG-01), Retry/Test connection, team account edit/deactivate/reset (UX-19), empty-report guard (BUG-15), Re-Audit pagination (BUG-09), Audit Runs filtering/pagination (UX-09), Performance/CWV report categories (BUG-14).
- **Partially implemented:** Search Console Performance / URL Inspection / Sitemaps (pages exist, no data possible until BUG-01 is resolved); CrUX API option (Off); client approval flow (exists, but blocked by the review requirement; end-to-end untested).
- **Optional / future:** review queue mode (UX-03), client-view preview (UX-07), audit duration estimate (UX-17), CSP header, 2FA, scheduled audits.

### 4. UX/UI improvements (implement after the P1/P2 bugs)
High: UX-01, UX-02, UX-03, UX-07, UX-08. Medium: UX-04, 05, 06, 09, 11, 12, 14, 17, 18, 19, 20. Low: UX-10, 13, 15, 16. Detail and acceptance criteria are in `WEBAUDIT_UX_IMPROVEMENTS.md`.

### 5. Affected pages and reproduction steps (condensed)

| Bug | URL | Steps | Observable failure |
|---|---|---|---|
| BUG-01 | `/google/connections?project=568a8045-37e2-4b2c-b9a6-45be10a63568` | Load page | "Access required: your Google account doesn't have permission…" + raw "API has not been used in project 154245030857 … or it is disabled"; no Retry, no property list |
| BUG-02 | `/`, `/google`, `/google/search-console`, `/audits/new` (Advanced), `/settings` | Compare status text | "set up" / "Connected" / "not connected" / "Connect Google" for the same state |
| BUG-03 | `/google/pagespeed?project=568a…` vs `/google/history?project=568a…` vs `/google?project=568a…` | Compare home Mobile row | 59 / 9.0 s / 10:07 vs latest 52 / 6.3 s / 10:15 |
| BUG-04 | `/google/history?project=568a…`; `/google` "Recent Google requests" | Read Runs column / list | Runs = 12 per row; duplicate entries at 10:07 |
| BUG-05 | `/issues/2e172bd5-…`, `/issues/4e95d616-…`, `/issues/ade8a9af-…`, `/issues/73363280-…` | Read "Current" value | All "4.1 s p75 (poor, LCP)" |
| BUG-06 | `/audits/57226d00-02e2-4b57-a54a-62105de0619a` | Performance card | "INP good, CLS good" while desktop INP 542 ms / CLS 0.6 are High findings |
| BUG-07/08/09 | `/reaudit` (CHM, base 3:22 PM, after 9:32 AM) | Compare | New 197 incl. all PERF/CWV/SD; `sm-…` IDs; 2.2 MB HTML |
| BUG-10 | `/` then click sidebar "Help" | DevTools Network | `?_rsc=` requests → 503 (15/20 prefetches; click nav) |
| BUG-11 | `/issues` (Website: All) | Read ID column | CNT-0001 ×2, A11Y-0001…0014 ×2 |
| BUG-12 | `/google/structured-data?project=568a…` | /brian-wheeler/ Article | Warning "datePublished missing" + Error "wrong type" |
| BUG-13 | same | /texas-fha-pre-qualification/, /texas-fha-tru-approval/ | Empty tables; summary says 20 pages with SD |
| BUG-14 | `/reports` | Category dropdown | No Performance / Core Web Vitals |
| BUG-15 | `/reports` | Tick "Only internally reviewed" → Update preview | Preview empty, Generate enabled |
| BUG-16 | `/audits/57226d00-…` | Hover health "Open" links | Same href for 3 cards |
| BUG-17 | `/issues` | Bulk dropdown | Defaults to "Confirm finding" |
| BUG-18 | `/issues/2fb88c98-…` (CNT-0001) | Review panel | Recommendation buttons on a Confirmed finding |
| BUG-20 | `/projects` vs `/` | Compare times | 9:32 vs 9:48 unlabelled; 3 cancels at 3:39 |
| BUG-21 | `/audits/56531528-…`, `/audits/c4bb683b-…`, `/audits` | Read cards | 0 pages but 109 raw findings; no reason; 0 vs 0/20 |
| BUG-22 | `/projects/<id>`, `/audits/<id>`, `/issues/<id>` | Tab title | "WebAudit Pro" |
| BUG-23 | `/this-page-does-not-exist` | Load | Default black Next.js 404 |
| BUG-24 | `/help` vs `/audits/57226d00-…` | Compare | "5–10 minutes" vs 16 m 28 s |
| BUG-25 | Re-Audit/Issues TYP-0019 | Read value | "line-height: 0.10 (1.4px on 14px text)" |

### 6. Evidence references
E01 Connections error (credentials panel cropped out) · E02 Overview · E03 My Websites · E04 Project detail · E05 Audit detail health · E06 Audit Runs · E07 New Audit advanced · E08 Issues list · E09 CWV-0011 · E10 Search "404" · E11 Reports · E12 Empty preview + enabled buttons · E13 Approvals · E14 Re-Audit · E15 SEO Overview · E16 PageSpeed latest results · E17 SEO History first vs latest · E18 Structured Data · E19 SC Performance · E20 URL Inspection · E21 Settings · E22 Help · E23 CNT-0001 evidence/review panel · E24 default 404.

### 7. Expected behaviour and acceptance criteria
Each BUG/UX entry in the register files has its own acceptance criteria. Cross-cutting criteria:
- Two screens never show different values for the same metric, audit and time (PSI, CWV, status).
- No 5xx responses during normal navigation (e2e assertion).
- Every user-visible Google error has a mapped, plain-language message, a next action, and a "Technical details" disclosure.
- No list shows two rows with the same displayed ID.

### 8. Recommended code areas to investigate [Guessing: verify with grep]
| Bug | Where to look | Search terms |
|---|---|---|
| BUG-01/02 | Google OAuth/Search Console client, connections page, shared status helper | `searchconsole`, `webmasters`, `sites.list`, `Access required`, `doesn't have permission`, `not connected` |
| BUG-03 | `app/(app)/google/pagespeed/page.tsx` data loader; PSI results repository | `Latest results`, `pagespeed`, `ORDER BY`, `analysed`, `GROUP BY` |
| BUG-04 | PSI enqueue server action + worker job handler; cache check | `Run PageSpeed Insights`, `skipCache`, `6-hour`, `enqueue`, job table |
| BUG-05/06 | PSI → findings importer; health card component | `loadingExperience`, `originLoadingExperience`, `crux:`, `Real-user Core Web Vitals` |
| BUG-07/08/09 | Re-Audit compare logic, fingerprint function, `app/(app)/reaudit/page.tsx` | `fingerprint`, `Unable to verify`, `Still present`, `Reopened` |
| BUG-10 | `middleware.ts`, custom server (if any), DB access layer error handling, worker DB locks | `503`, `Service Unavailable`, `SQLITE_BUSY`, `busy_timeout`, `NextResponse` |
| BUG-11 | Finding display-ID generator | `padStart(4`, `CNT-`, `A11Y-`, `displayId` |
| BUG-12/13 | Structured-data rules (`rules version 2026-11-03`) and validator | `wrong type`, `Recommended property`, `Not eligible`, `datePublished` |
| BUG-14/15 | `app/(app)/reports/page.tsx` options + generate actions | `structured-data`, `consistency`, `Update preview`, `Generate` |
| BUG-16 | Health card component | `Website Health`, `href={\`/issues?run=` |
| BUG-17/18 | Issues bulk form; issue review panel | `Bulk action`, `Approve recommendation` |
| BUG-20/21 | Overview activity feed, audit run summary | `Recent activity`, `updated_at`, `finished_at`, `Cancelled by a user` |
| BUG-22/23 | `generateMetadata` on detail routes; root `app/not-found.tsx` | `metadata`, `not-found` |
| BUG-25 | Typography check | `line-height`, `getComputedStyle`, `parseFloat` |

### 9. Required regression tests
- **Unit:** latest-PSI selector (3 runs/key → newest); PSI enqueue idempotency (double submit → 1 job); cache hit under 6 h; CrUX scope detection (URL vs origin fixtures); one finding per origin metric; Google error mapper (SERVICE_DISABLED, PERMISSION_DENIED, 401, network); fingerprint normalisation (random `sm-…` IDs → same hash); Re-Audit bucketing when the base audit lacks a category; SD validator single-verdict for `""`; display-ID uniqueness across projects; line-height conversion (`normal`, `%`, unitless, px).
- **Integration:** Search Console status helper returns the same state on all 6 screens for each fixture state; report category list equals the audit category list; empty report rejected server-side.
- **E2E (Playwright):** click through all sidebar links and Google tabs → assert no 5xx and no full document reload; Re-Audit first response size budget; Issues "All" view shows a Website column; health-card links carry category filters.
- **Existing behaviour to protect:** read-only crawling; domain-scope enforcement on New Audit; false positives excluded from reports; secrets never re-displayed; in-app Not found for bad IDs; security headers (X-Frame-Options DENY, nosniff, Referrer-Policy no-referrer, Permissions-Policy, no-store).

### 10. Dependencies and blockers
- **BUG-01 end-to-end verification depends on the user enabling the Search Console API** in Google Cloud project 154245030857, and on the Google account having access to the CHM/RRMH properties. Until then, test with mocked Google responses.
- BUG-05 re-import and BUG-08 re-fingerprinting depend on approval (§11) because they change historical counts.
- BUG-07 needs to know which categories each audit ran. Check whether per-audit categories/Google options are stored. If not, add that first.
- The UX-03 review queue depends on UX-02 (status vocabulary).
- Fixing BUG-10 may change navigation timing. Run the e2e suite afterwards.

### 11. Changes requiring user approval
1. Enabling the Search Console API in Google Cloud (user action, outside the code).
2. Any change to severity or count logic that alters client-facing High counts (BUG-05, UX-05).
3. Re-fingerprinting or migrating existing findings / display IDs (BUG-08, BUG-11).
4. Deleting or merging the duplicate PageSpeed results (BUG-04 cleanup).
5. Running new audits or PageSpeed calls for verification (external requests, API quota).
6. Adding a Content-Security-Policy (could break inline scripts or styles).
7. Changing report defaults (e.g., Client PDF = reviewed only).
8. Renaming status vocabulary (UX-02) if existing exported reports or client links rely on the terms.

### 12. Recommended implementation sequence
- **Sprint 1 (critical/blocked):** BUG-03 → BUG-01 → BUG-02 → BUG-10 (investigation + fix).
- **Sprint 2 (reliability/data correctness):** BUG-04 → BUG-05 → BUG-06 → BUG-11 → BUG-12 → BUG-13 → BUG-21 → BUG-25.
- **Sprint 3 (UX):** UX-02 → UX-03 → UX-07 → UX-04/05 → UX-06 (+BUG-15) → UX-09 → UX-10 → BUG-16/17/18/19/20/22/23.
- **Sprint 4 (Google SEO + reporting):** BUG-07 → BUG-08 → BUG-09/UX-08 → BUG-14 → UX-01 (guided setup) → Search Console property selection + Performance/Inspection/Sitemaps verification once the API is enabled → Google data in reports (untested so far) → UX-12/16/18.
- **Sprint 5 (security/testing/release):** CSP, role/permission tests, approval-link token/expiry tests, login rate limiting check, backup location check, full e2e regression suite, BUG-24/UX-14 docs, UX-19 account management.

**Stop condition for the implementing session:** after each sprint, report what changed and re-run the e2e checks before moving on. Don't run live audits or Google calls without approval (§11.5).

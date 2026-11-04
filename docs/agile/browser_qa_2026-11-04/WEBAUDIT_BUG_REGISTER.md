# C. Bug Register — WebAudit Pro (browser QA, 2026-11-04)

Environment: `http://localhost:3000`, signed in as Admin (J. Pajares), Chrome + Claude in Chrome extension. Projects present: **Capital Home Mortgage** (CHM, `568a8045-…`) and **RedRiverModularHomes** (RRMH, `ce463608-…`). All testing was read-only; no records were created, changed or deleted.

Evidence files are in `evidence/` next to this report (E01–E24). Values quoted below were read directly from the rendered pages.

**Evidence labels:** Verified = reproduced/observed directly · Partially Verified = symptom observed, part of the claim inferred · Suspected = inference from indirect evidence · Not Tested.
**Root causes are hypotheses** unless stated otherwise; no source code was inspected.

## Summary table

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

## BUG-01 — Search Console "API disabled" error shown as a permission problem; no recovery path
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

## BUG-02 — Search Console status contradicts itself across screens
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

## BUG-03 — PageSpeed "Latest results" table shows the oldest run
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

## BUG-04 — Excess / duplicate PageSpeed API runs
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

## BUG-05 — Site-wide CrUX data duplicated as per-page "real-user" findings
- **Module:** PageSpeed import → Findings (CWV-xxxx)
- **Severity:** P2 (inflates High-priority counts shown to clients; misattributes data)
- **Actual:** For the 5 pages PageSpeed was run on (home, /brian-wheeler/, /centennial-homes/, /clarksville/, /fresh-start-home-mortgages/), every real-user value is **identical**: LCP mobile 4.1 s, LCP desktop 10.5 s, CLS desktop 0.6, INP desktop 542 ms, FCP mobile 3.6 s / desktop 6.5 s, TTFB mobile 3.2 s / desktop 5.4 s (Re-Audit list + issue detail CWV-0003/0011/0019/0027). That makes 40 CWV findings, 20 of them **High**. CHM has 47 High in total.
- **Evidence status:** Identical values: Verified. That these are origin-level (whole-site) values: **[Likely]**. PageSpeed returns `originLoadingExperience` when a URL has too little traffic for URL-level data, and pages like `/brian-wheeler/` are unlikely to qualify. Issue detail says only "Real-user measurements (Chrome UX Report, 28 days)" and doesn't say URL vs origin.
- **Expected:** If PSI returns origin-level data, the app creates **one site-level finding per metric/device**, labelled "whole site (origin) data", and doesn't repeat it per page.
- **Acceptance criteria:** The import stores whether the data is URL-level or origin-level. Origin data produces at most one finding per metric+device per audit. Issue detail shows the scope. The CHM High count drops accordingly once data is re-imported (needs approval: changes client-facing counts).

## BUG-06 — Real-user CWV summary is mobile-only and unlabeled
- **Module:** Audit detail / SEO Overview → Performance card
- **Severity:** P2
- **Actual:** "Real-user Core Web Vitals: CLS good, TTFB poor, FCP poor, **INP good**, LCP poor" (E05, E15). The same audit has High findings "Poor real-user CLS on **desktop**" (0.6) and "Poor real-user INP on desktop" (542 ms).
- **Expected:** Show mobile and desktop separately, or label the card "(mobile)" and add a desktop line.
- **Acceptance criteria:** No poor desktop metric can show as "good" on a summary card.

## BUG-07 — Re-Audit treats "not measured before" as "New"
- **Module:** Re-Audit
- **Severity:** P2 (makes the site look like it regressed; misleading in client comparisons)
- **Reproduction:** `/reaudit` → Website CHM → base Nov 3 3:22 PM, comparison Nov 4 9:32 AM (defaults) → Compare.
- **Actual:** New **197**. This includes every PERF-, CWV- and SD- finding, each with BEFORE "–". SEO History shows structured data "Not available" for the 3:22 PM audit, and PageSpeed ran only on Nov 4. Totals check out: 197 + 530 = 727 latest; 530 + 60 + 40 = 630 base.
- **Expected:** A separate bucket, "Not checked in base audit", for findings whose check category/source didn't run in the base audit. These are left out of "New".
- **Acceptance criteria:** With the current data, PERF/CWV/SD findings move to the new bucket. "New" contains only categories both audits ran. A unit test covers a base audit missing a category.

## BUG-08 — Re-Audit fingerprints include auto-generated IDs
- **Module:** Re-Audit / finding fingerprinting
- **Severity:** P2
- **Actual:** "New" includes A11Y-0028…0033 (aria-controls="sm-17937559783053635-2", "-12", …), A11Y-0044…0053 and A11Y-0154…0163 ("…same id attribute: sm-17937559519296848-9" / "sm-1793756549708874-9"). `sm-<long number>-n` IDs look like run-time generated menu IDs (SmartMenus-style) that change on every page load.
- **Evidence status:** Verified that these appear as "New" with volatile IDs. **Suspected** that matching earlier findings were counted as "Resolved"/"Unable to verify". The Resolved list was not reviewed because the page output was too large (BUG-09).
- **Hypothesis:** The fingerprint ("rule + element") includes the axe failure message or a selector containing these IDs.
- **Acceptance criteria:** Fingerprints normalise volatile tokens (long numeric runs, hashed class names) before hashing. Two consecutive scans of an unchanged page produce 0 New / 0 Resolved for these rules (regression test using fixture HTML with random IDs).

## BUG-09 — Re-Audit page renders everything at once
- **Module:** Re-Audit
- **Severity:** P2 (performance)
- **Actual:** `GET /reaudit` returned **2,279,222 bytes** of HTML (measured with fetch). The page holds all 827 comparison items with before/after screenshots. The text extract was 156,612 characters. There's no pagination or lazy loading. Other pages were 16–74 KB.
- **Acceptance criteria:** The first response is under ~300 KB. Items are paginated or virtualised (e.g., 50 per page). Screenshots use lazy loading (`loading="lazy"`). The status tabs (New/Still present/…) filter on the server.

## BUG-10 — Client-side navigation requests return HTTP 503
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

## BUG-11 — Issue IDs are not unique across websites
- **Module:** Issues (All websites view), reports/approvals by ID
- **Severity:** P2
- **Actual:** In `/issues` (Website: All), `CNT-0001` appears twice (CHM `/brian-wheeler/` "Image fails to load", and RRMH `/blog/the-complete-guide-…` "Internal link returns HTTP 404"). `A11Y-0001` to `A11Y-0014` also appear twice each (E08). The table has no Website column. The Page column shows only a path for non-home pages.
- **Expected:** IDs unique wherever they're shown together, or a Website column, plus a project prefix in exports.
- **Acceptance criteria:** No two rows in any list or report share a displayed ID. The Website column is visible in the "All" view. Search by ID returns one result per website, with the website shown.

## BUG-12 — Structured-data validator contradictions
- **Module:** Structured Data
- **Severity:** P2
- **Actual (Verified):** For the Article block on /brian-wheeler/, /greg-bailey/, /sandy-nichols/ and /social-media/, the same property is reported both as *Warning "Recommended property 'datePublished' is missing"* and as *Error "'datePublished' has the wrong type (expected an ISO 8601 date)"*. The value is `datePublished: ""` (seen in Re-Audit). The item is labelled "Article: Not eligible: missing or invalid required properties" (E18).
- **Second issue [Likely, verify against current Google docs]:** Google's Article structured-data documentation lists no required properties (only recommended ones). "Not eligible … required properties" may therefore be wrong. An empty `datePublished` is still worth flagging as an invalid value.
- **Acceptance criteria:** A property gets exactly one verdict: missing, empty or invalid type. An empty string is reported once, as "empty value". Eligibility wording follows the rules file, and the rules file cites the Google doc it encodes.

## BUG-13 — Structured-data page count and empty states
- **Severity:** P3
- **Actual:** The audit summary says "Pages with structured data **20**". On the Structured Data page, `/texas-fha-pre-qualification/` and `/texas-fha-tru-approval/` show table headers with **no rows** and no message.
- **Acceptance criteria:** The count includes only pages with at least one item. A page with no items shows "No structured data found on this page", or is hidden behind a filter.

## BUG-14 — Report category filter is missing Performance / Core Web Vitals
- **Module:** Reports
- **Severity:** P2
- **Actual:** The Category options are Layout, Spacing, Typography, Buttons & tap targets, Accessibility, SEO & metadata, Content & links, Navigation, Component consistency, Structured data. There is no **Performance** (106 CHM findings) and no **Core Web Vitals** (40). "Technical SEO" on the audit page is called "SEO & metadata" here.
- **Acceptance criteria:** Report categories match the categories in the audit's "By category" list. A Performance-only report can be previewed, and its count is 146 for the current CHM audit.

## BUG-15 — Generate buttons enabled for an empty report
- **Severity:** P3
- **Reproduction:** `/reports` → tick "Only internally reviewed findings" → Update preview.
- **Actual:** The preview says "No findings match these options, so the report would be empty…". All four Generate buttons still have `disabled=false` (E12). Generating was **Not Tested** (it would create records).
- **Acceptance criteria:** When the preview count is 0, the Generate buttons are disabled and explain why. The server also rejects empty generation.

## BUG-16 — Website Health "Open" links aren't specific
- **Severity:** P3
- **Actual:** On `/audits/57226d00-…`, the "Open" links for Design & Responsive, Accessibility and Technical SEO all point to `/issues?run=57226d00-…` with no category filter. Both Search Console cards point to Connections. The page has seven links all named "Open" (WCAG 2.4.4 link purpose).
- **Acceptance criteria:** Each link applies the matching category filter. Each has an accessible name such as "Open Accessibility findings (184)".

## BUG-17 — Bulk action defaults to "Confirm finding"
- **Severity:** P3
- **Actual:** On `/issues`, the "With selected" dropdown starts at "Confirm finding" (E08). Pressing Apply after selecting rows would confirm them with no deliberate choice. Apply was not pressed.
- **Acceptance criteria:** Default is a placeholder ("Choose an action…"). Apply is disabled until an action and at least one row are chosen. Bulk actions on more than 10 rows show a confirmation with the count.

## BUG-18 — Review actions don't match the finding's class
- **Severity:** P3
- **Actual:** CNT-0001 (class **Confirmed**, "Image fails to load") offers Confirm finding, Mark false positive, **Approve recommendation**, Request revision, **Reject recommendation**, Add note only (E23). CWV-0011 (Confirmed) shows the same set.
- **Acceptance criteria:** Confirmed / Needs review → Confirm, False positive, Note. Recommendation → Approve, Request revision, Reject, Note. Or the actions are explained if they're intentionally shared.

## BUG-19 — Evidence highlight for zero-size elements
- **Severity:** P3 · **Partially Verified** (visual only)
- **Actual:** In CNT-0001 "Image fails to load" (/brian-wheeler/), the "Highlighted crop" shows the page header and hero. The red outline is a tiny mark in the crop's top-left corner (E23), so the broken image itself isn't identifiable.
- **Acceptance criteria:** For elements with a bounding box under 4×4 px, the crop centres on the nearest visible ancestor and adds a caption ("element has no visible size — outlined parent").

## BUG-20 — Timestamps mean different things without labels
- **Severity:** P3
- **Actual:** CHM latest audit: My Websites "Last run Nov 4, **9:32 AM**" (start). Overview "Last audit Nov 4, **9:48 AM**" (finish). Audit duration was 16 m 28 s. Overview "Recent activity" shows three CHM cancellations all at **3:39 PM**. Yet the audit started 3:27 PM shows elapsed 0 m 22 s (ended about 3:27). Only the 3:33 PM one (6 m 21 s) plausibly ended at 3:39. The 3:29 PM run's detail page was not opened.
- **Hypothesis:** Recent activity uses `updated_at`, which a later batch update touched, instead of `finished_at`.
- **Acceptance criteria:** Each timestamp is labelled (Started / Finished / Cancelled). Recent activity uses the event's own time.

## BUG-21 — Cancelled-audit records are inconsistent
- **Severity:** P3
- **Actual:** Audit `56531528-…` (cancelled): Pages completed **0** but Raw findings **109**, with the note "Pages scanned so far were not imported". Audit `c4bb683b-…`: elapsed 6 m 21 s, 0 pages discovered, **no cancellation message**. Audit Runs shows Pages "0" for two cancelled runs and "0/20" for the third (E06).
- **Acceptance criteria:** Raw findings for a cancelled run show "109 (not imported)" or 0. Every cancelled run shows who/why/when. The Pages column uses one format.

## BUG-22 — Generic page titles on detail pages
- **Severity:** P3 (WCAG 2.4.2; tabs and history are hard to tell apart)
- **Actual:** The `<title>` is "WebAudit Pro" on `/projects/<id>`, `/audits/<id>`, `/issues/<id>` and the in-app Not found page. List pages have specific titles.
- **Acceptance criteria:** Titles like "CWV-0011 · Capital Home Mortgage · WebAudit Pro", "Audit Nov 4 9:32 AM · Capital Home Mortgage · WebAudit Pro", "Not found · WebAudit Pro".

## BUG-23 — Unstyled default 404 for unknown routes
- **Severity:** P3
- **Actual:** `/this-page-does-not-exist` shows the default Next.js black "404 | This page could not be found." page with no app navigation (E24). In-app missing records (`/issues/<bad id>`, `/audits/not-a-real-id`) correctly show a friendly "Not found" with "Back to overview".
- **Acceptance criteria:** A root `not-found` page uses the app shell and offers Overview/Help links.

## BUG-24 — Help understates audit duration
- **Severity:** P3
- **Actual:** Help step 3 says "A 20-page audit usually takes 5–10 minutes". The latest CHM 20-page audit (5 viewports, 1000 ms delay) took **16 m 28 s**. RRMH's 80-page audit took 54 m 33 s.
- **Acceptance criteria:** Help states a formula or range based on observed data (pages × viewports × delay). New Audit shows an estimate before Start.

## BUG-25 — Suspicious line-height measurement
- **Severity:** P3 · **Suspected**
- **Actual:** TYP-0019 "Body text lines are cramped", /janice-stowers-mortgage-team/: "line-height: 0.10 (1.4px on 14px text)", in both base and latest audits. Text with a 1.4 px line-height would overlap almost completely, so this is more likely a measurement or parsing error (e.g., `line-height` given as a percentage, or `normal`) than a real site defect.
- **Recommended investigation:** Open the page at the reported viewport and read the element's computed `line-height`. Check how the engine converts `%` / unitless / `normal` values.
- **Acceptance criteria:** Unitless, `%`, `px` and `normal` line-heights convert correctly (unit tests). This finding either reproduces with a real computed value or disappears.

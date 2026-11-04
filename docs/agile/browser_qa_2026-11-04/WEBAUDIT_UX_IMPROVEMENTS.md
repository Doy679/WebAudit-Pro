# D. UX/UI Improvement Register — WebAudit Pro (browser QA, 2026-11-04)

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

### UX-01 — Guided Search Console setup with live checks
- **Page:** `/google/connections`
- **Problem:** The page mixes admin credentials, a per-project selector, limits and an error banner. The only guidance for the real blocker is Google's raw English error inside a permission message (E01). There's no Retry.
- **Solution:** A 5-step checklist card with live status ticks: ① Google Cloud credentials saved → ② Google account connected → ③ Search Console API enabled (checked by a test call) → ④ Account can see a property matching *capitalhomemortgage.com* → ⑤ Property selected. Each failed step gets one plain sentence and one button (e.g., "Open Google Cloud Console", "Retry check"). Raw errors go under "Technical details".
- **Benefit:** A non-technical admin can fix the integration without reading API errors.
- **Acceptance criteria:** With the current state, steps ①② show done, ③ shows "Not enabled", and the Retry button works without a page reload. Keyboard and screen-reader accessible (status announced via `role="status"`).

### UX-02 — Simplify status vocabulary
- **Pages:** `/issues`, `/issues/<id>`
- **Problem:** One row shows class **Confirmed**, Verification **Unverified**, Review **Pending**, Implementation **To do** (E08, E09). "Confirmed but unverified" reads as a contradiction to a client or PM.
- **Solution:** Rename class "Confirmed" to **"Measured"** (Help already defines it as "measured"). Merge Verification + Review into one **Review status**: Not reviewed / Accepted / False positive / Sent to client / Client approved / Client rejected. Keep Implementation separate.
- **Acceptance criteria:** No screen shows two words that read as opposites for the same finding. The Help glossary matches the UI labels exactly.

### UX-03 — A review queue mode
- **Page:** `/issues`
- **Problem:** CHM's latest audit has 727 findings (336 High across both sites). Client approval only accepts reviewed findings ("No findings in this audit are ready to release", E13). Reviewing them one detail page at a time isn't practical.
- **Solution:** A "Review queue" view: one finding at a time with evidence, keyboard shortcuts (C = confirm, F = false positive, N = next), "apply to all findings with this rule on this site", and progress (e.g., "34 / 336 high-priority reviewed").
- **Acceptance criteria:** A reviewer can work through 20 findings without opening a new page. Progress persists. Overview onboarding step 3 shows progress.

### UX-04 — Issues list: website column, counts, missing filter
- **Problem:** IDs repeat across websites (BUG-11). Rows for non-home pages show only a path. There's no quick filter for Recommendations (548 of 1477 rows). Chips don't show counts. Counts seen: High 336, Mobile 996, Desktop 896, Accessibility 657, SEO 124, Layout 83, Confirmed 533, Needs review 396, Awaiting client 0.
- **Solution:** Add a Website column when Website = All. Show counts on chips. Add a "Recommendations" chip. Make the "Awaiting client" empty state explain how items get there.
- **Acceptance criteria:** Chip counts match the "Showing x of N" total after clicking.

### UX-05 — Merge near-identical findings
- **Problem:** A11Y-0001…0006 (CHM) all report contrast 3.47 (#858585 on #f8f8f8, 12 px bold) across the same 13 pages, as six separate High findings. The same happens with A11Y-0011…0020 (#fff on #00a6e2).
- **Solution:** Group by rule + failure signature (colours/size) as well as by element. Show "6 elements" inside one finding.
- **Acceptance criteria:** The fix is one action for the developer, and the High count reflects distinct problems.

### UX-06 — Reports: live preview and safer defaults
- **Page:** `/reports`
- **Problem:** The preview updates only after pressing "Update preview". The default includes all 727 unreviewed findings, while the PDF tip says "include reviewed findings only". Generate stays enabled for empty output (BUG-15). Performance/CWV categories are missing (BUG-14).
- **Solution:** Auto-update the preview when an option changes. Make "Only reviewed" the default for the **Client PDF**, with a visible warning when unreviewed findings are included. Disable Generate at 0. Add "Your reports" status with a spinner and errors.
- **Acceptance criteria:** Changing any filter updates the count within 1 s, without a button. A Client PDF can't include unreviewed findings without an explicit tick.

### UX-07 — Client Approvals: explain and preview
- **Page:** `/approvals`
- **Problem:** The only message is "No findings in this audit are ready to release. Confirm findings or approve recommendations in Issues first." The "Issues" link opens the whole audit, not a review filter. There's no preview of what the client will see.
- **Solution:** Show "0 of 727 findings are ready. 336 high-priority findings need review →" linking to the review queue (UX-03), plus a "Preview client page" button once a package exists.
- **Acceptance criteria:** The link opens Issues filtered to the audit and to unreviewed status.

### UX-08 — Re-Audit: paginate and separate "not measured before"
- **Page:** `/reaudit`
- **Problem:** A 2.2 MB page (BUG-09). "New (197)" is mostly checks the base audit never ran (BUG-07). The base and comparison dropdowns both offer the same audit (Nov 4 9:32 can be chosen for both).
- **Solution:** Server-side tabs with 50 items per page. Collapse screenshots by default. Add a "Not checked before" tab. Stop the same audit being picked on both sides. Add a summary sentence ("40 fixed, 530 still present, 0 real regressions").
- **Acceptance criteria:** The page loads in under 1.5 s locally. Choosing the same audit twice is impossible or warned.

### UX-09 — Audit Runs: filter, sort, explain
- **Page:** `/audits`
- **Problem:** A plain table (E06) with no filters, sorting or paging. Cancelled runs give no reason. Pages format differs ("0" vs "0/20").
- **Solution:** Website/status filters, sortable columns, pagination, a "Cancelled by J. Pajares at 3:39 PM" tooltip, an elapsed-time column.
- **Acceptance criteria:** Filters persist in the URL.

### UX-10 — Remove the extra "Show"/"Select" click
- **Pages:** all Google subpages, `/google/connections`, `/approvals`
- **Problem:** Changing the Website dropdown does nothing until you press "Show" (or "Select" on Approvals).
- **Solution:** Apply on change (keep a submit button inside `<noscript>`/progressive enhancement).
- **Acceptance criteria:** Selecting a website updates the page and the URL `?project=` in one action.

### UX-11 — Specific health-card links
- See BUG-16. Each card links to its own filtered list, and the link text names the area and count.

### UX-12 — Structured Data page structure
- **Problem:** Every page's full item table is expanded. Organization warnings (8 per page) repeat on about 16 pages (E18).
- **Solution:** A summary table at the top (type × pages × errors/warnings), a "Show errors only" filter, collapsed page sections, and a "same issue on N pages" grouping.
- **Acceptance criteria:** Errors (4) are reachable in one click from the top.

### UX-13 — Label timestamps
- See BUG-20. Use "Started 9:32 AM · Finished 9:48 AM (16 m)" everywhere.

### UX-14 — Consistent onboarding and troubleshooting
- **Problem:** The Overview guide has 5 steps (E02); Help has 7 (E22). Help troubleshooting covers "Google data says 'not configured'", but the app actually shows "not connected" / "Access required …", and there's no entry for "Search Console API not enabled". Help's duration estimate is wrong (BUG-24).
- **Solution:** One step list shared by Overview and Help. Add troubleshooting entries using the exact on-screen messages.
- **Acceptance criteria:** Every error string a user can see in Google pages has a matching Help entry.

### UX-15 — Branded 404 and descriptive titles
- See BUG-22 and BUG-23.

### UX-16 — Clarify CrUX vs PageSpeed real-user data
- **Problem:** Connections shows "Chrome UX Report API: Off (optional)" (E01). Findings and PageSpeed tables still show real-user ("REAL USERS: poor") data that comes through PageSpeed.
- **Solution:** Change the label to "Chrome UX Report API (extra history): Off — basic real-user data still comes from PageSpeed".

### UX-17 — Time estimate and visible Google options on New Audit
- **Problem:** The summary line says "…no Google checks", but Google options are only inside Advanced settings, and there's no duration estimate before Start.
- **Solution:** Show "Estimated time: ~16 min for 20 pages × 5 screen sizes" and a visible "Add PageSpeed (5 pages, ~10 API calls)" toggle.

### UX-18 — Scope label on real-user metrics
- See BUG-05. Show "Whole-site data (Google didn't have enough visits for this page)" when applicable.

### UX-19 — Team account management
- **Page:** `/settings`
- **Problem:** "Team accounts" lists users and has "Add an account", but there are no visible controls to change a role, deactivate an account or reset a password (E21).
- **Solution:** Edit role, deactivate/reactivate, send a reset/temporary password, and show last sign-in.
- **Acceptance criteria:** An admin can remove a departed user's access without database access.

### UX-20 — Safer review controls
- See BUG-17 (bulk default) and BUG-18 (class-irrelevant buttons). Also add confirmation and undo for bulk actions.

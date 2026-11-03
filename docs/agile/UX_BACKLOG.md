# UX Improvement Backlog (2026-11-03)

Priorities: **P0** broken workflow or accessibility blocker · **P1** confusing core workflow, unclear errors, missing feedback · **P2** efficiency and navigation · **P3** visual polish.
"Done" means: implemented, exercised from the real UI by an E2E test or a browser walkthrough on a copy of the real Red River data, checked at 320–1440 px and with axe, and the full regression suite passing.

## UX review findings (before this sprint)

| Screen | Problem found | Who it affects |
|---|---|---|
| Overview | 9 equally weighted numbers; no "what next"; no worker or Google status; no list of websites | First-time users, PMs |
| New Audit | 15+ technical fields shown at once (viewports, ms delays, categories, Google quotas) | Non-technical users |
| Issues | 14 filters in one block; no one-click views (mobile, accessibility…); filters lost when opening an issue and coming back; rows showed only technical titles (axe rule names) | QA, PMs, clients' account managers |
| Issue detail | Opened with rule ids, selectors and CSS; no plain explanation of why it matters or who fixes it; "Proposed" could be mistaken for a real "after" image | Non-technical users, clients |
| Reports | Four format buttons with no explanation of who each is for; no way to know what a report will contain before generating; no report from hand-picked issues | PMs |
| Client portal | Technical titles; "Request revision" jargon; approval meaning in one sentence; no per-item status | Clients |
| Help | No in-app instructions or glossary | Everyone |
| Errors | Worker messages told users to run `npm run dev` (the app is started with `npm start`) | Admins |

## Completed this sprint

| ID | Pri | Improvement | Acceptance criteria | Evidence |
|---|---|---|---|---|
| UX-01 | P1 | **Dashboard redesign**: prominent *Start new audit*; 4 attention cards (high priority, needs review, awaiting client, reports ready) linking to matching quick filters; *My websites* with last audit, findings, high-priority count, live progress, *View issues* / *Audit again*; system status (worker, Google) in plain words; recent activity | All numbers from real data (`websiteSummaries`, `overviewStats`); cards link to working filters | `test/ux.test.ts` dashboard; E2E UX 1; real-data walkthrough (2 websites, 317 high, 438 needs review) |
| UX-02 | P1 | **Getting-started guide**: 5 steps with real progress (derived from data), dismissible, dismissal remembered per user, can be shown again | New user sees 0/5 done; admin with work done doesn't see it; hide survives reload | `onboarding` unit test; E2E UX 1 (fresh user, hide, reload, show) |
| UX-03 | P1 | **Help & getting started page** (nav item): 7-step workflow, glossary of terms, common problems and what to do, safety notes | Reachable from nav, dashboard guide and error page; no overflow/axe issues | E2E UX 4; UI audit includes `/help` |
| UX-04 | P1 | **Guided New Audit**: numbered steps Project → URL → Start; all technical settings in a collapsed *Advanced settings* with a one-line summary of what will run; problems hidden inside the collapsed section are shown next to Start | Defaults load from the selected project; edits preserved; summary updates live | E2E UX 4, Bug Tests 1–3, Tests 2–3 |
| UX-05 | P1 | **Issues quick filters**: All, High priority, Mobile, Desktop, Accessibility, SEO, Layout & spacing, Confirmed, Needs review, Awaiting client | Each maps to a real, tested query; combine with other filters | `ux.test.ts` (10 filters incl. client-approval state); E2E UX 2 |
| UX-06 | P2 | **Saved views** per user (save current filters, open, delete); only known filter parameters stored | Private to the user; delete only own | `ux.test.ts`; E2E UX 2 |
| UX-07 | P2 | **Filters preserved** when opening an issue: *Back to your filtered list* | Returns to identical list | E2E UX 2 |
| UX-08 | P2 | Simpler filter form: 5 main filters, the rest under *More filters* (auto-open when used); "Showing X–Y of N" | Existing filters unchanged in behaviour | E2E P0 regression + UX 2 |
| UX-09 | P1 | **Plain-language explanations** (what's wrong, why it matters, who usually fixes it) for every finding: 45 specific rules plus Google-provider and per-category fallbacks. Measured on the real database: **2,640 of 2,640 findings** have a specific explanation | No jargon for the 13 most frequent axe rules | `ux.test.ts` (rule coverage); real-data walkthrough |
| UX-10 | P1 | **Issue detail summary first**: What's wrong · Where (URL, "phones/tablets/desktops") · How serious (in words) · Why it matters · What to change · Who fixes it (+ assignee) · Client approval; technical evidence (rule, confidence, selector, CSS) in *Technical details for developers* | Developers still see every technical field | E2E UX 2, Tests 4–7 |
| UX-11 | P1 | **Honest Current vs Proposed**: current = measured value + real screenshot; proposed explicitly labelled *Text recommendation only* (no fabricated "after" image); benefit stated | No generated imagery | E2E UX 2 |
| UX-12 | P2 | **Screenshot viewer**: zoom to actual size / fit to width, keyboard-scrollable, toggle buttons with `aria-pressed`, lazy-loaded full-page images | Keyboard operable; 0 axe violations | E2E Tests 4–6; UI audit |
| UX-13 | P1 | **Report workflow**: 4 numbered steps (audit → what to include → preview → type), each type explained for its audience, live **preview** of exactly what will be included, failure message says data is unchanged and to retry | Preview count = report contents (same rules) | `exportPreview` unit test; E2E UX 3, Tests 8–9 |
| UX-14 | P2 | **Custom selected-issues report**: select rows on Issues → *Create report from selected* | Report contains exactly the selected issues | E2E UX 3 (2 selected → JSON with 2) |
| UX-15 | P1 | **Client portal**: "How this works" in 3 steps, *Approving does not change your website*, item N of M, plain problem statement, proposed improvement, expected benefit, per-item status, *Request changes* wording; no internal notes or selectors exposed | Client sees only released findings | E2E Tests 10–11 |
| UX-16 | P0 | Phone layout bug found on real data: issue detail was 594 px wide at 390 px (implicit grid column sized to long URLs) | 390 px on real Red River issue | Real-data walkthrough before/after |
| UX-17 | P1 | Worker messages say `npm start` and that queued audits are kept; not-found explains how to get access; error page links Help | — | Code review + walkthrough |
| UX-18 | P3 | Visual consistency: shared icon set, step badges, larger mobile menu button, contrast-safe colours (from the previous sprint) | 0 axe serious/critical | UI audit (17 pages × 5 widths) |

## Open UX backlog

| ID | Pri | Problem | User impact | Proposed solution | SP | Acceptance criteria |
|---|---|---|---|---|---|---|
| UX-20 | P1 | Real-user usability testing not done | Ease of use for non-technical users is **unproven** | 5 moderated sessions (2 non-technical, 1 QA, 1 developer, 1 client) using the acceptance tasks below; record time on task and errors | 5 | ≥4/5 complete each task unaided |
| UX-21 | P1 | Issues table needs horizontal scrolling on phones (960 px table in a scroll box) | Usable but awkward on phones | Card layout below 768 px (one form control per row, without duplicate checkboxes) | 5 | No horizontal scroll inside the list at 390 px |
| UX-22 | P1 | Accessibility findings are one per element, so "High priority" is dominated by axe (289 of 317 on real data) | Users can't see what really matters first | Engine grouping (PB-02) | 5 | High priority mixes categories after regrouping |
| UX-23 | P2 | No previous/next issue navigation inside a filtered list | Reviewing 50+ issues means going back each time | Prev/Next on detail page using the carried filters | 3 | Walk through a filtered list without returning |
| UX-24 | P2 | Report preview isn't a visual preview of the PDF | Users only see counts before generating | Render the first PDF page as an image, or open the HTML report inline | 5 | Preview reflects the actual layout |
| UX-25 | P2 | Contextual help tooltips on more controls (confidence, classification, provider) | Some filters still need the Help page | Inline `?` popovers with the glossary text | 2 | Each advanced filter has help |
| UX-26 | P2 | Long-running exports/audits only update by polling/refresh | Feedback is delayed a few seconds | Server-sent events for progress | 5 | Progress updates within 1 s |
| UX-27 | P2 | Approval package creation still lists findings in a long table | Slow for big releases | Use quick filters + saved views in the release picker | 3 | Release "reviewed high priority" in 3 clicks |
| UX-28 | P3 | Dark mode, density toggle | Preference | Theme tokens already centralized | 3 | — |
| UX-29 | P3 | Guided tour overlay | First-run discoverability | Optional highlights on the dashboard | 3 | Dismissible, never forced |

## UX acceptance tasks (from the actual UI)

| # | Task | How verified | Result |
|---|---|---|---|
| 1 | First-time user creates a project | E2E Test 1; guide step 1 links to it | Pass (automated) |
| 2 | Start an authorized audit without technical knowledge | E2E Tests 2–3 + UX 4 (advanced hidden, defaults loaded) | Pass (automated) |
| 3 | Understand audit progress | E2E Tests 2–3, Bug Tests 6–7 (worker states in words) | Pass (automated) |
| 4 | Find high-priority issues in a few actions | Dashboard card → High priority filter (1 click), E2E UX 1 | Pass (automated) |
| 5 | Understand an issue without CSS knowledge | Plain summary (E2E UX 2); real-data walkthrough | Pass (automated + walkthrough) |
| 6 | Developer inspects technical evidence | Technical details (E2E UX 2) | Pass (automated) |
| 7 | Generate Excel or PDF | E2E Tests 8–9, UX 3 | Pass (automated) |
| 8 | Client reviews and submits decisions | E2E Tests 10–11 | Pass (automated) |
| 9 | Understand missing Google data | Dashboard system status, Test 15 | Pass (automated) |
| 10 | Recover from common errors without losing work | Worker offline → queued (Bug Tests 6–7), scope errors keep input (Bug Test 3), Help "Common problems" | Pass (automated) |

**These results show the workflows work and are explained in plain language. They do not prove that non-technical users find the app easy; that needs real-user testing (UX-20).**

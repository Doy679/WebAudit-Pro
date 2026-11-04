# UX Improvements: Browser QA 2026-11-04

Source: `browser_qa_2026-11-04/WEBAUDIT_UX_IMPROVEMENTS.md` (UX-01 to UX-20). Earlier UX work is in `UX_BACKLOG.md`.
Status: **Done** (implemented and tested) · **Partly done** · **Needs approval** (changes persisted meaning, counts or client-facing defaults) · **Deferred** (with reason).

| ID | Pri | Status | What was done / why not yet | Linked |
|---|---|---|---|---|
| UX-01 | High | **Partly done** | Connections shows the shared status, Retry / Test connection, plain explanation, admin fix steps and technical details behind a disclosure. A full 5-step checklist card is not built yet. Live API success can't be shown until the Search Console API is enabled in Google Cloud. | BUG-01/02 |
| UX-02 | High | **Needs approval** | Renaming "Confirmed" → "Measured" and merging Verification + Review changes persisted status meaning used by exports and client links. Proposal: keep stored values; change only display labels, Help glossary and report headings together, after approval. | — |
| UX-03 | High | **Deferred** | Review queue (one finding at a time, keyboard shortcuts, progress). Largest remaining UX item, 8 SP. BUG-17/18 made bulk and single review safer first. | UX-02 |
| UX-04 | Medium | **Done** | Website named in mixed lists, Recommendations chip, counts on every chip (one query, 8.7 ms on 1,477 findings). | BUG-11 |
| UX-05 | Medium | **Needs approval** | Merging near-identical contrast findings changes High counts shown to clients. | PB-02 |
| UX-06 | Medium | **Partly done** | Empty reports blocked (UI + server), categories from the audit. Live auto-updating preview and "Client PDF = reviewed only" default not done (default change needs approval). | BUG-14/15 |
| UX-07 | High | **Done** | Blocked Client Approvals state shows ready vs total counts and links to the unreviewed high-priority findings of that audit. | — |
| UX-08 | High | **Done** | Re-Audit pages of 50, "Not checked before" tab, summary sentence, same-audit warning. | BUG-07/08/09 |
| UX-09 | Medium | **Done** | Audit Runs: website/status filters, pagination in the URL, Queued/Started/Finished/Duration, cancellation note. | BUG-20/21 |
| UX-10 | Low | **Deferred (accessibility)** | Applying a select on change navigates while keyboard users arrow through options (WCAG 3.2.2). Kept the explicit Show/Select buttons. | — |
| UX-11 | Medium | **Done** | Health links open their own categories with specific accessible names. | BUG-16 |
| UX-12 | Medium | **Partly done** | Empty pages state and correct counts; summary table, errors-only filter and collapsing not done. | BUG-12/13 |
| UX-13 | Low | **Done** | Timestamps labelled everywhere audit times appear. | BUG-20 |
| UX-14 | Medium | **Done** | Help troubleshooting uses the exact on-screen Search Console messages; real duration estimate. | BUG-24 |
| UX-15 | Low | **Done** | Branded 404, descriptive titles. | BUG-22/23 |
| UX-16 | Low | **Done** | "Off (optional extra history). Basic real-user data still comes from PageSpeed." | — |
| UX-17 | Medium | **Done** | Live duration estimate in New Audit (from this installation's audits). Google options remain under Advanced settings by design (UX sprint). | BUG-24 |
| UX-18 | Medium | **Partly done** | New imports label whole-site data; the health card labels each device "this page / whole site". Old per-page findings keep their text (re-import needs approval). | BUG-05 |
| UX-19 | Medium | **Done** | Admins can change a user's role (with last-admin and self-demotion protection, sessions signed out), in addition to existing deactivate and password reset. | — |
| UX-20 | Medium | **Done** | Bulk default, confirmation above 10, class-appropriate buttons. | BUG-17/18 |

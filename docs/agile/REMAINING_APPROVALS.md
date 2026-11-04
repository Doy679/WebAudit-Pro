# Remaining Approvals and External Actions (Sprint 6, 2026-11-04)

Nothing below has been done. Each item changes historical data, client-facing numbers or defaults, uses Google quota, or is an action only you can take.

## A. Your actions in Google Cloud (external configuration)

| # | Action | Why | After it's done |
|---|---|---|---|
| A1 | **Check or replace the PageSpeed API key** (Google Cloud Console → APIs & Services → Credentials). The key should exist, be restricted to the *PageSpeed Insights API*, and have **no website/referrer restriction** (an IP restriction for this computer is fine). Save the new key in Google Connections. | NEW-01: Google answered the 11:47 requests with HTTP 400 "API key…", its answer for an invalid, expired or deleted key [Likely]. The raw text wasn't stored then; it is from now on (admin-only). | Tick the confirmation and press **Test PageSpeed key** (one request). |
| A2 | **Enable the Google Search Console API** in Google Cloud project **154245030857** (APIs & Services → Library → Google Search Console API → Enable). | BUG-01: Google's own reply is SERVICE_DISABLED for that project. | Press **Retry / Test connection** (one read-only request), then choose the property. |

## B. Changes to historical data or client-facing counts (need explicit approval)

| # | Proposed change | Dry-run impact (on a copy of the real database) | Reversible? |
|---|---|---|---|
| B1 | **Consolidate whole-site real-user findings (BUG-05)** for existing audits: keep one finding per metric + device, labelled "Whole website", and mark the per-page copies as duplicates. | CHM 4 Nov 9:32 AM: 40 whole-site CWV findings in 8 groups → 32 removed; **High 47 → 31**. CHM 4 Nov 11:27 AM: 32 findings → 24 removed; **High 42 → 30**. | Yes, if done by status change rather than deletion (proposed). |
| B2 | **Re-validate or reinterpret stored structured-data results (BUG-12)** checked with rules 2026-11-03. | 40 stored page results (latest CHM audit) carry the old double verdict. Snippets are stored truncated (400 chars), so faithful re-validation isn't possible: options are a fresh audit (B4) or a display-level reinterpretation (missing + wrong-type on the same property → one "empty value"). | Display option: yes. |
| B3 | **Re-fingerprint historical findings (BUG-08)** | Not needed for correctness: comparisons already use keys recomputed at comparison time. | — |
| B4 | **Run a fresh CHM audit** (live, read-only crawl of capitalhomemortgage.com, ~14–20 min) to regenerate evidence with today's code: BUG-12 single verdicts, BUG-19 ringed zero-size crops, BUG-05 whole-site findings (needs A1 for PageSpeed). | New audit record; existing audits unchanged. | Yes (it's a new record). |
| B5 | **Merge near-identical findings (UX-05)**, e.g. 6 contrast findings with the same colours on the same pages. | Changes High counts shown to clients. Not yet modelled. | Depends on design. |
| B6 | **Client PDF defaults to reviewed findings only (UX-06 part 2)** | Changes a report default. | Yes. |
| B7 | **Rename stored status values (UX-02 beyond display)** | Display words are already changed (display only). Renaming stored values would affect exports and existing client links; not recommended. | — |
| B8 | **Enforce the Content-Security-Policy** | Currently report-only; see TEST_RESULTS.md for violations recorded during E2E. Enforcement could break pages if anything was missed. | Yes (config). |

## C. Release actions

| # | Action |
|---|---|
| C1 | **Push the Sprint 6 commits to GitHub** (not pushed, per instructions). |
| C2 | **Restart the local app on the new build.** The running app (started 12:02) still contains the BUG-12 crash: a new audit of a page with an empty structured-data value would fail. Restarting deploys the fix. |
| C3 | Real-user usability sessions (non-technical staff, client). Automated tests can't prove ease of use. |

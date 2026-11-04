# Google Integration Remediation: Test Results (2026-11-04)

All automated tests mock Google. No live Google request was made at any point in this sprint.

| Check | Result |
|---|---|
| Baseline before changes (G0) | TypeScript clean; **300/300** tests passed |
| TypeScript (`tsc --noEmit`), final | **Pass** (0 errors) |
| Unit + integration (`vitest run`, 22 files), final | **322 passed, 0 failed** (22 new) |
| Production build (`next build`, isolated `.next-qa`), final | **Compiled successfully** |
| E2E (Playwright, isolated DB, port 3100, 30 tests) | **30 passed, 0 failed**, incl. new "GQA-01/G3" test, BUG-10 navigation (no 5xx), and the UI/axe audit |
| Browser preview of the new build on a copy of the real DB (port 3200) | Statuses verified on 7 screens; **no console errors** |

The E2E run used the build before one display-only change (the newer-failure note now quotes the same time as the table column). The final unit run and production build include that change.

## New regression tests (`test/google-remediation.test.ts`)
| # | Requirement | Test | Result |
|---|---|---|---|
| 1 | Valid API key format accepted | "1. accepts a conventional Google API key" | Pass |
| 2 | GOCSPX secret rejected as API key, value not echoed, nothing saved | "2. rejects an OAuth client secret…" | Pass |
| 3 | OAuth client ID rejected as API key | "3. rejects an OAuth client ID…" | Pass |
| — | Malformed / spaced keys; API key or client ID in the secret field; client ID checks | "rejects malformed keys…" | Pass |
| — | One invalid field → no stored value changes | "an invalid field in one save…" | Pass |
| 4 | Invalid format → zero Google requests | "4. runPsi with a non-key value makes zero requests" | Pass |
| 5 | Stored malformed credential → `invalid-format`; queued task refused locally; valid shape stays `untested` | "5. an existing malformed credential…" | Pass |
| 6 | Secrets redacted (AIza, GOCSPX, ya29, 1//, key=, access_token=) | three G1-3 tests (helper, PSI + GSC classifiers, stored rows) | Pass |
| 7 | 3 rapid test submissions → 1 provider call; cooldown returns previous result | "7. three rapid submissions…" + cooldown test | Pass |
| 8 | Search Console check time + stale warning; no invented success time; Retry records success | three G2-1 tests | Pass |
| 9 | Success then failure → success kept, newer failure reported | "9. a success followed by a failure…" | Pass |
| 10 | Cache reuse provenance (stored and derived for older tasks, nothing rewritten) | two G2-3 tests | Pass |
| 11 | Credential history: actor and time, never the value | "11. records type, action, actor and time…" | Pass |
| 12 | Recovery links: Cloud Credentials with project, key-field anchor | "12. links to Google Cloud Credentials…" | Pass |
| 13 | Browser rendering and navigation | E2E "GQA-01/G3", "BUG-10 navigating…", UI audit; preview on real data | Pass |
| 14 | Admin-only controls | "14. admin-only…" (+ existing NEW-01 test) | Pass |
| — | Setup checklist: 5 steps, states, no secret in output | "the checklist has five steps…" | Pass |

## Existing tests updated
Placeholder keys (`"KEY"`, `"AIzaTESTKEY"`) and a client ID without the real shape (`123.apps…`) in `google-psi`, `google-service`, `qa-sprint` and `sprint6` tests became synthetic values in Google's documented shapes. The new checks correctly refuse the old placeholders. Test logic is unchanged.

## Browser preview on a copy of the real database (read-only, no worker, no Google calls)
| Screen | Observed |
|---|---|
| Google Connections | Checklist: 1 Done · 2 Needs attention ("looks like an OAuth client secret … No PageSpeed requests are sent") · 3 Done · 4 Needs attention ("may be out of date", checked 12:40 PM) · 5 To do. Test button replaced by "Testing is off until a Google API key is saved". Cloud link: project 154245030857. "No change recorded since change tracking started". |
| Overview, Settings, New Audit, SEO Overview, Search Console | "PageSpeed: the saved PageSpeed credential isn't a Google API key"; "Last checked Nov 4, 2026, 12:40 PM. This status may be out of date. Retry to check again." |
| PageSpeed | "Last successful results"; home page mobile: "Newer attempt failed: Nov 4, 2026, 2:09 PM: API key rejected" |
| SEO Overview: Recent Google requests | 8 entries from 11:47 AM shown as "Served from cache: original Google measurement at Nov 4, 2026, 10:19 AM" |
| Console | No errors |
| Live database | Unchanged (new table absent), confirmed read-only |

Screenshots (local, not committed): `%TEMP%\claude-chrome-screenshots-kv9sLW\screenshot-1793775737332-1.jpg` (checklist), `…screenshot-1793775776136-2.jpg` (key card and credential fields).

## Not tested (needs authorization)
- Pressing **Test PageSpeed key** or **Retry** against Google, and double-clicking the live button.
- Saving the real key, rotating the OAuth secret.
- The live app on port 3000 (still the old build until a restart is approved).

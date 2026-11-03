# Rule accuracy changes (Milestone 1)

Baseline: real audit of capitalhomemortgage.com, 20 pages × 5 viewports, 2026-11-03 (`runs/capitalhomemortgage.com/2026-11-03T02-40-45-560Z`).
Re-check: `npx tsx scripts/recheck.ts <runDir>` re-runs the current rules on that run's saved snapshots, so there is no new crawl and the data is identical.

## What the 3,874 findings were

| Pattern | Count | Verdict |
|---|---:|---|
| `tap-target-small` on 2×2px carousel bullets (review widget), every page × 3 mobile widths | 2,623 | Noise: one widget, collapsed or hidden dots |
| `tap-target-small` at 24–43px | 506 | Meets WCAG 2.2 AA (24px); below the AAA/platform 44px guideline |
| `placeholder-link` with `href=""` on `#sm-…` menu items | 110 distinct | Menu plugin submenu toggles; intended |
| `text-clipped` on `.skip-link` / `.ea11y-skip-to-content-link` | 36 | Screen-reader-only by design |
| Same element repeated across pages | 855 distinct rule + element pairs in total | Should be one finding with a page list |

## Changes
1. **Visually hidden elements** (≤ 2px in either dimension) are skipped by the size and clipping rules.
2. **Tap targets are tiered.** Under 24px → `tap-target-small`, confirmed (WCAG 2.2 AA 2.5.8). 24–43px → `tap-target-below-44`, recommendation (AAA 2.5.5 / mobile guideline).
3. **Menu toggles** (`aria-haspopup`, `aria-expanded`, `aria-controls`, or `has-submenu`/`toggle` classes) are not placeholder links.
4. **Fingerprint grouping:** rule + selector with `:nth-of-type()` removed (page path added for page-level rules). One finding per shared component, with all pages, viewports, instance count and raw occurrences kept for traceability.
5. **New rules:** broken images, broken internal links (HEAD/GET, rate-limited, robots-respected), navigation differing from most pages (needs review), empty headings, placeholder text, suspected misspellings (needs review), overlapping text (needs review), inconsistent repeated button components (recommendation).

## Result on the same data

| Rule | Before | After |
|---|---:|---:|
| `tap-target-small` | 3249 | 8 |
| `axe:color-contrast` | 264 | 132 |
| `placeholder-link` | 138 | 110 * |
| `axe:aria-valid-attr-value` | 50 | 31 |
| `text-clipped` | 36 | 0 |
| `section-padding-outlier` | 33 | 30 |
| `axe:link-in-text-block` | 30 | 29 |
| `heading-scale-inverted` | 20 | 17 |
| `axe:image-alt` | 15 | 1 |
| `axe:duplicate-id-aria` | 12 | 12 |
| `h1-multiple` | 5 | 5 |
| `axe:frame-title-unique` | 4 | 4 |
| `axe:form-field-multiple-labels` | 4 | 4 |
| `meta-description-missing` | 3 | 3 |
| `h1-missing` | 3 | 3 |
| `title-length` | 3 | 3 |
| `axe:bypass` | 2 | 1 |
| `axe:frame-title` | 1 | 1 |
| `button-text-wraps` | 1 | 1 |
| `line-height-tight` | 1 | 1 |
| `inconsistent-component` (new) | 0 | 18 |
| `tap-target-below-44` (new tier) | 0 | 268 |
| **Total** | **3,874** | **682** |

By kind: before 3,417 confirmed / 54 recommendations / 403 needs review. After: 50 confirmed / 334 recommendations / 298 needs review. 103 findings now cover two or more pages.

\* The old snapshots predate toggle detection, so the 110 `href=""` menu items can't be re-evaluated here. A fresh scan records `toggle` and should drop most of them.

## Limits of this comparison
- This measures **noise reduction**, not verified accuracy. No finding has been manually validated yet. The issue finder's "Confirm" and "Mark false positive" actions record that, and false-positive rates per rule can be computed from those decisions.
- Broken-link, navigation, toggle and overlap rules need new capture fields, so they only apply to new scans.
- Accessibility (axe) results from the old run were re-grouped, not re-evaluated. New runs save raw axe output per snapshot (`snapshots/<page>/<vw>.axe.json`).

import type { PageSnapshot } from "../types.js";

export type SpacingProp = "paddingTop" | "paddingBottom";
export const SPACING_PROPS: SpacingProp[] = ["paddingTop", "paddingBottom"];

export type Baseline = Map<string, Partial<Record<SpacingProp, { median: number; samples: number }>>>;

export const baselineKey = (sectionKind: string, viewport: number) => `${sectionKind}@${viewport}`;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Site-wide median padding per section kind and viewport, learned from every scanned page. */
export function buildBaseline(pages: PageSnapshot[]): Baseline {
  const values = new Map<string, Record<SpacingProp, number[]>>();
  for (const p of pages) {
    for (const e of p.elements) {
      if (e.role !== "section" || !e.sectionKind) continue;
      const key = baselineKey(e.sectionKind, p.viewport);
      const bucket = values.get(key) ?? { paddingTop: [], paddingBottom: [] };
      for (const prop of SPACING_PROPS) {
        const v = e.css[prop];
        if (typeof v === "number") bucket[prop].push(v);
      }
      values.set(key, bucket);
    }
  }
  const baseline: Baseline = new Map();
  for (const [key, bucket] of values) {
    const entry: Partial<Record<SpacingProp, { median: number; samples: number }>> = {};
    for (const prop of SPACING_PROPS) {
      if (bucket[prop].length) entry[prop] = { median: median(bucket[prop]), samples: bucket[prop].length };
    }
    baseline.set(key, entry);
  }
  return baseline;
}

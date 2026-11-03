import tokensJson from "../config/tokens.json" with { type: "json" };
import type { ElementSnapshot, PageSnapshot, Tokens } from "../src/types.js";

export const tokens = tokensJson as Tokens;

export function el(partial: Partial<ElementSnapshot> & { selector: string }): ElementSnapshot {
  return {
    tag: "div",
    role: "other",
    box: { x: 0, y: 0, w: 100, h: 50 },
    css: {},
    ...partial,
  };
}

export function page(partial: Partial<PageSnapshot> = {}): PageSnapshot {
  const viewport = partial.viewport ?? 1440;
  return {
    url: "https://example.com/",
    viewport,
    capturedAt: "2026-10-29T00:00:00.000Z",
    screenshot: `screenshots/home/${viewport}.png`,
    docWidth: viewport,
    docHeight: 3000,
    elements: [],
    ...partial,
    meta: {
      status: 200,
      finalUrl: partial.url ?? "https://example.com/",
      title: "Home Loans in Texas | Example Mortgage Company",
      metaDescription:
        "Example Mortgage helps Texas families buy and refinance homes with FHA, VA and conventional loans. Get a fast quote today.",
      canonical: partial.url ?? "https://example.com/",
      h1Count: 1,
      lang: "en",
      ...partial.meta,
    },
  };
}

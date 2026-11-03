// SYNTHETIC TEST DATA in the documented PageSpeed Insights v5 response shape
// (https://developers.google.com/speed/docs/insights/v5/reference/pagespeedapi/runpagespeed).
// Used only by unit tests; never shown in the app. Values are invented for the parser tests.
export function psiSample(over: { withField?: boolean; perf?: number } = {}) {
  const audit = (id: string, title: string, score: number | null, extra: Record<string, unknown> = {}) => ({ id, title, description: `${title}. [Learn more](https://developer.chrome.com/docs/lighthouse/${id}/)`, score, scoreDisplayMode: score === null ? "informative" : "numeric", ...extra });
  return {
    id: "https://example.com/",
    analysisUTCTimestamp: "2026-11-03T05:00:00.000Z",
    ...(over.withField === false ? {} : {
      loadingExperience: {
        id: "https://example.com/",
        overall_category: "AVERAGE",
        metrics: {
          LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3100, category: "AVERAGE" },
          INTERACTION_TO_NEXT_PAINT: { percentile: 180, category: "FAST" },
          CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 12, category: "AVERAGE" },
          FIRST_CONTENTFUL_PAINT_MS: { percentile: 1700, category: "FAST" },
          EXPERIMENTAL_TIME_TO_FIRST_BYTE: { percentile: 900, category: "AVERAGE" },
        },
      },
    }),
    lighthouseResult: {
      requestedUrl: "https://example.com/",
      finalDisplayedUrl: "https://example.com/",
      lighthouseVersion: "12.6.0",
      fetchTime: "2026-11-03T05:00:01.000Z",
      runWarnings: [],
      configSettings: { formFactor: "mobile" },
      categories: {
        performance: {
          id: "performance", title: "Performance", score: over.perf ?? 0.42,
          auditRefs: [
            { id: "largest-contentful-paint", group: "metrics", weight: 25 },
            { id: "first-contentful-paint", group: "metrics", weight: 10 },
            { id: "cumulative-layout-shift", group: "metrics", weight: 25 },
            { id: "total-blocking-time", group: "metrics", weight: 30 },
            { id: "speed-index", group: "metrics", weight: 10 },
            { id: "render-blocking-insight", group: "insights", weight: 0 },
            { id: "image-delivery-insight", group: "insights", weight: 0 },
            { id: "unused-javascript", group: "diagnostics", weight: 0 },
            { id: "mainthread-work-breakdown", group: "diagnostics", weight: 0 },
            { id: "uses-http2", group: "diagnostics", weight: 0 },
          ],
        },
        accessibility: { id: "accessibility", title: "Accessibility", score: 0.88, auditRefs: [{ id: "color-contrast", weight: 7, group: "a11y-color-contrast" }, { id: "image-alt", weight: 10, group: "a11y-names-labels" }] },
        "best-practices": { id: "best-practices", title: "Best Practices", score: 0.96, auditRefs: [{ id: "errors-in-console", weight: 1, group: "best-practices-general" }] },
        seo: { id: "seo", title: "SEO", score: 0.92, auditRefs: [{ id: "meta-description", weight: 1, group: "seo-content" }, { id: "is-crawlable", weight: 4.04, group: "seo-crawl" }] },
      },
      audits: {
        "largest-contentful-paint": audit("largest-contentful-paint", "Largest Contentful Paint", 0.12, { numericValue: 6230.4, numericUnit: "millisecond", displayValue: "6.2 s" }),
        "first-contentful-paint": audit("first-contentful-paint", "First Contentful Paint", 0.55, { numericValue: 2800, numericUnit: "millisecond", displayValue: "2.8 s" }),
        "cumulative-layout-shift": audit("cumulative-layout-shift", "Cumulative Layout Shift", 0.6, { numericValue: 0.183, numericUnit: "unitless", displayValue: "0.183" }),
        "total-blocking-time": audit("total-blocking-time", "Total Blocking Time", 0.3, { numericValue: 740, numericUnit: "millisecond", displayValue: "740 ms" }),
        "speed-index": audit("speed-index", "Speed Index", 0.45, { numericValue: 5900, numericUnit: "millisecond", displayValue: "5.9 s" }),
        "render-blocking-insight": audit("render-blocking-insight", "Render blocking requests", 0, {
          scoreDisplayMode: "metricSavings", displayValue: "Est savings of 1,200 ms", metricSavings: { FCP: 1200, LCP: 1200 },
          details: { type: "table", items: [{ url: "https://example.com/wp-content/themes/x/style.css", totalBytes: 98000, wastedMs: 900 }] },
        }),
        "image-delivery-insight": audit("image-delivery-insight", "Improve image delivery", 0, {
          scoreDisplayMode: "metricSavings", displayValue: "Est savings of 840 KiB", metricSavings: { LCP: 600 },
          details: { type: "table", items: [{ url: "https://example.com/wp-content/uploads/hero.jpg", totalBytes: 1200000, wastedBytes: 860000 }] },
        }),
        "unused-javascript": audit("unused-javascript", "Reduce unused JavaScript", 0.5, {
          scoreDisplayMode: "metricSavings", displayValue: "Est savings of 310 KiB", metricSavings: { LCP: 300 },
          details: { type: "opportunity", overallSavingsMs: 450, overallSavingsBytes: 317440, items: [{ url: "https://example.com/app.js", wastedBytes: 200000 }] },
        }),
        "mainthread-work-breakdown": audit("mainthread-work-breakdown", "Minimize main-thread work", 0, { numericValue: 4100, numericUnit: "millisecond", displayValue: "4.1 s", details: { type: "table", items: [] } }),
        "uses-http2": audit("uses-http2", "Use HTTP/2", 1),
        "color-contrast": audit("color-contrast", "Background and foreground colors do not have a sufficient contrast ratio.", 0, { scoreDisplayMode: "binary" }),
        "image-alt": audit("image-alt", "Image elements have [alt] attributes", 1, { scoreDisplayMode: "binary" }),
        "errors-in-console": audit("errors-in-console", "Browser errors were logged to the console", 0, { scoreDisplayMode: "binary" }),
        "meta-description": audit("meta-description", "Document does not have a meta description", 0, { scoreDisplayMode: "binary" }),
        "is-crawlable": audit("is-crawlable", "Page isn't blocked from indexing", 1, { scoreDisplayMode: "binary" }),
      },
    },
  };
}

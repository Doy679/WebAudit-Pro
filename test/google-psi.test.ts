import { describe, it, expect, vi } from "vitest";
import { parsePsi, runPsi, psiFindings, psiReportUrl, PsiQuotaError, PsiConfigError, PsiPageError } from "../server/google/psi";
import { parseCruxRecord, cruxCategory } from "../server/google/crux";
import { psiSample } from "./fixtures/google/psi-sample";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("parsePsi", () => {
  const r = parsePsi(psiSample(), "mobile");

  it("reads category scores as 0–100 and keeps missing ones as null", () => {
    expect(r.scores).toEqual({ performance: 42, accessibility: 88, bestPractices: 96, seo: 92 });
    const noSeo = psiSample();
    delete (noSeo.lighthouseResult.categories as Record<string, unknown>).seo;
    expect(parsePsi(noSeo, "mobile").scores.seo).toBeNull();
  });

  it("reads lab metrics with units from Lighthouse", () => {
    expect(r.lab.lcp).toEqual({ value: 6230.4, unit: "ms", display: "6.2 s", score: 0.12 });
    expect(r.lab.cls).toEqual({ value: 0.183, unit: "unitless", display: "0.183", score: 0.6 });
    expect(r.lab.tbt?.value).toBe(740);
    expect(r.lab.si?.value).toBe(5900);
  });

  it("labels field data as real-user CrUX data and converts CLS from the API's ×100 integer", () => {
    expect(r.field?.source).toBe("psi-crux");
    expect(r.field?.metrics.lcp).toEqual({ p75: 3100, unit: "ms", category: "needs-improvement" });
    expect(r.field?.metrics.cls).toEqual({ p75: 0.12, unit: "unitless", category: "needs-improvement" });
    expect(r.field?.metrics.inp?.category).toBe("good");
  });

  it("returns no field data rather than inventing it when PSI omits loadingExperience", () => {
    expect(parsePsi(psiSample({ withField: false }), "mobile").field).toBeNull();
  });

  it("lists opportunities with savings and diagnostics, excluding passed audits", () => {
    expect(r.opportunities.map((o) => o.id)).toEqual(["render-blocking-insight", "image-delivery-insight", "unused-javascript"]);
    const img = r.opportunities.find((o) => o.id === "image-delivery-insight")!;
    expect(img.displayValue).toBe("Est savings of 840 KiB");
    expect(img.metricSavings).toEqual({ LCP: 600 });
    expect(r.diagnostics.map((d) => d.id)).toEqual(["mainthread-work-breakdown"]);
    expect(r.failedChecks.accessibility.map((a) => a.id)).toEqual(["color-contrast"]);
    expect(r.failedChecks.seo.map((a) => a.id)).toEqual(["meta-description"]);
  });

  it("links to the official PageSpeed Insights report", () => {
    expect(psiReportUrl("https://example.com/a?b=1", "desktop")).toBe("https://pagespeed.web.dev/report?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&form_factor=desktop");
  });
});

describe("psiFindings", () => {
  const findings = psiFindings(parsePsi(psiSample(), "mobile"), "https://example.com/");

  it("turns opportunities into recommendations (never confirmed malfunctions) with the original audit id", () => {
    const rb = findings.find((f) => f.metricKey === "render-blocking-insight")!;
    expect(rb.kind).toBe("recommendation");
    expect(rb.type).toBe("performance");
    expect(rb.provider).toBe("psi");
    expect(rb.current).toContain("1,200 ms");
    expect(rb.evidence).toContain("style.css");
  });

  it("reports poor real-user Core Web Vitals as confirmed field measurements, and poor lab metrics as recommendations", () => {
    const poor = psiFindings(parsePsi({ ...psiSample(), loadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 5200, category: "SLOW" } } } }, "mobile"), "https://example.com/");
    const field = poor.find((f) => f.metricKey === "crux:lcp")!;
    expect([field.type, field.kind]).toEqual(["cwv", "confirmed"]);
    const lab = findings.find((f) => f.metricKey === "lab:largest-contentful-paint")!;
    expect(lab.kind).toBe("recommendation");
    expect(lab.current).toContain("6.2 s");
  });

  it("does not create findings for accessibility audits (the internal axe-core engine covers them)", () => {
    expect(findings.some((f) => f.metricKey === "color-contrast")).toBe(false);
  });
});

describe("runPsi", () => {
  it("requests all four categories with the key and strategy", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json(psiSample()));
    await runPsi("https://example.com/", "desktop", { apiKey: "KEY", fetchImpl, retries: 0 });
    const url = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    expect(url.searchParams.get("strategy")).toBe("desktop");
    expect(url.searchParams.getAll("category")).toEqual(["performance", "accessibility", "best-practices", "seo"]);
    expect(url.searchParams.get("key")).toBe("KEY");
  });

  it("stops on a daily quota error instead of retrying", async () => {
    const fetchImpl = vi.fn(async () => json({ error: { code: 429, message: "Quota exceeded for quota metric 'Queries' and limit 'Queries per day'", status: "RESOURCE_EXHAUSTED" } }, 429));
    await expect(runPsi("https://example.com/", "mobile", { apiKey: "K", fetchImpl, retries: 3, backoffMs: 1 })).rejects.toBeInstanceOf(PsiQuotaError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries transient errors with backoff", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => (++n < 3 ? json({ error: { code: 500, message: "backend" } }, 500) : json(psiSample())));
    const r = await runPsi("https://example.com/", "mobile", { apiKey: "K", fetchImpl, retries: 3, backoffMs: 1 });
    expect(r.scores.performance).toBe(42);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("reports invalid keys and Lighthouse page failures distinctly", async () => {
    await expect(runPsi("https://example.com/", "mobile", { apiKey: "bad", fetchImpl: async () => json({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }, 400), retries: 0 }))
      .rejects.toBeInstanceOf(PsiConfigError);
    const failed = psiSample();
    (failed.lighthouseResult as Record<string, unknown>).runtimeError = { code: "FAILED_DOCUMENT_REQUEST", message: "Lighthouse was unable to reliably load the page" };
    await expect(runPsi("https://example.com/", "mobile", { apiKey: "K", fetchImpl: async () => json(failed), retries: 0 })).rejects.toBeInstanceOf(PsiPageError);
  });
});

describe("CrUX adapter", () => {
  it("parses p75 values and classifies them with Google's thresholds", () => {
    const rec = parseCruxRecord({
      record: {
        key: { url: "https://example.com/", formFactor: "PHONE" },
        metrics: {
          largest_contentful_paint: { percentiles: { p75: 2300 } },
          interaction_to_next_paint: { percentiles: { p75: 560 } },
          cumulative_layout_shift: { percentiles: { p75: "0.14" } },
        },
        collectionPeriod: { firstDate: { year: 2026, month: 10, day: 5 }, lastDate: { year: 2026, month: 11, day: 1 } },
      },
    });
    expect(rec.metrics.lcp).toEqual({ p75: 2300, unit: "ms", category: "good" });
    expect(rec.metrics.inp?.category).toBe("poor");
    expect(rec.metrics.cls).toEqual({ p75: 0.14, unit: "unitless", category: "needs-improvement" });
    expect(rec.period).toBe("2026-10-05 to 2026-11-01");
    expect(rec.source).toBe("crux-api");
  });

  it("uses the documented thresholds", () => {
    expect(cruxCategory("lcp", 2500)).toBe("good");
    expect(cruxCategory("lcp", 4001)).toBe("poor");
    expect(cruxCategory("inp", 200)).toBe("good");
    expect(cruxCategory("cls", 0.25)).toBe("needs-improvement");
  });
});

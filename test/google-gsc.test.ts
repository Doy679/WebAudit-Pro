import { describe, it, expect, vi } from "vitest";
import {
  authUrl, pkcePair, exchangeCode, refreshAccess, revokeToken, listSites, searchAnalytics, listSitemaps, inspectUrl,
  propertyCoversUrl, propertyMatchesDomain, GscAuthError, GscPermissionError, GscQuotaError, parseInspection, inspectionFindings, sitemapFindings,
} from "../server/google/gsc";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("OAuth", () => {
  it("requests only the read-only Search Console scope, offline access and PKCE", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    const u = new URL(authUrl({ clientId: "id.apps.googleusercontent.com", redirectUri: "http://localhost:3000/api/google/oauth/callback", state: "S", challenge }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/webmasters.readonly");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toBe(challenge);
    expect(u.searchParams.get("state")).toBe("S");
  });

  it("exchanges the code server-side and requires a refresh token", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ access_token: "A", expires_in: 3599, refresh_token: "R", scope: "https://www.googleapis.com/auth/webmasters.readonly", token_type: "Bearer" }));
    const t = await exchangeCode({ code: "C", verifier: "V", clientId: "id", clientSecret: "sec", redirectUri: "http://x/cb" }, fetchImpl);
    expect(t).toMatchObject({ accessToken: "A", refreshToken: "R" });
    const body = new URLSearchParams(fetchImpl.mock.calls[0][1]!.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("V");
    await expect(exchangeCode({ code: "C", verifier: "V", clientId: "id", clientSecret: "s", redirectUri: "r" }, async () => json({ access_token: "A", expires_in: 1, scope: "https://www.googleapis.com/auth/webmasters.readonly" })))
      .rejects.toThrow(/refresh token/);
  });

  it("rejects a grant that is missing the Search Console scope", async () => {
    await expect(exchangeCode({ code: "C", verifier: "V", clientId: "id", clientSecret: "s", redirectUri: "r" },
      async () => json({ access_token: "A", refresh_token: "R", expires_in: 1, scope: "openid" }))).rejects.toThrow(/Search Console/);
  });

  it("turns a revoked refresh token into an auth error that asks to reconnect", async () => {
    await expect(refreshAccess({ refreshToken: "R", clientId: "i", clientSecret: "s" }, async () => json({ error: "invalid_grant" }, 400))).rejects.toBeInstanceOf(GscAuthError);
  });

  it("revokes tokens at Google", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response("", { status: 200 }));
    await revokeToken("R", fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/revoke");
  });
});

describe("read-only API calls", () => {
  it("lists properties with permission levels", async () => {
    const sites = await listSites("A", async () => json({ siteEntry: [{ siteUrl: "sc-domain:capitalhomemortgage.com", permissionLevel: "siteOwner" }, { siteUrl: "https://x.com/", permissionLevel: "siteUnverifiedUser" }] }));
    expect(sites).toEqual([{ siteUrl: "sc-domain:capitalhomemortgage.com", permissionLevel: "siteOwner" }, { siteUrl: "https://x.com/", permissionLevel: "siteUnverifiedUser" }]);
  });

  it("encodes the property in Search Analytics requests and returns rows", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ rows: [{ keys: ["mortgage"], clicks: 10, impressions: 200, ctr: 0.05, position: 7.2 }], responseAggregationType: "byProperty" }));
    const rows = await searchAnalytics("A", "sc-domain:capitalhomemortgage.com", { startDate: "2026-10-01", endDate: "2026-10-28", dimensions: ["query"], rowLimit: 25 }, fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Acapitalhomemortgage.com/searchAnalytics/query");
    expect(rows[0]).toMatchObject({ keys: ["mortgage"], clicks: 10 });
  });

  it("maps 403 to a permission error and 429 to a quota error", async () => {
    await expect(listSitemaps("A", "sc-domain:x.com", async () => json({ error: { code: 403, message: "User does not have sufficient permission for site" } }, 403))).rejects.toBeInstanceOf(GscPermissionError);
    await expect(inspectUrl("A", "sc-domain:x.com", "https://x.com/", async () => json({ error: { code: 429, message: "Quota exceeded" } }, 429))).rejects.toBeInstanceOf(GscQuotaError);
    await expect(listSites("A", async () => json({ error: { code: 401, message: "Invalid Credentials" } }, 401))).rejects.toBeInstanceOf(GscAuthError);
  });

  it("calls the URL Inspection endpoint with the property", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ inspectionResult: { indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed" } } }));
    await inspectUrl("A", "sc-domain:x.com", "https://x.com/a", fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect");
    expect(JSON.parse(fetchImpl.mock.calls[0][1]!.body as string)).toEqual({ inspectionUrl: "https://x.com/a", siteUrl: "sc-domain:x.com" });
  });
});

describe("property scope", () => {
  it("matches domain and URL-prefix properties to a project domain", () => {
    expect(propertyMatchesDomain("sc-domain:capitalhomemortgage.com", "capitalhomemortgage.com")).toBe(true);
    expect(propertyMatchesDomain("https://www.capitalhomemortgage.com/", "capitalhomemortgage.com")).toBe(true);
    expect(propertyMatchesDomain("sc-domain:other.com", "capitalhomemortgage.com")).toBe(false);
  });

  it("only allows inspecting URLs inside the property", () => {
    expect(propertyCoversUrl("sc-domain:x.com", "https://blog.x.com/a")).toBe(true);
    expect(propertyCoversUrl("https://x.com/blog/", "https://x.com/blog/post")).toBe(true);
    expect(propertyCoversUrl("https://x.com/blog/", "https://x.com/shop")).toBe(false);
    expect(propertyCoversUrl("sc-domain:x.com", "https://evilx.com/")).toBe(false);
  });
});

describe("inspection and sitemap findings", () => {
  const raw = {
    inspectionResult: {
      inspectionResultLink: "https://search.google.com/search-console/inspect?resource_id=x",
      indexStatusResult: {
        verdict: "NEUTRAL", coverageState: "Crawled - currently not indexed", robotsTxtState: "ALLOWED", indexingState: "INDEXING_ALLOWED",
        lastCrawlTime: "2026-10-20T08:00:00Z", pageFetchState: "SUCCESSFUL", googleCanonical: "https://x.com/a/", userCanonical: "https://x.com/a",
      },
      richResultsResult: { verdict: "FAIL", detectedItems: [{ richResultType: "Breadcrumbs", items: [{ name: "Unnamed item", issues: [{ issueMessage: "Missing field \"item\"", severity: "ERROR" }] }] }] },
    },
  };

  it("keeps Google's fields and marks missing ones as unavailable", () => {
    const p = parseInspection(raw);
    expect(p).toMatchObject({ verdict: "NEUTRAL", coverageState: "Crawled - currently not indexed", lastCrawlTime: "2026-10-20T08:00:00Z", googleCanonical: "https://x.com/a/" });
    expect(parseInspection({ inspectionResult: {} }).verdict).toBeNull();
  });

  it("creates indexing, canonical and rich-result findings labelled as Google-indexed information", () => {
    const f = inspectionFindings(parseInspection(raw), "https://x.com/a", "2026-11-03T00:00:00Z");
    expect(f.map((x) => x.metricKey).sort()).toEqual(["gsc:canonical", "gsc:coverage", "gsc:rich:Breadcrumbs"]);
    expect(f.every((x) => x.provider === "gsc")).toBe(true);
    expect(f.find((x) => x.metricKey === "gsc:coverage")!.evidence).toMatch(/last crawled/i);
    expect(f.find((x) => x.metricKey === "gsc:canonical")!.kind).toBe("needs-review");
  });

  it("produces nothing for a healthy indexed page", () => {
    const ok = parseInspection({ inspectionResult: { indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed", pageFetchState: "SUCCESSFUL", robotsTxtState: "ALLOWED", googleCanonical: "https://x.com/", userCanonical: "https://x.com/" } } });
    expect(inspectionFindings(ok, "https://x.com/", "t")).toEqual([]);
  });

  it("reports sitemaps with errors", () => {
    const f = sitemapFindings([{ path: "https://x.com/sitemap.xml", errors: 3, warnings: 1, lastDownloaded: "2026-11-01T00:00:00Z" }, { path: "https://x.com/ok.xml", errors: 0, warnings: 0 }], "sc-domain:x.com", "t");
    expect(f).toHaveLength(1);
    expect(f[0].current).toContain("3 errors");
  });
});

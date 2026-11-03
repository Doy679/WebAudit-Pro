// Central project-scope rules, used by the web app, the worker and the audit engine.
// A URL is in scope only when its hostname equals the project's domain (www. ignored).
// Subdomains count only when explicitly authorized. There is no substring matching.

export interface ScopeProject {
  name: string;
  domain: string;
  /** Subdomains (shop.example.com) are audited only when this is explicitly set. */
  includeSubdomains?: boolean;
}

export class ScopeError extends Error {}

export const bareHost = (hostname: string) => hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");

function parse(url: string): URL | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

export function hostInScope(hostname: string, p: Pick<ScopeProject, "domain" | "includeSubdomains">): boolean {
  const host = bareHost(hostname);
  const domain = bareHost(p.domain);
  return host === domain || (!!p.includeSubdomains && host.endsWith(`.${domain}`));
}

export function urlInProjectScope(p: Pick<ScopeProject, "domain" | "includeSubdomains">, url: string): boolean {
  const u = parse(url);
  return !!u && hostInScope(u.hostname, p);
}

/** Throws an actionable message naming the selected project and the URL's actual domain. */
export function assertUrlInProjectScope(p: ScopeProject, url: string): URL {
  const u = parse(url);
  if (!u) throw new ScopeError(`"${url}" isn't a valid http(s) website address.`);
  if (!hostInScope(u.hostname, p)) {
    throw new ScopeError(`You selected ${p.name}, but the entered URL belongs to ${bareHost(u.hostname)}. Correct the URL or select the matching project.`);
  }
  return u;
}

/** Builds the scope predicate the engine uses for discovered, redirected and linked URLs. */
export const scopePredicate = (p: Pick<ScopeProject, "domain" | "includeSubdomains">) => (url: string) => urlInProjectScope(p, url);

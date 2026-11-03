const section = (u: string) => new URL(u).pathname.split("/").filter(Boolean)[0] ?? "";

/**
 * Picks up to `max` pages: start URL first, then round-robin across top-level
 * path sections so one big section (e.g. /blog) can't crowd out the rest.
 */
export function samplePages(startUrl: string, urls: string[], max: number): string[] {
  const seen = new Set<string>([startUrl]);
  const groups = new Map<string, string[]>();
  for (const u of urls) {
    if (seen.has(u)) continue;
    seen.add(u);
    const key = section(u);
    groups.set(key, [...(groups.get(key) ?? []), u]);
  }
  // Smaller sections first: they are usually the key service/landing pages.
  const queues = [...groups.values()].sort((a, b) => a.length - b.length);
  const picked = [startUrl];
  while (picked.length < max && queues.some((q) => q.length)) {
    for (const q of queues) {
      if (picked.length >= max) break;
      const next = q.shift();
      if (next) picked.push(next);
    }
  }
  return picked;
}

import type { Issue } from "../types.js";

export interface ReportMeta {
  startUrl: string;
  startedAt: string;
  finishedAt: string;
  pages: { url: string; ok: boolean; status: number; error?: string }[];
  skipped: { url: string; reason: string }[];
}

// JSON inside <script> must not be able to close the tag. Crawled text is untrusted.
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
const safeJson = (v: unknown) =>
  JSON.stringify(v).replace(/</g, "\\u003c").split(LS).join("\\u2028").split(PS).join("\\u2029");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Static, self-contained report. All issue text is rendered with textContent (never innerHTML). */
export function renderReport(issues: Issue[], meta: ReportMeta): string {
  const host = new URL(meta.startUrl).host;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Site Audit: ${esc(host)}</title>
<style>
:root{--bg:#f7f7f5;--panel:#fff;--ink:#1d1d1b;--muted:#6b6b66;--line:#e4e3de;--accent:#2f5bd3;
--high:#c9372c;--high-bg:#fdecea;--med:#b25e09;--med-bg:#fdf1e3;--low:#4d6b8a;--low-bg:#eaf0f6;
--ok:#2f7d4f;--ok-bg:#e6f4ec;--code:#f1f0ec}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#161615;--panel:#1f1f1d;--ink:#ecebe6;--muted:#9c9b95;--line:#33332f;--accent:#7c9cf0;
--high:#ff8a80;--high-bg:#3a1f1d;--med:#f2b45c;--med-bg:#3a2c18;--low:#9ab8d6;--low-bg:#1f2a35;--ok:#7fd1a1;--ok-bg:#1b3326;--code:#2a2a27}}
:root[data-theme="dark"]{--bg:#161615;--panel:#1f1f1d;--ink:#ecebe6;--muted:#9c9b95;--line:#33332f;--accent:#7c9cf0;
--high:#ff8a80;--high-bg:#3a1f1d;--med:#f2b45c;--med-bg:#3a2c18;--low:#9ab8d6;--low-bg:#1f2a35;--ok:#7fd1a1;--ok-bg:#1b3326;--code:#2a2a27}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
header{padding:28px 16px 8px;max-width:1200px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}
.sub{color:var(--muted);font-size:13px}
.stats{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 4px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px 12px;min-width:96px}
.stat b{display:block;font-size:20px;font-variant-numeric:tabular-nums}
.stat span{font-size:12px;color:var(--muted)}
.filters{position:sticky;top:0;z-index:2;background:var(--bg);border-bottom:1px solid var(--line)}
.filters .in{max-width:1200px;margin:0 auto;padding:10px 16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
select,input{font:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink);max-width:100%}
input{flex:1;min-width:160px}
.count{font-size:13px;color:var(--muted);margin-left:auto}
main{max-width:1200px;margin:0 auto;padding:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;margin-bottom:12px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,420px);overflow:hidden}
@media (max-width:820px){.card{grid-template-columns:minmax(0,1fr)}}
.body{padding:14px 16px;min-width:0}
.top{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px}
.id{font:600 12px ui-monospace,Consolas,monospace;color:var(--muted)}
.badge{font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;text-transform:uppercase;letter-spacing:.03em}
.sev-high{background:var(--high-bg);color:var(--high)}.sev-medium{background:var(--med-bg);color:var(--med)}.sev-low{background:var(--low-bg);color:var(--low)}
.kind{border:1px solid var(--line);color:var(--muted)}
.kind-confirmed{background:var(--ok-bg);color:var(--ok);border-color:transparent}
h2{font-size:16px;margin:0 0 6px}
.loc{font-size:12px;color:var(--muted);word-break:break-all}
.loc a{color:var(--accent)}
code{font:12px ui-monospace,Consolas,monospace;background:var(--code);padding:1px 5px;border-radius:4px;word-break:break-all}
.cmp{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 10px;margin:10px 0;font-size:13px}
.cmp dt{color:var(--muted)}.cmp dd{margin:0;word-break:break-word}
.rec{font-size:13px;margin:0}
.shot{background:var(--code);display:flex;align-items:flex-start;justify-content:center;min-height:120px;border-left:1px solid var(--line)}
.shot a{display:block;width:100%}
.shot img{display:block;width:100%;height:auto;max-height:420px;object-fit:cover;object-position:top}
.noshot{color:var(--muted);font-size:12px;padding:16px;align-self:center}
.vps{display:flex;gap:4px;flex-wrap:wrap;margin-top:8px}
.vps a{font-size:11px;color:var(--accent);border:1px solid var(--line);border-radius:4px;padding:1px 6px;text-decoration:none}
details{margin-top:24px;font-size:13px}
details li{word-break:break-all}
.empty{color:var(--muted);text-align:center;padding:40px 0}
</style>
</head>
<body>
<header>
  <h1>Site audit · ${esc(host)}</h1>
  <div class="sub">Read-only scan of ${meta.pages.length} page(s) · ${esc(new Date(meta.finishedAt).toLocaleString("en-US"))} · Findings are pending internal review</div>
  <div class="stats" id="stats"></div>
</header>
<div class="filters"><div class="in">
  <select id="f-page"><option value="">All pages</option></select>
  <select id="f-vp"><option value="">All viewports</option></select>
  <select id="f-sev"><option value="">All severities</option><option>high</option><option>medium</option><option>low</option></select>
  <select id="f-type"><option value="">All types</option></select>
  <select id="f-kind"><option value="">All kinds</option><option value="confirmed">Confirmed</option><option value="recommendation">Recommendation</option><option value="needs-review">Needs review</option></select>
  <input id="f-q" type="search" placeholder="Search rule, selector, text…">
  <span class="count" id="count"></span>
</div></div>
<main>
  <div id="list"></div>
  <details><summary>Pages scanned and skipped</summary><ul id="pages"></ul></details>
</main>
<script type="application/json" id="data">${safeJson({ issues, meta })}</script>
<script>
const { issues, meta } = JSON.parse(document.getElementById("data").textContent);
const $ = (id) => document.getElementById(id);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) k === "class" ? (el.className = v) : el.setAttribute(k, v);
  for (const k of kids) if (k != null) el.append(k);
  return el;
};
const KIND = { confirmed: "Confirmed", recommendation: "Recommendation", "needs-review": "Needs review" };
const path = (u) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };

const stat = (n, label) => h("div", { class: "stat" }, h("b", {}, String(n)), h("span", {}, label));
const by = (k) => (v) => issues.filter((i) => i[k] === v).length;
$("stats").append(stat(issues.length, "issues"), stat(by("severity")("high"), "high"), stat(by("severity")("medium"), "medium"),
  stat(by("kind")("confirmed"), "confirmed"), stat(by("kind")("recommendation"), "recommendations"), stat(by("kind")("needs-review"), "need review"));

const opts = (sel, values, label = (v) => v) => values.forEach((v) => sel.append(h("option", { value: String(v) }, label(v))));
opts($("f-page"), [...new Set(issues.map((i) => i.location.url))].sort(), path);
opts($("f-vp"), [...new Set(issues.flatMap((i) => i.location.viewports))].sort((a, b) => a - b), (v) => v + "px");
opts($("f-type"), [...new Set(issues.map((i) => i.type))].sort());

function card(i) {
  const shot = i.evidence.annotated;
  const cmp = h("dl", { class: "cmp" });
  if (i.current) cmp.append(h("dt", {}, "Current"), h("dd", {}, i.current));
  if (i.proposed) cmp.append(h("dt", {}, "Proposed"), h("dd", {}, i.proposed));
  if (i.location.selector) cmp.append(h("dt", {}, "Element"), h("dd", {}, h("code", {}, i.location.selector)));
  if (i.location.elementorId) cmp.append(h("dt", {}, "Elementor"), h("dd", {}, h("code", {}, i.location.elementorId)));
  cmp.append(h("dt", {}, "Confidence"), h("dd", {}, Math.round(i.confidence * 100) + "%"));
  const vps = h("div", { class: "vps" }, ...i.evidence.screenshots.filter((s) => s.path).map((s) => h("a", { href: s.path, target: "_blank" }, s.viewport + "px full page")));
  return h("article", { class: "card" },
    h("div", { class: "body" },
      h("div", { class: "top" },
        h("span", { class: "id" }, i.id),
        h("span", { class: "badge sev-" + i.severity }, i.severity),
        h("span", { class: "badge kind kind-" + i.kind }, KIND[i.kind]),
        h("span", { class: "badge kind" }, i.type),
        i.sharedTemplate ? h("span", { class: "badge kind" }, "shared template") : null),
      h("h2", {}, i.title),
      h("div", { class: "loc" }, h("a", { href: i.location.url, target: "_blank", rel: "noopener noreferrer" }, path(i.location.url)),
        " · " + i.location.viewports.map((v) => v + "px").join(", ") + " · " + i.rule),
      cmp,
      h("p", { class: "rec" }, i.recommendation),
      vps),
    h("div", { class: "shot" }, shot ? h("a", { href: shot, target: "_blank" }, h("img", { src: shot, alt: "Screenshot for " + i.id, loading: "lazy" }))
      : h("div", { class: "noshot" }, "Page-level finding, no element to highlight")));
}

function render() {
  const f = { page: $("f-page").value, vp: $("f-vp").value, sev: $("f-sev").value, type: $("f-type").value, kind: $("f-kind").value, q: $("f-q").value.toLowerCase() };
  const shown = issues.filter((i) =>
    (!f.page || i.location.url === f.page) && (!f.vp || i.location.viewports.includes(+f.vp)) &&
    (!f.sev || i.severity === f.sev) && (!f.type || i.type === f.type) && (!f.kind || i.kind === f.kind) &&
    (!f.q || [i.id, i.rule, i.title, i.location.selector, i.current, i.proposed, i.recommendation].join(" ").toLowerCase().includes(f.q)));
  $("list").replaceChildren(...(shown.length ? shown.map(card) : [h("div", { class: "empty" }, "No issues match these filters.")]));
  $("count").textContent = shown.length + " of " + issues.length;
}
["f-page", "f-vp", "f-sev", "f-type", "f-kind", "f-q"].forEach((id) => $(id).addEventListener("input", render));
render();

for (const p of meta.pages) $("pages").append(h("li", {}, (p.ok ? "✓ " : "✗ ") + p.url + " (HTTP " + p.status + (p.error ? ", " + p.error : "") + ")"));
for (const s of meta.skipped) $("pages").append(h("li", {}, "skipped " + s.url + " (" + s.reason + ")"));
</script>
</body>
</html>
`;
}

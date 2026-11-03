// Runs inside the audited page (our own headless browser only) and returns plain JSON.
// Read-only: measures layout and computed styles, never changes the DOM.
(() => {
  const vw = window.innerWidth;
  const sx = window.scrollX, sy = window.scrollY;
  const MAX = { text: 600, link: 300, button: 200, overflow: 20 };

  const visible = (el, cs) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0;
  };
  const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.round(n * 10) / 10 : undefined; };
  const isUnique = (s) => { try { return document.querySelectorAll(s).length === 1; } catch { return false; } };

  function selectorFor(el) {
    const elementorCls = [...el.classList].find((c) => /^elementor-element-[0-9a-f]{5,}$/.test(c));
    if (elementorCls && isUnique("." + elementorCls)) return "." + elementorCls;
    if (el.id && isUnique("#" + CSS.escape(el.id))) return "#" + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 5) {
      if (cur !== el && cur.id && isUnique("#" + CSS.escape(cur.id))) { parts.unshift("#" + CSS.escape(cur.id)); break; }
      let part = cur.tagName.toLowerCase();
      const cls = [...cur.classList].filter((c) => /^[a-zA-Z][\w-]*$/.test(c) && !/^(active|is-|has-|hover|focus|elementor-animation)/.test(c)).slice(0, 2);
      if (cls.length) part += "." + cls.map((c) => CSS.escape(c)).join(".");
      const parent = cur.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(" > ");
  }

  function lineCount(el, lineHeight) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const tops = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0).map((r) => r.top).sort((a, b) => a - b);
    if (!tops.length) return 1;
    let lines = 1;
    for (let i = 1; i < tops.length; i++) if (tops[i] - tops[i - 1] > lineHeight * 0.5) lines++;
    return lines;
  }

  function describe(el, role, cs, extra = {}) {
    const r = el.getBoundingClientRect();
    const fontSize = px(cs.fontSize);
    const lineHeight = cs.lineHeight === "normal" ? (fontSize ? Math.round(fontSize * 1.2 * 10) / 10 : undefined) : px(cs.lineHeight);
    const elementorEl = el.closest(".elementor-element[data-id]");
    const shared = !!el.closest("header, footer, [data-elementor-type=header], [data-elementor-type=footer], .elementor-location-header, .elementor-location-footer");
    const out = {
      selector: selectorFor(el),
      tag: el.tagName.toLowerCase(),
      role,
      box: { x: Math.round(r.left + sx), y: Math.round(r.top + sy), w: Math.round(r.width), h: Math.round(r.height) },
      css: {
        paddingTop: px(cs.paddingTop), paddingBottom: px(cs.paddingBottom),
        marginTop: px(cs.marginTop), marginBottom: px(cs.marginBottom),
        fontSize, lineHeight, whiteSpace: cs.whiteSpace, overflowX: cs.overflowX, overflowY: cs.overflowY,
      },
      ...extra,
    };
    const text = (el.innerText || el.value || "").replace(/\s+/g, " ").trim();
    if (text) out.text = text.slice(0, 120);
    if (elementorEl) out.elementorId = elementorEl.getAttribute("data-id");
    if (shared) out.sharedTemplate = true;
    if (role !== "section" && role !== "other") out.scroll = { sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight };
    return out;
  }

  const elements = [];
  const seen = new Set();
  const push = (el, role, limit, extra) => {
    if (seen.has(el)) return;
    const cs = getComputedStyle(el);
    if (!visible(el, cs)) return;
    if (limit !== undefined && elements.filter((e) => e.role === role).length >= limit) return;
    seen.add(el);
    elements.push(describe(el, role, cs, extra));
  };

  // Sections: top-level layout blocks only (nested Elementor containers would double count).
  const SECTION = "section, .elementor-section, .e-con.e-parent";
  const sections = [...document.querySelectorAll(SECTION)].filter(
    (el) => !el.parentElement?.closest(SECTION) && !el.closest("header, footer, nav") && el.getBoundingClientRect().width >= vw * 0.5,
  );
  sections.forEach((el, i) => push(el, "section", undefined, { sectionKind: i === 0 ? "hero" : "section" }));

  document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((el) => push(el, "heading"));

  const BUTTON = "button, input[type=submit], input[type=button], [role=button], .elementor-button, a.button, a.btn, a[class*=button], a[class*=btn]";
  document.querySelectorAll(BUTTON).forEach((el) => {
    const cs = getComputedStyle(el);
    const lh = cs.lineHeight === "normal" ? parseFloat(cs.fontSize) * 1.2 : parseFloat(cs.lineHeight);
    const extra = { lineCount: lineCount(el, lh || 16) };
    if (el.tagName === "A") extra.href = el.getAttribute("href") ?? "";
    push(el, "button", MAX.button, extra);
  });

  // Standalone links only: inline links inside sentences are exempt from tap-target sizing.
  document.querySelectorAll("a[href]").forEach((el) => {
    const display = getComputedStyle(el).display;
    const inText = el.parentElement?.closest("p, li:not(nav li), td, blockquote, figcaption") && display === "inline";
    if (!inText && (display !== "inline" || el.closest("nav"))) push(el, "link", MAX.link, { href: el.getAttribute("href") ?? "" });
  });

  document.querySelectorAll("p, li, td, label, figcaption, blockquote, dd").forEach((el) => {
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) push(el, "text", MAX.text);
  });

  // Elements that stick out past the viewport (outermost only), unless an ancestor scrolls/clips them.
  const docEl = document.documentElement;
  if (docEl.scrollWidth > docEl.clientWidth + 1) {
    const offenders = [];
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.right + sx <= docEl.clientWidth + 1 || r.width === 0) continue;
      let contained = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (getComputedStyle(a).overflowX !== "visible") { contained = true; break; }
        if (offenders.includes(a)) { contained = true; break; }
      }
      if (!contained) offenders.push(el);
      if (offenders.length >= MAX.overflow) break;
    }
    offenders.forEach((el) => push(el, "other"));
  }

  const meta = (name) => document.querySelector(`meta[name="${name}" i]`)?.getAttribute("content") ?? undefined;
  const canonical = document.querySelector('link[rel="canonical" i]');
  return {
    // Normalize for scrollbar width so docWidth is comparable to the configured viewport.
    docWidth: docEl.scrollWidth + (vw - docEl.clientWidth),
    docHeight: Math.max(docEl.scrollHeight, document.body?.scrollHeight ?? 0),
    meta: {
      title: document.title || undefined,
      metaDescription: meta("description"),
      canonical: canonical ? canonical.href : undefined,
      robotsMeta: meta("robots"),
      h1Count: document.querySelectorAll("h1").length,
      lang: docEl.getAttribute("lang") || undefined,
    },
    elements,
  };
})()

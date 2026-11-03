// Runs inside the audited page (our own headless browser) and returns structured data as plain JSON.
// Read-only and bounded: at most 30 JSON-LD blocks, 50 microdata/RDFa roots, 100 KB of visible text.
(() => {
  const MAX_TEXT = 200;
  const selectorFor = (el) => {
    if (el.id) return "#" + CSS.escape(el.id);
    const cls = [...el.classList].slice(0, 2).map((c) => "." + CSS.escape(c)).join("");
    return el.tagName.toLowerCase() + cls;
  };

  const jsonld = [...document.querySelectorAll('script[type="application/ld+json" i]')].slice(0, 30).map((s, index) => ({
    index,
    text: (s.textContent || "").slice(0, 600000),
  }));

  // Microdata (https://html.spec.whatwg.org/multipage/microdata.html), simplified: no itemref support.
  const microValue = (el) => {
    if (el.hasAttribute("itemscope")) return microItem(el);
    const tag = el.tagName.toLowerCase();
    if (tag === "meta") return el.getAttribute("content") || "";
    if (["a", "link", "area"].includes(tag)) return el.href || el.getAttribute("href") || "";
    if (["img", "audio", "video", "source", "iframe", "embed"].includes(tag)) return el.src || el.getAttribute("src") || "";
    if (tag === "time") return el.getAttribute("datetime") || (el.textContent || "").trim();
    if (tag === "data" || tag === "meter") return el.getAttribute("value") || "";
    return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  };
  const microItem = (root) => {
    const props = {};
    const walk = (node) => {
      for (const child of node.children) {
        if (child.hasAttribute("itemprop")) {
          for (const name of child.getAttribute("itemprop").split(/\s+/).filter(Boolean)) (props[name] ||= []).push(microValue(child));
          if (child.hasAttribute("itemscope")) continue; // nested item owns its own properties
        }
        if (!child.hasAttribute("itemscope")) walk(child);
      }
    };
    walk(root);
    return {
      selector: selectorFor(root),
      types: (root.getAttribute("itemtype") || "").split(/\s+/).filter(Boolean),
      id: root.getAttribute("itemid") || undefined,
      props,
    };
  };
  const microdata = [...document.querySelectorAll("[itemscope]:not([itemprop])")].slice(0, 50).map(microItem);

  // RDFa Lite (typeof/property/resource), simplified.
  const rdfaValue = (el) => el.getAttribute("content") || el.getAttribute("href") || el.getAttribute("src") || el.getAttribute("resource") || (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  const rdfaItem = (root) => {
    const props = {};
    const walk = (node) => {
      for (const child of node.children) {
        const prop = child.getAttribute("property");
        if (prop) for (const name of prop.split(/\s+/).filter(Boolean)) (props[name.replace(/^schema:/, "")] ||= []).push(child.hasAttribute("typeof") ? rdfaItem(child) : rdfaValue(child));
        if (!child.hasAttribute("typeof")) walk(child);
      }
    };
    walk(root);
    return { selector: selectorFor(root), types: (root.getAttribute("typeof") || "").split(/\s+/).filter(Boolean), id: root.getAttribute("resource") || undefined, props };
  };
  const rdfa = [...document.querySelectorAll("[typeof]")].filter((el) => !el.hasAttribute("property")).slice(0, 50).map(rdfaItem);

  return { jsonld, microdata, rdfa, visibleText: (document.body?.innerText || "").slice(0, 100000) };
})()

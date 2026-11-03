export const VIEWPORTS = [320, 390, 768, 1024, 1440];

export const CATEGORIES: { value: string; label: string; hint: string }[] = [
  { value: "layout", label: "Layout", hint: "Horizontal overflow, clipped and overlapping content" },
  { value: "spacing", label: "Spacing", hint: "Section padding vs. design tokens and site norms" },
  { value: "typography", label: "Typography", hint: "Font sizes, line height, heading hierarchy" },
  { value: "buttons", label: "Buttons & tap targets", hint: "Target size, wrapping labels, dead links" },
  { value: "a11y", label: "Accessibility", hint: "axe-core WCAG 2.1 A/AA checks" },
  { value: "seo", label: "SEO & metadata", hint: "Status codes, titles, descriptions, canonicals, H1" },
  { value: "content", label: "Content & links", hint: "Broken images/links, empty or placeholder content, spelling" },
  { value: "navigation", label: "Navigation", hint: "Menus that differ between pages" },
  { value: "consistency", label: "Component consistency", hint: "Same component rendered differently" },
  { value: "structured-data", label: "Structured data", hint: "JSON-LD, microdata and RDFa checked against Google's documented requirements" },
];

/** Finding categories from Google providers (not selectable as engine categories). */
export const PROVIDER_TYPES: { value: string; label: string }[] = [
  { value: "performance", label: "Performance" },
  { value: "cwv", label: "Core Web Vitals" },
  { value: "indexing", label: "Search indexing" },
  { value: "search-console", label: "Search Console" },
];

export const TYPE_LABEL: Record<string, string> = {
  ...Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label])),
  ...Object.fromEntries(PROVIDER_TYPES.map((c) => [c.value, c.label])),
  seo: "Technical SEO",
};

export const PROVIDER_LABEL: Record<string, string> = {
  webaudit: "WebAudit Pro", psi: "Google PageSpeed Insights", crux: "Chrome UX Report", gsc: "Google Search Console", schema: "Internal Schema Validator",
};

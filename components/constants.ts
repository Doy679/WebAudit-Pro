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
];

export const TYPE_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

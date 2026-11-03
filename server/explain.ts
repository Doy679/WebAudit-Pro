// Plain-language explanations of findings for non-technical readers: what is wrong, why it matters,
// and who usually fixes it. Specific rules first, then a fallback per category, so every finding gets one.

export type Fixer = "Developer" | "Designer" | "Content editor" | "SEO specialist";
export interface Explanation { what: string; why: string; who: Fixer }

const RULES: Record<string, Explanation> = {
  "horizontal-overflow": { what: "Part of the page is wider than the screen, so visitors have to scroll sideways.", why: "On phones this looks broken and hides content off-screen.", who: "Developer" },
  "overlapping-content": { what: "Two pieces of content sit on top of each other.", why: "Visitors can't read or click the hidden part.", who: "Developer" },
  "text-clipped": { what: "Text is cut off by its container.", why: "Visitors miss part of the message.", who: "Developer" },
  "section-padding-outlier": { what: "This section's spacing is noticeably different from the rest of the site.", why: "Uneven spacing makes pages look unfinished and harder to scan.", who: "Designer" },
  "font-too-small": { what: "Text is too small to read comfortably.", why: "Small text is hard to read on a phone, especially for older visitors.", who: "Designer" },
  "line-height-tight": { what: "Lines of text are packed too closely together.", why: "Tight lines are tiring to read and harder to follow.", who: "Designer" },
  "heading-scale-inverted": { what: "A smaller heading level is displayed larger than a more important one.", why: "Visitors can't tell which headings are main topics and which are details.", who: "Designer" },
  "empty-heading": { what: "A heading has no text.", why: "Screen readers announce an empty heading, which confuses blind visitors.", who: "Developer" },
  "tap-target-small": { what: "A button or link is too small to tap easily.", why: "On a phone, visitors miss it or tap the wrong thing.", who: "Developer" },
  "tap-target-below-44": { what: "A button or link is smaller than the recommended tap size.", why: "On a phone, small targets are easy to miss, which frustrates visitors.", who: "Developer" },
  "button-text-wraps": { what: "A button's label breaks onto several lines.", why: "Wrapped buttons look broken and are harder to read.", who: "Designer" },
  "placeholder-link": { what: "A link goes nowhere (for example \"#\").", why: "Visitors click and nothing happens, which feels broken.", who: "Developer" },
  "placeholder-text": { what: "Placeholder text (like \"Lorem ipsum\") is still on the page.", why: "It looks unfinished and unprofessional to visitors.", who: "Content editor" },
  "broken-image": { what: "An image doesn't load.", why: "Visitors see an empty box or broken-image icon.", who: "Developer" },
  "broken-internal-link": { what: "A link points to a page that doesn't exist.", why: "Visitors hit an error page, and search engines waste time on it.", who: "Developer" },
  "suspected-misspelling": { what: "A word may be misspelled.", why: "Spelling mistakes reduce trust in the business.", who: "Content editor" },
  "navigation-inconsistent": { what: "The menu is different on some pages.", why: "Visitors lose their way when navigation changes between pages.", who: "Developer" },
  "inconsistent-component": { what: "The same element (like a button) looks different in different places.", why: "Inconsistent design looks careless and confuses visitors.", who: "Designer" },
  "title-length": { what: "The page title is too long or too short for search results.", why: "Google may cut it off or rewrite it, so fewer people click.", who: "SEO specialist" },
  "title-duplicate": { what: "Several pages share the same title.", why: "Search engines and visitors can't tell the pages apart.", who: "SEO specialist" },
  "title-missing": { what: "The page has no title.", why: "Search results show a poor or made-up title, so fewer people click.", who: "SEO specialist" },
  "meta-description-missing": { what: "The page has no search-result description.", why: "Google picks random text from the page, which may not convince people to click.", who: "Content editor" },
  "meta-description-length": { what: "The search-result description is too long or too short.", why: "Google may cut it off or replace it.", who: "Content editor" },
  "h1-missing": { what: "The page has no main heading.", why: "Visitors and search engines can't quickly tell what the page is about.", who: "Content editor" },
  "h1-multiple": { what: "The page has more than one main heading.", why: "It blurs what the page is mainly about for search engines and screen readers.", who: "Developer" },
  "axe:color-contrast": { what: "Text is hard to read because its colour is too close to the background.", why: "People with low vision, or anyone on a phone in sunlight, may not be able to read it.", who: "Designer" },
  "axe:image-alt": { what: "An image has no text description.", why: "Blind visitors using screen readers don't know what the image shows.", who: "Content editor" },
  "axe:role-img-alt": { what: "An image or icon has no text description.", why: "Blind visitors using screen readers don't know what it shows.", who: "Developer" },
  "axe:link-name": { what: "A link has no readable name.", why: "Screen readers announce just \"link\", so blind visitors don't know where it goes.", who: "Developer" },
  "axe:button-name": { what: "A button has no readable name.", why: "Screen readers announce just \"button\", so blind visitors don't know what it does.", who: "Developer" },
  "axe:label": { what: "A form field has no label.", why: "Screen-reader users don't know what to type.", who: "Developer" },
  "axe:aria-valid-attr-value": { what: "An element gives screen readers an invalid setting, so it's announced wrongly.", why: "Screen-reader users (blind and low-vision visitors) get wrong or confusing information.", who: "Developer" },
  "axe:aria-prohibited-attr": { what: "An element has a screen-reader label that isn't allowed on it, so it's ignored.", why: "Screen-reader users (blind and low-vision visitors) get wrong or confusing information.", who: "Developer" },
  "axe:aria-allowed-attr": { what: "An element has a screen-reader setting that doesn't belong on it.", why: "Screen-reader users (blind and low-vision visitors) get wrong or confusing information.", who: "Developer" },
  "axe:listitem": { what: "A list item isn't inside a proper list.", why: "Screen readers can't announce how many items the list has or where the visitor is in it.", who: "Developer" },
  "axe:aria-command-name": { what: "A clickable control has no readable name.", why: "Screen readers can't tell blind visitors what the control does.", who: "Developer" },
  "axe:duplicate-id-aria": { what: "Two elements share the same internal name that labels rely on.", why: "Screen readers may read the wrong label for a field or control.", who: "Developer" },
  "axe:frame-title": { what: "An embedded frame (such as a map or video) has no title.", why: "Screen-reader users don't know what the embedded content is.", who: "Developer" },
  "axe:frame-title-unique": { what: "Several embedded frames share the same title.", why: "Screen-reader users can't tell the embedded items apart.", who: "Developer" },
  "axe:form-field-multiple-labels": { what: "A form field has more than one label.", why: "Screen readers may read the wrong label, so visitors don't know what to enter.", who: "Developer" },
  "axe:aria-required-parent": { what: "A menu or list part is used outside the container it belongs in.", why: "Screen readers can't announce the structure, so navigation is confusing.", who: "Developer" },
  "axe:aria-required-children": { what: "A menu, list or tab group is missing the parts it should contain.", why: "Screen readers can't announce the structure, so navigation is confusing.", who: "Developer" },
  "axe:bypass": { what: "There's no way to skip past the menu to the main content.", why: "Keyboard and screen-reader users must go through the whole menu on every page.", who: "Developer" },
  "axe:scrollable-region-focusable": { what: "A scrolling area can't be reached with the keyboard.", why: "Visitors who don't use a mouse can't read the hidden content.", who: "Developer" },
  "axe:link-in-text-block": { what: "A link inside a paragraph only stands out by colour.", why: "Colour-blind visitors can't see that it's a link.", who: "Designer" },
};

const CATEGORY: Record<string, Explanation> = {
  a11y: { what: "", why: "It makes the site harder to use for people with disabilities, including screen reader and keyboard users.", who: "Developer" },
  layout: { what: "", why: "Layout problems make the page look broken on some screen sizes.", who: "Developer" },
  spacing: { what: "", why: "Inconsistent spacing makes pages look unfinished.", who: "Designer" },
  typography: { what: "", why: "Text that is hard to read makes visitors leave sooner.", who: "Designer" },
  buttons: { what: "", why: "Buttons and links that are hard to use frustrate visitors, especially on phones.", who: "Developer" },
  seo: { what: "", why: "It can reduce how well the page appears in Google search results.", who: "SEO specialist" },
  content: { what: "", why: "Broken or unfinished content reduces trust in the business.", who: "Content editor" },
  navigation: { what: "", why: "Visitors may get lost moving between pages.", who: "Developer" },
  consistency: { what: "", why: "Inconsistent design looks careless.", who: "Designer" },
  "structured-data": { what: "", why: "Google may not show rich results (stars, FAQs, business details) for this page.", who: "SEO specialist" },
  performance: { what: "", why: "Slow pages lose visitors, and speed is part of how Google ranks pages.", who: "Developer" },
  cwv: { what: "", why: "Real visitors experience this page as slow or jumpy; Google uses this in rankings.", who: "Developer" },
  indexing: { what: "", why: "Pages Google can't index don't appear in search results.", who: "SEO specialist" },
  "search-console": { what: "", why: "Google reported a problem that can affect how the site appears in search.", who: "SEO specialist" },
};

const PREFIX: Record<string, Explanation> = {
  "psi:": { what: "Google's speed test found something that slows this page down.", why: CATEGORY.performance.why, who: "Developer" },
  "crux:": { what: "Real Chrome users experienced this page as slow or unstable.", why: CATEGORY.cwv.why, who: "Developer" },
  "gsc:": { what: "Google Search Console reported a problem with this page.", why: CATEGORY["search-console"].why, who: "SEO specialist" },
  "schema:": { what: "The page's structured data (information for Google) is incomplete or invalid.", why: CATEGORY["structured-data"].why, who: "SEO specialist" },
};

export function explainIssue(i: { rule: string; type: string; title: string }): Explanation {
  if (RULES[i.rule]) return RULES[i.rule];
  const prefix = Object.keys(PREFIX).find((p) => i.rule.startsWith(p));
  if (prefix) return PREFIX[prefix];
  const c = CATEGORY[i.type] ?? { what: "", why: "It affects how visitors experience the page.", who: "Developer" as Fixer };
  const title = i.title.trim().replace(/\.$/, "");
  return { ...c, what: title ? `${title}.` : "The audit found a problem on this page that needs a closer look." };
}

// Versioned Google structured-data rules, transcribed from Google Search Central documentation
// (https://developers.google.com/search/docs/appearance/structured-data/search-gallery).
// Only features Google currently documents are included. Deprecated features (HowTo, sitelinks search box)
// and schema.org types without a Google feature (WebSite, WebPage, Person, Service, …) get no eligibility claim.
// When Google changes its docs, update these rules and RULES_VERSION together.
export const RULES_VERSION = "2026-11-03 (Google Search Central structured data docs)";

export type ValueKind = "date" | "url" | "number" | "integer" | "text" | "object" | "url-or-object";

export interface FeatureRule {
  feature: string;
  docUrl: string;
  types: string[];
  /** "a|b" means at least one of them. */
  required: string[];
  recommended: string[];
  valueTypes: Record<string, ValueKind>;
  /** Properties whose text should be visible on the page. */
  visible?: string[];
  note?: string;
}

const DOC = "https://developers.google.com/search/docs/appearance/structured-data";

// Common LocalBusiness subtypes seen on mortgage, real-estate and service sites (schema.org LocalBusiness hierarchy).
export const LOCAL_BUSINESS_TYPES = [
  "LocalBusiness", "FinancialService", "BankOrCreditUnion", "AccountingService", "InsuranceAgency", "RealEstateAgent",
  "HomeAndConstructionBusiness", "GeneralContractor", "HousePainter", "Plumber", "Electrician", "RoofingContractor",
  "ProfessionalService", "LegalService", "Attorney", "Store", "HomeGoodsStore", "FurnitureStore", "AutoDealer",
  "Restaurant", "FoodEstablishment", "MedicalBusiness", "Dentist", "HealthAndBeautyBusiness", "LodgingBusiness",
];

export const FEATURES: FeatureRule[] = [
  {
    feature: "Article", docUrl: `${DOC}/article`, types: ["Article", "NewsArticle", "BlogPosting"],
    required: [], recommended: ["author", "datePublished", "dateModified", "headline", "image"],
    valueTypes: { datePublished: "date", dateModified: "date", image: "url-or-object" }, visible: ["headline"],
  },
  {
    feature: "Breadcrumb", docUrl: `${DOC}/breadcrumb`, types: ["BreadcrumbList"],
    required: ["itemListElement"], recommended: [], valueTypes: {},
  },
  {
    feature: "Event", docUrl: `${DOC}/event`, types: ["Event", "BusinessEvent", "EducationEvent", "SocialEvent"],
    required: ["name", "startDate", "location"],
    recommended: ["description", "endDate", "eventAttendanceMode", "eventStatus", "image", "offers", "organizer", "performer"],
    valueTypes: { startDate: "date", endDate: "date", location: "object", image: "url-or-object" }, visible: ["name"],
  },
  {
    feature: "FAQ", docUrl: `${DOC}/faqpage`, types: ["FAQPage"], required: ["mainEntity"], recommended: [], valueTypes: {},
    note: "Google shows FAQ rich results only for well-known, authoritative government and health websites.",
  },
  {
    feature: "Job posting", docUrl: `${DOC}/job-posting`, types: ["JobPosting"],
    required: ["datePosted", "description", "hiringOrganization", "jobLocation|applicantLocationRequirements", "title"],
    recommended: ["baseSalary", "employmentType", "identifier", "validThrough"],
    valueTypes: { datePosted: "date", validThrough: "date", hiringOrganization: "object" }, visible: ["title"],
  },
  {
    feature: "Local business", docUrl: `${DOC}/local-business`, types: LOCAL_BUSINESS_TYPES,
    required: ["name", "address"], recommended: ["aggregateRating", "geo", "openingHoursSpecification", "priceRange", "review", "telephone", "url"],
    valueTypes: { address: "object", url: "url", geo: "object", image: "url-or-object" },
  },
  {
    feature: "Organization", docUrl: `${DOC}/organization`, types: ["Organization", "Corporation", "NGO", "OnlineBusiness", "OnlineStore"],
    required: [], recommended: ["name", "url", "logo", "address", "telephone", "email", "sameAs", "description"],
    valueTypes: { url: "url", logo: "url-or-object" },
  },
  {
    feature: "Product snippet", docUrl: `${DOC}/product-snippet`, types: ["Product", "ProductGroup"],
    required: ["name", "offers|review|aggregateRating"], recommended: ["image", "description", "brand", "sku"],
    valueTypes: { image: "url-or-object", offers: "object", aggregateRating: "object", review: "object" }, visible: ["name"],
  },
  {
    feature: "Recipe", docUrl: `${DOC}/recipe`, types: ["Recipe"], required: ["name", "image"],
    recommended: ["aggregateRating", "author", "cookTime", "datePublished", "description", "prepTime", "recipeIngredient", "recipeInstructions", "recipeYield", "totalTime"],
    valueTypes: { image: "url-or-object", datePublished: "date" }, visible: ["name"],
  },
  {
    feature: "Review snippet", docUrl: `${DOC}/review-snippet`, types: ["Review"], required: ["author", "reviewRating"], recommended: ["datePublished", "itemReviewed"],
    valueTypes: { reviewRating: "object", datePublished: "date" },
  },
  {
    feature: "Review snippet", docUrl: `${DOC}/review-snippet`, types: ["AggregateRating"], required: ["ratingValue", "ratingCount|reviewCount"], recommended: ["bestRating", "worstRating"],
    valueTypes: { ratingValue: "number", ratingCount: "integer", reviewCount: "integer" },
  },
  {
    feature: "Video", docUrl: `${DOC}/video`, types: ["VideoObject"], required: ["name", "thumbnailUrl", "uploadDate"],
    recommended: ["contentUrl|embedUrl", "description", "duration"], valueTypes: { uploadDate: "date", thumbnailUrl: "url", contentUrl: "url", embedUrl: "url" },
  },
];

export const featureFor = (types: string[]) => FEATURES.find((f) => types.some((t) => f.types.includes(t))) ?? null;

export const ENGLISH_MARKETING_ROUTES = [
  "/",
  "/about",
  "/benefits",
  "/compliance-standards",
  "/contact",
  "/faq",
  "/industries",
  "/pricing",
  "/product",
  "/roi-calculator",
  "/security",
  "/solutions",
  "/use-cases",
] as const;

const CHINESE_SLUGS = [
  "",
  "about",
  "benefits",
  "compliance-standards",
  "contact",
  "faq",
  "industries",
  "pricing",
  "product",
  "roi-calculator",
  "security",
  "solutions",
  "use-cases",
] as const;

export const CHINESE_MARKETING_ROUTES = (["zh-hans", "zh-hant"] as const).flatMap((locale) =>
  CHINESE_SLUGS.map((slug) => `/${locale}${slug ? `/${slug}` : ""}`),
);

export const DASHBOARD_ROUTES = [
  "/dashboard",
  "/dashboard/agents",
  "/dashboard/approvals",
  "/dashboard/compliance",
  "/dashboard/wallets",
] as const;

export const ROUTES = [
  ...ENGLISH_MARKETING_ROUTES,
  ...CHINESE_MARKETING_ROUTES,
  ...DASHBOARD_ROUTES,
] as const;

export const PUBLIC_ROUTES = [...ENGLISH_MARKETING_ROUTES, ...CHINESE_MARKETING_ROUTES] as const;

export const INVALID_ROUTES = ["/does-not-exist", "/zh-xx", "/zh-hans/does-not-exist"] as const;

export const METADATA_PARITY_ROUTES = ["/", "/contact", "/zh-hant", "/zh-hans/pricing"] as const;

export const VISUAL_PARITY_ROUTES = [
  "/",
  "/contact",
  "/roi-calculator",
  "/zh-hant",
  "/zh-hans/pricing",
] as const;

export const VISUAL_VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

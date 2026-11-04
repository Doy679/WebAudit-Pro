import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Approval links carry secret tokens: never leak them through the Referer header.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Sprint 6: evaluated in REPORT-ONLY mode (never blocks). Enforcing it needs approval after the E2E run shows no
  // violations; 'unsafe-inline' is still needed for Next.js's inline bootstrap scripts until nonces are added.
  {
    key: "Content-Security-Policy-Report-Only",
    value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'",
  },
];

const config: NextConfig = {
  // A separate build folder for test/QA servers, so they never overwrite the build the running app serves.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  devIndicators: false,
  poweredByHeader: false,
  // The worker owns Playwright and ExcelJS; keep them out of the web bundle if ever imported.
  serverExternalPackages: ["playwright", "playwright-core", "exceljs", "@axe-core/playwright"],
  // The engine (src/) uses NodeNext-style ".js" import suffixes for its TypeScript files.
  webpack(config) {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;

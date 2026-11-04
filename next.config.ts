import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Approval links carry secret tokens: never leak them through the Referer header.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
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

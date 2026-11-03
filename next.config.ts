import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Approval links carry secret tokens: never leak them through the Referer header.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  // The worker owns Playwright and ExcelJS; keep them out of the web bundle if ever imported.
  serverExternalPackages: ["playwright", "playwright-core", "exceljs", "@axe-core/playwright"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;

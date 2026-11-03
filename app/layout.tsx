import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "WebAudit Pro", template: "%s · WebAudit Pro" },
  description: "Read-only website UX/UI audits with evidence, review and client approval.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

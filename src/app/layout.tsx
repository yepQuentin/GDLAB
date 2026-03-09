import type { Metadata } from "next";

import "./globals.css";
import { HeaderNav } from "@/components/header-nav";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "GDLAB 商学院",
    template: "%s | GDLAB 商学院",
  },
  description: "每日资讯与深度商业文章解读",
  icons: {
    icon: [{ url: "/GoerDynamics.png", type: "image/png" }],
    shortcut: "/GoerDynamics.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="site-shell">
          <HeaderNav />
          <main className="site-main">
            <div className="container">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}

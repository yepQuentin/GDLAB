import type { Metadata } from "next";

import { SearchClient } from "@/components/search-client";
import { buildSearchIndex, getCanonicalUrl } from "@/lib/content";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "搜索",
  description: "搜索 Daily Pulse 与 Business Case 已发布内容。",
  alternates: {
    canonical: getCanonicalUrl("/search"),
  },
};

export default async function SearchPage() {
  const { docs, hint } = await buildSearchIndex();

  return (
    <div className="page-stack">
      <section className="section-block section-block-no-divider">
        <div className="section-header">
          <div className="section-title-group">
            <p className="section-kicker">Search</p>
            <h1>站内搜索</h1>
          </div>
        </div>
        <p className="section-description">支持按关键词检索标题、摘要、标签与正文。</p>

        {hint ? <p className="config-hint">{hint}</p> : null}

        <SearchClient docs={docs} />
      </section>
    </div>
  );
}

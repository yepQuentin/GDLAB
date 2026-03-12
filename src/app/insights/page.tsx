import type { Metadata } from "next";

import { ContentCard } from "@/components/content-card";
import { Pagination } from "@/components/pagination";
import { getCanonicalUrl, getContentList } from "@/lib/content";
import { parsePageNumber } from "@/lib/paging";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Insights",
  description: "Insights 历史全集合页，展示所有已发布深度分析。",
  alternates: {
    canonical: getCanonicalUrl("/insights"),
  },
};

interface InsightListPageProps {
  searchParams?: Promise<{ page?: string }>;
}

export default async function InsightListPage({ searchParams }: InsightListPageProps) {
  const pageParam = (await searchParams)?.page;
  const page = parsePageNumber(pageParam);
  const { payload, hint } = await getContentList("insight", page);

  return (
    <div className="page-stack">
      <section className="section-block section-block-no-divider">
        <div className="section-header">
          <div className="section-title-group">
            <p className="section-kicker">Insights</p>
            <h1>深度分析</h1>
          </div>
        </div>
        <p className="section-description">查看所有已发布的 Insights 深度内容。</p>

        {hint ? <p className="config-hint">{hint}</p> : null}

        <div className="content-grid">
          {payload.items.length > 0 ? (
            payload.items.map((item) => <ContentCard key={item.id} item={item} showSummary={false} />)
          ) : (
            <p className="empty-state">暂无 Insights 历史内容。</p>
          )}
        </div>

        <Pagination currentPage={payload.page} totalPages={payload.totalPages} pathname="/insights" />
      </section>
    </div>
  );
}

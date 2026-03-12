import type { Metadata } from "next";

import { ContentCard } from "@/components/content-card";
import { Pagination } from "@/components/pagination";
import { getCanonicalUrl, getContentList } from "@/lib/content";
import { parsePageNumber } from "@/lib/paging";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Daily Pulse",
  description: "Daily Pulse 历史全集合页，展示所有已发布每日资讯。",
  alternates: {
    canonical: getCanonicalUrl("/daily"),
  },
};

interface DailyListPageProps {
  searchParams?: Promise<{ page?: string }>;
}

export default async function DailyListPage({ searchParams }: DailyListPageProps) {
  const pageParam = (await searchParams)?.page;
  const page = parsePageNumber(pageParam);
  const { payload, hint } = await getContentList("daily", page);

  return (
    <div className="page-stack">
      <section className="section-block section-block-no-divider">
        <div className="section-header">
          <div className="section-title-group">
            <p className="section-kicker">Daily Pulse</p>
            <h1>每日热点</h1>
          </div>
        </div>
        <p className="section-description">查看所有已发布的 Daily Pulse 历史内容。</p>

        {hint ? <p className="config-hint">{hint}</p> : null}

        <div className="content-grid">
          {payload.items.length > 0 ? (
            payload.items.map((item) => <ContentCard key={item.id} item={item} showSummary={false} />)
          ) : (
            <p className="empty-state">暂无 Daily Pulse 历史内容。</p>
          )}
        </div>

        <Pagination currentPage={payload.page} totalPages={payload.totalPages} pathname="/daily" />
      </section>
    </div>
  );
}

import Link from "next/link";

import { ContentCard } from "@/components/content-card";
import { getCanonicalUrl, getHomePayload } from "@/lib/content";

export const revalidate = 300;

export const metadata = {
  title: "首页",
  description: "Daily Pulse 与 Insights 精选内容",
  alternates: {
    canonical: getCanonicalUrl("/"),
  },
};

export default async function HomePage() {
  const { payload, hint } = await getHomePayload();

  return (
    <div className="page-stack home-page">
      <section className="portal-hero">
        <p className="portal-kicker">商业探索道场</p>
        <h1 className="portal-title">GDLAB</h1>
        <p className="portal-lead">
          挖掘海内外重点事件与非公开情报，精选与公司战略高度相关的资讯与案例进行解读
        </p>
      </section>

      {hint ? <p className="config-hint">{hint}</p> : null}

      <section className="portal-channel">
        <div className="section-header">
          <div className="section-title-group">
            <p className="section-kicker">Daily Pulse</p>
            <h2>每日热点</h2>
          </div>
          <Link href="/daily" className="section-link">
            查看全部
          </Link>
        </div>
        <p className="section-description">近 3 天热点，覆盖品牌、时局、行业、科技</p>

        <div className="content-grid">
          {payload.dailyRecent.length > 0 ? (
            payload.dailyRecent.map((item) => (
              <ContentCard key={item.id} item={item} showSummary={false} />
            ))
          ) : (
            <p className="empty-state">最近 3 天暂无 Daily Pulse 内容。</p>
          )}
        </div>
      </section>

      <section className="portal-channel">
        <div className="section-header">
          <div className="section-title-group">
            <p className="section-kicker">Insights</p>
            <h2>深度分析</h2>
          </div>
          <Link href="/insights" className="section-link">
            查看全部
          </Link>
        </div>
        <p className="section-description">围绕领先案例与重点事件进行深度解读</p>

        <div className="content-grid">
          {payload.insightRecent.length > 0 ? (
            payload.insightRecent.map((item) => (
              <ContentCard key={item.id} item={item} showSummary={false} />
            ))
          ) : (
            <p className="empty-state">暂无 Insights 内容。</p>
          )}
        </div>
      </section>
    </div>
  );
}

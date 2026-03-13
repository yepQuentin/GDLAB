import Link from "next/link";

import type { ContentMeta, ContentType } from "@/lib/types";

interface ContentCardProps {
  item: ContentCardItem;
  showSummary?: boolean;
}

export interface ContentCardItem {
  id: string;
  title: string;
  type: ContentType;
  publishDate: string;
  summary?: string;
  tags: string[];
  slug?: ContentMeta["slug"];
  href?: string;
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(date);
}

export function ContentCard({ item, showSummary = true }: ContentCardProps) {
  const href =
    item.href ??
    (item.slug ? (item.type === "daily" ? `/daily/${item.slug}` : `/insights/${item.slug}`) : undefined);
  const cardClassName = showSummary ? "content-card" : "content-card content-card-compact";

  if (!href) {
    throw new Error(`ContentCard item "${item.id}" is missing both href and slug.`);
  }

  return (
    <article className={cardClassName}>
      <Link href={href} className="content-card-link" aria-label={`进入阅读：${item.title}`}>
        <div className="content-card-meta">
          <span>{formatDate(item.publishDate)}</span>
          <span className="content-card-cta" aria-hidden="true">
            进入阅读
          </span>
        </div>
        <h3 className="content-card-title">{item.title}</h3>
        {showSummary ? <p className="content-card-summary">{item.summary || "暂无摘要"}</p> : null}
        {item.tags.length > 0 ? (
          <div className="content-card-tags">
            {item.tags.map((tag) => (
              <span key={`${item.id}-${tag}`}>{tag}</span>
            ))}
          </div>
        ) : null}
      </Link>
    </article>
  );
}

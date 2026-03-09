import Link from "next/link";

import type { ContentMeta } from "@/lib/types";

interface ContentCardProps {
  item: ContentMeta;
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

export function ContentCard({ item }: ContentCardProps) {
  const href = item.type === "daily" ? `/daily/${item.slug}` : `/insights/${item.slug}`;

  return (
    <article className="content-card">
      <div className="content-card-meta">
        <span>{formatDate(item.publishDate)}</span>
      </div>
      <h3 className="content-card-title">
        <Link href={href}>{item.title}</Link>
      </h3>
      <p className="content-card-summary">{item.summary || "暂无摘要"}</p>
      {item.tags.length > 0 ? (
        <div className="content-card-tags">
          {item.tags.map((tag) => (
            <span key={`${item.id}-${tag}`}>{tag}</span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

"use client";

import { useMemo, useState } from "react";
import Fuse from "fuse.js";
import Link from "next/link";

import type { SearchDocument, ContentType } from "@/lib/types";

interface SearchClientProps {
  docs: SearchDocument[];
}

type SearchFilter = "all" | ContentType;

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

export function SearchClient({ docs }: SearchClientProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SearchFilter>("all");

  const fuse = useMemo(
    () =>
      new Fuse(docs, {
        includeScore: true,
        threshold: 0.35,
        keys: [
          { name: "title", weight: 0.5 },
          { name: "summary", weight: 0.2 },
          { name: "tags", weight: 0.1 },
          { name: "bodyText", weight: 0.2 },
        ],
      }),
    [docs],
  );

  const filteredDocs = useMemo(() => {
    const typeFiltered = filter === "all" ? docs : docs.filter((doc) => doc.type === filter);

    if (!query.trim()) {
      return typeFiltered;
    }

    const typeFilteredSet = new Set(typeFiltered.map((doc) => doc.id));

    return fuse
      .search(query)
      .map((result) => result.item)
      .filter((item) => typeFilteredSet.has(item.id));
  }, [docs, filter, fuse, query]);

  return (
    <section className="search-panel">
      <div className="search-controls">
        <input
          type="search"
          placeholder="搜索标题、摘要、标签或正文"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="search-input"
        />
        <div className="search-filters">
          <button
            type="button"
            className={filter === "all" ? "filter-btn active" : "filter-btn"}
            onClick={() => setFilter("all")}
          >
            全部
          </button>
          <button
            type="button"
            className={filter === "daily" ? "filter-btn active" : "filter-btn"}
            onClick={() => setFilter("daily")}
          >
            每日热点
          </button>
          <button
            type="button"
            className={filter === "case" ? "filter-btn active" : "filter-btn"}
            onClick={() => setFilter("case")}
          >
            商业案例
          </button>
        </div>
      </div>

      <p className="search-count">共 {filteredDocs.length} 条结果</p>

      <div className="search-result-grid">
        {filteredDocs.length > 0 ? (
          filteredDocs.map((doc) => (
            <article key={doc.id} className="content-card">
              <div className="content-card-meta">
                <span className="content-type">{doc.type === "daily" ? "每日热点" : "商业案例"}</span>
                <span>{formatDate(doc.publishDate)}</span>
              </div>
              <h3 className="content-card-title">
                <Link href={doc.url}>{doc.title}</Link>
              </h3>
              <p className="content-card-summary">{doc.summary || "暂无摘要"}</p>
              {doc.tags.length > 0 ? (
                <div className="content-card-tags">
                  {doc.tags.map((tag) => (
                    <span key={`${doc.id}-${tag}`}>{tag}</span>
                  ))}
                </div>
              ) : null}
            </article>
          ))
        ) : (
          <p className="empty-state">未检索到匹配内容，请尝试更换关键词。</p>
        )}
      </div>
    </section>
  );
}

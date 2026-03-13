"use client";

import { useMemo, useState } from "react";
import Fuse from "fuse.js";

import { ContentCard } from "@/components/content-card";
import type { SearchDocument, ContentType } from "@/lib/types";

interface SearchClientProps {
  docs: SearchDocument[];
}

type SearchFilter = "all" | ContentType;

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
            className={filter === "insight" ? "filter-btn active" : "filter-btn"}
            onClick={() => setFilter("insight")}
          >
            深度分析
          </button>
        </div>
      </div>

      <p className="search-count">共 {filteredDocs.length} 条结果</p>

      <div className="search-result-grid">
        {filteredDocs.length > 0 ? (
          filteredDocs.map((doc) => (
            <ContentCard
              key={doc.id}
              item={{
                id: doc.id,
                title: doc.title,
                type: doc.type,
                publishDate: doc.publishDate,
                summary: doc.summary,
                tags: doc.tags,
                href: doc.url,
              }}
              showSummary={false}
            />
          ))
        ) : (
          <p className="empty-state">未检索到匹配内容，请尝试更换关键词。</p>
        )}
      </div>
    </section>
  );
}

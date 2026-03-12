import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ContentCard } from "@/components/content-card";
import type { ContentMeta } from "@/lib/types";

const baseItem: ContentMeta = {
  id: "daily-1",
  title: "每日热点 No.1",
  slug: "daily-2026-03-12",
  type: "daily",
  publishDate: "2026-03-12",
  status: "Published",
  summary: "",
  cover: null,
  tags: ["AI", "品牌"],
};

describe("ContentCard", () => {
  it("默认展示摘要占位文案", () => {
    const markup = renderToStaticMarkup(React.createElement(ContentCard, { item: baseItem }));

    expect(markup).toContain("暂无摘要");
    expect(markup).not.toContain("content-card-compact");
  });

  it("关闭摘要时不渲染摘要段落并使用紧凑布局", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ContentCard, { item: baseItem, showSummary: false }),
    );

    expect(markup).not.toContain("暂无摘要");
    expect(markup).toContain("content-card content-card-compact");
    expect(markup).toContain("AI");
  });
});

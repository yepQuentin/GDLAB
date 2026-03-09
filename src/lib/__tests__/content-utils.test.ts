import { describe, expect, it } from "vitest";

import {
  paginate,
  parseDailySections,
  pickLatestCases,
  pickRecentDaily,
  sortByPublishDateDesc,
} from "@/lib/content-utils";
import type { ContentMeta } from "@/lib/types";

const baseItems: ContentMeta[] = [
  {
    id: "1",
    title: "Daily 1",
    slug: "daily-1",
    type: "daily",
    publishDate: "2026-03-05",
    status: "Published",
    summary: "",
    cover: null,
    tags: [],
  },
  {
    id: "2",
    title: "Daily old",
    slug: "daily-old",
    type: "daily",
    publishDate: "2026-03-01",
    status: "Published",
    summary: "",
    cover: null,
    tags: [],
  },
  {
    id: "3",
    title: "Case 1",
    slug: "case-1",
    type: "case",
    publishDate: "2026-03-04",
    status: "Published",
    summary: "",
    cover: null,
    tags: [],
  },
  {
    id: "4",
    title: "Case 2",
    slug: "case-2",
    type: "case",
    publishDate: "2026-03-03",
    status: "Published",
    summary: "",
    cover: null,
    tags: [],
  },
  {
    id: "5",
    title: "Case 3",
    slug: "case-3",
    type: "case",
    publishDate: "2026-03-02",
    status: "Published",
    summary: "",
    cover: null,
    tags: [],
  },
];

const denseDailyItems: ContentMeta[] = [
  {
    id: "d-1",
    title: "Daily 03/06",
    slug: "daily-2026-03-06",
    type: "daily",
    publishDate: "2026-03-06",
    status: "Published",
    summary: "",
    cover: null,
    tags: [],
  },
  {
    id: "d-2",
    title: "Daily 03/05",
    slug: "daily-2026-03-05",
    type: "daily",
    publishDate: "2026-03-05",
    status: "Published",
    summary: "",
    cover: null,
    tags: [],
  },
  {
    id: "d-3",
    title: "Daily 03/04",
    slug: "daily-2026-03-04",
    type: "daily",
    publishDate: "2026-03-04",
    status: "Published",
    summary: "",
    cover: null,
    tags: [],
  },
  {
    id: "d-4",
    title: "Daily 03/03",
    slug: "daily-2026-03-03",
    type: "daily",
    publishDate: "2026-03-03",
    status: "Published",
    summary: "",
    cover: null,
    tags: [],
  },
];

describe("content-utils", () => {
  it("按发布日期倒序排序", () => {
    const sorted = sortByPublishDateDesc(baseItems);
    expect(sorted.map((item) => item.id)).toEqual(["1", "3", "4", "5", "2"]);
  });

  it("首页 Daily 返回最新 3 篇，不按系统当天裁切", () => {
    const sorted = sortByPublishDateDesc(baseItems);
    const recentDaily = pickRecentDaily(sorted);
    expect(recentDaily.map((item) => item.id)).toEqual(["1", "2"]);
  });

  it("首页 Daily 固定返回最新 3 篇已发布内容", () => {
    const sorted = sortByPublishDateDesc(denseDailyItems);
    const recentDaily = pickRecentDaily(sorted);
    expect(recentDaily.map((item) => item.id)).toEqual(["d-1", "d-2", "d-3"]);
  });

  it("取最新 2 篇 Business Case", () => {
    const sorted = sortByPublishDateDesc(baseItems);
    const latestCases = pickLatestCases(sorted, 2);
    expect(latestCases.map((item) => item.id)).toEqual(["3", "4"]);
  });

  it("分页返回正确页码和切片", () => {
    const pageData = paginate([1, 2, 3, 4, 5], 2, 2);
    expect(pageData).toEqual({
      items: [3, 4],
      page: 2,
      pageSize: 2,
      total: 5,
      totalPages: 3,
    });
  });

  it("解析 Daily 四分区（中文H2）", () => {
    const markdown = [
      "## 品牌",
      "品牌新闻 A",
      "",
      "## 时局",
      "宏观变化 B",
      "",
      "## 行业",
      "行业洞察 C",
      "",
      "## 科技",
      "技术趋势 D",
    ].join("\n");

    const sections = parseDailySections(markdown);

    expect(sections.intro).toBe("");
    expect(sections.brand).toContain("品牌新闻 A");
    expect(sections.currentAffairs).toContain("宏观变化 B");
    expect(sections.industry).toContain("行业洞察 C");
    expect(sections.technology).toContain("技术趋势 D");
  });

  it("解析 Daily 四分区（英文H2 + 标题下音频）", () => {
    const markdown = [
      "[🎧 今日播客音频](https://example.com/today.mp3)",
      "",
      "## TIMES 时局",
      "### 机器人产业政策",
      "政策解读 A",
      "",
      "## INDUSTRIES 行业",
      "### 可穿戴行业",
      "行业观察 B",
      "",
      "## TECHS 科技",
      "### 智能体协作",
      "技术追踪 C",
      "",
      "## BRANDS 品牌",
      "### 会员经营",
      "品牌洞察 D",
    ].join("\n");

    const sections = parseDailySections(markdown);

    expect(sections.intro).toContain("today.mp3");
    expect(sections.currentAffairs).toContain("机器人产业政策");
    expect(sections.industry).toContain("可穿戴行业");
    expect(sections.technology).toContain("智能体协作");
    expect(sections.brand).toContain("会员经营");
  });
});

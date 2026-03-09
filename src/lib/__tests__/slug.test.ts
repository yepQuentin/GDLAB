import { describe, expect, it } from "vitest";

import { buildDailySlug, extractDateFromDailySlug, resolveContentSlug } from "@/lib/slug";

describe("slug", () => {
  it("daily 使用 publish_date 生成标准 slug", () => {
    expect(buildDailySlug("2026-03-05")).toBe("daily-2026-03-05");
    expect(buildDailySlug("2026-03-05T08:00:00+08:00")).toBe("daily-2026-03-05");
  });

  it("daily 优先使用 Notion 中填写的 slug", () => {
    expect(resolveContentSlug("daily", "2026-03-05", "2026-03-05", "fallback-id")).toBe(
      "2026-03-05",
    );
  });

  it("daily 未填写 slug 时使用标准日期 slug", () => {
    expect(resolveContentSlug("daily", "2026-03-05", "", "fallback-id")).toBe("daily-2026-03-05");
  });

  it("daily 当日期非法时回退 rawSlug/fallback", () => {
    expect(resolveContentSlug("daily", "invalid-date", "manual-slug", "fallback-id")).toBe(
      "manual-slug",
    );
    expect(resolveContentSlug("daily", "invalid-date", "", "fallback-id")).toBe("fallback-id");
  });

  it("case 保持原 slug 不变", () => {
    expect(resolveContentSlug("case", "2026-03-05", "case-custom", "fallback-id")).toBe(
      "case-custom",
    );
  });

  it("可从 daily slug 提取日期", () => {
    expect(extractDateFromDailySlug("daily-2026-03-05")).toBe("2026-03-05");
    expect(extractDateFromDailySlug("daily-2026-3-5")).toBeNull();
    expect(extractDateFromDailySlug("case-2026-03-05")).toBeNull();
  });
});

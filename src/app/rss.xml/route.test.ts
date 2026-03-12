import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPublishedContentMetaMock = vi.fn();

vi.mock("@/lib/notion", () => ({
  getPublishedContentMeta: getPublishedContentMetaMock,
}));

describe("GET /rss.xml", () => {
  beforeEach(() => {
    getPublishedContentMetaMock.mockReset();
    process.env.NEXT_PUBLIC_SITE_URL = "https://gdlab.example.com";
  });

  afterEach(() => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  it("返回 RSS XML 并输出 daily/insight 链接", async () => {
    getPublishedContentMetaMock.mockResolvedValue([
      {
        id: "daily-1",
        title: "Daily & News <1>",
        slug: "2026-03-12",
        type: "daily",
        publishDate: "2026-03-12",
        status: "Published",
        summary: "A & B <summary>",
        cover: null,
        tags: ["热点", "R&D"],
      },
      {
        id: "insight-1",
        title: "Insight One",
        slug: "insight-one",
        type: "insight",
        publishDate: "2026-03-11",
        status: "Published",
        summary: "",
        cover: null,
        tags: [],
      },
    ]);

    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/rss+xml");
    expect(body).toContain('<rss version="2.0"');
    expect(body).toContain(
      '<atom:link href="https://gdlab.example.com/rss.xml" rel="self" type="application/rss+xml" />',
    );
    expect(body).toContain("<link>https://gdlab.example.com/daily/2026-03-12</link>");
    expect(body).toContain("<link>https://gdlab.example.com/insights/insight-one</link>");
    expect(body).toContain("<title>Daily &amp; News &lt;1&gt;</title>");
    expect(body).toContain("<description>A &amp; B &lt;summary&gt;</description>");
    expect(body).toContain("<category>R&amp;D</category>");
  });

  it("最多输出 50 条 item", async () => {
    const payload = Array.from({ length: 55 }, (_, index) => ({
      id: `content-${index}`,
      title: `Title ${index}`,
      slug: `slug-${index}`,
      type: index % 2 === 0 ? "daily" : "insight",
      publishDate: "2026-03-12",
      status: "Published",
      summary: `summary ${index}`,
      cover: null,
      tags: [],
    }));
    getPublishedContentMetaMock.mockResolvedValue(payload);

    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.text();
    const itemCount = (body.match(/<item>/g) ?? []).length;

    expect(response.status).toBe(200);
    expect(itemCount).toBe(50);
  });
});

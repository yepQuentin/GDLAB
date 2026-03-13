import { afterEach, describe, expect, it, vi } from "vitest";

const getEngagementStatsMock = vi.fn();

vi.mock("@/lib/engagement-store", () => ({
  getEngagementStats: getEngagementStatsMock,
}));

describe("GET /api/engagement/stats", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("参数不合法时返回 400", async () => {
    const { GET } = await import("./route");

    const response = await GET(new Request("http://localhost/api/engagement/stats?type=invalid"));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
  });

  it("参数合法时返回统计", async () => {
    getEngagementStatsMock.mockResolvedValue({
      views: 12,
      likes: 3,
      shares: 1,
    });
    const { GET } = await import("./route");

    const response = await GET(
      new Request("http://localhost/api/engagement/stats?type=daily&slug=daily-2026-03-13"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      data: {
        type: "daily",
        slug: "daily-2026-03-13",
        views: 12,
        likes: 3,
        shares: 1,
      },
    });
  });
});

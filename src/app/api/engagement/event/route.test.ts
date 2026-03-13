import { afterEach, describe, expect, it, vi } from "vitest";

const applyEngagementEventMock = vi.fn();

vi.mock("@/lib/engagement-store", () => ({
  applyEngagementEvent: applyEngagementEventMock,
}));

describe("POST /api/engagement/event", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("body 不合法时返回 400", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/engagement/event", {
        method: "POST",
        body: JSON.stringify({ type: "daily" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
  });

  it("点赞缺失 clientId 时返回 400", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/engagement/event", {
        method: "POST",
        body: JSON.stringify({
          type: "daily",
          slug: "daily-2026-03-13",
          event: "like",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
  });

  it("参数合法时写入事件并返回最新统计", async () => {
    applyEngagementEventMock.mockResolvedValue({
      views: 8,
      likes: 2,
      shares: 1,
      likedByMe: true,
    });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/engagement/event", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "insight",
          slug: "market-shift",
          event: "like",
          clientId: "client-x",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      data: {
        type: "insight",
        slug: "market-shift",
        views: 8,
        likes: 2,
        shares: 1,
        likedByMe: true,
      },
    });
  });
});

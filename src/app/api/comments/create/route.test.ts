import { afterEach, describe, expect, it, vi } from "vitest";

const createCommentMock = vi.fn();
const checkCommentRateLimitMock = vi.fn();
const containsSensitiveWordMock = vi.fn();
const createClientHashMock = vi.fn();

vi.mock("@/lib/comment-store", () => ({
  createComment: createCommentMock,
}));

vi.mock("@/lib/comment-moderation", async () => {
  const actual = await vi.importActual<typeof import("@/lib/comment-moderation")>(
    "@/lib/comment-moderation",
  );
  return {
    ...actual,
    checkCommentRateLimit: checkCommentRateLimitMock,
    containsSensitiveWord: containsSensitiveWordMock,
    createClientHash: createClientHashMock,
  };
});

describe("POST /api/comments/create", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("参数不合法时返回 400", async () => {
    containsSensitiveWordMock.mockReturnValue(false);
    checkCommentRateLimitMock.mockReturnValue({ ok: true });
    createClientHashMock.mockReturnValue("hash-a");
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/comments/create", {
        method: "POST",
        body: JSON.stringify({
          slug: "daily-2026-03-13",
          body: "hello",
          clientId: "client-a",
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("命中敏感词时返回拦截提示", async () => {
    containsSensitiveWordMock.mockReturnValue(true);
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/comments/create", {
        method: "POST",
        body: JSON.stringify({
          type: "daily",
          slug: "daily-2026-03-13",
          body: "blocked",
          clientId: "client-a",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("内容含敏感词，不允许发布。");
  });

  it("参数合法时返回 200", async () => {
    containsSensitiveWordMock.mockReturnValue(false);
    createClientHashMock.mockReturnValue("hash-a");
    checkCommentRateLimitMock.mockReturnValue({ ok: true });
    createCommentMock.mockResolvedValue({
      id: "comment-1",
      type: "daily",
      slug: "daily-2026-03-13",
      parentId: null,
      depth: 0,
      nickname: "Doer",
      body: "hello",
      status: "visible",
      needsReview: true,
      createdAt: "2026-03-14T13:00:00.000Z",
    });
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/comments/create", {
        method: "POST",
        body: JSON.stringify({
          type: "daily",
          slug: "daily-2026-03-13",
          body: "hello",
          clientId: "client-a",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.id).toBe("comment-1");
  });
});

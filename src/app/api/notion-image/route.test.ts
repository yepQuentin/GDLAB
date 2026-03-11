import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const retrieveBlockMock = vi.fn();
const findCachedNotionMediaMock = vi.fn();
const cacheNotionMediaMock = vi.fn();

vi.mock("@notionhq/client", () => ({
  Client: class MockClient {
    blocks = {
      retrieve: retrieveBlockMock,
    };
  },
}));

vi.mock("@/lib/notion-media-cache", () => ({
  cacheNotionMedia: cacheNotionMediaMock,
  findCachedNotionMedia: findCachedNotionMediaMock,
}));

describe("GET /api/notion-image", () => {
  beforeEach(() => {
    process.env.NOTION_TOKEN = "test-token";
    retrieveBlockMock.mockReset();
    findCachedNotionMediaMock.mockReset();
    cacheNotionMediaMock.mockReset();
    findCachedNotionMediaMock.mockResolvedValue(null);
    cacheNotionMediaMock.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    delete process.env.NOTION_TOKEN;
  });

  it("在 blockId 可用时优先使用 fresh url 而不是旧 src", async () => {
    const fetchMock = vi.fn();
    const expiredUrl = "https://expired.example.com/old-image.jpg";
    const freshUrl = "https://fresh.example.com/new-image.jpg";

    vi.stubGlobal("fetch", fetchMock);

    retrieveBlockMock.mockResolvedValue({
      type: "image",
      image: {
        type: "file",
        file: { url: freshUrl },
      },
    });
    fetchMock.mockResolvedValue(
      new Response(Buffer.from("image-binary"), {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
        },
      }),
    );

    const { GET } = await import("./route");

    const response = await GET(
      new Request(
        `http://localhost/api/notion-image?src=${encodeURIComponent(expiredUrl)}&blockId=31f00aeb-fef7-80df-a3af-e142062422ba`,
      ),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      freshUrl,
      expect.objectContaining({
        redirect: "follow",
      }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expiredUrl,
      expect.objectContaining({
        redirect: "follow",
      }),
    );
    expect(cacheNotionMediaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        blockId: "31f00aeb-fef7-80df-a3af-e142062422ba",
        kind: "image",
        sourceUrl: freshUrl,
      }),
    );
  });
});

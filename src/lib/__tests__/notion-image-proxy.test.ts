import { describe, expect, it } from "vitest";

import {
  buildNotionImageProxyUrl,
  extractNotionBlockIdFromUrl,
  rewriteMarkdownImageUrlsWithProxy,
} from "@/lib/notion-image-proxy";

describe("notion-image-proxy", () => {
  it("extracts block id from notion image query id", () => {
    const url =
      "https://www.notion.so/image/https%3A%2F%2Fcdn.example.com%2Fa.png?table=block&id=73d4a8f9c0b24d7bb1c6f5e4d3a2b1c0&spaceId=abc";

    expect(extractNotionBlockIdFromUrl(url)).toBe("73d4a8f9-c0b2-4d7b-b1c6-f5e4d3a2b1c0");
  });

  it("builds proxy url with block id when available", () => {
    const sourceUrl =
      "https://www.notion.so/image/https%3A%2F%2Fcdn.example.com%2Fa.png?table=block&id=73d4a8f9c0b24d7bb1c6f5e4d3a2b1c0&spaceId=abc";
    const proxyUrl = buildNotionImageProxyUrl(sourceUrl);
    const parsed = new URL(proxyUrl, "http://localhost:3000");

    expect(parsed.pathname).toBe("/api/notion-image");
    expect(parsed.searchParams.get("src")).toBe(sourceUrl);
    expect(parsed.searchParams.get("blockId")).toBe("73d4a8f9-c0b2-4d7b-b1c6-f5e4d3a2b1c0");
  });

  it("prefers explicit block id when provided", () => {
    const sourceUrl =
      "https://prod-files-secure.s3.us-west-2.amazonaws.com/workspace/page-id/file-id/demo.png";
    const proxyUrl = buildNotionImageProxyUrl(sourceUrl, "31e00aeb-fef7-80af-b938-efb88269940a");
    const parsed = new URL(proxyUrl, "http://localhost:3000");

    expect(parsed.pathname).toBe("/api/notion-image");
    expect(parsed.searchParams.get("src")).toBe(sourceUrl);
    expect(parsed.searchParams.get("blockId")).toBe("31e00aeb-fef7-80af-b938-efb88269940a");
  });

  it("keeps relative urls unchanged", () => {
    expect(buildNotionImageProxyUrl("/images/foo.png")).toBe("/images/foo.png");
  });

  it("rewrites markdown image urls to proxy urls", () => {
    const markdown = [
      "before",
      "![one](https://cdn.example.com/1.png)",
      "![two](/local-image.png)",
      "after",
    ].join("\n");

    const result = rewriteMarkdownImageUrlsWithProxy(markdown);

    expect(result).toContain("![one](/api/notion-image?src=https%3A%2F%2Fcdn.example.com%2F1.png)");
    expect(result).toContain("![two](/local-image.png)");
  });
});

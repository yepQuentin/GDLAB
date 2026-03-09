import { describe, expect, it } from "vitest";

import {
  buildNotionAudioProxyUrl,
  rewriteMarkdownAudioUrlsWithProxy,
} from "@/lib/notion-audio-proxy";

describe("notion-audio-proxy", () => {
  it("builds proxy url and keeps explicit blockId", () => {
    const url =
      "https://prod-files-secure.s3.us-west-2.amazonaws.com/xx/test.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256";
    const proxyUrl = buildNotionAudioProxyUrl(url, "73d4a8f9c0b24d7bb1c6f5e4d3a2b1c0");
    const parsed = new URL(proxyUrl, "http://localhost:3000");

    expect(parsed.pathname).toBe("/api/notion-audio");
    expect(parsed.searchParams.get("src")).toBe(url);
    expect(parsed.searchParams.get("blockId")).toBe("73d4a8f9-c0b2-4d7b-b1c6-f5e4d3a2b1c0");
  });

  it("rewrites markdown audio links to proxy urls", () => {
    const markdown = [
      "[🎧 今日播客音频](https://prod-files-secure.s3.us-west-2.amazonaws.com/xx/test.mp3)",
      "[普通链接](https://example.com/article)",
      "![图片](https://example.com/demo.png)",
    ].join("\n");

    const result = rewriteMarkdownAudioUrlsWithProxy(markdown);

    expect(result).toContain(
      "[🎧 今日播客音频](/api/notion-audio?src=https%3A%2F%2Fprod-files-secure.s3.us-west-2.amazonaws.com%2Fxx%2Ftest.mp3)",
    );
    expect(result).toContain("[普通链接](https://example.com/article)");
    expect(result).toContain("![图片](https://example.com/demo.png)");
  });
});


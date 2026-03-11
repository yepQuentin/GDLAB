import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildNotionMediaLookupKeys,
  cacheNotionMedia,
  findCachedNotionMedia,
  getNotionMediaCacheDir,
  parseHttpByteRange,
} from "@/lib/notion-media-cache";

describe("notion-media-cache", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("writes media once and resolves by blockId and sourceUrl", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "gdlab-media-cache-"));

    const cached = await cacheNotionMedia({
      kind: "image",
      cacheDir: tempDir,
      blockId: "73d4a8f9-c0b2-4d7b-b1c6-f5e4d3a2b1c0",
      sourceUrl: "https://cdn.example.com/demo.png",
      contentType: "image/png; charset=utf-8",
      body: Buffer.from("png-demo"),
    });

    const byBlockId = await findCachedNotionMedia({
      kind: "image",
      cacheDir: tempDir,
      blockId: "73d4a8f9-c0b2-4d7b-b1c6-f5e4d3a2b1c0",
    });
    const bySourceUrl = await findCachedNotionMedia({
      kind: "image",
      cacheDir: tempDir,
      sourceUrl: "https://cdn.example.com/demo.png",
    });

    expect(cached.contentType).toBe("image/png");
    expect(cached.fileName.endsWith(".png")).toBe(true);
    await expect(readFile(cached.filePath, "utf8")).resolves.toBe("png-demo");
    expect(byBlockId?.filePath).toBe(cached.filePath);
    expect(bySourceUrl?.filePath).toBe(cached.filePath);
  });

  it("reuses the cached file when the same lookup keys are requested again", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "gdlab-media-cache-"));

    const first = await cacheNotionMedia({
      kind: "audio",
      cacheDir: tempDir,
      blockId: "block-audio-1",
      sourceUrl: "https://cdn.example.com/demo.mp3",
      contentType: "audio/mpeg",
      body: Buffer.from("audio-demo"),
    });
    const second = await cacheNotionMedia({
      kind: "audio",
      cacheDir: tempDir,
      blockId: "block-audio-1",
      sourceUrl: "https://cdn.example.com/demo.mp3",
      contentType: "audio/mpeg",
      body: Buffer.from("different-content"),
    });

    expect(second.filePath).toBe(first.filePath);
    await expect(readFile(first.filePath, "utf8")).resolves.toBe("audio-demo");
  });

  it("refreshes the cache when the same blockId points to a different source url", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "gdlab-media-cache-"));

    const first = await cacheNotionMedia({
      kind: "image",
      cacheDir: tempDir,
      blockId: "shared-block-id",
      sourceUrl: "https://cdn.example.com/old.png",
      contentType: "image/png",
      body: Buffer.from("old-image"),
    });
    const second = await cacheNotionMedia({
      kind: "image",
      cacheDir: tempDir,
      blockId: "shared-block-id",
      sourceUrl: "https://cdn.example.com/new.png",
      contentType: "image/png",
      body: Buffer.from("new-image"),
    });
    const byBlockId = await findCachedNotionMedia({
      kind: "image",
      cacheDir: tempDir,
      blockId: "shared-block-id",
    });

    expect(second.filePath).not.toBe(first.filePath);
    expect(byBlockId?.filePath).toBe(second.filePath);
    expect(byBlockId?.sourceUrl).toBe("https://cdn.example.com/new.png");
    await expect(readFile(second.filePath, "utf8")).resolves.toBe("new-image");
  });

  it("builds block and source lookup keys in a stable order", () => {
    expect(
      buildNotionMediaLookupKeys(
        "https://cdn.example.com/demo.png",
        "73d4a8f9-c0b2-4d7b-b1c6-f5e4d3a2b1c0",
      ),
    ).toEqual([
      "block-73d4a8f9-c0b2-4d7b-b1c6-f5e4d3a2b1c0",
      "src-fc2088bd5a496f269d04cabb70dfc5f02a03d5b2f4c3cb2c3916947040ea20d4",
    ]);
  });

  it("parses valid and invalid byte ranges", () => {
    expect(parseHttpByteRange(null, 1024)).toEqual({ status: "absent" });
    expect(parseHttpByteRange("bytes=128-1023", 2048)).toEqual({
      status: "ok",
      start: 128,
      end: 1023,
      byteLength: 896,
    });
    expect(parseHttpByteRange("bytes=256-", 1024)).toEqual({
      status: "ok",
      start: 256,
      end: 1023,
      byteLength: 768,
    });
    expect(parseHttpByteRange("bytes=-100", 1024)).toEqual({
      status: "ok",
      start: 924,
      end: 1023,
      byteLength: 100,
    });
    expect(parseHttpByteRange("bytes=999-100", 1024)).toEqual({ status: "invalid" });
    expect(parseHttpByteRange("bytes=2048-4096", 1024)).toEqual({ status: "invalid" });
  });

  it("uses the explicit cache dir override before env defaults", () => {
    expect(getNotionMediaCacheDir("/tmp/custom-cache")).toBe("/tmp/custom-cache");
  });
});

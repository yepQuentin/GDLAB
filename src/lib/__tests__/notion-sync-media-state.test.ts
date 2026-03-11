import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildEmptyMediaState,
  buildNextMediaState,
  cleanupOrphanedMediaCache,
  getMediaRetentionDays,
  shouldExpireMediaOrphan,
} from "../../../scripts/notion-sync.mjs";

describe("notion-sync media state", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("writes an orphan tombstone when the last active reference disappears", () => {
    const previousMediaState = {
      ...buildEmptyMediaState(),
      pages: {
        "page-insight": {
          content_type: "insight",
          references: [
            {
              kind: "image",
              blockId: "block-1",
              sourceUrl: "https://cdn.example.com/cover.png",
              fileName: "cover.png",
              lookupKeys: ["block-block-1", "src-cover"],
            },
          ],
          updated_at: "2026-03-10T00:00:00.000Z",
        },
      },
    };

    const nextMediaState = buildNextMediaState(previousMediaState, {}, "2026-03-11T00:00:00.000Z");

    expect(nextMediaState.pages).toEqual({});
    expect(nextMediaState.orphans).toEqual([
      {
        kind: "image",
        blockId: "block-1",
        sourceUrl: "https://cdn.example.com/cover.png",
        fileName: "cover.png",
        lookupKeys: ["block-block-1", "src-cover"],
        content_type: "insight",
        orphaned_at: "2026-03-11T00:00:00.000Z",
      },
    ]);
  });

  it("keeps active media and removes only expired orphans", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "gdlab-media-state-"));

    await mkdir(path.join(tempDir, "image", "files"), { recursive: true });
    await mkdir(path.join(tempDir, "image", "index"), { recursive: true });
    await mkdir(path.join(tempDir, "audio", "files"), { recursive: true });
    await mkdir(path.join(tempDir, "audio", "index"), { recursive: true });

    await writeFile(path.join(tempDir, "image", "files", "active.png"), "active");
    await writeFile(path.join(tempDir, "image", "index", "active-key.json"), "{}");
    await writeFile(path.join(tempDir, "audio", "files", "old.mp3"), "orphan");
    await writeFile(path.join(tempDir, "audio", "index", "old-key.json"), "{}");

    const mediaState = {
      ...buildEmptyMediaState(),
      pages: {
        "page-daily": {
          content_type: "daily",
          references: [
            {
              kind: "image",
              blockId: "active-block",
              sourceUrl: "https://cdn.example.com/active.png",
              fileName: "active.png",
              lookupKeys: ["active-key"],
            },
          ],
          updated_at: "2026-03-11T00:00:00.000Z",
        },
      },
      orphans: [
        {
          kind: "audio",
          blockId: "old-block",
          sourceUrl: "https://cdn.example.com/old.mp3",
          fileName: "old.mp3",
          lookupKeys: ["old-key"],
          content_type: "daily",
          orphaned_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    };

    const cleanupResult = await cleanupOrphanedMediaCache(
      tempDir,
      mediaState,
      Date.parse("2026-03-11T00:00:00.000Z"),
    );

    expect(cleanupResult.filesRemoved).toBe(1);
    expect(cleanupResult.indexRemoved).toBe(1);
    expect(cleanupResult.orphansRemoved).toBe(1);
    expect(cleanupResult.mediaState.orphans).toEqual([]);
    await expect(
      import("node:fs/promises").then(({ access }) => access(path.join(tempDir!, "image", "files", "active.png"))),
    ).resolves.toBeUndefined();
    await expect(
      import("node:fs/promises").then(({ access }) => access(path.join(tempDir!, "audio", "files", "old.mp3"))),
    ).rejects.toBeTruthy();
  });

  it("uses daily=30 and insight=180 retention windows", () => {
    expect(getMediaRetentionDays("daily")).toBe(30);
    expect(getMediaRetentionDays("insight")).toBe(180);

    expect(
      shouldExpireMediaOrphan(
        {
          kind: "image",
          blockId: null,
          sourceUrl: "https://cdn.example.com/daily.png",
          fileName: "daily.png",
          lookupKeys: ["daily-key"],
          content_type: "daily",
          orphaned_at: "2026-02-01T00:00:00.000Z",
        },
        Date.parse("2026-03-11T00:00:00.000Z"),
      ),
    ).toBe(true);

    expect(
      shouldExpireMediaOrphan(
        {
          kind: "image",
          blockId: null,
          sourceUrl: "https://cdn.example.com/insight.png",
          fileName: "insight.png",
          lookupKeys: ["insight-key"],
          content_type: "insight",
          orphaned_at: "2026-02-01T00:00:00.000Z",
        },
        Date.parse("2026-03-11T00:00:00.000Z"),
      ),
    ).toBe(false);
  });
});

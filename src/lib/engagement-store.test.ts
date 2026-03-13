import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  applyEngagementEvent,
  createEmptyEngagementStats,
  getEngagementStats,
} from "@/lib/engagement-store";

describe("engagement-store", () => {
  let tempDir = "";
  let storeFile = "";
  const originalStateFile = process.env.ENGAGEMENT_STATE_FILE;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "gdlab-engagement-"));
    storeFile = path.join(tempDir, "stats.json");
    process.env.ENGAGEMENT_STATE_FILE = storeFile;
  });

  afterEach(async () => {
    if (originalStateFile) {
      process.env.ENGAGEMENT_STATE_FILE = originalStateFile;
    } else {
      delete process.env.ENGAGEMENT_STATE_FILE;
    }

    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("默认返回空统计", async () => {
    const stats = await getEngagementStats({ type: "daily", slug: "daily-2026-03-13" });
    expect(stats).toEqual(createEmptyEngagementStats());
  });

  it("点赞与取消点赞保持幂等", async () => {
    const slug = "insight-alpha";

    await applyEngagementEvent({
      type: "insight",
      slug,
      event: "like",
      clientId: "client-a",
    });
    await applyEngagementEvent({
      type: "insight",
      slug,
      event: "like",
      clientId: "client-a",
    });
    await applyEngagementEvent({
      type: "insight",
      slug,
      event: "like",
      clientId: "client-b",
    });

    let stats = await getEngagementStats({ type: "insight", slug });
    expect(stats.likes).toBe(2);

    await applyEngagementEvent({
      type: "insight",
      slug,
      event: "unlike",
      clientId: "client-a",
    });
    await applyEngagementEvent({
      type: "insight",
      slug,
      event: "unlike",
      clientId: "client-a",
    });

    stats = await getEngagementStats({ type: "insight", slug });
    expect(stats.likes).toBe(1);
  });

  it("阅读与转发事件累加计数", async () => {
    const slug = "daily-2026-03-13";

    await applyEngagementEvent({ type: "daily", slug, event: "view" });
    await applyEngagementEvent({ type: "daily", slug, event: "view" });
    await applyEngagementEvent({ type: "daily", slug, event: "share" });

    const stats = await getEngagementStats({ type: "daily", slug });
    expect(stats).toEqual({
      views: 2,
      likes: 0,
      shares: 1,
    });
  });
});

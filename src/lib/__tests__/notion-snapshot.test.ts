import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = {
  NOTION_SNAPSHOT_DIR: process.env.NOTION_SNAPSHOT_DIR,
  NOTION_SYNC_STATE_FILE: process.env.NOTION_SYNC_STATE_FILE,
};

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

describe("notion-snapshot", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    vi.resetModules();
    process.env.NOTION_SNAPSHOT_DIR = ORIGINAL_ENV.NOTION_SNAPSHOT_DIR;
    process.env.NOTION_SYNC_STATE_FILE = ORIGINAL_ENV.NOTION_SYNC_STATE_FILE;

    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("读取最新快照并转换为页面元数据", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "gdlab-snapshot-"));
    process.env.NOTION_SNAPSHOT_DIR = tempDir;
    process.env.NOTION_SYNC_STATE_FILE = path.join(tempDir, "sync-state.json");

    await writeJson(process.env.NOTION_SYNC_STATE_FILE, {
      pages: {
        "page-daily": { slug: "page-daily", type: "daily", last_edited_time: "2026-03-09T08:00:00.000Z" },
        "page-insight": { slug: "microsoft", type: "case", last_edited_time: "2026-03-08T08:00:00.000Z" },
      },
      updated_at: "2026-03-09T08:05:00.000Z",
      version: 1,
    });

    await mkdir(path.join(tempDir, "page-daily"), { recursive: true });
    await mkdir(path.join(tempDir, "page-insight"), { recursive: true });

    await writeJson(path.join(tempDir, "page-daily", "2026-03-08T08-00-00-000Z.json"), {
      page_id: "page-daily",
      type: "daily",
      slug: "stale-slug",
      snapshot_at: "2026-03-08T08:00:00.000Z",
      properties: {
        title: { type: "title", title: [{ plain_text: "旧 Daily" }] },
        publish_date: { type: "date", date: { start: "2026-03-08" } },
        summary: { type: "rich_text", rich_text: [{ plain_text: "旧摘要" }] },
        tags: { type: "multi_select", multi_select: [] },
        status: { type: "select", select: { name: "Published" } },
      },
      blocks: [],
      markdown: "old",
    });

    await writeJson(path.join(tempDir, "page-daily", "2026-03-09T08-00-00-000Z.json"), {
      page_id: "page-daily",
      type: "daily",
      slug: "page-daily",
      snapshot_at: "2026-03-09T08:00:00.000Z",
      created_time: "2026-03-09T07:00:00.000Z",
      properties: {
        title: { type: "title", title: [{ plain_text: "今日热点" }] },
        publish_date: { type: "date", date: { start: "2026-03-09" } },
        summary: { type: "rich_text", rich_text: [{ plain_text: "最新摘要" }] },
        tags: { type: "multi_select", multi_select: [{ name: "品牌" }] },
        status: { type: "select", select: { name: "Published" } },
      },
      blocks: [],
      markdown: "latest",
    });

    await writeJson(path.join(tempDir, "page-insight", "2026-03-08T08-00-00-000Z.json"), {
      page_id: "page-insight",
      type: "case",
      slug: "microsoft",
      snapshot_at: "2026-03-08T08:00:00.000Z",
      created_time: "2026-03-08T07:00:00.000Z",
      properties: {
        title: { type: "title", title: [{ plain_text: "微软转型" }] },
        publish_date: { type: "date", date: { start: "2026-03-08" } },
        slug: { type: "rich_text", rich_text: [{ plain_text: "microsoft" }] },
        summary: { type: "rich_text", rich_text: [{ plain_text: "商业案例" }] },
        tags: { type: "multi_select", multi_select: [{ name: "云" }] },
        status: { type: "select", select: { name: "Published" } },
        cover: {
          type: "files",
          files: [{ type: "external", external: { url: "https://cdn.example.com/cover.png" } }],
        },
      },
      blocks: [],
      markdown: "insight",
    });

    const { getSnapshotContentMetaList, getSnapshotContentMetaBySlug } = await import("../notion-snapshot");
    const items = await getSnapshotContentMetaList();

    expect(items).not.toBeNull();
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({
      id: "page-daily",
      slug: "daily-2026-03-09",
      title: "今日热点",
      type: "daily",
    });
    expect(items?.[1]).toMatchObject({
      id: "page-insight",
      slug: "microsoft",
      title: "微软转型",
      type: "insight",
      cover: "https://cdn.example.com/cover.png",
    });

    await expect(getSnapshotContentMetaBySlug("insight", "microsoft")).resolves.toMatchObject({
      id: "page-insight",
      slug: "microsoft",
    });
  });

  it("读取最新快照中的 markdown 和 blocks", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "gdlab-snapshot-"));
    process.env.NOTION_SNAPSHOT_DIR = tempDir;
    process.env.NOTION_SYNC_STATE_FILE = path.join(tempDir, "sync-state.json");

    await writeJson(process.env.NOTION_SYNC_STATE_FILE, {
      pages: {
        "page-1": { slug: "demo", type: "insight", last_edited_time: "2026-03-09T08:00:00.000Z" },
      },
      updated_at: "2026-03-09T08:05:00.000Z",
      version: 1,
    });

    await mkdir(path.join(tempDir, "page-1"), { recursive: true });
    await writeJson(path.join(tempDir, "page-1", "2026-03-09T08-00-00-000Z.json"), {
      page_id: "page-1",
      type: "insight",
      slug: "demo",
      snapshot_at: "2026-03-09T08:00:00.000Z",
      properties: {
        title: { type: "title", title: [{ plain_text: "Demo" }] },
        status: { type: "select", select: { name: "Published" } },
      },
      markdown: "# Hello",
      blocks: [{ id: "block-1", type: "paragraph", paragraph: { rich_text: [] } }],
    });

    const { getSnapshotBlocksByPageId, getSnapshotMarkdownByPageId } = await import("../notion-snapshot");

    await expect(getSnapshotMarkdownByPageId("page-1")).resolves.toBe("# Hello");
    await expect(getSnapshotBlocksByPageId("page-1")).resolves.toMatchObject([
      { id: "block-1", type: "paragraph" },
    ]);
  });

  it("在状态文件与快照不一致时返回 null，交给 live Notion 兜底", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "gdlab-snapshot-"));
    process.env.NOTION_SNAPSHOT_DIR = tempDir;
    process.env.NOTION_SYNC_STATE_FILE = path.join(tempDir, "sync-state.json");

    await writeJson(process.env.NOTION_SYNC_STATE_FILE, {
      pages: {
        missing: { slug: "missing", type: "daily", last_edited_time: "2026-03-09T08:00:00.000Z" },
      },
      updated_at: "2026-03-09T08:05:00.000Z",
      version: 1,
    });

    const { getSnapshotContentMetaList } = await import("../notion-snapshot");

    await expect(getSnapshotContentMetaList()).resolves.toBeNull();
  });
});

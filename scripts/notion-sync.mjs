import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  Client,
  extractDatabaseId,
  isFullBlock,
  isFullPage,
} from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";

const SNAPSHOT_VERSION = 1;
const STATE_VERSION = 1;
const DEFAULT_REVALIDATE_URL = "http://127.0.0.1:3000/api/internal/revalidate";
const DEFAULT_RETENTION_DAYS = 90;
const SYNC_CONTENT_TYPES = new Set(["daily", "insight", "case"]);

function formatErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function buildNotionAudioProxyUrl(rawUrl, explicitBlockId) {
  if (!/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }

  const parsed = new URL(rawUrl);
  if (parsed.pathname === "/api/notion-audio") {
    return rawUrl;
  }

  const query = new URLSearchParams({ src: rawUrl });
  if (explicitBlockId) {
    query.set("blockId", explicitBlockId);
  }

  return `/api/notion-audio?${query.toString()}`;
}

function configureNotionToMarkdown(notionToMarkdown) {
  notionToMarkdown.setCustomTransformer("audio", async (rawBlock) => {
    const block = rawBlock;
    if (block.type !== "audio" || !block.audio) {
      return false;
    }

    const audioBlock = block.audio;
    const sourceUrl =
      audioBlock.type === "external" ? audioBlock.external?.url : audioBlock.file?.url;
    if (!sourceUrl) {
      return "";
    }

    const caption = audioBlock.caption.map((item) => item.plain_text).join("").trim();
    const linkText = caption || "🎧 今日播客音频";
    const proxiedUrl = buildNotionAudioProxyUrl(sourceUrl, block.id);

    return `[${linkText}](${proxiedUrl})`;
  });
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getOptionalEnv(name, fallback) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function getSelectProperty(page, propertyName) {
  const property = page.properties[propertyName];
  if (!property || property.type !== "select") {
    return "";
  }

  return property.select?.name?.trim() ?? "";
}

function getRichTextProperty(page, propertyName) {
  const property = page.properties[propertyName];
  if (!property || property.type !== "rich_text") {
    return "";
  }

  return property.rich_text.map((item) => item.plain_text).join("").trim();
}

function normalizeContentType(rawType) {
  const normalized = String(rawType || "").trim().toLowerCase();
  if (normalized === "insight" || normalized === "case") {
    return "insight";
  }

  return "daily";
}

function resolveDataSourceId(rawDatabaseId) {
  return extractDatabaseId(rawDatabaseId) ?? rawDatabaseId;
}

async function readJsonIfExists(filePath, fallback) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
  await rename(tempPath, filePath);
}

async function listAllPublishedPages(client, dataSourceId) {
  const pages = [];
  let cursor;

  do {
    const response = await client.dataSources.query({
      data_source_id: dataSourceId,
      filter: {
        property: "status",
        select: { equals: "Published" },
      },
      page_size: 100,
      start_cursor: cursor,
      sorts: [{ property: "publish_date", direction: "descending" }],
    });

    for (const result of response.results) {
      if (!isFullPage(result)) {
        continue;
      }

      const rawType = getSelectProperty(result, "type");
      if (!SYNC_CONTENT_TYPES.has(rawType)) {
        continue;
      }

      const type = normalizeContentType(rawType);

      const slug = getRichTextProperty(result, "slug") || result.id.replace(/-/g, "");
      pages.push({
        page_id: result.id,
        last_edited_time: result.last_edited_time,
        slug,
        type,
      });
    }

    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);

  return pages;
}

async function listAllBlockChildren(client, blockId) {
  const blocks = [];
  let cursor;

  do {
    const response = await client.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor,
    });

    for (const result of response.results) {
      if (isFullBlock(result)) {
        blocks.push(result);
      }
    }

    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);

  return blocks;
}

async function fetchBlockTree(client, blockId) {
  const blocks = await listAllBlockChildren(client, blockId);

  return Promise.all(
    blocks.map(async (block) => {
      const children = block.has_children ? await fetchBlockTree(client, block.id) : [];
      return {
        ...block,
        children,
      };
    }),
  );
}

async function buildPageMarkdown(notionToMarkdown, pageId) {
  try {
    const markdownBlocks = await notionToMarkdown.pageToMarkdown(pageId);
    return notionToMarkdown.toMarkdownString(markdownBlocks).parent;
  } catch (error) {
    console.warn(`[notion-sync] markdown snapshot skipped for ${pageId}: ${formatErrorMessage(error)}`);
    return undefined;
  }
}

async function buildSnapshot(client, notionToMarkdown, dataSourceId, pageSummary) {
  const pageResponse = await client.pages.retrieve({ page_id: pageSummary.page_id });
  if (!isFullPage(pageResponse)) {
    throw new Error(`Unable to retrieve full page: ${pageSummary.page_id}`);
  }

  const blocks = await fetchBlockTree(client, pageSummary.page_id);
  const markdown = await buildPageMarkdown(notionToMarkdown, pageSummary.page_id);

  return {
    snapshot_version: SNAPSHOT_VERSION,
    snapshot_at: new Date().toISOString(),
    source_database_id: dataSourceId,
    page_id: pageSummary.page_id,
    type: pageSummary.type,
    slug: pageSummary.slug,
    last_edited_time: pageSummary.last_edited_time,
    created_time: pageResponse.created_time,
    cover: pageResponse.cover,
    properties: pageResponse.properties,
    blocks,
    ...(typeof markdown === "string" ? { markdown } : {}),
  };
}

async function writeSnapshot(snapshotDir, snapshot) {
  const pageDir = path.join(snapshotDir, snapshot.page_id);
  await mkdir(pageDir, { recursive: true });

  const normalizedTimestamp = snapshot.snapshot_at.replace(/[.:]/g, "-");
  const snapshotPath = path.join(pageDir, `${normalizedTimestamp}.json`);
  await writeJsonAtomic(snapshotPath, snapshot);
}

function buildEmptyState() {
  return {
    pages: {},
    updated_at: "",
    version: STATE_VERSION,
  };
}

function normalizeState(raw) {
  if (!raw || typeof raw !== "object" || raw.version !== STATE_VERSION) {
    return buildEmptyState();
  }

  if (!raw.pages || typeof raw.pages !== "object") {
    return buildEmptyState();
  }

  return {
    pages: raw.pages,
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : "",
    version: STATE_VERSION,
  };
}

async function cleanupExpiredSnapshots(snapshotDir, retentionDays) {
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const entries = await readdir(snapshotDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const pageDir = path.join(snapshotDir, entry.name);
    const snapshots = await readdir(pageDir, { withFileTypes: true });

    for (const snapshot of snapshots) {
      if (!snapshot.isFile() || !snapshot.name.endsWith(".json")) {
        continue;
      }

      const filePath = path.join(pageDir, snapshot.name);
      const fileStats = await stat(filePath);

      if (now - fileStats.mtimeMs > retentionMs) {
        await rm(filePath, { force: true });
      }
    }

    const remaining = await readdir(pageDir);
    if (remaining.length === 0) {
      await rm(pageDir, { recursive: true, force: true });
    }
  }
}

async function triggerRevalidation(revalidateUrl, revalidateSecret, payload) {
  const response = await fetch(revalidateUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-revalidate-secret": revalidateSecret,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Revalidate request failed with ${response.status}: ${body}`);
  }
}

async function main() {
  const notionToken = requireEnv("NOTION_TOKEN");
  const rawDatabaseId = requireEnv("NOTION_DATABASE_ID");
  const revalidateSecret = requireEnv("REVALIDATE_SECRET");

  const dataSourceId = resolveDataSourceId(rawDatabaseId);
  const snapshotDir = getOptionalEnv("NOTION_SNAPSHOT_DIR", "/var/lib/gdlab/notion-snapshots");
  const stateFilePath = getOptionalEnv("NOTION_SYNC_STATE_FILE", path.join(snapshotDir, "sync-state.json"));
  const revalidateUrl = getOptionalEnv("REVALIDATE_URL", DEFAULT_REVALIDATE_URL);
  const retentionDaysRaw = getOptionalEnv("NOTION_SNAPSHOT_RETENTION_DAYS", String(DEFAULT_RETENTION_DAYS));
  const retentionDays = Number.parseInt(retentionDaysRaw, 10);

  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    throw new Error(`Invalid NOTION_SNAPSHOT_RETENTION_DAYS: ${retentionDaysRaw}`);
  }

  await mkdir(snapshotDir, { recursive: true });

  const notionClient = new Client({ auth: notionToken });
  const notionToMarkdown = new NotionToMarkdown({ notionClient });
  configureNotionToMarkdown(notionToMarkdown);
  const previousState = normalizeState(await readJsonIfExists(stateFilePath, buildEmptyState()));
  const pages = await listAllPublishedPages(notionClient, dataSourceId);

  const nextPagesState = {};
  const changedPages = [];
  for (const page of pages) {
    nextPagesState[page.page_id] = {
      last_edited_time: page.last_edited_time,
      slug: page.slug,
      type: page.type,
    };

    const previousPage = previousState.pages[page.page_id];
    if (
      !previousPage ||
      previousPage.last_edited_time !== page.last_edited_time ||
      previousPage.slug !== page.slug ||
      previousPage.type !== page.type
    ) {
      changedPages.push(page);
    }
  }

  const removedPageIds = Object.keys(previousState.pages).filter((pageId) => !nextPagesState[pageId]);

  for (const page of changedPages) {
    const snapshot = await buildSnapshot(notionClient, notionToMarkdown, dataSourceId, page);
    await writeSnapshot(snapshotDir, snapshot);
    console.log(`[notion-sync] snapshot written for ${page.type}:${page.slug} (${page.page_id})`);
  }

  await cleanupExpiredSnapshots(snapshotDir, retentionDays);

  const hasDetectedChanges = changedPages.length > 0 || removedPageIds.length > 0;
  if (hasDetectedChanges) {
    await triggerRevalidation(revalidateUrl, revalidateSecret, {
      changed_page_ids: changedPages.map((page) => page.page_id),
      removed_page_ids: removedPageIds,
      source: "notion-sync",
      triggered_at: new Date().toISOString(),
    });
    console.log(
      `[notion-sync] revalidate triggered (changed=${changedPages.length}, removed=${removedPageIds.length})`,
    );
  } else {
    console.log("[notion-sync] no changes detected");
  }

  await writeJsonAtomic(stateFilePath, {
    pages: nextPagesState,
    updated_at: new Date().toISOString(),
    version: STATE_VERSION,
  });
}

main().catch((error) => {
  console.error("[notion-sync] failed", error);
  process.exitCode = 1;
});

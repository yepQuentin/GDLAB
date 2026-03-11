import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  Client,
  extractDatabaseId,
  isFullBlock,
  isFullPage,
} from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";

const SNAPSHOT_VERSION = 1;
const STATE_VERSION = 1;
const MEDIA_STATE_VERSION = 1;
const DEFAULT_REVALIDATE_URL = "http://127.0.0.1:3000/api/internal/revalidate";
const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_MEDIA_CACHE_DIR = "/var/lib/gdlab/notion-media-cache";
const SYNC_CONTENT_TYPES = new Set(["daily", "insight", "case"]);
const CONTENT_TYPE_TO_EXTENSION = new Map([
  ["audio/mp4", ".m4a"],
  ["audio/mpeg", ".mp3"],
  ["audio/ogg", ".ogg"],
  ["audio/wav", ".wav"],
  ["image/gif", ".gif"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

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

function buildNotionImageProxyUrl(rawUrl, explicitBlockId) {
  if (!/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }

  const parsed = new URL(rawUrl);
  if (parsed.pathname === "/api/notion-image") {
    return rawUrl;
  }

  const query = new URLSearchParams({ src: rawUrl });
  if (explicitBlockId) {
    query.set("blockId", explicitBlockId);
  }

  return `/api/notion-image?${query.toString()}`;
}

function configureNotionToMarkdown(notionToMarkdown) {
  notionToMarkdown.setCustomTransformer("image", async (rawBlock) => {
    const block = rawBlock;
    if (block.type !== "image" || !block.image) {
      return false;
    }

    const imageBlock = block.image;
    const sourceUrl =
      imageBlock.type === "external" ? imageBlock.external?.url : imageBlock.file?.url;
    if (!sourceUrl) {
      return "";
    }

    const alt = imageBlock.caption.map((item) => item.plain_text).join("").trim();
    const proxiedUrl = buildNotionImageProxyUrl(sourceUrl, block.id);

    return `![${alt}](${proxiedUrl})`;
  });

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

function hashValue(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeSourceUrl(sourceUrl) {
  try {
    return new URL(sourceUrl).toString();
  } catch {
    return String(sourceUrl || "").trim();
  }
}

function sanitizeSegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_.]+/g, "_");
}

function buildBlockLookupKey(blockId) {
  if (!blockId || !String(blockId).trim()) {
    return null;
  }

  return `block-${sanitizeSegment(blockId)}`;
}

function buildSourceLookupKey(sourceUrl) {
  return `src-${hashValue(normalizeSourceUrl(sourceUrl))}`;
}

function buildLookupKeys(sourceUrl, blockId) {
  const blockLookupKey = buildBlockLookupKey(blockId);
  return blockLookupKey
    ? [blockLookupKey, buildSourceLookupKey(sourceUrl)]
    : [buildSourceLookupKey(sourceUrl)];
}

function getKindRoot(cacheDir, kind) {
  return path.join(cacheDir, kind);
}

function getFilesDir(cacheDir, kind) {
  return path.join(getKindRoot(cacheDir, kind), "files");
}

function getIndexDir(cacheDir, kind) {
  return path.join(getKindRoot(cacheDir, kind), "index");
}

function getIndexPath(cacheDir, kind, lookupKey) {
  return path.join(getIndexDir(cacheDir, kind), `${lookupKey}.json`);
}

function getNormalizedContentType(contentType) {
  return String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function getFileExtension(kind, sourceUrl, contentType) {
  const normalizedContentType = getNormalizedContentType(contentType);
  const mappedExtension = CONTENT_TYPE_TO_EXTENSION.get(normalizedContentType);
  if (mappedExtension) {
    return mappedExtension;
  }

  try {
    const extension = path.extname(new URL(sourceUrl).pathname).toLowerCase();
    if (extension) {
      return extension;
    }
  } catch {
    // Ignore malformed source URLs and use the media kind fallback.
  }

  return kind === "audio" ? ".bin" : ".asset";
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

async function writeBufferAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, value);
  await rename(tempPath, filePath);
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function ensureMediaCacheDirectories(cacheDir, kind) {
  await mkdir(getFilesDir(cacheDir, kind), { recursive: true });
  await mkdir(getIndexDir(cacheDir, kind), { recursive: true });
}

async function readCachedMediaEntryByLookupKey(cacheDir, kind, lookupKey) {
  const indexPath = getIndexPath(cacheDir, kind, lookupKey);
  if (!(await pathExists(indexPath))) {
    return null;
  }

  const raw = await readFile(indexPath, "utf8");
  const cachedEntry = JSON.parse(raw);
  const filePath = path.join(getFilesDir(cacheDir, kind), cachedEntry.fileName);
  if (!(await pathExists(filePath))) {
    return null;
  }

  return {
    ...cachedEntry,
    filePath,
  };
}

async function findCachedMediaEntry(cacheDir, kind, sourceUrl, blockId) {
  if (!sourceUrl && !blockId) {
    return null;
  }

  const lookupKeys = sourceUrl
    ? buildLookupKeys(sourceUrl, blockId)
    : [buildBlockLookupKey(blockId)].filter(Boolean);

  for (const lookupKey of lookupKeys) {
    const cachedEntry = await readCachedMediaEntryByLookupKey(cacheDir, kind, lookupKey);
    if (cachedEntry) {
      return cachedEntry;
    }
  }

  return null;
}

function shouldReuseCachedMediaEntry(cachedEntry, entry) {
  if (!cachedEntry) {
    return false;
  }

  if (!entry.blockId) {
    return true;
  }

  return cachedEntry.sourceUrl === normalizeSourceUrl(entry.sourceUrl);
}

function getMediaSourceUrl(media) {
  if (!media || typeof media !== "object") {
    return "";
  }

  return media.type === "external" ? media.external?.url ?? "" : media.file?.url ?? "";
}

function collectBlockMediaEntries(blocks, entries = []) {
  for (const block of blocks) {
    if (block.type === "image") {
      const sourceUrl = getMediaSourceUrl(block.image);
      if (sourceUrl) {
        entries.push({ kind: "image", blockId: block.id, sourceUrl });
      }
    }

    if (block.type === "audio") {
      const sourceUrl = getMediaSourceUrl(block.audio);
      if (sourceUrl) {
        entries.push({ kind: "audio", blockId: block.id, sourceUrl });
      }
    }

    if (Array.isArray(block.children) && block.children.length > 0) {
      collectBlockMediaEntries(block.children, entries);
    }
  }

  return entries;
}

function collectSnapshotCoverEntries(snapshot) {
  const entries = [];

  const propertyCover = snapshot?.properties?.cover;
  if (propertyCover?.type === "files" && Array.isArray(propertyCover.files)) {
    for (const file of propertyCover.files) {
      const sourceUrl = getMediaSourceUrl(file);
      if (sourceUrl) {
        entries.push({ kind: "image", blockId: null, sourceUrl });
      }
    }
  }

  const pageCover = getMediaSourceUrl(snapshot?.cover);
  if (pageCover) {
    entries.push({ kind: "image", blockId: null, sourceUrl: pageCover });
  }

  return entries;
}

function dedupeMediaEntries(entries) {
  const byKey = new Map();
  for (const entry of entries) {
    const dedupeKey = `${entry.kind}:${entry.blockId ?? "no-block"}:${normalizeSourceUrl(entry.sourceUrl)}`;
    if (!byKey.has(dedupeKey)) {
      byKey.set(dedupeKey, {
        ...entry,
        sourceUrl: normalizeSourceUrl(entry.sourceUrl),
      });
    }
  }

  return [...byKey.values()];
}

async function cacheMediaEntry(cacheDir, entry, contentType, body) {
  const existing = await findCachedMediaEntry(cacheDir, entry.kind, entry.sourceUrl, entry.blockId);
  if (shouldReuseCachedMediaEntry(existing, entry)) {
    return existing;
  }

  await ensureMediaCacheDirectories(cacheDir, entry.kind);

  const normalizedSourceUrl = normalizeSourceUrl(entry.sourceUrl);
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const fileExtension = getFileExtension(entry.kind, normalizedSourceUrl, contentType);
  const blockLookupKey = buildBlockLookupKey(entry.blockId);
  const sourceLookupKey = buildSourceLookupKey(normalizedSourceUrl);
  const storageKey = `${blockLookupKey ?? sourceLookupKey}-${hashValue(normalizedSourceUrl).slice(0, 12)}`;
  const fileName = `${storageKey}${fileExtension}`;
  const filePath = path.join(getFilesDir(cacheDir, entry.kind), fileName);
  const cachedEntry = {
    kind: entry.kind,
    blockId: entry.blockId || null,
    sourceUrl: normalizedSourceUrl,
    contentType: getNormalizedContentType(contentType),
    byteLength: buffer.length,
    fileName,
    cachedAt: new Date().toISOString(),
  };

  await writeBufferAtomic(filePath, buffer);
  await Promise.all(
    buildLookupKeys(normalizedSourceUrl, entry.blockId).map((lookupKey) =>
      writeJsonAtomic(getIndexPath(cacheDir, entry.kind, lookupKey), cachedEntry),
    ),
  );

  return {
    ...cachedEntry,
    filePath,
  };
}

async function fetchAndCacheMediaEntry(cacheDir, entry) {
  const existing = await findCachedMediaEntry(cacheDir, entry.kind, entry.sourceUrl, entry.blockId);
  if (shouldReuseCachedMediaEntry(existing, entry)) {
    return { source: "disk", cachedEntry: existing };
  }

  const response = await fetch(entry.sourceUrl);
  if (!response.ok) {
    throw new Error(`media fetch failed with ${response.status}`);
  }

  const body = Buffer.from(await response.arrayBuffer());
  const cachedEntry = await cacheMediaEntry(
    cacheDir,
    entry,
    response.headers.get("content-type") ?? "",
    body,
  );

  return { source: "network", cachedEntry };
}

async function prewarmSnapshotMedia(cacheDir, snapshot) {
  const mediaEntries = dedupeMediaEntries([
    ...collectSnapshotCoverEntries(snapshot),
    ...collectBlockMediaEntries(Array.isArray(snapshot.blocks) ? snapshot.blocks : []),
  ]);

  const result = {
    total: mediaEntries.length,
    network: 0,
    disk: 0,
    failed: 0,
    references: [],
  };

  for (const entry of mediaEntries) {
    try {
      const warmed = await fetchAndCacheMediaEntry(cacheDir, entry);
      if (warmed.source === "network") {
        result.network += 1;
      } else {
        result.disk += 1;
      }
      result.references.push({
        kind: warmed.cachedEntry.kind,
        blockId: warmed.cachedEntry.blockId,
        sourceUrl: warmed.cachedEntry.sourceUrl,
        fileName: warmed.cachedEntry.fileName,
        lookupKeys: buildLookupKeys(warmed.cachedEntry.sourceUrl, warmed.cachedEntry.blockId),
      });
    } catch (error) {
      result.failed += 1;
      console.warn(
        `[notion-sync] media cache skipped for ${entry.kind}:${entry.blockId ?? "no-block"} ${entry.sourceUrl}: ${formatErrorMessage(error)}`,
      );
    }
  }

  return result;
}

function buildEmptyMediaState() {
  return {
    orphans: [],
    pages: {},
    updated_at: "",
    version: MEDIA_STATE_VERSION,
  };
}

function normalizeMediaReference(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  if (raw.kind !== "image" && raw.kind !== "audio") {
    return null;
  }

  if (typeof raw.fileName !== "string" || !raw.fileName.trim()) {
    return null;
  }

  if (!Array.isArray(raw.lookupKeys)) {
    return null;
  }

  const lookupKeys = raw.lookupKeys
    .filter((lookupKey) => typeof lookupKey === "string" && lookupKey.trim())
    .map((lookupKey) => lookupKey.trim());

  if (lookupKeys.length === 0) {
    return null;
  }

  return {
    kind: raw.kind,
    blockId: typeof raw.blockId === "string" && raw.blockId.trim() ? raw.blockId.trim() : null,
    sourceUrl: typeof raw.sourceUrl === "string" ? normalizeSourceUrl(raw.sourceUrl) : "",
    fileName: raw.fileName.trim(),
    lookupKeys,
  };
}

function normalizePageContentType(rawType) {
  return rawType === "insight" ? "insight" : "daily";
}

function normalizeMediaOrphan(raw) {
  const reference = normalizeMediaReference(raw);
  if (!reference) {
    return null;
  }

  if (typeof raw.orphaned_at !== "string" || !raw.orphaned_at.trim()) {
    return null;
  }

  return {
    ...reference,
    content_type: normalizePageContentType(raw.content_type),
    orphaned_at: raw.orphaned_at,
  };
}

function normalizeMediaState(raw) {
  if (!raw || typeof raw !== "object" || raw.version !== MEDIA_STATE_VERSION) {
    return buildEmptyMediaState();
  }

  if (!raw.pages || typeof raw.pages !== "object") {
    return buildEmptyMediaState();
  }

  const pages = {};
  for (const [pageId, pageState] of Object.entries(raw.pages)) {
    if (!pageState || typeof pageState !== "object" || !Array.isArray(pageState.references)) {
      continue;
    }

    const references = pageState.references
      .map((reference) => normalizeMediaReference(reference))
      .filter(Boolean);

    pages[pageId] = {
      content_type: normalizePageContentType(pageState.content_type),
      references,
      updated_at: typeof pageState.updated_at === "string" ? pageState.updated_at : "",
    };
  }

  const orphans = Array.isArray(raw.orphans)
    ? raw.orphans
        .map((orphan) => normalizeMediaOrphan(orphan))
        .filter(Boolean)
    : [];

  return {
    orphans,
    pages,
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : "",
    version: MEDIA_STATE_VERSION,
  };
}

function dedupeMediaReferences(references) {
  const byKey = new Map();

  for (const reference of references) {
    const normalized = normalizeMediaReference(reference);
    if (!normalized) {
      continue;
    }

    const dedupeKey = `${normalized.kind}:${normalized.fileName}`;
    const existing = byKey.get(dedupeKey);
    if (!existing) {
      byKey.set(dedupeKey, normalized);
      continue;
    }

    byKey.set(dedupeKey, {
      ...existing,
      blockId: existing.blockId ?? normalized.blockId,
      sourceUrl: existing.sourceUrl || normalized.sourceUrl,
      lookupKeys: [...new Set([...existing.lookupKeys, ...normalized.lookupKeys])],
    });
  }

  return [...byKey.values()];
}

function mergeMediaReferences(...referenceSets) {
  return dedupeMediaReferences(referenceSets.flat());
}

function buildMediaReferenceKey(reference) {
  return `${reference.kind}:${reference.fileName}`;
}

function collectActiveMediaOwners(pagesState) {
  const owners = new Map();

  for (const pageState of Object.values(pagesState)) {
    const contentType = normalizePageContentType(pageState.content_type);

    for (const reference of pageState.references) {
      const referenceKey = buildMediaReferenceKey(reference);
      const existing = owners.get(referenceKey);

      if (!existing) {
        owners.set(referenceKey, {
          contentTypes: new Set([contentType]),
          reference,
        });
        continue;
      }

      existing.contentTypes.add(contentType);
      existing.reference = mergeMediaReferences(existing.reference, reference)[0];
    }
  }

  return owners;
}

function collectActiveMediaArtifacts(pagesState) {
  const activeFiles = {
    image: new Set(),
    audio: new Set(),
  };
  const activeLookupKeys = {
    image: new Set(),
    audio: new Set(),
  };

  for (const pageState of Object.values(pagesState)) {
    for (const reference of pageState.references) {
      activeFiles[reference.kind].add(reference.fileName);
      for (const lookupKey of reference.lookupKeys) {
        activeLookupKeys[reference.kind].add(`${lookupKey}.json`);
      }
    }
  }

  return {
    activeFiles,
    activeLookupKeys,
  };
}

function getMediaRetentionDays(contentType) {
  return contentType === "insight" ? 180 : 30;
}

function shouldExpireMediaOrphan(orphan, now = Date.now()) {
  const orphanedTimestamp = Date.parse(orphan.orphaned_at);
  if (!Number.isFinite(orphanedTimestamp)) {
    return false;
  }

  const retentionMs = getMediaRetentionDays(orphan.content_type) * 24 * 60 * 60 * 1000;
  return now - orphanedTimestamp >= retentionMs;
}

function buildNextMediaState(previousMediaState, nextPagesState, updatedAt) {
  const normalizedUpdatedAt = updatedAt || new Date().toISOString();
  const previousOwners = collectActiveMediaOwners(previousMediaState.pages);
  const nextOwners = collectActiveMediaOwners(nextPagesState);
  const nextOrphansByKey = new Map();

  for (const orphan of previousMediaState.orphans) {
    const referenceKey = buildMediaReferenceKey(orphan);
    if (!nextOwners.has(referenceKey)) {
      nextOrphansByKey.set(referenceKey, orphan);
    }
  }

  for (const [referenceKey, previousOwner] of previousOwners.entries()) {
    if (nextOwners.has(referenceKey)) {
      continue;
    }

    if (nextOrphansByKey.has(referenceKey)) {
      continue;
    }

    nextOrphansByKey.set(referenceKey, {
      ...previousOwner.reference,
      content_type: previousOwner.contentTypes.has("insight") ? "insight" : "daily",
      orphaned_at: normalizedUpdatedAt,
    });
  }

  return {
    orphans: [...nextOrphansByKey.values()],
    pages: nextPagesState,
    updated_at: normalizedUpdatedAt,
    version: MEDIA_STATE_VERSION,
  };
}

async function cleanupOrphanedMediaCache(cacheDir, mediaState, now = Date.now()) {
  const { activeFiles, activeLookupKeys } = collectActiveMediaArtifacts(mediaState.pages);
  const summary = {
    filesRemoved: 0,
    indexRemoved: 0,
    orphansRemoved: 0,
    mediaState,
  };

  const retainedOrphans = [];

  for (const orphan of mediaState.orphans) {
    const isActive = activeFiles[orphan.kind].has(orphan.fileName);
    if (isActive) {
      summary.orphansRemoved += 1;
      continue;
    }

    if (!shouldExpireMediaOrphan(orphan, now)) {
      retainedOrphans.push(orphan);
      continue;
    }

    const filePath = path.join(getFilesDir(cacheDir, orphan.kind), orphan.fileName);
    if (await pathExists(filePath)) {
      await rm(filePath, { force: true });
      summary.filesRemoved += 1;
    }

    for (const lookupKey of orphan.lookupKeys) {
      const indexPath = path.join(getIndexDir(cacheDir, orphan.kind), `${lookupKey}.json`);
      if (await pathExists(indexPath)) {
        await rm(indexPath, { force: true });
        summary.indexRemoved += 1;
      }
    }

    summary.orphansRemoved += 1;
  }

  for (const kind of ["image", "audio"]) {
    const filesDir = getFilesDir(cacheDir, kind);
    if (await pathExists(filesDir)) {
      const fileEntries = await readdir(filesDir, { withFileTypes: true });
      for (const entry of fileEntries) {
        if (!entry.isFile()) {
          continue;
        }

        const isActive = activeFiles[kind].has(entry.name);
        const isRetainedOrphan = retainedOrphans.some(
          (orphan) => orphan.kind === kind && orphan.fileName === entry.name,
        );

        if (isActive || isRetainedOrphan) {
          continue;
        }

        await rm(path.join(filesDir, entry.name), { force: true });
        summary.filesRemoved += 1;
      }
    }

    const indexDir = getIndexDir(cacheDir, kind);
    if (await pathExists(indexDir)) {
      const indexEntries = await readdir(indexDir, { withFileTypes: true });
      for (const entry of indexEntries) {
        if (!entry.isFile()) {
          continue;
        }

        const isActive = activeLookupKeys[kind].has(entry.name);
        const isRetainedOrphan = retainedOrphans.some(
          (orphan) =>
            orphan.kind === kind && orphan.lookupKeys.some((lookupKey) => `${lookupKey}.json` === entry.name),
        );

        if (isActive || isRetainedOrphan) {
          continue;
        }

        await rm(path.join(indexDir, entry.name), { force: true });
        summary.indexRemoved += 1;
      }
    }
  }

  summary.mediaState = {
    ...mediaState,
    orphans: retainedOrphans,
  };

  return summary;
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
  const mediaCacheDir = getOptionalEnv("NOTION_MEDIA_CACHE_DIR", DEFAULT_MEDIA_CACHE_DIR);
  const mediaStateFilePath = getOptionalEnv(
    "NOTION_MEDIA_STATE_FILE",
    path.join(mediaCacheDir, "media-state.json"),
  );
  const stateFilePath = getOptionalEnv("NOTION_SYNC_STATE_FILE", path.join(snapshotDir, "sync-state.json"));
  const revalidateUrl = getOptionalEnv("REVALIDATE_URL", DEFAULT_REVALIDATE_URL);
  const retentionDaysRaw = getOptionalEnv("NOTION_SNAPSHOT_RETENTION_DAYS", String(DEFAULT_RETENTION_DAYS));
  const retentionDays = Number.parseInt(retentionDaysRaw, 10);

  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    throw new Error(`Invalid NOTION_SNAPSHOT_RETENTION_DAYS: ${retentionDaysRaw}`);
  }

  await mkdir(snapshotDir, { recursive: true });
  await mkdir(mediaCacheDir, { recursive: true });

  const notionClient = new Client({ auth: notionToken });
  const notionToMarkdown = new NotionToMarkdown({ notionClient });
  configureNotionToMarkdown(notionToMarkdown);
  const previousState = normalizeState(await readJsonIfExists(stateFilePath, buildEmptyState()));
  const previousMediaState = normalizeMediaState(
    await readJsonIfExists(mediaStateFilePath, buildEmptyMediaState()),
  );
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
  const nextMediaPagesState = { ...previousMediaState.pages };

  for (const [pageId, pageState] of Object.entries(nextMediaPagesState)) {
    const knownType = nextPagesState[pageId]?.type || previousState.pages[pageId]?.type;
    nextMediaPagesState[pageId] = {
      ...pageState,
      content_type: normalizePageContentType(pageState.content_type || knownType),
    };
  }

  for (const pageId of removedPageIds) {
    delete nextMediaPagesState[pageId];
  }

  for (const page of changedPages) {
    const snapshot = await buildSnapshot(notionClient, notionToMarkdown, dataSourceId, page);
    await writeSnapshot(snapshotDir, snapshot);
    const mediaCacheSummary = await prewarmSnapshotMedia(mediaCacheDir, snapshot);
    const previousPageMediaState = previousMediaState.pages[page.page_id];
    const mergedReferences =
      mediaCacheSummary.failed > 0 && previousPageMediaState
        ? mergeMediaReferences(previousPageMediaState.references, mediaCacheSummary.references)
        : dedupeMediaReferences(mediaCacheSummary.references);

    nextMediaPagesState[page.page_id] = {
      content_type: normalizePageContentType(page.type),
      references: mergedReferences,
      updated_at: new Date().toISOString(),
    };
    console.log(
      `[notion-sync] snapshot written for ${page.type}:${page.slug} (${page.page_id}) media(total=${mediaCacheSummary.total}, network=${mediaCacheSummary.network}, disk=${mediaCacheSummary.disk}, failed=${mediaCacheSummary.failed})`,
    );
  }

  await cleanupExpiredSnapshots(snapshotDir, retentionDays);

  const nextMediaState = buildNextMediaState(
    previousMediaState,
    nextMediaPagesState,
    new Date().toISOString(),
  );

  try {
    const mediaCleanupSummary = await cleanupOrphanedMediaCache(mediaCacheDir, nextMediaState);
    const cleanedMediaState = mediaCleanupSummary.mediaState;
    nextMediaState.pages = cleanedMediaState.pages;
    nextMediaState.orphans = cleanedMediaState.orphans;
    nextMediaState.updated_at = cleanedMediaState.updated_at;
    console.log(
      `[notion-sync] media cleanup completed (files_removed=${mediaCleanupSummary.filesRemoved}, index_removed=${mediaCleanupSummary.indexRemoved}, orphans_removed=${mediaCleanupSummary.orphansRemoved}, orphans_retained=${nextMediaState.orphans.length})`,
    );
  } catch (error) {
    console.warn(`[notion-sync] media cleanup skipped: ${formatErrorMessage(error)}`);
  }

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
  await writeJsonAtomic(mediaStateFilePath, nextMediaState);
}

const isDirectExecution =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  main().catch((error) => {
    console.error("[notion-sync] failed", error);
    process.exitCode = 1;
  });
}

export {
  buildEmptyMediaState,
  buildMediaReferenceKey,
  buildNextMediaState,
  cleanupOrphanedMediaCache,
  dedupeMediaReferences,
  getMediaRetentionDays,
  normalizeMediaState,
  shouldExpireMediaOrphan,
};

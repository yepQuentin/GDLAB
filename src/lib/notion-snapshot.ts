import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { BlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";

import { sortByPublishDateDesc } from "@/lib/content-utils";
import { resolveContentSlug } from "@/lib/slug";
import type { ContentMeta, ContentType, PublishStatus } from "@/lib/types";

const DEFAULT_NOTION_SNAPSHOT_DIR = "/var/lib/gdlab/notion-snapshots";

type SnapshotContentType = ContentType | "case";

export type NotionSnapshotBlock = BlockObjectResponse & {
  children?: NotionSnapshotBlock[];
};

interface NotionSnapshotFile {
  blocks?: NotionSnapshotBlock[];
  cover?: {
    type?: string;
    external?: { url?: string };
    file?: { url?: string };
  } | null;
  created_time?: string;
  last_edited_time?: string;
  markdown?: string;
  page_id?: string;
  properties?: Record<string, unknown>;
  slug?: string;
  snapshot_at?: string;
  snapshot_version?: number;
  type?: SnapshotContentType | string;
}

interface SnapshotStateEntry {
  last_edited_time?: string;
  slug?: string;
  type?: SnapshotContentType | string;
}

interface SnapshotStateFile {
  pages: Record<string, SnapshotStateEntry>;
  updated_at: string;
  version: number;
}

function getSnapshotDir(): string {
  return process.env.NOTION_SNAPSHOT_DIR?.trim() || DEFAULT_NOTION_SNAPSHOT_DIR;
}

function getSnapshotStateFilePath(): string {
  return process.env.NOTION_SYNC_STATE_FILE?.trim() || path.join(getSnapshotDir(), "sync-state.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeContentType(rawType: string): ContentType | null {
  const normalized = rawType.trim().toLowerCase();

  if (normalized === "daily") {
    return "daily";
  }

  if (normalized === "insight" || normalized === "case") {
    return "insight";
  }

  return null;
}

function getSnapshotProperty(
  properties: Record<string, unknown> | undefined,
  propertyName: string,
): Record<string, unknown> | null {
  if (!properties) {
    return null;
  }

  const property = properties[propertyName];
  return isRecord(property) ? property : null;
}

function getTitleProperty(
  properties: Record<string, unknown> | undefined,
  propertyName: string,
): string {
  const property = getSnapshotProperty(properties, propertyName);
  if (!property || property.type !== "title" || !Array.isArray(property.title)) {
    return "";
  }

  return property.title
    .filter(isRecord)
    .map((item) => (typeof item.plain_text === "string" ? item.plain_text : ""))
    .join("")
    .trim();
}

function getRichTextProperty(
  properties: Record<string, unknown> | undefined,
  propertyName: string,
): string {
  const property = getSnapshotProperty(properties, propertyName);
  if (!property || property.type !== "rich_text" || !Array.isArray(property.rich_text)) {
    return "";
  }

  return property.rich_text
    .filter(isRecord)
    .map((item) => (typeof item.plain_text === "string" ? item.plain_text : ""))
    .join("")
    .trim();
}

function getSelectProperty(
  properties: Record<string, unknown> | undefined,
  propertyName: string,
): string {
  const property = getSnapshotProperty(properties, propertyName);
  if (!property || property.type !== "select" || !isRecord(property.select)) {
    return "";
  }

  return typeof property.select.name === "string" ? property.select.name.trim() : "";
}

function getDateProperty(
  properties: Record<string, unknown> | undefined,
  propertyName: string,
): string {
  const property = getSnapshotProperty(properties, propertyName);
  if (!property || property.type !== "date" || !isRecord(property.date)) {
    return "";
  }

  return typeof property.date.start === "string" ? property.date.start : "";
}

function getTagsProperty(
  properties: Record<string, unknown> | undefined,
  propertyName: string,
): string[] {
  const property = getSnapshotProperty(properties, propertyName);
  if (!property || property.type !== "multi_select" || !Array.isArray(property.multi_select)) {
    return [];
  }

  return property.multi_select
    .filter(isRecord)
    .map((item) => (typeof item.name === "string" ? item.name : ""))
    .filter(Boolean);
}

function getCoverProperty(snapshot: NotionSnapshotFile, propertyName: string): string | null {
  const property = getSnapshotProperty(snapshot.properties, propertyName);

  if (property?.type === "files" && Array.isArray(property.files) && property.files.length > 0) {
    const firstFile = property.files[0];
    if (isRecord(firstFile) && firstFile.type === "external" && isRecord(firstFile.external)) {
      return typeof firstFile.external.url === "string" ? firstFile.external.url : null;
    }

    if (isRecord(firstFile) && firstFile.type === "file" && isRecord(firstFile.file)) {
      return typeof firstFile.file.url === "string" ? firstFile.file.url : null;
    }
  }

  if (!snapshot.cover || !isRecord(snapshot.cover)) {
    return null;
  }

  if (snapshot.cover.type === "external" && isRecord(snapshot.cover.external)) {
    return typeof snapshot.cover.external.url === "string" ? snapshot.cover.external.url : null;
  }

  if (snapshot.cover.type === "file" && isRecord(snapshot.cover.file)) {
    return typeof snapshot.cover.file.url === "string" ? snapshot.cover.file.url : null;
  }

  return null;
}

function mapSnapshotToContentMeta(snapshot: NotionSnapshotFile): ContentMeta | null {
  if (!snapshot.page_id || !snapshot.properties) {
    return null;
  }

  const rawType =
    typeof snapshot.type === "string"
      ? snapshot.type
      : getSelectProperty(snapshot.properties, "type") || "daily";
  const type = normalizeContentType(rawType);

  if (!type) {
    return null;
  }

  const title = getTitleProperty(snapshot.properties, "title") || "Untitled";
  const publishDate =
    getDateProperty(snapshot.properties, "publish_date") ||
    snapshot.created_time ||
    snapshot.snapshot_at ||
    "";
  const rawSlug = getRichTextProperty(snapshot.properties, "slug");
  const fallbackSlug = snapshot.slug || snapshot.page_id.replace(/-/g, "");
  const slug = resolveContentSlug(type, publishDate, rawSlug, fallbackSlug);
  const rawStatus = getSelectProperty(snapshot.properties, "status") || "Published";
  const status: PublishStatus = rawStatus === "Published" ? "Published" : "Draft";

  return {
    id: snapshot.page_id,
    title,
    slug,
    type,
    publishDate,
    status,
    summary: getRichTextProperty(snapshot.properties, "summary"),
    cover: getCoverProperty(snapshot, "cover"),
    tags: getTagsProperty(snapshot.properties, "tags"),
  };
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    return null;
  }
}

async function readSnapshotState(): Promise<SnapshotStateFile | null> {
  const state = await readJsonFile<SnapshotStateFile>(getSnapshotStateFilePath());

  if (!state || !isRecord(state.pages)) {
    return null;
  }

  return {
    pages: state.pages,
    updated_at: typeof state.updated_at === "string" ? state.updated_at : "",
    version: typeof state.version === "number" ? state.version : 0,
  };
}

function getSnapshotPageDirectory(pageId: string): string {
  return path.join(getSnapshotDir(), pageId);
}

async function readLatestSnapshotByPageId(pageId: string): Promise<NotionSnapshotFile | null> {
  try {
    const files = await readdir(getSnapshotPageDirectory(pageId), { withFileTypes: true });
    const latestSnapshotName = files
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left))[0];

    if (!latestSnapshotName) {
      return null;
    }

    return readJsonFile<NotionSnapshotFile>(path.join(getSnapshotPageDirectory(pageId), latestSnapshotName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    return null;
  }
}

export async function getSnapshotContentMetaList(type?: ContentType): Promise<ContentMeta[] | null> {
  const state = await readSnapshotState();
  if (!state) {
    return null;
  }

  const snapshots = await Promise.all(
    Object.keys(state.pages).map(async (pageId) => readLatestSnapshotByPageId(pageId)),
  );

  if (snapshots.some((snapshot) => snapshot === null)) {
    return null;
  }

  const safeSnapshots = snapshots.filter((snapshot): snapshot is NotionSnapshotFile => snapshot !== null);

  const items = safeSnapshots
    .map((snapshot) => mapSnapshotToContentMeta(snapshot))
    .filter((item): item is ContentMeta => item !== null && item.status === "Published");

  const filtered = type ? items.filter((item) => item.type === type) : items;
  return sortByPublishDateDesc(filtered);
}

export async function getSnapshotContentMetaBySlug(
  type: ContentType,
  slug: string,
): Promise<ContentMeta | null> {
  const items = await getSnapshotContentMetaList(type);
  if (!items) {
    return null;
  }

  return items.find((item) => item.slug === slug) ?? null;
}

export async function getSnapshotMarkdownByPageId(pageId: string): Promise<string | null> {
  const snapshot = await readLatestSnapshotByPageId(pageId);
  if (!snapshot || typeof snapshot.markdown !== "string") {
    return null;
  }

  return snapshot.markdown;
}

export async function getSnapshotBlocksByPageId(pageId: string): Promise<NotionSnapshotBlock[] | null> {
  const snapshot = await readLatestSnapshotByPageId(pageId);
  if (!snapshot || !Array.isArray(snapshot.blocks)) {
    return null;
  }

  return snapshot.blocks as NotionSnapshotBlock[];
}

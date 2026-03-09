import {
  Client,
  collectPaginatedAPI,
  extractDatabaseId,
  isFullPage,
} from "@notionhq/client";
import type {
  PageObjectResponse,
  QueryDataSourceParameters,
  QueryDataSourceResponse,
} from "@notionhq/client/build/src/api-endpoints";
import { unstable_cache } from "next/cache";
import { NotionToMarkdown } from "notion-to-md";

import { CACHE_REVALIDATE_SECONDS, CACHE_TAGS } from "@/lib/cache-config";
import type { ContentMeta, ContentType, PublishStatus } from "@/lib/types";
import { sortByPublishDateDesc } from "@/lib/content-utils";
import { extractDateFromDailySlug, resolveContentSlug } from "@/lib/slug";
import {
  buildNotionAudioProxyUrl,
  rewriteMarkdownAudioUrlsWithProxy,
} from "@/lib/notion-audio-proxy";
import { rewriteMarkdownImageUrlsWithProxy } from "@/lib/notion-image-proxy";

const notionToken = process.env.NOTION_TOKEN;
const rawDatabaseId = process.env.NOTION_DATABASE_ID;
const notionDataSourceId = rawDatabaseId ? extractDatabaseId(rawDatabaseId) ?? rawDatabaseId : "";

const notionClient = notionToken ? new Client({ auth: notionToken }) : null;
const notionToMarkdown = notionClient ? new NotionToMarkdown({ notionClient }) : null;

type DataSourceQueryParameters = Omit<QueryDataSourceParameters, "data_source_id">;
type DataSourceQueryResults = QueryDataSourceResponse["results"];
const CONTENT_META_REVALIDATE_SECONDS = CACHE_REVALIDATE_SECONDS;
const CONTENT_MARKDOWN_REVALIDATE_SECONDS = CACHE_REVALIDATE_SECONDS;
const BUILD_TIME_MARKDOWN_TIMEOUT_MS = 15000;
const QUERY_DATASOURCE_RETRY_ATTEMPTS = 3;
const buildTimeNotionWarnings = new Set<string>();

interface NotionAudioBlockLike {
  id: string;
  type: string;
  audio?: {
    type: "external" | "file";
    external?: { url: string };
    file?: { url: string };
    caption: Array<{ plain_text: string }>;
  };
}

function isProductionBuildPhase(): boolean {
  return process.env.npm_lifecycle_event === "build";
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function warnBuildTimeNotionFailure(scope: string, error: unknown) {
  const message = `${scope}:${formatErrorMessage(error)}`;
  if (buildTimeNotionWarnings.has(message)) {
    return;
  }

  buildTimeNotionWarnings.add(message);
  console.warn(`[notion] ${scope} failed during build, using fallback. ${formatErrorMessage(error)}`);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, scope: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${scope} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

if (notionToMarkdown) {
  notionToMarkdown.setCustomTransformer("audio", async (rawBlock) => {
    const block = rawBlock as unknown as NotionAudioBlockLike;
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

function rewriteBookmarkLabels(markdown: string): string {
  // Normalize Notion bookmark blocks to consistent Chinese link label.
  return markdown.replace(/\[bookmark\]\(([^)]+)\)/gi, "[原文链接]($1)");
}

function rewriteSourceLinkParagraphs(markdown: string): string {
  return markdown
    .replace(
      /(^|\n)(原文链接|来源|source)\s*[：:]\s*\[[^\]]+\]\((https?:\/\/[^)\s]+)\)(?=\n|$)/gim,
      (_match, leadingBreak: string, _label: string, href: string) => `${leadingBreak}[原文链接](${href})`,
    )
    .replace(
      /(^|\n)(原文链接|来源|source)\s*[：:]\s*(https?:\/\/[^\s)]+)(?=\n|$)/gim,
      (_match, leadingBreak: string, _label: string, href: string) => `${leadingBreak}[原文链接](${href})`,
    );
}

function getTitleProperty(page: PageObjectResponse, propertyName: string): string {
  const property = page.properties[propertyName];
  if (!property || property.type !== "title") {
    return "";
  }

  return property.title.map((item) => item.plain_text).join("").trim();
}

function getRichTextProperty(page: PageObjectResponse, propertyName: string): string {
  const property = page.properties[propertyName];
  if (!property || property.type !== "rich_text") {
    return "";
  }

  return property.rich_text.map((item) => item.plain_text).join("").trim();
}

function getSelectProperty(page: PageObjectResponse, propertyName: string): string {
  const property = page.properties[propertyName];
  if (!property || property.type !== "select") {
    return "";
  }

  return property.select?.name?.trim() ?? "";
}

function getDateProperty(page: PageObjectResponse, propertyName: string): string {
  const property = page.properties[propertyName];
  if (!property || property.type !== "date") {
    return "";
  }

  return property.date?.start ?? "";
}

function getTagsProperty(page: PageObjectResponse, propertyName: string): string[] {
  const property = page.properties[propertyName];
  if (!property || property.type !== "multi_select") {
    return [];
  }

  return property.multi_select.map((item) => item.name).filter(Boolean);
}

function getCoverProperty(page: PageObjectResponse, propertyName: string): string | null {
  const property = page.properties[propertyName];

  if (property?.type === "files" && property.files.length > 0) {
    const firstFile = property.files[0];
    if (firstFile.type === "external") {
      return firstFile.external.url;
    }
    return firstFile.file.url;
  }

  if (page.cover) {
    if (page.cover.type === "external") {
      return page.cover.external.url;
    }
    return page.cover.file.url;
  }

  return null;
}

function normalizeContentType(rawType: string): ContentType {
  const normalized = rawType.trim().toLowerCase();
  if (normalized === "insight" || normalized === "case") {
    return "insight";
  }

  return "daily";
}

function mapPageToMeta(page: PageObjectResponse): ContentMeta {
  const title = getTitleProperty(page, "title") || "Untitled";
  const type = normalizeContentType(getSelectProperty(page, "type") || "daily");
  const publishDate = getDateProperty(page, "publish_date") || page.created_time;
  const rawSlug = getRichTextProperty(page, "slug");
  const fallbackSlug = rawSlug || page.id.replace(/-/g, "");
  const slug = resolveContentSlug(type, publishDate, rawSlug, fallbackSlug);
  const rawStatus = getSelectProperty(page, "status") || "Draft";
  const status = rawStatus === "Published" ? "Published" : "Draft";

  return {
    id: page.id,
    title,
    slug,
    type,
    publishDate,
    status: status as PublishStatus,
    summary: getRichTextProperty(page, "summary"),
    cover: getCoverProperty(page, "cover"),
    tags: getTagsProperty(page, "tags"),
  };
}

function assertNotionConfig() {
  if (!notionClient) {
    return {
      ok: false as const,
      reason: "NOTION_TOKEN 未配置，返回空数据。",
    };
  }

  if (!notionDataSourceId) {
    return {
      ok: false as const,
      reason: "NOTION_DATABASE_ID 未配置，返回空数据。",
    };
  }

  return { ok: true as const };
}

async function queryDataSource(params: DataSourceQueryParameters): Promise<DataSourceQueryResults> {
  const status = assertNotionConfig();
  if (!status.ok) {
    return [];
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= QUERY_DATASOURCE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const results = await collectPaginatedAPI(notionClient!.dataSources.query, {
        ...params,
        data_source_id: notionDataSourceId,
      });

      return results;
    } catch (error) {
      lastError = error;

      if (attempt < QUERY_DATASOURCE_RETRY_ATTEMPTS) {
        await waitForRetry(attempt * 250);
        continue;
      }
    }
  }

  if (isProductionBuildPhase()) {
    warnBuildTimeNotionFailure("queryDataSource", lastError);
    return [];
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function getPublishedContentMetaUncached(type?: ContentType): Promise<ContentMeta[]> {
  const filters: DataSourceQueryParameters["filter"] = {
    and: [
      { property: "status", select: { equals: "Published" } },
      ...(type === "daily" ? [{ property: "type", select: { equals: "daily" } }] : []),
    ],
  };

  const results = await queryDataSource({
    filter: filters,
    sorts: [{ property: "publish_date", direction: "descending" }],
    page_size: 100,
  });

  const pages = results.filter((result): result is PageObjectResponse => isFullPage(result));
  const normalized = pages.map(mapPageToMeta);
  const typeFiltered = type ? normalized.filter((item) => item.type === type) : normalized;
  return sortByPublishDateDesc(typeFiltered);
}

const getPublishedContentMetaCached = unstable_cache(
  getPublishedContentMetaUncached,
  ["notion-published-content-meta-v2"],
  {
    revalidate: CONTENT_META_REVALIDATE_SECONDS,
    tags: [CACHE_TAGS.CONTENT_META],
  },
);

export async function getPublishedContentMeta(type?: ContentType): Promise<ContentMeta[]> {
  if (isProductionBuildPhase()) {
    return getPublishedContentMetaUncached(type);
  }

  return getPublishedContentMetaCached(type);
}

async function getPublishedContentBySlugUncached(
  type: ContentType,
  slug: string,
): Promise<ContentMeta | null> {
  if (type === "daily") {
    const dailyDate = extractDateFromDailySlug(slug);
    if (dailyDate) {
      const results = await queryDataSource({
        filter: {
          and: [
            { property: "status", select: { equals: "Published" } },
            { property: "type", select: { equals: "daily" } },
            { property: "publish_date", date: { on_or_after: dailyDate } },
            { property: "publish_date", date: { on_or_before: dailyDate } },
          ],
        },
        page_size: 1,
      });

      const dailyPage = results.find((result): result is PageObjectResponse => isFullPage(result));
      if (dailyPage) {
        return mapPageToMeta(dailyPage);
      }
    }

    const allDaily = await getPublishedContentMeta("daily");
    return allDaily.find((item) => item.slug === slug) ?? null;
  }

  const results = await queryDataSource({
    filter: {
      and: [
        { property: "status", select: { equals: "Published" } },
        { property: "slug", rich_text: { equals: slug } },
      ],
    },
    page_size: 10,
  });

  const page = results
    .filter((result): result is PageObjectResponse => isFullPage(result))
    .map(mapPageToMeta)
    .find((item) => item.type === type);

  if (!page) {
    const allContent = await getPublishedContentMeta(type);
    return allContent.find((item) => item.slug === slug) ?? null;
  }

  return page;
}

const getPublishedContentBySlugCached = unstable_cache(
  getPublishedContentBySlugUncached,
  ["notion-published-content-by-slug-v2"],
  {
    revalidate: CONTENT_META_REVALIDATE_SECONDS,
    tags: [CACHE_TAGS.CONTENT_META],
  },
);

export async function getPublishedContentBySlug(
  type: ContentType,
  slug: string,
): Promise<ContentMeta | null> {
  if (isProductionBuildPhase()) {
    return getPublishedContentBySlugUncached(type, slug);
  }

  return getPublishedContentBySlugCached(type, slug);
}

const getPageMarkdownByIdCached = unstable_cache(
  async (pageId: string): Promise<string> => {
    if (!notionToMarkdown) {
      return "";
    }

    try {
      const markdownBlocks = isProductionBuildPhase()
        ? await withTimeout(
            notionToMarkdown.pageToMarkdown(pageId),
            BUILD_TIME_MARKDOWN_TIMEOUT_MS,
            `pageToMarkdown:${pageId}`,
          )
        : await notionToMarkdown.pageToMarkdown(pageId);
      const rawMarkdown = notionToMarkdown.toMarkdownString(markdownBlocks).parent;
      const bookmarkRewrittenMarkdown = rewriteBookmarkLabels(rawMarkdown);
      const sourceLinkRewrittenMarkdown = rewriteSourceLinkParagraphs(bookmarkRewrittenMarkdown);
      const audioRewrittenMarkdown = rewriteMarkdownAudioUrlsWithProxy(sourceLinkRewrittenMarkdown);
      return rewriteMarkdownImageUrlsWithProxy(audioRewrittenMarkdown);
    } catch (error) {
      if (isProductionBuildPhase()) {
        warnBuildTimeNotionFailure(`pageToMarkdown:${pageId}`, error);
        return "";
      }

      throw error;
    }
  },
  ["notion-page-markdown-v3"],
  {
    revalidate: CONTENT_MARKDOWN_REVALIDATE_SECONDS,
    tags: [CACHE_TAGS.CONTENT_MARKDOWN],
  },
);

export async function getPageMarkdownById(pageId: string): Promise<string> {
  return getPageMarkdownByIdCached(pageId);
}

export function hasNotionConfiguration(): boolean {
  return Boolean(notionClient && notionDataSourceId);
}

export function getNotionConfigurationHint(): string {
  const status = assertNotionConfig();
  if (status.ok) {
    return "";
  }

  return status.reason;
}

import {
  paginate,
  parseDailySections,
  pickLatestCases,
  pickRecentDaily,
  stripMarkdown,
} from "@/lib/content-utils";
import { unstable_cache } from "next/cache";
import { CACHE_REVALIDATE_SECONDS, CACHE_TAGS } from "@/lib/cache-config";
import {
  getNotionConfigurationHint,
  getPageMarkdownById,
  getPublishedContentBySlug,
  getPublishedContentMeta,
  hasNotionConfiguration,
} from "@/lib/notion";
import type {
  ContentDetail,
  ContentMeta,
  ContentType,
  HomePayload,
  PaginatedContent,
  SearchDocument,
} from "@/lib/types";

const DEFAULT_PAGE_SIZE = 10;
const SEARCH_INDEX_REVALIDATE_SECONDS = CACHE_REVALIDATE_SECONDS;

function isProductionBuildPhase(): boolean {
  return process.env.npm_lifecycle_event === "build";
}

export interface HomeDataResult {
  payload: HomePayload;
  hint?: string;
}

export interface ListDataResult {
  payload: PaginatedContent;
  hint?: string;
}

export async function getHomePayload(): Promise<HomeDataResult> {
  const allPublished = await getPublishedContentMeta();

  const payload: HomePayload = {
    dailyRecent: pickRecentDaily(allPublished),
    caseRecent: pickLatestCases(allPublished, 2),
  };

  if (!hasNotionConfiguration()) {
    return { payload, hint: getNotionConfigurationHint() };
  }

  return { payload };
}

export async function getContentList(
  type: ContentType,
  page: number,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<ListDataResult> {
  const allContent = await getPublishedContentMeta(type);
  const payload = paginate(allContent, page, pageSize);

  if (!hasNotionConfiguration()) {
    return { payload, hint: getNotionConfigurationHint() };
  }

  return { payload };
}

export async function getContentBySlug(
  type: ContentType,
  slug: string,
): Promise<ContentDetail | null> {
  const meta = await getPublishedContentBySlug(type, slug);
  if (!meta) {
    return null;
  }

  const markdown = await getPageMarkdownById(meta.id);

  return {
    meta,
    markdown,
    dailySections: type === "daily" ? parseDailySections(markdown) : undefined,
  };
}

export async function getContentMetaBySlug(
  type: ContentType,
  slug: string,
): Promise<ContentMeta | null> {
  return getPublishedContentBySlug(type, slug);
}

export async function getPublishedContentSlugs(type: ContentType): Promise<string[]> {
  const allContent = await getPublishedContentMeta(type);
  return allContent.map((item) => item.slug);
}

async function contentMetaToSearchDocument(meta: ContentMeta): Promise<SearchDocument> {
  const markdown = await getPageMarkdownById(meta.id);

  return {
    id: meta.id,
    type: meta.type,
    title: meta.title,
    summary: meta.summary,
    tags: meta.tags,
    bodyText: stripMarkdown(markdown),
    publishDate: meta.publishDate,
    url: meta.type === "daily" ? `/daily/${meta.slug}` : `/cases/${meta.slug}`,
  };
}

async function buildSearchIndexUncached(): Promise<{ docs: SearchDocument[]; hint?: string }> {
  const allPublished = await getPublishedContentMeta();

  const docs = await Promise.all(allPublished.map(contentMetaToSearchDocument));

  if (!hasNotionConfiguration()) {
    return { docs, hint: getNotionConfigurationHint() };
  }

  return { docs };
}

const buildSearchIndexCached = unstable_cache(
  buildSearchIndexUncached,
  ["content-search-index-v2"],
  {
    revalidate: SEARCH_INDEX_REVALIDATE_SECONDS,
    tags: [CACHE_TAGS.SEARCH_INDEX],
  },
);

export async function buildSearchIndex(): Promise<{ docs: SearchDocument[]; hint?: string }> {
  if (isProductionBuildPhase()) {
    return buildSearchIndexUncached();
  }

  return buildSearchIndexCached();
}

export function getCanonicalUrl(path: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!baseUrl) {
    return path;
  }

  return new URL(path, baseUrl).toString();
}

export const CACHE_REVALIDATE_SECONDS = 300;

export const CACHE_TAGS = {
  CASE_BLOCKS: "case-blocks",
  CONTENT_MARKDOWN: "content-markdown",
  CONTENT_META: "content-meta",
  SEARCH_INDEX: "search-index",
} as const;

export const CACHE_TAG_LIST = [
  CACHE_TAGS.CONTENT_META,
  CACHE_TAGS.CONTENT_MARKDOWN,
  CACHE_TAGS.CASE_BLOCKS,
  CACHE_TAGS.SEARCH_INDEX,
] as const;

export const REVALIDATE_PATH_TARGETS = [
  { path: "/" },
  { path: "/daily" },
  { path: "/insights" },
  { path: "/search" },
  { path: "/sitemap.xml" },
  { path: "/rss.xml" },
  { path: "/daily/[slug]", type: "page" as const },
  { path: "/insights/[slug]", type: "page" as const },
] as const;

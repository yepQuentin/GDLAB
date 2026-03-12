import { CACHE_REVALIDATE_SECONDS } from "@/lib/cache-config";
import { getPublishedContentMeta } from "@/lib/notion";
import type { ContentMeta } from "@/lib/types";

const DEFAULT_SITE_URL = "http://localhost:3000";
const FEED_TITLE = "GDLAB 商学院";
const FEED_DESCRIPTION = "每日资讯与深度商业文章解读";
const MAX_FEED_ITEMS = 50;

function resolveSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (!configured) {
    return DEFAULT_SITE_URL;
  }

  try {
    return new URL(configured).toString();
  } catch {
    return DEFAULT_SITE_URL;
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function resolveContentUrl(item: ContentMeta, siteUrl: string): string {
  const pathname =
    item.type === "daily" ? `/daily/${item.slug}` : `/insights/${item.slug}`;
  return new URL(pathname, siteUrl).toString();
}

function resolvePubDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toUTCString();
  }

  return parsed.toUTCString();
}

function buildRssXml(items: ContentMeta[], siteUrl: string): string {
  const feedUrl = new URL("/rss.xml", siteUrl).toString();
  const homeUrl = new URL("/", siteUrl).toString();
  const lastBuildDate = resolvePubDate(items[0]?.publishDate ?? new Date().toISOString());

  const itemXml = items
    .map((item) => {
      const link = resolveContentUrl(item, siteUrl);
      const description = item.summary || item.title;
      const categoryXml = item.tags
        .map((tag) => `      <category>${escapeXml(tag)}</category>`)
        .join("\n");

      const categoryBlock = categoryXml ? `\n${categoryXml}` : "";

      return `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${escapeXml(resolvePubDate(item.publishDate))}</pubDate>
      <description>${escapeXml(description)}</description>${categoryBlock}
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(FEED_TITLE)}</title>
    <description>${escapeXml(FEED_DESCRIPTION)}</description>
    <link>${escapeXml(homeUrl)}</link>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
    <lastBuildDate>${escapeXml(lastBuildDate)}</lastBuildDate>
${itemXml}
  </channel>
</rss>
`;
}

export async function GET(): Promise<Response> {
  const siteUrl = resolveSiteUrl();
  const allPublished = await getPublishedContentMeta();
  const feedItems = allPublished.slice(0, MAX_FEED_ITEMS);
  const body = buildRssXml(feedItems, siteUrl);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": `public, max-age=0, s-maxage=${CACHE_REVALIDATE_SECONDS}, stale-while-revalidate=${CACHE_REVALIDATE_SECONDS * 2}`,
    },
  });
}

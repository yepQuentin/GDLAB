import type { MetadataRoute } from "next";

import { getPublishedContentMeta } from "@/lib/notion";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const allContent = await getPublishedContentMeta();

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${siteUrl}/`,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${siteUrl}/daily`,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/insights`,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/search`,
      changeFrequency: "daily",
      priority: 0.5,
    },
  ];

  const contentPages: MetadataRoute.Sitemap = allContent.map((item) => ({
    url:
      item.type === "daily"
        ? `${siteUrl}/daily/${item.slug}`
        : `${siteUrl}/insights/${item.slug}`,
    lastModified: item.publishDate,
    changeFrequency: "daily",
    priority: 0.7,
  }));

  return [...staticPages, ...contentPages];
}

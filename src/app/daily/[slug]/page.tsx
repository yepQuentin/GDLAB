import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EngagementActionBar, EngagementReadCount } from "@/components/engagement-bar";
import { CommentThread } from "@/components/comment-thread";
import { MarkdownContent } from "@/components/markdown-content";
import {
  getCanonicalUrl,
  getContentBySlug,
  getContentMetaBySlug,
  getPublishedContentSlugs,
} from "@/lib/content";

export const revalidate = 300;

interface DailyDetailPageProps {
  params: Promise<{ slug: string }>;
}

interface DailySectionImage {
  src: string;
  alt: string;
}

interface DailySectionItem {
  title: string;
  bodyMarkdown: string;
  images: DailySectionImage[];
}

export async function generateStaticParams() {
  const slugs = await getPublishedContentSlugs("daily");
  return slugs.map((slug) => ({ slug }));
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function buildSectionItem(title: string, lines: string[]): DailySectionItem {
  const images: DailySectionImage[] = [];
  const bodyLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      bodyLines.push(line);
      continue;
    }

    if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
      continue;
    }

    const imageMatch = trimmed.match(/^!\[(.*)\]\((.+)\)$/);
    if (imageMatch) {
      images.push({
        alt: imageMatch[1] ?? "",
        src: imageMatch[2] ?? "",
      });
      continue;
    }

    bodyLines.push(line);
  }

  return {
    title: title.trim(),
    bodyMarkdown: bodyLines.join("\n").trim(),
    images,
  };
}

function parseSectionItems(markdown: string): DailySectionItem[] {
  const normalized = markdown.trim();
  if (!normalized) {
    return [];
  }

  const lines = normalized.split("\n");
  const items: DailySectionItem[] = [];
  let currentTitle = "";
  let currentLines: string[] = [];

  const pushItem = () => {
    const nextItem = buildSectionItem(currentTitle, currentLines);
    if (!nextItem.title && !nextItem.bodyMarkdown && nextItem.images.length === 0) {
      return;
    }
    items.push(nextItem);
  };

  for (const line of lines) {
    const headingMatch = line.match(/^###\s+(.+?)\s*$/);
    if (headingMatch) {
      if (currentTitle || currentLines.length > 0) {
        pushItem();
      }
      currentTitle = headingMatch[1].trim();
      currentLines = [];
      continue;
    }

    currentLines.push(line);
  }

  if (currentTitle || currentLines.length > 0) {
    pushItem();
  }

  if (items.length === 0) {
    return [buildSectionItem("", lines)];
  }

  return items;
}

interface DailySectionBlockProps {
  titleCn: string;
  titleEn: string;
  markdown: string;
}

function DailySectionBlock({ titleCn, titleEn, markdown }: DailySectionBlockProps) {
  const items = parseSectionItems(markdown);
  let imageItemIndex = 0;

  return (
    <section className="daily-section">
      <header className="daily-section-header">
        <h2>{titleCn}</h2>
        <p className="daily-section-label">{titleEn}</p>
      </header>

      <div className="daily-items">
        {items.length === 0 ? (
          <p className="empty-markdown">暂无正文内容</p>
        ) : (
          items.map((item, index) => {
            const hasImage = item.images.length > 0;
            const imageSide = hasImage ? (imageItemIndex % 2 === 0 ? "right" : "left") : "none";
            if (hasImage) {
              imageItemIndex += 1;
            }

            return (
              <article
                key={`${titleEn}-${index}`}
                className="daily-item"
                data-has-image={hasImage ? "true" : "false"}
                data-image-side={imageSide}
              >
                <div className="daily-item-text">
                  {item.title ? <h3 className="daily-item-title">{item.title}</h3> : null}
                  {item.bodyMarkdown ? <MarkdownContent markdown={item.bodyMarkdown} /> : null}
                </div>

                {hasImage ? (
                  <div className="daily-item-media">
                    {item.images.map((image, imageIndex) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={`${titleEn}-${index}-img-${imageIndex}`}
                        src={image.src}
                        alt={image.alt}
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        className="article-image"
                      />
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

export async function generateMetadata({ params }: DailyDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const meta = await getContentMetaBySlug("daily", slug);

  if (!meta) {
    return {
      title: "内容不存在",
      description: "请求的 Daily Pulse 内容不存在或未发布。",
    };
  }

  return {
    title: meta.title,
    description: meta.summary || "Daily Pulse 内容详情",
    alternates: {
      canonical: getCanonicalUrl(`/daily/${meta.slug}`),
    },
  };
}

export default async function DailyDetailPage({ params }: DailyDetailPageProps) {
  const { slug } = await params;
  const detail = await getContentBySlug("daily", slug);

  if (!detail) {
    notFound();
  }

  const sections = detail.dailySections;

  return (
    <article className="article-page daily-layout">
      <header className="article-header">
        <p className="article-kicker">Daily Pulse</p>
        <h1>{detail.meta.title}</h1>
        <div className="article-meta-row">
          <p className="article-meta">发布日期：{formatDate(detail.meta.publishDate)}</p>
          <EngagementReadCount
            type="daily"
            slug={detail.meta.slug}
            variant="daily-meta-inline"
            className="article-meta"
          />
        </div>
        {detail.meta.summary ? <p className="article-summary">{detail.meta.summary}</p> : null}
      </header>

      {sections?.intro ? (
        <section className="daily-section daily-intro">
          <header className="daily-section-header">
            <h2>导语与音频</h2>
            <p className="daily-section-label">Intro</p>
          </header>
          <MarkdownContent markdown={sections.intro} />
        </section>
      ) : null}

      <div className="daily-sections-grid">
        <DailySectionBlock titleCn="品牌" titleEn="Brands" markdown={sections?.brand ?? ""} />
        <DailySectionBlock titleCn="时局" titleEn="Times" markdown={sections?.currentAffairs ?? ""} />
        <DailySectionBlock titleCn="行业" titleEn="Industries" markdown={sections?.industry ?? ""} />
        <DailySectionBlock titleCn="科技" titleEn="Techs" markdown={sections?.technology ?? ""} />
      </div>

      <EngagementActionBar type="daily" slug={detail.meta.slug} />
      <CommentThread type="daily" slug={detail.meta.slug} />
    </article>
  );
}

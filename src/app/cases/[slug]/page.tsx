import { Suspense } from "react";

import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

import { CaseArticleBody, CaseArticleSkeleton } from "@/app/cases/[slug]/case-article";
import {
  getCanonicalUrl,
  getContentMetaBySlug,
} from "@/lib/content";
import { buildNotionImageProxyUrl } from "@/lib/notion-image-proxy";

import styles from "./case-detail.module.css";

export const revalidate = 300;

interface CaseDetailPageProps {
  params: Promise<{ slug: string }>;
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

export async function generateMetadata({ params }: CaseDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const meta = await getContentMetaBySlug("case", slug);

  if (!meta) {
    return {
      title: "内容不存在",
      description: "请求的 Business Case 内容不存在或未发布。",
    };
  }

  return {
    title: meta.title,
    description: meta.summary || "Business Case 内容详情",
    alternates: {
      canonical: getCanonicalUrl(`/cases/${meta.slug}`),
    },
  };
}

export default async function CaseDetailPage({ params }: CaseDetailPageProps) {
  const { slug } = await params;
  const meta = await getContentMetaBySlug("case", slug);

  if (!meta) {
    notFound();
  }

  const coverUrl = meta.cover ? buildNotionImageProxyUrl(meta.cover) : null;

  return (
    <article className={styles.page}>
      <header className={`${styles.hero} ${coverUrl ? "" : styles.heroTextOnly}`.trim()}>
        <div className={styles.heroBody}>
          <p className={styles.kicker}>Business Case</p>
          <h1 className={styles.title}>{meta.title}</h1>
          <div className={styles.metaRow}>
            <span className={styles.metaPill}>发布日期：{formatDate(meta.publishDate)}</span>
          </div>
          {meta.summary ? <p className={styles.summary}>{meta.summary}</p> : null}
          {meta.tags.length > 0 ? (
            <ul className={styles.tagList} aria-label="内容标签">
              {meta.tags.map((tag) => (
                <li key={`tag-${tag}`} className={styles.tag}>
                  {tag}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {coverUrl ? (
          <figure className={styles.coverFigure}>
            <div className={styles.coverFrame}>
              <Image
                src={coverUrl}
                alt={meta.title}
                fill
                priority
                sizes="(min-width: 1140px) 1120px, calc(100vw - 2rem)"
                className={styles.coverImage}
              />
            </div>
          </figure>
        ) : null}
      </header>

      <Suspense fallback={<CaseArticleSkeleton />}>
        <CaseArticleBody pageId={meta.id} />
      </Suspense>
    </article>
  );
}

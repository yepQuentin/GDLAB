import type { ReactNode } from "react";

import { PodcastAudioPlayer } from "@/components/podcast-audio-player";
import { EngagementActionBar, EngagementReadCount } from "@/components/engagement-bar";
import { CommentThread } from "@/components/comment-thread";
import { CaseOutlineNav } from "@/app/insights/[slug]/case-outline-nav";
import {
  resolveCaseVideoPresentation,
  type CaseAudioBlock,
  type CaseBlock,
  type CaseCalloutBlock,
  type CaseCodeBlock,
  type CaseFileBlock,
  type CaseHeadingBlock,
  type CaseImageBlock,
  type CaseLinkCardBlock,
  type CaseListItemBlock,
  type CaseQuoteBlock,
  type CaseRichTextSegment,
  type CaseTableBlock,
  type CaseVideoBlock,
} from "@/lib/case-content";
import {
  getCaseArticleState,
  type CaseArticleReadyState,
} from "./case-article-data";
import styles from "./case-detail.module.css";

interface CaseArticleBodyProps {
  pageId: string;
  slug: string;
}

interface CaseArticleLayoutProps extends CaseArticleReadyState {
  slug: string;
}

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function renderAnnotatedText(segment: CaseRichTextSegment): ReactNode {
  let node: ReactNode = segment.text;

  if (segment.type === "equation" || segment.annotations.code) {
    node = <code className={styles.inlineCode}>{node}</code>;
  }
  if (segment.annotations.bold) {
    node = <strong>{node}</strong>;
  }
  if (segment.annotations.italic) {
    node = <em>{node}</em>;
  }
  if (segment.annotations.strikethrough) {
    node = <s>{node}</s>;
  }
  if (segment.annotations.underline) {
    node = <span className={styles.underlined}>{node}</span>;
  }
  if (segment.href) {
    node = (
      <a
        href={segment.href}
        {...(isExternalHref(segment.href) ? { target: "_blank", rel: "noreferrer" } : {})}
      >
        {node}
      </a>
    );
  }

  return node;
}

function CaseRichText({ segments }: { segments: CaseRichTextSegment[] }) {
  return (
    <>
      {segments.map((segment, index) => (
        <span key={`${segment.text}-${index}`}>{renderAnnotatedText(segment)}</span>
      ))}
    </>
  );
}

function CaseHeading({ block }: { block: CaseHeadingBlock }) {
  const HeadingTag = block.level === 3 ? "h3" : "h2";
  const className = block.level === 3 ? styles.subheading : styles.sectionHeading;

  return (
    <HeadingTag id={block.anchorId} className={className}>
      <a href={`#${block.anchorId}`} className={styles.headingLink}>
        <CaseRichText segments={block.richText} />
      </a>
    </HeadingTag>
  );
}

function CaseList({ ordered, items }: { ordered: boolean; items: CaseListItemBlock[] }) {
  const ListTag = ordered ? "ol" : "ul";

  return (
    <ListTag className={ordered ? styles.orderedList : styles.bulletedList}>
      {items.map((item) => (
        <li key={item.id} className={styles.listItem}>
          {item.richText.length > 0 ? (
            <div className={styles.listItemText}>
              <CaseRichText segments={item.richText} />
            </div>
          ) : null}
          {item.children.length > 0 ? (
            <div className={styles.listChildren}>
              <CaseBlockStream blocks={item.children} />
            </div>
          ) : null}
        </li>
      ))}
    </ListTag>
  );
}

function CaseQuote({ block }: { block: CaseQuoteBlock }) {
  return (
    <blockquote className={styles.quote}>
      {block.richText.length > 0 ? (
        <p className={styles.quoteText}>
          <CaseRichText segments={block.richText} />
        </p>
      ) : null}
      {block.children.length > 0 ? (
        <div className={styles.quoteChildren}>
          <CaseBlockStream blocks={block.children} />
        </div>
      ) : null}
    </blockquote>
  );
}

function CaseCallout({ block }: { block: CaseCalloutBlock }) {
  return (
    <aside className={styles.callout}>
      <div className={styles.calloutIcon}>
        {block.icon?.type === "emoji" ? (
          <span aria-hidden="true">{block.icon.value}</span>
        ) : block.icon?.type === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={block.icon.value} alt="" loading="lazy" decoding="async" />
        ) : (
          <span aria-hidden="true">i</span>
        )}
      </div>
      <div className={styles.calloutBody}>
        {block.richText.length > 0 ? (
          <p className={styles.calloutText}>
            <CaseRichText segments={block.richText} />
          </p>
        ) : null}
        {block.children.length > 0 ? <CaseBlockStream blocks={block.children} /> : null}
      </div>
    </aside>
  );
}

function CaseImage({ block }: { block: CaseImageBlock }) {
  return (
    <figure className={styles.figure}>
      <div className={styles.figureMedia}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={block.src}
          alt={block.alt}
          loading="lazy"
          fetchPriority="low"
          decoding="async"
          referrerPolicy="no-referrer"
          className={styles.figureImage}
        />
      </div>
      {block.caption ? <figcaption className={styles.figcaption}>{block.caption}</figcaption> : null}
    </figure>
  );
}

function CaseTable({ block }: { block: CaseTableBlock }) {
  const [headerRow, ...bodyRows] = block.rows;
  const rows = block.hasColumnHeader ? bodyRows : block.rows;

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        {block.hasColumnHeader && headerRow ? (
          <thead>
            <tr>
              {headerRow.cells.map((cell, index) => (
                <th key={`head-${index}`} scope="col">
                  <CaseRichText segments={cell} />
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`}>
              {row.cells.map((cell, cellIndex) => {
                if (block.hasRowHeader && cellIndex === 0) {
                  return (
                    <th key={`cell-${rowIndex}-${cellIndex}`} scope="row">
                      <CaseRichText segments={cell} />
                    </th>
                  );
                }

                return (
                  <td key={`cell-${rowIndex}-${cellIndex}`}>
                    <CaseRichText segments={cell} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MediaLinkCard({
  href,
  eyebrow,
  title,
  detail,
}: {
  href: string;
  eyebrow: string;
  title: string;
  detail?: string;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={styles.linkCard}>
      <span className={styles.linkCardEyebrow}>{eyebrow}</span>
      <strong className={styles.linkCardTitle}>{title}</strong>
      {detail ? <span className={styles.linkCardDetail}>{detail}</span> : null}
    </a>
  );
}

function CaseLinkCard({ block }: { block: CaseLinkCardBlock }) {
  let detail = "";
  try {
    detail = new URL(block.url).hostname.replace(/^www\./, "");
  } catch {
    detail = block.url;
  }

  return (
    <MediaLinkCard
      href={block.url}
      eyebrow={block.type.toUpperCase()}
      title={block.title}
      detail={detail}
    />
  );
}

function CaseAttachment({ block }: { block: CaseFileBlock }) {
  return (
    <MediaLinkCard
      href={block.src}
      eyebrow={block.type === "pdf" ? "PDF" : "FILE"}
      title={block.title}
      detail={block.caption || "点击查看原始附件"}
    />
  );
}

function CaseAudio({ block }: { block: CaseAudioBlock }) {
  return (
    <div className={styles.audioCard}>
      <PodcastAudioPlayer src={block.src} label={block.title} />
    </div>
  );
}

function CaseVideo({ block }: { block: CaseVideoBlock }) {
  const presentation = resolveCaseVideoPresentation(block.src);

  if (presentation.kind === "direct") {
    return (
      <figure className={styles.mediaFrame}>
        <video className={styles.video} controls preload="metadata" playsInline>
          <source src={block.src} />
        </video>
        {block.caption ? <figcaption className={styles.figcaption}>{block.caption}</figcaption> : null}
      </figure>
    );
  }

  if ((presentation.kind === "youtube" || presentation.kind === "vimeo") && presentation.embedUrl) {
    return (
      <figure className={styles.mediaFrame}>
        <div className={styles.embedShell}>
          <iframe
            src={presentation.embedUrl}
            title={block.caption || "Insights 视频"}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
        {block.caption ? <figcaption className={styles.figcaption}>{block.caption}</figcaption> : null}
      </figure>
    );
  }

  return (
    <MediaLinkCard
      href={block.src}
      eyebrow="VIDEO"
      title={block.caption || "打开视频"}
      detail="当前来源不适合内嵌播放，点击新窗口查看"
    />
  );
}

function CaseCode({ block }: { block: CaseCodeBlock }) {
  return (
    <section className={styles.codeBlock}>
      <header className={styles.codeHeader}>
        <span>{block.language}</span>
        {block.caption ? <span>{block.caption}</span> : null}
      </header>
      <pre className={styles.pre}>
        <code>{block.code}</code>
      </pre>
    </section>
  );
}

function CaseBlockView({ block }: { block: CaseBlock }) {
  switch (block.type) {
    case "paragraph":
      return (
        <p className={styles.paragraph}>
          <CaseRichText segments={block.richText} />
        </p>
      );
    case "heading":
      return <CaseHeading block={block} />;
    case "quote":
      return <CaseQuote block={block} />;
    case "callout":
      return <CaseCallout block={block} />;
    case "image":
      return <CaseImage block={block} />;
    case "table":
      return <CaseTable block={block} />;
    case "video":
      return <CaseVideo block={block} />;
    case "audio":
      return <CaseAudio block={block} />;
    case "file":
    case "pdf":
      return <CaseAttachment block={block} />;
    case "bookmark":
    case "embed":
    case "link_preview":
      return <CaseLinkCard block={block} />;
    case "code":
      return <CaseCode block={block} />;
    case "divider":
      return <hr className={styles.divider} />;
    default:
      return null;
  }
}

function CaseBlockStream({ blocks }: { blocks: CaseBlock[] }) {
  const nodes: ReactNode[] = [];
  let index = 0;

  while (index < blocks.length) {
    const block = blocks[index];

    if (block.type === "bulleted_list_item" || block.type === "numbered_list_item") {
      const ordered = block.type === "numbered_list_item";
      const items: CaseListItemBlock[] = [];

      while (index < blocks.length) {
        const nextBlock = blocks[index];
        if (nextBlock.type !== block.type) {
          break;
        }
        items.push(nextBlock);
        index += 1;
      }

      nodes.push(<CaseList key={`${block.id}-group`} ordered={ordered} items={items} />);
      continue;
    }

    nodes.push(<CaseBlockView key={block.id} block={block} />);
    index += 1;
  }

  return <>{nodes}</>;
}

function CaseFailurePanel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className={styles.failurePanel}>
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  );
}

function CaseFailureState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className={styles.layout}>
      <div className={styles.contentColumn}>
        <div className={styles.readingPaper}>
          <CaseFailurePanel title={title} description={description} />
        </div>
      </div>
    </div>
  );
}

function CaseArticleLayout({
  characterCount,
  mediaCount,
  model,
  readMinutes,
  sectionCount,
  slug,
}: CaseArticleLayoutProps) {
  const hasIntro = model.intro.length > 0;
  const hasSections = model.sections.length > 0;
  const formattedCharacterCount = new Intl.NumberFormat("zh-CN").format(characterCount);

  return (
    <div className={styles.layout}>
      {model.outline.length > 0 ? <CaseOutlineNav outline={model.outline} /> : null}

      <div className={styles.contentColumn}>
        <div className={styles.readingPaper}>
          <section className={styles.statsBar}>
            <div className={styles.statsItem}>
              <span className={styles.statsLabel}>预计阅读</span>
              <strong>{readMinutes} 分钟</strong>
            </div>
            <div className={styles.statsItem}>
              <span className={styles.statsLabel}>文章字数</span>
              <strong>{formattedCharacterCount} 字</strong>
            </div>
            <div className={styles.statsItem}>
              <span className={styles.statsLabel}>章节数</span>
              <strong>{sectionCount}</strong>
            </div>
            <div className={styles.statsItem}>
              <span className={styles.statsLabel}>图表媒体</span>
              <strong>{mediaCount}</strong>
            </div>
            <EngagementReadCount
              type="insight"
              slug={slug}
              variant="insight-stats"
              itemClassName={styles.statsItem}
              labelClassName={styles.statsLabel}
            />
          </section>

          {hasIntro ? (
            <section className={styles.leadSection}>
              {hasSections ? (
                <header className={styles.leadHeader}>
                  <p className={styles.leadEyebrow}>Executive Summary</p>
                </header>
              ) : null}
              <div className={styles.sectionBody}>
                <CaseBlockStream blocks={model.intro} />
              </div>
            </section>
          ) : null}

          {hasSections ? (
            model.sections.map((section, index) => (
              <section key={section.id} className={styles.section}>
                <header className={styles.sectionHeader}>
                  <p className={styles.sectionEyebrow}>Section {String(index + 1).padStart(2, "0")}</p>
                  <CaseHeading block={section.heading} />
                </header>
                <div className={styles.sectionBody}>
                  <CaseBlockStream blocks={section.blocks} />
                </div>
              </section>
            ))
          ) : !hasIntro ? (
            <CaseFailurePanel title="正文为空" description="这篇 Insights 文章已经发布，但正文还没有可渲染的内容块。" />
          ) : null}

          <EngagementActionBar type="insight" slug={slug} className={styles.engagementFooter} />
          <CommentThread type="insight" slug={slug} withTopDivider={false} />
        </div>
      </div>
    </div>
  );
}

export async function CaseArticleBody({ pageId, slug }: CaseArticleBodyProps) {
  const state = await getCaseArticleState(pageId).catch(() => null);
  if (!state) {
    return (
      <CaseFailureState
        title="正文加载失败"
        description="当前页面元数据可用，但正文内容拉取失败。建议稍后重试。"
      />
    );
  }

  if (state.status === "unavailable") {
    return (
      <CaseFailureState
        title="正文暂不可用"
        description="当前文章元数据可访问，但正文内容还没有成功拉取。请稍后重试。"
      />
    );
  }

  if (state.status === "empty") {
    return (
      <CaseFailureState
        title="正文为空"
        description="这篇 Insights 文章已经发布，但正文还没有可渲染的内容块。"
      />
    );
  }

  return <CaseArticleLayout {...state} slug={slug} />;
}

export function CaseArticleSkeleton() {
  return (
    <div className={styles.layout}>
      <aside className={styles.toc} aria-hidden="true">
        <div className={styles.tocInner}>
          <div className={styles.skeletonLineShort} />
          <div className={styles.skeletonLine} />
          <div className={styles.skeletonLineShort} />
        </div>
      </aside>

      <div className={styles.contentColumn}>
        <div className={styles.readingPaper} aria-hidden="true">
          <section className={styles.statsBar}>
            <div className={styles.statsItem}>
              <span className={styles.statsLabel}>预计阅读</span>
              <div className={styles.skeletonValue} />
            </div>
            <div className={styles.statsItem}>
              <span className={styles.statsLabel}>文章字数</span>
              <div className={styles.skeletonValue} />
            </div>
            <div className={styles.statsItem}>
              <span className={styles.statsLabel}>章节数</span>
              <div className={styles.skeletonValue} />
            </div>
            <div className={styles.statsItem}>
              <span className={styles.statsLabel}>图表媒体</span>
              <div className={styles.skeletonValue} />
            </div>
            <div className={styles.statsItem}>
              <span className={styles.statsLabel}>阅读人数</span>
              <div className={styles.skeletonValue} />
            </div>
          </section>

          <section className={styles.leadSection}>
            <div className={styles.skeletonLineShort} />
            <div className={styles.skeletonParagraph} />
            <div className={styles.skeletonParagraph} />
            <div className={styles.skeletonParagraphShort} />
          </section>

          <section className={styles.section}>
            <div className={styles.skeletonLineShort} />
            <div className={styles.skeletonLine} />
            <div className={styles.skeletonParagraph} />
            <div className={styles.skeletonParagraph} />
            <div className={styles.skeletonParagraphShort} />
          </section>
        </div>
      </div>
    </div>
  );
}

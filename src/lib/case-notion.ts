import { Client } from "@notionhq/client";
import type {
  BlockObjectResponse,
  ListBlockChildrenResponse,
  RichTextItemResponse,
  TableRowBlockObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";
import { unstable_cache } from "next/cache";

import { CACHE_REVALIDATE_SECONDS, CACHE_TAGS } from "@/lib/cache-config";
import {
  buildCaseHeadingId,
  type CaseAudioBlock,
  type CaseBlock,
  type CaseCalloutBlock,
  type CaseCalloutIcon,
  type CaseCodeBlock,
  type CaseFileBlock,
  type CaseHeadingBlock,
  type CaseImageBlock,
  type CaseLinkCardBlock,
  type CaseListItemBlock,
  type CaseParagraphBlock,
  type CaseQuoteBlock,
  type CaseRichTextSegment,
  type CaseTableBlock,
  type CaseTableRow,
  type CaseTextAnnotations,
  type CaseVideoBlock,
} from "@/lib/case-content";
import { buildNotionAudioProxyUrl } from "@/lib/notion-audio-proxy";

const notionToken = process.env.NOTION_TOKEN;
const notionClient = notionToken ? new Client({ auth: notionToken }) : null;
const CASE_CONTENT_REVALIDATE_SECONDS = CACHE_REVALIDATE_SECONDS;
const CASE_FETCH_CONCURRENCY = 4;
const CASE_FETCH_TIMEOUT_MS = 12000;
const CASE_FETCH_RETRY_ATTEMPTS = 2;

const DEFAULT_ANNOTATIONS: CaseTextAnnotations = {
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  color: "default",
};

function mapRichText(items: RichTextItemResponse[]): CaseRichTextSegment[] {
  return items.map((item) => ({
    type: item.type === "equation" ? "equation" : "text",
    text: item.type === "equation" ? item.equation.expression : item.plain_text,
    href: item.href,
    annotations: {
      bold: item.annotations.bold,
      italic: item.annotations.italic,
      strikethrough: item.annotations.strikethrough,
      underline: item.annotations.underline,
      code: item.annotations.code,
      color: item.annotations.color,
    },
  }));
}

function formatCaseFetchError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function withCaseFetchTimeout<T>(promise: Promise<T>, scope: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${scope} timed out after ${CASE_FETCH_TIMEOUT_MS}ms`));
    }, CASE_FETCH_TIMEOUT_MS);
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

function getPlainText(items: RichTextItemResponse[]): string {
  return items.map((item) => item.plain_text).join("").trim();
}

function extractFileLabel(sourceUrl: string, fallback: string): string {
  try {
    const parsed = new URL(sourceUrl);
    const filename = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() ?? fallback);
    return filename || fallback;
  } catch {
    return fallback;
  }
}

function extractHostLabel(sourceUrl: string, fallback: string): string {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "") || fallback;
  } catch {
    return fallback;
  }
}

function getMediaUrl(
  media:
    | { type: "external"; external?: { url: string } }
    | { type: "file"; file?: { url: string } },
): string {
  return media.type === "external" ? media.external?.url ?? "" : media.file?.url ?? "";
}

function buildCaseImageProxyUrl(sourceUrl: string, blockId: string): string {
  const query = new URLSearchParams({
    src: sourceUrl,
    blockId,
  });

  return `/api/notion-image?${query.toString()}`;
}

function mapCalloutIcon(
  icon: Extract<BlockObjectResponse, { type: "callout" }>["callout"]["icon"],
): CaseCalloutIcon | null {
  if (!icon) {
    return null;
  }

  switch (icon.type) {
    case "emoji":
      return icon.emoji ? { type: "emoji", value: icon.emoji } : null;
    case "custom_emoji":
      return icon.custom_emoji?.url ? { type: "image", value: icon.custom_emoji.url } : null;
    case "external":
      return icon.external?.url ? { type: "image", value: icon.external.url } : null;
    case "file":
      return icon.file?.url ? { type: "image", value: icon.file.url } : null;
    default:
      return null;
  }
}

async function listAllBlockChildrenUncached(blockId: string): Promise<BlockObjectResponse[]> {
  if (!notionClient) {
    return [];
  }

  const results: BlockObjectResponse[] = [];
  let cursor: string | undefined;

  do {
    const response = (await notionClient.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    })) as ListBlockChildrenResponse;

    for (const result of response.results) {
      if ("type" in result) {
        results.push(result);
      }
    }

    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);

  return results;
}

async function listAllBlockChildrenWithRetry(blockId: string): Promise<BlockObjectResponse[]> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= CASE_FETCH_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await withCaseFetchTimeout(
        listAllBlockChildrenUncached(blockId),
        `case block children:${blockId}:attempt:${attempt}`,
      );
    } catch (error) {
      lastError = error;

      if (attempt < CASE_FETCH_RETRY_ATTEMPTS) {
        console.warn(
          `[case-notion] child block fetch retry ${attempt}/${CASE_FETCH_RETRY_ATTEMPTS - 1} for ${blockId}: ${formatCaseFetchError(error)}`,
        );
        await waitForRetry(attempt * 250);
        continue;
      }
    }
  }

  console.error(
    `[case-notion] failed to fetch child blocks for ${blockId}: ${formatCaseFetchError(lastError)}`,
  );
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function mapWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );

  return results;
}

async function fetchCaseBlocksUncached(blockId: string): Promise<CaseBlock[]> {
  const blocks = await listAllBlockChildrenWithRetry(blockId);
  const mapped = await mapWithConcurrency(blocks, CASE_FETCH_CONCURRENCY, (block) =>
    mapBlockToCaseBlock(block),
  );

  return mapped.filter((block): block is CaseBlock => block !== null);
}

async function fetchCaseBlocksWithRetry(blockId: string): Promise<CaseBlock[]> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= CASE_FETCH_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await withCaseFetchTimeout(
        fetchCaseBlocksUncached(blockId),
        `case block tree:${blockId}:attempt:${attempt}`,
      );
    } catch (error) {
      lastError = error;

      if (attempt < CASE_FETCH_RETRY_ATTEMPTS) {
        console.warn(
          `[case-notion] block tree fetch retry ${attempt}/${CASE_FETCH_RETRY_ATTEMPTS - 1} for ${blockId}: ${formatCaseFetchError(error)}`,
        );
        await waitForRetry(attempt * 250);
        continue;
      }
    }
  }

  console.error(
    `[case-notion] failed to fetch block tree for ${blockId}: ${formatCaseFetchError(lastError)}`,
  );
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function mapTableBlock(block: Extract<BlockObjectResponse, { type: "table" }>): Promise<CaseTableBlock> {
  const rows = await listAllBlockChildrenWithRetry(block.id);
  const tableRows: CaseTableRow[] = rows
    .filter((row): row is TableRowBlockObjectResponse => row.type === "table_row")
    .map((row) => ({
      cells: row.table_row.cells.map((cell) => mapRichText(cell)),
    }));

  return {
    id: block.id,
    type: "table",
    rows: tableRows,
    hasColumnHeader: block.table.has_column_header,
    hasRowHeader: block.table.has_row_header,
  };
}

async function mapBlockToCaseBlock(block: BlockObjectResponse): Promise<CaseBlock | null> {
  switch (block.type) {
    case "paragraph": {
      const richText = mapRichText(block.paragraph.rich_text);
      if (richText.length === 0) {
        return null;
      }

      const paragraphBlock: CaseParagraphBlock = {
        id: block.id,
        type: "paragraph",
        richText,
      };

      return paragraphBlock;
    }

    case "heading_1":
    case "heading_2":
    case "heading_3": {
      const richTextSource =
        block.type === "heading_1"
          ? block.heading_1.rich_text
          : block.type === "heading_2"
            ? block.heading_2.rich_text
            : block.heading_3.rich_text;
      const richText = mapRichText(richTextSource);
      if (richText.length === 0) {
        return null;
      }

      const title = getPlainText(richTextSource) || block.id;
      const headingBlock: CaseHeadingBlock = {
        id: block.id,
        type: "heading",
        level: block.type === "heading_1" ? 1 : block.type === "heading_2" ? 2 : 3,
        anchorId: buildCaseHeadingId(title, block.id.replace(/-/g, "").slice(0, 8)),
        richText,
      };

      return headingBlock;
    }

    case "bulleted_list_item":
    case "numbered_list_item": {
      const richText =
        block.type === "bulleted_list_item"
          ? mapRichText(block.bulleted_list_item.rich_text)
          : mapRichText(block.numbered_list_item.rich_text);
      const children = block.has_children ? await fetchCaseBlocksWithRetry(block.id) : [];

      if (richText.length === 0 && children.length === 0) {
        return null;
      }

      const listItemBlock: CaseListItemBlock = {
        id: block.id,
        type: block.type,
        richText,
        children,
      };

      return listItemBlock;
    }

    case "quote": {
      const quoteBlock: CaseQuoteBlock = {
        id: block.id,
        type: "quote",
        richText: mapRichText(block.quote.rich_text),
        children: block.has_children ? await fetchCaseBlocksWithRetry(block.id) : [],
      };

      if (quoteBlock.richText.length === 0 && quoteBlock.children.length === 0) {
        return null;
      }

      return quoteBlock;
    }

    case "callout": {
      const calloutBlock: CaseCalloutBlock = {
        id: block.id,
        type: "callout",
        richText: mapRichText(block.callout.rich_text),
        icon: mapCalloutIcon(block.callout.icon),
        children: block.has_children ? await fetchCaseBlocksWithRetry(block.id) : [],
      };

      if (calloutBlock.richText.length === 0 && calloutBlock.children.length === 0) {
        return null;
      }

      return calloutBlock;
    }

    case "divider":
      return {
        id: block.id,
        type: "divider",
      };

    case "image": {
      const sourceUrl = getMediaUrl(block.image);
      if (!sourceUrl) {
        return null;
      }

      const caption = getPlainText(block.image.caption);
      const label = caption || extractFileLabel(sourceUrl, "插图");
      const imageBlock: CaseImageBlock = {
        id: block.id,
        type: "image",
        src: buildCaseImageProxyUrl(sourceUrl, block.id),
        alt: label,
        caption,
      };

      return imageBlock;
    }

    case "video": {
      const sourceUrl = getMediaUrl(block.video);
      if (!sourceUrl) {
        return null;
      }

      const videoBlock: CaseVideoBlock = {
        id: block.id,
        type: "video",
        src: sourceUrl,
        caption: getPlainText(block.video.caption),
      };

      return videoBlock;
    }

    case "audio": {
      const sourceUrl = getMediaUrl(block.audio);
      if (!sourceUrl) {
        return null;
      }

      const title = getPlainText(block.audio.caption) || extractFileLabel(sourceUrl, "音频");
      const audioBlock: CaseAudioBlock = {
        id: block.id,
        type: "audio",
        src: buildNotionAudioProxyUrl(sourceUrl, block.id),
        title,
      };

      return audioBlock;
    }

    case "file":
    case "pdf": {
      const media = block.type === "file" ? block.file : block.pdf;
      const sourceUrl = getMediaUrl(media);
      if (!sourceUrl) {
        return null;
      }

      const caption = getPlainText(media.caption);
      const fileBlock: CaseFileBlock = {
        id: block.id,
        type: block.type,
        src: sourceUrl,
        title: caption || extractFileLabel(sourceUrl, block.type === "pdf" ? "附件 PDF" : "附件文件"),
        caption,
      };

      return fileBlock;
    }

    case "bookmark":
    case "embed":
    case "link_preview": {
      const sourceUrl =
        block.type === "bookmark"
          ? block.bookmark.url
          : block.type === "embed"
            ? block.embed.url
            : block.link_preview.url;
      if (!sourceUrl) {
        return null;
      }

      const title =
        (
          block.type === "bookmark"
            ? getPlainText(block.bookmark.caption)
            : block.type === "embed"
              ? getPlainText(block.embed.caption)
              : ""
        ) || extractHostLabel(sourceUrl, block.type);

      const linkBlock: CaseLinkCardBlock = {
        id: block.id,
        type: block.type,
        url: sourceUrl,
        title,
      };

      return linkBlock;
    }

    case "code": {
      const codeBlock: CaseCodeBlock = {
        id: block.id,
        type: "code",
        language: block.code.language || "plain text",
        caption: getPlainText(block.code.caption),
        code: block.code.rich_text.map((item) => item.plain_text).join(""),
      };

      if (!codeBlock.code.trim() && !codeBlock.caption) {
        return null;
      }

      return codeBlock;
    }

    case "equation":
      return {
        id: block.id,
        type: "paragraph",
        richText: [
          {
            type: "equation",
            text: block.equation.expression,
            href: null,
            annotations: DEFAULT_ANNOTATIONS,
          },
        ],
      };

    case "table":
      return mapTableBlock(block);

    default:
      return null;
  }
}

const getCaseBlocksByPageIdCached = unstable_cache(
  async (pageId: string): Promise<CaseBlock[]> => fetchCaseBlocksWithRetry(pageId),
  ["case-block-tree-v1"],
  {
    revalidate: CASE_CONTENT_REVALIDATE_SECONDS,
    tags: [CACHE_TAGS.CASE_BLOCKS],
  },
);

export async function getCaseBlocksByPageId(pageId: string): Promise<CaseBlock[]> {
  return getCaseBlocksByPageIdCached(pageId);
}

export interface CaseTextAnnotations {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  underline: boolean;
  code: boolean;
  color: string;
}

export interface CaseRichTextSegment {
  type: "text" | "equation";
  text: string;
  href: string | null;
  annotations: CaseTextAnnotations;
}

interface CaseBlockBase {
  id: string;
}

export interface CaseParagraphBlock extends CaseBlockBase {
  type: "paragraph";
  richText: CaseRichTextSegment[];
}

export interface CaseHeadingBlock extends CaseBlockBase {
  type: "heading";
  level: 1 | 2 | 3;
  anchorId: string;
  richText: CaseRichTextSegment[];
}

export interface CaseListItemBlock extends CaseBlockBase {
  type: "bulleted_list_item" | "numbered_list_item";
  richText: CaseRichTextSegment[];
  children: CaseBlock[];
}

export interface CaseQuoteBlock extends CaseBlockBase {
  type: "quote";
  richText: CaseRichTextSegment[];
  children: CaseBlock[];
}

export interface CaseCalloutIcon {
  type: "emoji" | "image";
  value: string;
}

export interface CaseCalloutBlock extends CaseBlockBase {
  type: "callout";
  richText: CaseRichTextSegment[];
  icon: CaseCalloutIcon | null;
  children: CaseBlock[];
}

export interface CaseImageBlock extends CaseBlockBase {
  type: "image";
  src: string;
  alt: string;
  caption: string;
}

export interface CaseTableRow {
  cells: CaseRichTextSegment[][];
}

export interface CaseTableBlock extends CaseBlockBase {
  type: "table";
  rows: CaseTableRow[];
  hasColumnHeader: boolean;
  hasRowHeader: boolean;
}

export interface CaseVideoBlock extends CaseBlockBase {
  type: "video";
  src: string;
  caption: string;
}

export interface CaseAudioBlock extends CaseBlockBase {
  type: "audio";
  src: string;
  title: string;
}

export interface CaseFileBlock extends CaseBlockBase {
  type: "file" | "pdf";
  src: string;
  title: string;
  caption: string;
}

export interface CaseLinkCardBlock extends CaseBlockBase {
  type: "bookmark" | "embed" | "link_preview";
  url: string;
  title: string;
}

export interface CaseCodeBlock extends CaseBlockBase {
  type: "code";
  language: string;
  caption: string;
  code: string;
}

export interface CaseDividerBlock extends CaseBlockBase {
  type: "divider";
}

export type CaseBlock =
  | CaseParagraphBlock
  | CaseHeadingBlock
  | CaseListItemBlock
  | CaseQuoteBlock
  | CaseCalloutBlock
  | CaseImageBlock
  | CaseTableBlock
  | CaseVideoBlock
  | CaseAudioBlock
  | CaseFileBlock
  | CaseLinkCardBlock
  | CaseCodeBlock
  | CaseDividerBlock;

export interface CaseOutlineItem {
  id: string;
  title: string;
  level: 1 | 2 | 3;
  parentId: string | null;
}

export interface CaseOutlineGroup extends CaseOutlineItem {
  children: CaseOutlineItem[];
}

export interface CaseSection {
  id: string;
  title: string;
  heading: CaseHeadingBlock;
  blocks: CaseBlock[];
  subheadings: CaseOutlineItem[];
}

export interface CaseContentModel {
  intro: CaseBlock[];
  sections: CaseSection[];
  outline: CaseOutlineItem[];
}

export interface CaseVideoPresentation {
  kind: "direct" | "youtube" | "vimeo" | "other";
  embedUrl?: string;
}

export function getCaseRichTextPlainText(segments: CaseRichTextSegment[]): string {
  return segments.map((segment) => segment.text).join("");
}

export function buildCaseHeadingId(title: string, seed: number | string): string {
  const normalized = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  const suffix =
    typeof seed === "number"
      ? String(seed + 1)
      : seed
          .normalize("NFKC")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "")
          .slice(0, 12);

  if (!normalized) {
    return `case-section-${suffix || "x"}`;
  }

  return `case-${normalized}-${suffix || "x"}`;
}

export function buildCaseContentModel(blocks: CaseBlock[]): CaseContentModel {
  const intro: CaseBlock[] = [];
  const sections: CaseSection[] = [];
  const outline: CaseOutlineItem[] = [];
  let currentSection: CaseSection | null = null;

  for (const block of blocks) {
    if (block.type === "heading" && block.level <= 2) {
      const title = getCaseRichTextPlainText(block.richText).trim() || `章节 ${sections.length + 1}`;
      const outlineItem: CaseOutlineItem = {
        id: block.anchorId,
        title,
        level: block.level,
        parentId: null,
      };

      outline.push(outlineItem);
      currentSection = {
        id: block.anchorId,
        title,
        heading: block,
        blocks: [],
        subheadings: [],
      };
      sections.push(currentSection);
      continue;
    }

    if (block.type === "heading" && block.level === 3) {
      const outlineItem: CaseOutlineItem = {
        id: block.anchorId,
        title: getCaseRichTextPlainText(block.richText).trim() || "小节",
        level: 3,
        parentId: currentSection?.id ?? null,
      };

      outline.push(outlineItem);
      if (currentSection) {
        currentSection.subheadings.push(outlineItem);
        currentSection.blocks.push(block);
      } else {
        intro.push(block);
      }
      continue;
    }

    if (currentSection) {
      currentSection.blocks.push(block);
    } else {
      intro.push(block);
    }
  }

  return { intro, sections, outline };
}

export function buildCaseOutlineGroups(outline: CaseOutlineItem[]): CaseOutlineGroup[] {
  const childrenByParent = new Map<string, CaseOutlineItem[]>();

  for (const item of outline) {
    if (!item.parentId) {
      continue;
    }

    const siblings = childrenByParent.get(item.parentId) ?? [];
    siblings.push(item);
    childrenByParent.set(item.parentId, siblings);
  }

  return outline
    .filter((item) => item.level <= 2)
    .map((item) => ({
      ...item,
      children: childrenByParent.get(item.id) ?? [],
    }));
}

export function resolveCaseVideoPresentation(sourceUrl: string): CaseVideoPresentation {
  try {
    const parsed = new URL(sourceUrl);
    const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    if (/\.(mp4|m4v|mov|webm|ogg)$/i.test(pathname)) {
      return { kind: "direct" };
    }

    if (hostname === "youtu.be") {
      const videoId = parsed.pathname.split("/").filter(Boolean)[0];
      if (videoId) {
        return {
          kind: "youtube",
          embedUrl: `https://www.youtube.com/embed/${videoId}`,
        };
      }
    }

    if (hostname.endsWith("youtube.com")) {
      const videoId = parsed.searchParams.get("v") ?? parsed.pathname.split("/").filter(Boolean).pop();
      if (videoId) {
        return {
          kind: "youtube",
          embedUrl: `https://www.youtube.com/embed/${videoId}`,
        };
      }
    }

    if (hostname === "vimeo.com" || hostname.endsWith(".vimeo.com")) {
      const videoId = parsed.pathname.split("/").filter(Boolean).pop();
      if (videoId) {
        return {
          kind: "vimeo",
          embedUrl: `https://player.vimeo.com/video/${videoId}`,
        };
      }
    }
  } catch {
    return { kind: "other" };
  }

  return { kind: "other" };
}

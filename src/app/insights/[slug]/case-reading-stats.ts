import {
  getCaseRichTextPlainText,
  type CaseBlock,
} from "@/lib/case-content";

interface CaseSectionCountInput {
  sectionCount: number;
  outlineCount: number;
  hasIntro: boolean;
}

function buildCaseReadableText(blocks: CaseBlock[]): string {
  return blocks
    .map((block) => {
      if ("richText" in block) {
        return getCaseRichTextPlainText(block.richText);
      }
      if (block.type === "code") {
        return block.code;
      }
      if (block.type === "table") {
        return block.rows
          .flatMap((row) => row.cells)
          .map((cell) => getCaseRichTextPlainText(cell))
          .join(" ");
      }
      return "";
    })
    .join(" ");
}

export function countCaseCharacters(blocks: CaseBlock[]): number {
  return buildCaseReadableText(blocks).replace(/\s+/g, "").length;
}

export function countCaseMediaBlocks(blocks: CaseBlock[]): number {
  return blocks.reduce((count, block) => {
    if (
      block.type === "image" ||
      block.type === "table" ||
      block.type === "video" ||
      block.type === "audio"
    ) {
      return count + 1;
    }

    if (
      block.type === "callout" ||
      block.type === "quote" ||
      block.type === "bulleted_list_item" ||
      block.type === "numbered_list_item"
    ) {
      return count + countCaseMediaBlocks(block.children);
    }

    return count;
  }, 0);
}

export function estimateCaseReadMinutes(blocks: CaseBlock[]): number {
  return Math.max(1, Math.ceil(countCaseCharacters(blocks) / 450));
}

export function calculateCaseSectionCount({
  sectionCount,
  outlineCount,
  hasIntro,
}: CaseSectionCountInput): number {
  return Math.max(sectionCount, outlineCount, hasIntro ? 1 : 0);
}

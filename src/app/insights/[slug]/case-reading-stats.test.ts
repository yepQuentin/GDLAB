import { describe, expect, it } from "vitest";

import type { CaseBlock, CaseRichTextSegment } from "@/lib/case-content";

import {
  calculateCaseSectionCount,
  countCaseCharacters,
  countCaseMediaBlocks,
  estimateCaseReadMinutes,
} from "./case-reading-stats";

const plain = (text: string): CaseRichTextSegment[] => [
  {
    type: "text",
    text,
    href: null,
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: "default",
    },
  },
];

describe("case-reading-stats", () => {
  it("递归统计正文里的媒体块", () => {
    const blocks: CaseBlock[] = [
      { id: "image-1", type: "image", src: "/cover.png", alt: "cover", caption: "" },
      {
        id: "callout-1",
        type: "callout",
        richText: plain("说明"),
        icon: null,
        children: [
          { id: "video-1", type: "video", src: "https://example.com/demo.mp4", caption: "" },
        ],
      },
      {
        id: "list-1",
        type: "bulleted_list_item",
        richText: plain("要点"),
        children: [
          {
            id: "quote-1",
            type: "quote",
            richText: plain("引用"),
            children: [
              {
                id: "audio-1",
                type: "audio",
                src: "https://example.com/audio.mp3",
                title: "audio",
              },
            ],
          },
        ],
      },
    ];

    expect(countCaseMediaBlocks(blocks)).toBe(3);
  });

  it("按中文阅读速度估算阅读时长", () => {
    const blocks: CaseBlock[] = [
      {
        id: "p-1",
        type: "paragraph",
        richText: plain("测".repeat(520)),
      },
      {
        id: "code-1",
        type: "code",
        language: "ts",
        caption: "",
        code: "const value = 1;",
      },
    ];

    expect(estimateCaseReadMinutes(blocks)).toBe(2);
  });

  it("统计正文中的非空白字数", () => {
    const blocks: CaseBlock[] = [
      {
        id: "p-1",
        type: "paragraph",
        richText: plain("测 试"),
      },
      {
        id: "code-1",
        type: "code",
        language: "ts",
        caption: "",
        code: "a = 1",
      },
      {
        id: "table-1",
        type: "table",
        hasColumnHeader: false,
        hasRowHeader: false,
        rows: [
          {
            cells: [plain("行 业"), plain("增 长")],
          },
        ],
      },
    ];

    expect(countCaseCharacters(blocks)).toBe(9);
  });

  it("在只有导语时为章节数提供回退值", () => {
    expect(
      calculateCaseSectionCount({
        sectionCount: 0,
        outlineCount: 0,
        hasIntro: true,
      }),
    ).toBe(1);

    expect(
      calculateCaseSectionCount({
        sectionCount: 2,
        outlineCount: 1,
        hasIntro: true,
      }),
    ).toBe(2);
  });
});

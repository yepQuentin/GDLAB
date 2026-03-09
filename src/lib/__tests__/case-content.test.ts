import { describe, expect, it } from "vitest";

import {
  buildCaseContentModel,
  buildCaseHeadingId,
  buildCaseOutlineGroups,
  resolveCaseVideoPresentation,
  type CaseBlock,
  type CaseRichTextSegment,
} from "@/lib/case-content";

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

describe("case-content", () => {
  it("为中文标题生成稳定锚点", () => {
    expect(buildCaseHeadingId("一、品牌背景 @陈明霄", "abc123")).toBe("case-一-品牌背景-陈明霄-abc123");
  });

  it("按 h2 / h3 生成长文目录与章节", () => {
    const blocks: CaseBlock[] = [
      { id: "intro", type: "paragraph", richText: plain("导语") },
      {
        id: "h2-1",
        type: "heading",
        level: 2,
        anchorId: "case-brand",
        richText: plain("品牌背景"),
      },
      { id: "p-1", type: "paragraph", richText: plain("段落一") },
      {
        id: "h3-1",
        type: "heading",
        level: 3,
        anchorId: "case-brand-1",
        richText: plain("品牌定位"),
      },
      { id: "p-2", type: "paragraph", richText: plain("段落二") },
      {
        id: "h2-2",
        type: "heading",
        level: 2,
        anchorId: "case-growth",
        richText: plain("增长策略"),
      },
      { id: "p-3", type: "paragraph", richText: plain("段落三") },
    ];

    const model = buildCaseContentModel(blocks);

    expect(model.intro).toHaveLength(1);
    expect(model.sections).toHaveLength(2);
    expect(model.sections[0].title).toBe("品牌背景");
    expect(model.sections[0].blocks).toHaveLength(3);
    expect(model.sections[0].subheadings).toEqual([
      {
        id: "case-brand-1",
        title: "品牌定位",
        level: 3,
        parentId: "case-brand",
      },
    ]);
    expect(model.outline.map((item) => item.id)).toEqual([
      "case-brand",
      "case-brand-1",
      "case-growth",
    ]);

    expect(buildCaseOutlineGroups(model.outline)).toEqual([
      {
        id: "case-brand",
        title: "品牌背景",
        level: 2,
        parentId: null,
        children: [
          {
            id: "case-brand-1",
            title: "品牌定位",
            level: 3,
            parentId: "case-brand",
          },
        ],
      },
      {
        id: "case-growth",
        title: "增长策略",
        level: 2,
        parentId: null,
        children: [],
      },
    ]);
  });

  it("识别直接视频和 YouTube / Vimeo 嵌入", () => {
    expect(resolveCaseVideoPresentation("https://cdn.example.com/demo.mp4")).toEqual({
      kind: "direct",
    });

    expect(resolveCaseVideoPresentation("https://www.youtube.com/watch?v=abc123xyz")).toEqual({
      kind: "youtube",
      embedUrl: "https://www.youtube.com/embed/abc123xyz",
    });

    expect(resolveCaseVideoPresentation("https://vimeo.com/12345678")).toEqual({
      kind: "vimeo",
      embedUrl: "https://player.vimeo.com/video/12345678",
    });
  });
});

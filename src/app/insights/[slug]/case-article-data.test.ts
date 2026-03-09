import { afterEach, describe, expect, it, vi } from "vitest";

import type { CaseBlock, CaseRichTextSegment } from "@/lib/case-content";
import type { CaseArticleReadyState } from "./case-article-data";

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("@/lib/case-content");
  vi.doUnmock("@/lib/case-notion");
  vi.doUnmock("node:fs/promises");
});

function buildReadySnapshotState(): CaseArticleReadyState {
  return {
    characterCount: 10,
    status: "ready",
    mediaCount: 1,
    model: {
      intro: [],
      sections: [],
      outline: [],
    },
    readMinutes: 1,
    sectionCount: 1,
  };
}

describe("case-article-data", () => {
  it("为可渲染正文生成 ready 状态和统计信息", async () => {
    const { buildCaseArticleStateFromBlocks } = await import("./case-article-data");
    const blocks: CaseBlock[] = [
      {
        id: "intro-1",
        type: "paragraph",
        richText: plain("导语"),
      },
      {
        id: "heading-1",
        type: "heading",
        level: 2,
        anchorId: "case-brand",
        richText: plain("品牌背景"),
      },
      {
        id: "paragraph-1",
        type: "paragraph",
        richText: plain("正文内容"),
      },
      {
        id: "image-1",
        type: "image",
        src: "/cover.png",
        alt: "cover",
        caption: "",
      },
    ];

    const state = buildCaseArticleStateFromBlocks(blocks);

    expect(state.status).toBe("ready");
    if (state.status !== "ready") {
      throw new Error("expected ready state");
    }

    expect(state.characterCount).toBe(10);
    expect(state.mediaCount).toBe(1);
    expect(state.readMinutes).toBe(1);
    expect(state.sectionCount).toBe(1);
    expect(state.model.intro).toHaveLength(1);
    expect(state.model.sections).toHaveLength(1);
    expect(state.model.sections[0]?.title).toBe("品牌背景");
  });

  it("在没有块内容时返回 unavailable", async () => {
    const { buildCaseArticleStateFromBlocks } = await import("./case-article-data");

    expect(buildCaseArticleStateFromBlocks([])).toEqual({ status: "unavailable" });
  });

  it("在正文模型为空时返回 empty", async () => {
    vi.doMock("@/lib/case-content", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/case-content")>("@/lib/case-content");

      return {
        ...actual,
        buildCaseContentModel: vi.fn(() => ({
          intro: [],
          sections: [],
          outline: [],
        })),
      };
    });

    const { buildCaseArticleStateFromBlocks } = await import("./case-article-data");

    expect(buildCaseArticleStateFromBlocks([{ id: "divider-1", type: "divider" }])).toEqual({
      status: "empty",
    });
  });

  it("命中新鲜快照时直接返回缓存内容", async () => {
    const snapshotState = buildReadySnapshotState();
    const readFile = vi.fn().mockResolvedValue(
      JSON.stringify({
        savedAt: new Date().toISOString(),
        state: snapshotState,
        version: 1,
      }),
    );
    const getCaseBlocksByPageId = vi.fn();

    vi.doMock("node:fs/promises", () => ({
      mkdir: vi.fn(),
      readFile,
      rename: vi.fn(),
      unlink: vi.fn(),
      writeFile: vi.fn(),
    }));
    vi.doMock("@/lib/case-notion", () => ({
      getCaseBlocksByPageId,
    }));

    const { getCaseArticleState } = await import("./case-article-data");

    await expect(getCaseArticleState("page-fresh")).resolves.toEqual(snapshotState);
    expect(getCaseBlocksByPageId).not.toHaveBeenCalled();
  });

  it("在快照过期后刷新正文并写回缓存", async () => {
    const staleSnapshotState = buildReadySnapshotState();
    const readFile = vi.fn().mockResolvedValue(
      JSON.stringify({
        savedAt: "2020-01-01T00:00:00.000Z",
        state: staleSnapshotState,
        version: 1,
      }),
    );
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const rename = vi.fn().mockResolvedValue(undefined);
    const getCaseBlocksByPageId = vi.fn().mockResolvedValue([
      {
        id: "intro-1",
        type: "paragraph",
        richText: plain("新的正文内容"),
      },
    ] satisfies CaseBlock[]);

    vi.doMock("node:fs/promises", () => ({
      mkdir,
      readFile,
      rename,
      unlink: vi.fn(),
      writeFile,
    }));
    vi.doMock("@/lib/case-notion", () => ({
      getCaseBlocksByPageId,
    }));

    const { getCaseArticleState } = await import("./case-article-data");
    const state = await getCaseArticleState("page-stale");

    expect(state.status).toBe("ready");
    expect(getCaseBlocksByPageId).toHaveBeenCalledWith("page-stale");
    expect(mkdir).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it("刷新失败时回退到旧快照", async () => {
    const staleSnapshotState = buildReadySnapshotState();
    const readFile = vi.fn().mockResolvedValue(
      JSON.stringify({
        savedAt: "2020-01-01T00:00:00.000Z",
        state: staleSnapshotState,
        version: 1,
      }),
    );
    const getCaseBlocksByPageId = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const writeFile = vi.fn();

    vi.doMock("node:fs/promises", () => ({
      mkdir: vi.fn(),
      readFile,
      rename: vi.fn(),
      unlink: vi.fn(),
      writeFile,
    }));
    vi.doMock("@/lib/case-notion", () => ({
      getCaseBlocksByPageId,
    }));

    const { getCaseArticleState } = await import("./case-article-data");

    await expect(getCaseArticleState("page-fallback")).resolves.toEqual(staleSnapshotState);
    expect(getCaseBlocksByPageId).toHaveBeenCalledWith("page-fallback");
    expect(writeFile).not.toHaveBeenCalled();
  });
});

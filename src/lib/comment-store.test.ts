import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  adminHideComment,
  createComment,
  deleteOwnComment,
  getCommentThread,
  toggleCommentLike,
} from "@/lib/comment-store";

describe("comment-store", () => {
  let tempDir = "";
  let storeFile = "";
  const originalStateFile = process.env.COMMENT_STATE_FILE;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "gdlab-comment-"));
    storeFile = path.join(tempDir, "store.json");
    process.env.COMMENT_STATE_FILE = storeFile;
  });

  afterEach(async () => {
    if (originalStateFile) {
      process.env.COMMENT_STATE_FILE = originalStateFile;
    } else {
      delete process.env.COMMENT_STATE_FILE;
    }

    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("支持创建多级回复并按顶层最新排序", async () => {
    const first = await createComment({
      type: "insight",
      slug: "insight-a",
      body: "first",
      clientId: "client-a",
    });
    const second = await createComment({
      type: "insight",
      slug: "insight-a",
      body: "second",
      clientId: "client-b",
    });

    const child = await createComment({
      type: "insight",
      slug: "insight-a",
      parentId: first.id,
      body: "child-1",
      clientId: "client-c",
    });
    await createComment({
      type: "insight",
      slug: "insight-a",
      parentId: child.id,
      body: "child-2",
      clientId: "client-d",
    });

    const thread = await getCommentThread({
      type: "insight",
      slug: "insight-a",
      viewerClientId: "client-a",
    });

    expect(thread.totalComments).toBe(4);
    expect(thread.nodes.map((item) => item.id)).toEqual([second.id, first.id]);
    expect(thread.nodes[1]?.children[0]?.children[0]?.body).toBe("child-2");
  });

  it("点赞支持 toggle", async () => {
    const comment = await createComment({
      type: "daily",
      slug: "daily-x",
      body: "hello",
      clientId: "client-a",
    });

    let result = await toggleCommentLike({
      commentId: comment.id,
      clientId: "client-a",
    });
    expect(result).toEqual({
      likes: 1,
      likedByMe: true,
    });

    result = await toggleCommentLike({
      commentId: comment.id,
      clientId: "client-a",
    });
    expect(result).toEqual({
      likes: 0,
      likedByMe: false,
    });
  });

  it("作者删除父评论会级联删除整棵子树", async () => {
    const parent = await createComment({
      type: "daily",
      slug: "daily-delete",
      body: "parent",
      clientId: "client-a",
    });
    const child = await createComment({
      type: "daily",
      slug: "daily-delete",
      parentId: parent.id,
      body: "child",
      clientId: "client-b",
    });
    await createComment({
      type: "daily",
      slug: "daily-delete",
      parentId: child.id,
      body: "child-2",
      clientId: "client-c",
    });

    await deleteOwnComment({
      commentId: parent.id,
      clientId: "client-a",
    });

    const thread = await getCommentThread({
      type: "daily",
      slug: "daily-delete",
    });
    expect(thread.totalComments).toBe(0);
    expect(thread.nodes).toHaveLength(0);
  });

  it("管理员隐藏父评论会隐藏整棵子树", async () => {
    const parent = await createComment({
      type: "daily",
      slug: "daily-hide",
      body: "parent",
      clientId: "client-a",
    });
    await createComment({
      type: "daily",
      slug: "daily-hide",
      parentId: parent.id,
      body: "child",
      clientId: "client-b",
    });

    await adminHideComment({ commentId: parent.id });
    const thread = await getCommentThread({
      type: "daily",
      slug: "daily-hide",
    });

    expect(thread.totalComments).toBe(0);
    expect(thread.nodes).toHaveLength(0);
  });
});

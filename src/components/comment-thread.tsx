"use client";

import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";

import { getOrCreateClientId } from "@/components/engagement-bar";
import { ThumbsUpIcon } from "@/components/thumbs-up-icon";
import type { ContentType } from "@/lib/types";

import styles from "./comment-thread.module.css";

interface CommentNode {
  id: string;
  parentId: string | null;
  depth: number;
  nickname: string;
  body: string;
  likes: number;
  likedByMe: boolean;
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
  children: CommentNode[];
}

interface ThreadResponseData {
  type: ContentType;
  slug: string;
  totalComments: number;
  nodes: CommentNode[];
}

interface CommentThreadProps {
  type: ContentType;
  slug: string;
  className?: string;
  withTopDivider?: boolean;
}

interface BaseApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function readApiResponse<T>(response: Response): Promise<BaseApiResponse<T> | null> {
  try {
    return (await response.json()) as BaseApiResponse<T>;
  } catch {
    return null;
  }
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function countDescendants(nodes: CommentNode[]): number {
  let total = 0;
  for (const node of nodes) {
    total += 1 + countDescendants(node.children);
  }
  return total;
}

export function CommentThread({
  type,
  slug,
  className,
  withTopDivider = true,
}: CommentThreadProps) {
  const [clientId] = useState(() => (typeof window === "undefined" ? "" : getOrCreateClientId()));
  const [nodes, setNodes] = useState<CommentNode[]>([]);
  const [totalComments, setTotalComments] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [composerNickname, setComposerNickname] = useState("");
  const [composerBody, setComposerBody] = useState("");
  const [pendingCreate, setPendingCreate] = useState(false);
  const [replyTargetId, setReplyTargetId] = useState("");
  const [replyNickname, setReplyNickname] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [pendingLikeIds, setPendingLikeIds] = useState<Record<string, boolean>>({});
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Record<string, boolean>>({});
  const [expandedDeepReplies, setExpandedDeepReplies] = useState<Record<string, boolean>>({});

  const loadThread = useCallback(async (nextClientId: string): Promise<void> => {
    if (!nextClientId) {
      return;
    }

    setLoading(true);
    setError("");

    const query = new URLSearchParams({
      type,
      slug,
      clientId: nextClientId,
    });
    const response = await fetch(`/api/comments/thread?${query.toString()}`, {
      method: "GET",
      cache: "no-store",
    }).catch(() => null);

    if (!response || !response.ok) {
      setLoading(false);
      setError("评论加载失败，请稍后重试。");
      return;
    }

    const payload = await readApiResponse<ThreadResponseData>(response);
    if (!payload || !payload.ok || !payload.data) {
      setLoading(false);
      setError(payload?.error || "评论加载失败，请稍后重试。");
      return;
    }

    setNodes(payload.data.nodes);
    setTotalComments(payload.data.totalComments);
    setLoading(false);
  }, [slug, type]);

  useEffect(() => {
    if (!clientId) {
      return;
    }
    const timer = setTimeout(() => {
      void loadThread(clientId);
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [clientId, loadThread]);

  async function refreshThread(): Promise<void> {
    if (!clientId) {
      return;
    }
    await loadThread(clientId);
  }

  async function createComment(input: { body: string; parentId?: string }): Promise<void> {
    if (!clientId) {
      return;
    }
    const body = input.body.trim();
    if (!body) {
      setHint("评论内容不能为空。");
      return;
    }

    setPendingCreate(true);
    const nickname = (input.parentId ? replyNickname : composerNickname).trim() || "Doer";
    const response = await fetch("/api/comments/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type,
        slug,
        body,
        nickname,
        clientId,
        ...(input.parentId ? { parentId: input.parentId } : {}),
      }),
    }).catch(() => null);

    if (!response) {
      setHint("发布失败，请稍后重试。");
      setPendingCreate(false);
      return;
    }

    const payload = await readApiResponse<unknown>(response);
    if (!response.ok || !payload?.ok) {
      setHint(payload?.error || "发布失败，请稍后重试。");
      setPendingCreate(false);
      return;
    }

    if (input.parentId) {
      setReplyTargetId("");
      setReplyBody("");
    } else {
      setComposerBody("");
    }
    setHint("评论已发布。");
    setPendingCreate(false);
    await refreshThread();
  }

  async function handleToggleLike(commentId: string): Promise<void> {
    if (!clientId || pendingLikeIds[commentId]) {
      return;
    }

    setPendingLikeIds((prev) => ({ ...prev, [commentId]: true }));
    const response = await fetch("/api/comments/like-toggle", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        commentId,
        clientId,
      }),
    }).catch(() => null);

    if (!response) {
      setHint("点赞失败，请稍后重试。");
      setPendingLikeIds((prev) => ({ ...prev, [commentId]: false }));
      return;
    }

    const payload = await readApiResponse<unknown>(response);
    if (!response.ok || !payload?.ok) {
      setHint(payload?.error || "点赞失败，请稍后重试。");
      setPendingLikeIds((prev) => ({ ...prev, [commentId]: false }));
      return;
    }

    setPendingLikeIds((prev) => ({ ...prev, [commentId]: false }));
    setHint("");
    await refreshThread();
  }

  async function handleDeleteOwn(commentId: string): Promise<void> {
    if (!clientId || pendingDeleteIds[commentId]) {
      return;
    }

    setPendingDeleteIds((prev) => ({ ...prev, [commentId]: true }));
    const response = await fetch("/api/comments/delete-self", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        commentId,
        clientId,
      }),
    }).catch(() => null);

    if (!response) {
      setHint("删除失败，请稍后重试。");
      setPendingDeleteIds((prev) => ({ ...prev, [commentId]: false }));
      return;
    }

    const payload = await readApiResponse<unknown>(response);
    if (!response.ok || !payload?.ok) {
      setHint(payload?.error || "删除失败，请稍后重试。");
      setPendingDeleteIds((prev) => ({ ...prev, [commentId]: false }));
      return;
    }

    setPendingDeleteIds((prev) => ({ ...prev, [commentId]: false }));
    setHint("评论已删除。");
    await refreshThread();
  }

  function renderChildren(parent: CommentNode): ReactElement | null {
    if (parent.children.length === 0) {
      return null;
    }

    const shouldFold = parent.depth >= 2;
    const expanded = expandedDeepReplies[parent.id] === true;

    if (shouldFold && !expanded) {
      const total = countDescendants(parent.children);
      return (
        <div className={styles.foldContainer}>
          <button
            type="button"
            className={styles.foldButton}
            onClick={() => {
              setExpandedDeepReplies((prev) => ({
                ...prev,
                [parent.id]: true,
              }));
            }}
          >
            展开更深回复（{total}）
          </button>
        </div>
      );
    }

    return <div className={styles.children}>{parent.children.map((child) => renderCommentItem(child))}</div>;
  }

  function renderCommentItem(node: CommentNode): ReactElement {
    const isReplying = replyTargetId === node.id;
    const likePending = pendingLikeIds[node.id] === true;
    const deletePending = pendingDeleteIds[node.id] === true;

    return (
      <article key={node.id} className={styles.commentItem}>
        <header className={styles.commentHeader}>
          <div className={styles.commentMeta}>
            <strong className={styles.commentAuthor}>{node.nickname || "Doer"}</strong>
            <time className={styles.commentTime} dateTime={node.createdAt}>
              {formatDateTime(node.createdAt)}
            </time>
          </div>
        </header>

        <p className={styles.commentBody}>{node.body}</p>

        <div className={styles.commentActions}>
          <button
            type="button"
            className={clsx(styles.actionButton, node.likedByMe ? styles.actionButtonLiked : "")}
            onClick={() => {
              handleToggleLike(node.id).catch(() => undefined);
            }}
            disabled={likePending}
          >
            <ThumbsUpIcon className={styles.actionIcon} />
            <span>{node.likes}</span>
          </button>

          <button
            type="button"
            className={styles.inlineButton}
            onClick={() => {
              setReplyTargetId((prev) => (prev === node.id ? "" : node.id));
              setReplyBody("");
            }}
          >
            回复
          </button>

          {node.canDelete ? (
            <button
              type="button"
              className={styles.inlineButton}
              onClick={() => {
                handleDeleteOwn(node.id).catch(() => undefined);
              }}
              disabled={deletePending}
            >
              删除
            </button>
          ) : null}
        </div>

        {isReplying ? (
          <div className={styles.replyComposer}>
            <div className={styles.fieldRow}>
              <label htmlFor={`reply-nickname-${node.id}`}>昵称</label>
              <input
                id={`reply-nickname-${node.id}`}
                className={styles.textInput}
                value={replyNickname}
                maxLength={24}
                onChange={(event) => {
                  setReplyNickname(event.target.value);
                }}
                placeholder="请输入昵称"
              />
            </div>

            <label htmlFor={`reply-body-${node.id}`} className={styles.srOnly}>
              回复内容
            </label>
            <textarea
              id={`reply-body-${node.id}`}
              className={styles.textArea}
              rows={3}
              value={replyBody}
              onChange={(event) => {
                setReplyBody(event.target.value);
              }}
              placeholder="写下你的回复..."
            />

            <div className={styles.composerActions}>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={pendingCreate}
                onClick={() => {
                  createComment({ body: replyBody, parentId: node.id }).catch(() => undefined);
                }}
              >
                发送回复
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  setReplyTargetId("");
                  setReplyBody("");
                }}
              >
                取消
              </button>
            </div>
          </div>
        ) : null}

        {renderChildren(node)}
      </article>
    );
  }

  return (
    <section
      className={clsx(styles.section, withTopDivider ? styles.sectionWithDivider : "", className)}
      aria-label="评论区"
    >
      <header className={styles.sectionHeader}>
        <div>
          <p className={styles.kicker}>Community</p>
          <h2 className={styles.title}>评论</h2>
        </div>
        <p className={styles.count}>共 {totalComments} 条</p>
      </header>

      <div className={styles.composer}>
        <div className={styles.fieldRow}>
          <label htmlFor={`comment-nickname-${type}-${slug}`}>昵称</label>
          <input
            id={`comment-nickname-${type}-${slug}`}
            className={styles.textInput}
            value={composerNickname}
            maxLength={24}
            onChange={(event) => {
              setComposerNickname(event.target.value);
            }}
            placeholder="请输入昵称"
          />
        </div>

        <label htmlFor={`comment-body-${type}-${slug}`} className={styles.srOnly}>
          评论内容
        </label>
        <textarea
          id={`comment-body-${type}-${slug}`}
          className={styles.textArea}
          rows={4}
          value={composerBody}
          onChange={(event) => {
            setComposerBody(event.target.value);
          }}
          placeholder="写下你的观点..."
        />

        <div className={styles.composerActions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => {
              createComment({ body: composerBody }).catch(() => undefined);
            }}
            disabled={pendingCreate}
          >
            发布评论
          </button>
        </div>
      </div>

      {hint ? (
        <p className={styles.hint} aria-live="polite">
          {hint}
        </p>
      ) : null}

      {loading ? <p className={styles.stateText}>评论加载中...</p> : null}
      {!loading && error ? <p className={styles.stateText}>{error}</p> : null}

      {!loading && !error ? (
        <div className={styles.list}>{nodes.length > 0 ? nodes.map((node) => renderCommentItem(node)) : <p className={styles.stateText}>还没有评论，来发第一条吧。</p>}</div>
      ) : null}
    </section>
  );
}

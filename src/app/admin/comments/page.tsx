"use client";

import { useState } from "react";

type CommentType = "daily" | "insight";
type CommentStatus = "visible" | "hidden";

interface AdminCommentItem {
  id: string;
  type: CommentType;
  slug: string;
  parentId: string | null;
  depth: number;
  nickname: string;
  body: string;
  status: CommentStatus;
  needsReview: boolean;
  likes: number;
  createdAt: string;
  updatedAt: string;
}

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
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

function getCommentTargetUrl(comment: AdminCommentItem): string {
  return comment.type === "daily" ? `/daily/${comment.slug}` : `/insights/${comment.slug}`;
}

export default function AdminCommentsPage() {
  const [token, setToken] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | CommentType>("");
  const [statusFilter, setStatusFilter] = useState<"" | CommentStatus>("");
  const [items, setItems] = useState<AdminCommentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [pendingId, setPendingId] = useState("");

  async function loadComments(): Promise<void> {
    if (!token.trim()) {
      setError("请先输入 COMMENT_ADMIN_TOKEN。");
      return;
    }

    setLoading(true);
    setError("");
    setHint("");

    const query = new URLSearchParams();
    if (typeFilter) {
      query.set("type", typeFilter);
    }
    if (statusFilter) {
      query.set("status", statusFilter);
    }

    const response = await fetch(`/api/comments/admin/list?${query.toString()}`, {
      method: "GET",
      headers: {
        "x-comment-admin-token": token.trim(),
      },
      cache: "no-store",
    }).catch(() => null);

    if (!response) {
      setLoading(false);
      setError("加载失败，请稍后重试。");
      return;
    }

    const payload = (await response.json()) as ApiResponse<AdminCommentItem[]>;
    if (!response.ok || !payload.ok || !payload.data) {
      setLoading(false);
      setError(payload.error || "加载失败，请稍后重试。");
      return;
    }

    setItems(payload.data);
    setLoading(false);
  }

  async function moderate(commentId: string, action: "hide" | "delete"): Promise<void> {
    if (!token.trim()) {
      setError("请先输入 COMMENT_ADMIN_TOKEN。");
      return;
    }

    setPendingId(commentId);
    setHint("");
    const response = await fetch(`/api/comments/admin/${action}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-comment-admin-token": token.trim(),
      },
      body: JSON.stringify({ commentId }),
    }).catch(() => null);

    if (!response) {
      setPendingId("");
      setError("操作失败，请稍后重试。");
      return;
    }

    const payload = (await response.json()) as ApiResponse<unknown>;
    if (!response.ok || !payload.ok) {
      setPendingId("");
      setError(payload.error || "操作失败，请稍后重试。");
      return;
    }

    setPendingId("");
    setHint(action === "hide" ? "已隐藏评论。" : "已删除评论。");
    await loadComments();
  }

  return (
    <section className="section-block">
      <header className="section-header">
        <div className="section-title-group">
          <p className="section-kicker">Admin</p>
          <h1>评论管理</h1>
        </div>
      </header>

      <p className="section-description">支持按类型/状态筛选，并执行基础隐藏与删除操作。</p>

      <div style={{ marginTop: "16px", display: "grid", gap: "12px" }}>
        <label style={{ display: "grid", gap: "6px" }}>
          <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>COMMENT_ADMIN_TOKEN</span>
          <input
            type="password"
            value={token}
            onChange={(event) => {
              setToken(event.target.value);
            }}
            placeholder="输入管理令牌"
            style={{
              height: "38px",
              border: "1px solid var(--line-soft)",
              borderRadius: "10px",
              padding: "0 12px",
              font: "inherit",
            }}
          />
        </label>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <select
            value={typeFilter}
            onChange={(event) => {
              const next = event.target.value as "" | CommentType;
              setTypeFilter(next);
              if (token.trim()) {
                void loadComments();
              }
            }}
            style={{
              height: "34px",
              border: "1px solid var(--line-soft)",
              borderRadius: "999px",
              padding: "0 12px",
              font: "inherit",
              background: "#fff",
            }}
          >
            <option value="">全部类型</option>
            <option value="daily">Daily</option>
            <option value="insight">Insights</option>
          </select>

          <select
            value={statusFilter}
            onChange={(event) => {
              const next = event.target.value as "" | CommentStatus;
              setStatusFilter(next);
              if (token.trim()) {
                void loadComments();
              }
            }}
            style={{
              height: "34px",
              border: "1px solid var(--line-soft)",
              borderRadius: "999px",
              padding: "0 12px",
              font: "inherit",
              background: "#fff",
            }}
          >
            <option value="">全部状态</option>
            <option value="visible">visible</option>
            <option value="hidden">hidden</option>
          </select>

          <button
            type="button"
            onClick={() => {
              loadComments().catch(() => undefined);
            }}
            style={{
              height: "34px",
              border: "1px solid var(--line)",
              borderRadius: "999px",
              padding: "0 14px",
              background: "var(--line)",
              color: "#fff",
              font: "inherit",
              cursor: "pointer",
            }}
          >
            刷新
          </button>
        </div>
      </div>

      {error ? <p style={{ color: "#9b2c2c", marginTop: "10px" }}>{error}</p> : null}
      {hint ? <p style={{ color: "var(--muted)", marginTop: "10px" }}>{hint}</p> : null}
      {loading ? <p style={{ color: "var(--muted)", marginTop: "10px" }}>加载中...</p> : null}

      <div style={{ marginTop: "16px", display: "grid", gap: "10px" }}>
        {items.map((item) => (
          <article
            key={item.id}
            style={{
              border: "1px solid var(--line-soft)",
              borderRadius: "12px",
              padding: "12px",
              background: "#fff",
              display: "grid",
              gap: "8px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: "4px" }}>
                <strong style={{ fontSize: "0.95rem" }}>{item.nickname || "Doer"}</strong>
                <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                  {item.type}/{item.slug} · 深度 {item.depth} · likes {item.likes}
                </div>
              </div>
              <div style={{ color: "var(--muted)", fontSize: "0.8rem", textAlign: "right" }}>
                <div>{formatDateTime(item.createdAt)}</div>
                <div>status: {item.status}</div>
                <div>review: {item.needsReview ? "pending" : "done"}</div>
              </div>
            </div>

            <p style={{ margin: 0, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {item.body}
            </p>

            <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
              <a
                href={getCommentTargetUrl(item)}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--muted)", fontSize: "0.82rem" }}
              >
                打开正文
              </a>

              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => {
                    moderate(item.id, "hide").catch(() => undefined);
                  }}
                  disabled={pendingId === item.id}
                  style={{
                    border: "1px solid var(--line-soft)",
                    borderRadius: "999px",
                    padding: "4px 10px",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  隐藏
                </button>

                <button
                  type="button"
                  onClick={() => {
                    moderate(item.id, "delete").catch(() => undefined);
                  }}
                  disabled={pendingId === item.id}
                  style={{
                    border: "1px solid #c48c8c",
                    borderRadius: "999px",
                    padding: "4px 10px",
                    background: "#fff",
                    color: "#8a2222",
                    cursor: "pointer",
                  }}
                >
                  删除
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

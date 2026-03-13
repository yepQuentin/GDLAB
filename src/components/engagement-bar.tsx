"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";

import type { ContentType } from "@/lib/types";
import type {
  EngagementEventRequestBody,
  EngagementEventResponse,
  EngagementStats,
  EngagementStatsResponse,
} from "@/lib/engagement-types";

import styles from "./engagement-bar.module.css";

const CLIENT_ID_STORAGE_KEY = "gdlab:engagement:client-id";
const DAILY_VIEW_STORAGE_KEY_PREFIX = "gdlab:engagement:view";
const LIKE_STORAGE_KEY_PREFIX = "gdlab:engagement:liked";
const VIEW_REPORT_DELAY_MS = 5000;
const ENABLE_ENGAGEMENT = process.env.NEXT_PUBLIC_ENABLE_ENGAGEMENT === "true";

interface EngagementBaseProps {
  slug: string;
  type: ContentType;
}

interface EngagementReadCountProps extends EngagementBaseProps {
  variant: "daily-header" | "daily-meta-inline" | "insight-stats";
  className?: string;
  itemClassName?: string;
  labelClassName?: string;
  valueClassName?: string;
}

interface EngagementActionBarProps extends EngagementBaseProps {
  className?: string;
}

interface EngagementRequestResult {
  likedByMe?: boolean;
  stats: EngagementStats;
}

function formatNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "--";
  }

  if (value >= 10000) {
    return `${(value / 10000).toFixed(1)}万`;
  }

  return new Intl.NumberFormat("zh-CN").format(Math.max(0, Math.floor(value)));
}

function getLikeStorageKey(type: ContentType, slug: string): string {
  return `${LIKE_STORAGE_KEY_PREFIX}:${type}:${slug}`;
}

function getViewStorageKey(type: ContentType, slug: string, dateKey: string): string {
  return `${DAILY_VIEW_STORAGE_KEY_PREFIX}:${type}:${slug}:${dateKey}`;
}

function getDateKeyInShanghai(date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Shanghai",
  });
  return formatter.format(date);
}

function safeGetLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetLocalStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures silently.
  }
}

export function getOrCreateClientId(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const existingId = safeGetLocalStorage(CLIENT_ID_STORAGE_KEY)?.trim();
  if (existingId) {
    return existingId;
  }

  const nextId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  safeSetLocalStorage(CLIENT_ID_STORAGE_KEY, nextId);
  return nextId;
}

export function shouldReportDailyView(type: ContentType, slug: string, dateKey: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const key = getViewStorageKey(type, slug, dateKey);
  return safeGetLocalStorage(key) !== "1";
}

function markDailyViewReported(type: ContentType, slug: string, dateKey: string): void {
  const key = getViewStorageKey(type, slug, dateKey);
  safeSetLocalStorage(key, "1");
}

function readLikedState(type: ContentType, slug: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return safeGetLocalStorage(getLikeStorageKey(type, slug)) === "1";
}

function writeLikedState(type: ContentType, slug: string, liked: boolean): void {
  safeSetLocalStorage(getLikeStorageKey(type, slug), liked ? "1" : "0");
}

async function requestStats(type: ContentType, slug: string): Promise<EngagementStats | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(`/api/engagement/stats?type=${type}&slug=${encodeURIComponent(slug)}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as EngagementStatsResponse;
    if (!payload.ok) {
      return null;
    }

    return payload.data;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function postEvent(body: EngagementEventRequestBody): Promise<EngagementRequestResult | null> {
  const response = await fetch("/api/engagement/event", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  }).catch(() => null);

  if (!response || !response.ok) {
    return null;
  }

  const payload = (await response.json()) as EngagementEventResponse;
  if (!payload.ok) {
    return null;
  }

  return {
    stats: payload.data,
    ...(typeof payload.data.likedByMe === "boolean" ? { likedByMe: payload.data.likedByMe } : {}),
  };
}

async function reportViewEvent(type: ContentType, slug: string): Promise<boolean> {
  const body: EngagementEventRequestBody = {
    type,
    slug,
    event: "view",
  };
  const payload = JSON.stringify(body);

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([payload], { type: "application/json" });
    const sent = navigator.sendBeacon("/api/engagement/event", blob);
    if (sent) {
      return true;
    }
  }

  const result = await fetch("/api/engagement/event", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: payload,
    keepalive: true,
  }).catch(() => null);

  return Boolean(result && result.ok);
}

export function EngagementReadCount({
  variant,
  type,
  slug,
  className,
  itemClassName,
  labelClassName,
  valueClassName,
}: EngagementReadCountProps) {
  const [views, setViews] = useState<number | null>(null);

  useEffect(() => {
    if (!ENABLE_ENGAGEMENT) {
      return;
    }

    let cancelled = false;
    requestStats(type, slug).then((stats) => {
      if (cancelled || !stats) {
        return;
      }
      setViews(stats.views);
    });

    return () => {
      cancelled = true;
    };
  }, [slug, type]);

  useEffect(() => {
    if (!ENABLE_ENGAGEMENT || typeof document === "undefined") {
      return;
    }

    const dateKey = getDateKeyInShanghai();
    if (!shouldReportDailyView(type, slug, dateKey)) {
      return;
    }

    let timerId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const trigger = async () => {
      if (cancelled || document.visibilityState !== "visible") {
        return;
      }

      const sent = await reportViewEvent(type, slug);
      if (!sent) {
        return;
      }

      markDailyViewReported(type, slug, dateKey);
      setViews((prev) => (prev === null ? prev : prev + 1));
    };

    const schedule = () => {
      if (timerId || document.visibilityState !== "visible") {
        return;
      }

      timerId = setTimeout(async () => {
        timerId = null;
        await trigger();
      }, VIEW_REPORT_DELAY_MS);
    };

    const clear = () => {
      if (!timerId) {
        return;
      }
      clearTimeout(timerId);
      timerId = null;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        schedule();
        return;
      }
      clear();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      clear();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [slug, type]);

  if (!ENABLE_ENGAGEMENT) {
    return null;
  }

  const value = formatNumber(views);
  if (variant === "insight-stats") {
    return (
      <div className={itemClassName}>
        <span className={labelClassName}>阅读人数</span>
        <strong className={valueClassName}>{value}</strong>
      </div>
    );
  }

  if (variant === "daily-meta-inline") {
    return <p className={className}>阅读人数：{value}</p>;
  }

  return (
    <p className={clsx(styles.readCounter, className)}>
      阅读人数<strong>{value}</strong>
    </p>
  );
}

export function EngagementActionBar({ type, slug, className }: EngagementActionBarProps) {
  const [likes, setLikes] = useState<number | null>(null);
  const [shares, setShares] = useState<number | null>(null);
  const [liked, setLiked] = useState(() => readLikedState(type, slug));
  const [pendingLike, setPendingLike] = useState(false);
  const [pendingShare, setPendingShare] = useState(false);
  const [hint, setHint] = useState("");
  const clientId = useMemo(() => getOrCreateClientId(), []);

  useEffect(() => {
    if (!ENABLE_ENGAGEMENT) {
      return;
    }

    let cancelled = false;
    requestStats(type, slug).then((stats) => {
      if (cancelled || !stats) {
        return;
      }
      setLikes(stats.likes);
      setShares(stats.shares);
    });

    return () => {
      cancelled = true;
    };
  }, [slug, type]);

  const handleLike = async () => {
    if (pendingLike) {
      return;
    }

    const previousLiked = liked;
    const previousLikes = likes ?? 0;
    const nextLiked = !previousLiked;

    setPendingLike(true);
    setLiked(nextLiked);
    setLikes(Math.max(0, previousLikes + (nextLiked ? 1 : -1)));
    writeLikedState(type, slug, nextLiked);

    const result = await postEvent({
      type,
      slug,
      event: nextLiked ? "like" : "unlike",
      clientId,
    }).catch(() => null);

    if (!result) {
      setLiked(previousLiked);
      setLikes(previousLikes);
      writeLikedState(type, slug, previousLiked);
      setHint("操作失败，请重试");
      setPendingLike(false);
      return;
    }

    setLikes(result.stats.likes);
    if (typeof result.likedByMe === "boolean") {
      setLiked(result.likedByMe);
      writeLikedState(type, slug, result.likedByMe);
    }
    setHint("");
    setPendingLike(false);
  };

  const handleShare = async () => {
    if (pendingShare) {
      return;
    }

    setPendingShare(true);

    const shareTitle = typeof document !== "undefined" ? document.title : "";
    const shareUrl = typeof window !== "undefined" ? window.location.href : "";
    let shared = false;

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: shareTitle, url: shareUrl });
        shared = true;
      } catch (error) {
        if ((error as DOMException).name === "AbortError") {
          setPendingShare(false);
          return;
        }
      }
    }

    if (!shared && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(shareUrl);
        shared = true;
      } catch {
        // Ignore and fallback to failure hint below.
      }
    }

    if (!shared) {
      setHint("转发失败，请重试");
      setPendingShare(false);
      return;
    }

    const previousShares = shares ?? 0;
    setShares(previousShares + 1);
    setHint("链接已复制");

    const result = await postEvent({
      type,
      slug,
      event: "share",
      clientId,
    }).catch(() => null);

    if (!result) {
      setShares(previousShares);
      setHint("操作失败，请重试");
      setPendingShare(false);
      return;
    }

    setShares(result.stats.shares);
    setPendingShare(false);
  };

  if (!ENABLE_ENGAGEMENT) {
    return null;
  }

  return (
    <section className={clsx(styles.actionBar, className)} aria-label="内容互动">
      <div className={styles.actionDock}>
        <button
          type="button"
          onClick={handleLike}
          disabled={pendingLike}
          className={clsx(styles.actionButton, liked ? styles.actionButtonLiked : "")}
          aria-label={liked ? "取消点赞" : "点赞"}
        >
          <svg
            className={styles.actionIcon}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M7 10v12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
          <span className={styles.actionValue}>{formatNumber(likes)}</span>
        </button>

        <button
          type="button"
          onClick={handleShare}
          disabled={pendingShare}
          className={styles.actionButton}
          aria-label="转发"
        >
          <svg className={styles.actionIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 2v13" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            <path d="m16 6-4-4-4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            <path
              d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className={styles.actionValue}>{formatNumber(shares)}</span>
        </button>
      </div>

      {hint ? (
        <p className={styles.actionHint} aria-live="polite">
          {hint}
        </p>
      ) : null}
    </section>
  );
}

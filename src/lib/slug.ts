import type { ContentType } from "@/lib/types";

export function formatDateInShanghai(dateInput: string): string | null {
  const exactDateMatch = dateInput.match(/^(\d{4}-\d{2}-\d{2})/);
  if (exactDateMatch) {
    return exactDateMatch[1];
  }

  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(date);
}

export function buildDailySlug(publishDate: string): string | null {
  const dateInShanghai = formatDateInShanghai(publishDate);
  if (!dateInShanghai) {
    return null;
  }

  return `daily-${dateInShanghai}`;
}

export function extractDateFromDailySlug(slug: string): string | null {
  const match = slug.match(/^daily-(\d{4}-\d{2}-\d{2})$/);
  return match ? match[1] : null;
}

export function resolveContentSlug(
  type: ContentType,
  publishDate: string,
  rawSlug: string,
  fallbackSlug: string,
): string {
  if (type !== "daily") {
    return rawSlug || fallbackSlug;
  }

  return rawSlug || buildDailySlug(publishDate) || fallbackSlug;
}

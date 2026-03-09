import type { ContentMeta, DailySections } from "@/lib/types";

export const SHANGHAI_TIME_ZONE = "Asia/Shanghai";

function getDateParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  return { year, month, day };
}

function toDayStamp(date: Date, timeZone: string): number {
  const { year, month, day } = getDateParts(date, timeZone);
  return Date.UTC(year, month - 1, day);
}

export function isWithinRecentDays(
  publishDate: string,
  days: number,
  now: Date = new Date(),
  timeZone: string = SHANGHAI_TIME_ZONE,
): boolean {
  if (!publishDate) {
    return false;
  }

  const publishTime = new Date(publishDate);
  if (Number.isNaN(publishTime.getTime())) {
    return false;
  }

  const todayStamp = toDayStamp(now, timeZone);
  const publishStamp = toDayStamp(publishTime, timeZone);
  const diffDays = Math.floor((todayStamp - publishStamp) / 86_400_000);

  return diffDays >= 0 && diffDays < days;
}

export function pickRecentDaily(items: ContentMeta[]): ContentMeta[] {
  return sortByPublishDateDesc(items.filter((item) => item.type === "daily")).slice(0, 3);
}

export function pickLatestCases(items: ContentMeta[], count = 2): ContentMeta[] {
  return items.filter((item) => item.type === "case").slice(0, count);
}

export function sortByPublishDateDesc(items: ContentMeta[]): ContentMeta[] {
  return [...items].sort((a, b) => {
    const aTime = new Date(a.publishDate).getTime();
    const bTime = new Date(b.publishDate).getTime();

    if (Number.isNaN(aTime) && Number.isNaN(bTime)) {
      return 0;
    }
    if (Number.isNaN(aTime)) {
      return 1;
    }
    if (Number.isNaN(bTime)) {
      return -1;
    }

    return bTime - aTime;
  });
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;

  return {
    items: items.slice(start, end),
    page: safePage,
    pageSize,
    total,
    totalPages,
  };
}

function resolveDailySection(heading: string): keyof Omit<DailySections, "intro"> | null {
  const normalized = heading.trim().toUpperCase();

  if (normalized.includes("TIMES") || heading.includes("时局")) {
    return "currentAffairs";
  }

  if (normalized.includes("INDUSTRIES") || heading.includes("行业")) {
    return "industry";
  }

  if (normalized.includes("TECHS") || normalized.includes("TECH") || heading.includes("科技")) {
    return "technology";
  }

  if (normalized.includes("BRANDS") || normalized.includes("BRAND") || heading.includes("品牌")) {
    return "brand";
  }

  return null;
}

export function parseDailySections(markdown: string): DailySections {
  const sections: DailySections = {
    intro: "",
    brand: "",
    currentAffairs: "",
    industry: "",
    technology: "",
  };

  const lines = markdown.split("\n");
  let currentSection: keyof DailySections = "intro";

  for (const line of lines) {
    const headingMatch = line.match(/^##(?!#)\s*(.+?)\s*$/);

    if (headingMatch) {
      const matchedSection = resolveDailySection(headingMatch[1]);
      if (matchedSection) {
        currentSection = matchedSection;
      }
      continue;
    }

    sections[currentSection] += `${line}\n`;
  }

  return {
    intro: sections.intro.trim(),
    brand: sections.brand.trim(),
    currentAffairs: sections.currentAffairs.trim(),
    industry: sections.industry.trim(),
    technology: sections.technology.trim(),
  };
}

export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[>*_~\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type ContentType = "daily" | "case";

export type PublishStatus = "Draft" | "Published";

export interface ContentMeta {
  id: string;
  title: string;
  slug: string;
  type: ContentType;
  publishDate: string;
  status: PublishStatus;
  summary: string;
  cover: string | null;
  tags: string[];
}

export interface DailySections {
  intro: string;
  brand: string;
  currentAffairs: string;
  industry: string;
  technology: string;
}

export interface ContentDetail {
  meta: ContentMeta;
  markdown: string;
  dailySections?: DailySections;
}

export interface HomePayload {
  dailyRecent: ContentMeta[];
  caseRecent: ContentMeta[];
}

export interface PaginatedContent {
  items: ContentMeta[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SearchDocument {
  id: string;
  type: ContentType;
  title: string;
  summary: string;
  tags: string[];
  bodyText: string;
  publishDate: string;
  url: string;
}

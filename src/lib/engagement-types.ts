export type EngagementContentType = "daily" | "insight";

export type EngagementEventType = "view" | "like" | "unlike" | "share";

export interface EngagementKey {
  type: EngagementContentType;
  slug: string;
}

export interface EngagementStats {
  views: number;
  likes: number;
  shares: number;
}

export interface EngagementEntry extends EngagementKey, EngagementStats {
  likedClientIds: string[];
  updatedAt: string;
}

export interface EngagementStoreFile {
  version: 1;
  updatedAt: string;
  entries: Record<string, EngagementEntry>;
}

export interface EngagementEventRequestBody extends EngagementKey {
  event: EngagementEventType;
  clientId?: string;
}

export interface EngagementStatsResponse {
  ok: true;
  data: EngagementKey & EngagementStats;
}

export interface EngagementEventResponse {
  ok: true;
  data: EngagementKey & EngagementStats & { likedByMe?: boolean };
}

export interface EngagementErrorResponse {
  ok: false;
  error: string;
}

export type CommentContentType = "daily" | "insight";

export type CommentStatus = "visible" | "hidden";

export interface CommentKey {
  type: CommentContentType;
  slug: string;
}

export interface CommentEntry extends CommentKey {
  id: string;
  parentId: string | null;
  depth: number;
  nickname: string;
  body: string;
  authorClientHash: string;
  likedClientHashes: string[];
  status: CommentStatus;
  needsReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CommentStoreFile {
  version: 1;
  updatedAt: string;
  comments: Record<string, CommentEntry>;
}

export interface CommentNode {
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

export interface CommentThreadResult {
  type: CommentContentType;
  slug: string;
  totalComments: number;
  nodes: CommentNode[];
}

export interface CreateCommentInput extends CommentKey {
  body: string;
  nickname?: string;
  parentId?: string;
  clientId: string;
}

export interface ToggleCommentLikeInput {
  commentId: string;
  clientId: string;
}

export interface DeleteOwnCommentInput {
  commentId: string;
  clientId: string;
}

export interface AdminModerateCommentInput {
  commentId: string;
}

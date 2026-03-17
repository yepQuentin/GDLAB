import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createClientHash,
  sanitizeCommentBody,
  sanitizeNickname,
  sanitizeClientId,
  validateCommentBody,
} from "@/lib/comment-moderation";
import type {
  AdminModerateCommentInput,
  CommentContentType,
  CommentEntry,
  CommentKey,
  CommentNode,
  CommentStatus,
  CommentStoreFile,
  CreateCommentInput,
  DeleteOwnCommentInput,
  ToggleCommentLikeInput,
} from "@/lib/comment-types";

const DEFAULT_COMMENT_STATE_FILE = "/var/lib/gdlab/comments/store.json";
const FALLBACK_COMMENT_STATE_FILE = path.join(
  process.cwd(),
  ".next",
  "cache",
  "comments",
  "store.json",
);
const STORE_VERSION = 1;

let mutationQueue: Promise<void> = Promise.resolve();

function nowIsoString(): string {
  return new Date().toISOString();
}

function isCommentType(value: unknown): value is CommentContentType {
  return value === "daily" || value === "insight";
}

function isCommentStatus(value: unknown): value is CommentStatus {
  return value === "visible" || value === "hidden";
}

function normalizeDepth(depth: unknown): number {
  if (typeof depth !== "number" || !Number.isFinite(depth) || depth < 0) {
    return 0;
  }
  return Math.floor(depth);
}

function normalizeLikedClientHashes(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const dedup = new Set<string>();
  for (const value of input) {
    if (typeof value !== "string") {
      continue;
    }

    const normalized = value.trim();
    if (normalized) {
      dedup.add(normalized);
    }
  }
  return [...dedup];
}

function createEmptyStore(): CommentStoreFile {
  return {
    version: STORE_VERSION,
    updatedAt: nowIsoString(),
    comments: {},
  };
}

function generateCommentId(): string {
  try {
    return randomUUID();
  } catch {
    return `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function parseStore(raw: string): CommentStoreFile {
  const parsed = JSON.parse(raw) as Partial<CommentStoreFile>;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    parsed.version !== STORE_VERSION ||
    typeof parsed.comments !== "object" ||
    parsed.comments === null
  ) {
    return createEmptyStore();
  }

  const comments: Record<string, CommentEntry> = {};
  for (const [id, rawEntry] of Object.entries(parsed.comments)) {
    if (!rawEntry || typeof rawEntry !== "object") {
      continue;
    }

    const entry = rawEntry as Partial<CommentEntry>;
    if (!isCommentType(entry.type) || typeof entry.slug !== "string" || !entry.slug.trim()) {
      continue;
    }
    if (typeof entry.id !== "string" || !entry.id.trim()) {
      continue;
    }
    if (entry.parentId !== null && typeof entry.parentId !== "string") {
      continue;
    }
    if (typeof entry.nickname !== "string" || typeof entry.body !== "string") {
      continue;
    }
    if (typeof entry.authorClientHash !== "string" || !entry.authorClientHash.trim()) {
      continue;
    }
    if (!isCommentStatus(entry.status)) {
      continue;
    }

    comments[id] = {
      id: entry.id,
      type: entry.type,
      slug: entry.slug.trim(),
      parentId: entry.parentId ?? null,
      depth: normalizeDepth(entry.depth),
      nickname: entry.nickname,
      body: entry.body,
      authorClientHash: entry.authorClientHash.trim(),
      likedClientHashes: normalizeLikedClientHashes(entry.likedClientHashes),
      status: entry.status,
      needsReview: Boolean(entry.needsReview),
      createdAt: typeof entry.createdAt === "string" && entry.createdAt ? entry.createdAt : nowIsoString(),
      updatedAt: typeof entry.updatedAt === "string" && entry.updatedAt ? entry.updatedAt : nowIsoString(),
    };
  }

  return {
    version: STORE_VERSION,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIsoString(),
    comments,
  };
}

function getCommentStateFilePathCandidates(): string[] {
  const configured = process.env.COMMENT_STATE_FILE?.trim();
  if (configured) {
    return [configured];
  }

  return [DEFAULT_COMMENT_STATE_FILE, FALLBACK_COMMENT_STATE_FILE];
}

function isPermissionDeniedError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EACCES" || code === "EPERM";
}

export function getCommentStateFilePath(): string {
  return getCommentStateFilePathCandidates()[0];
}

export async function readCommentStore(): Promise<CommentStoreFile> {
  const candidates = getCommentStateFilePathCandidates();

  for (const filePath of candidates) {
    try {
      const raw = await readFile(filePath, "utf8");
      return parseStore(raw);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || isPermissionDeniedError(error)) {
        continue;
      }
      throw error;
    }
  }

  return createEmptyStore();
}

async function writeCommentStoreAtPath(store: CommentStoreFile, filePath: string): Promise<void> {
  const directory = path.dirname(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify(store);

  await mkdir(directory, { recursive: true });
  await writeFile(tempPath, payload, "utf8");

  try {
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

export async function writeCommentStore(store: CommentStoreFile): Promise<void> {
  const candidates = getCommentStateFilePathCandidates();
  let lastError: unknown;

  for (let index = 0; index < candidates.length; index += 1) {
    const filePath = candidates[index];
    try {
      await writeCommentStoreAtPath(store, filePath);
      return;
    } catch (error) {
      lastError = error;
      const isLastCandidate = index === candidates.length - 1;
      if (!isLastCandidate && isPermissionDeniedError(error)) {
        continue;
      }
      throw error;
    }
  }

  if (lastError) {
    throw lastError;
  }
}

async function runExclusiveMutation<T>(callback: () => Promise<T>): Promise<T> {
  const chained = mutationQueue.then(callback, callback);
  mutationQueue = chained.then(
    () => undefined,
    () => undefined,
  );
  return chained;
}

function getCommentsForKey(store: CommentStoreFile, key: CommentKey): CommentEntry[] {
  return Object.values(store.comments).filter(
    (item) => item.type === key.type && item.slug === key.slug,
  );
}

function buildDescendantIds(store: CommentStoreFile, commentId: string): Set<string> {
  const childrenByParentId = new Map<string, string[]>();
  for (const item of Object.values(store.comments)) {
    if (!item.parentId) {
      continue;
    }
    const list = childrenByParentId.get(item.parentId) ?? [];
    list.push(item.id);
    childrenByParentId.set(item.parentId, list);
  }

  const ids = new Set<string>();
  const queue = [commentId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || ids.has(current)) {
      continue;
    }
    ids.add(current);
    const children = childrenByParentId.get(current) ?? [];
    queue.push(...children);
  }

  return ids;
}

function deleteSubtree(store: CommentStoreFile, commentId: string): void {
  const ids = buildDescendantIds(store, commentId);
  for (const id of ids) {
    delete store.comments[id];
  }
}

function hideSubtree(store: CommentStoreFile, commentId: string): void {
  const ids = buildDescendantIds(store, commentId);
  const now = nowIsoString();
  for (const id of ids) {
    const target = store.comments[id];
    if (!target) {
      continue;
    }
    target.status = "hidden";
    target.needsReview = false;
    target.updatedAt = now;
  }
}

function buildThreadNodes(input: {
  comments: CommentEntry[];
  viewerClientHash: string;
}): CommentNode[] {
  const visible = input.comments.filter((item) => item.status === "visible");
  const byId = new Map(visible.map((item) => [item.id, item]));
  const childrenByParentId = new Map<string, CommentEntry[]>();
  const roots: CommentEntry[] = [];

  for (const item of visible) {
    if (!item.parentId) {
      roots.push(item);
      continue;
    }
    if (!byId.has(item.parentId)) {
      continue;
    }
    const list = childrenByParentId.get(item.parentId) ?? [];
    list.push(item);
    childrenByParentId.set(item.parentId, list);
  }

  const sortByCreatedAtAsc = (a: CommentEntry, b: CommentEntry) =>
    a.createdAt.localeCompare(b.createdAt);
  const sortByCreatedAtDesc = (a: CommentEntry, b: CommentEntry) =>
    b.createdAt.localeCompare(a.createdAt);

  function toNode(entry: CommentEntry): CommentNode {
    const children = (childrenByParentId.get(entry.id) ?? []).sort(sortByCreatedAtAsc).map(toNode);

    return {
      id: entry.id,
      parentId: entry.parentId,
      depth: entry.depth,
      nickname: entry.nickname,
      body: entry.body,
      likes: entry.likedClientHashes.length,
      likedByMe: input.viewerClientHash ? entry.likedClientHashes.includes(input.viewerClientHash) : false,
      canDelete: input.viewerClientHash ? entry.authorClientHash === input.viewerClientHash : false,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      children,
    };
  }

  return roots.sort(sortByCreatedAtDesc).map(toNode);
}

export async function getCommentThread(input: {
  type: CommentContentType;
  slug: string;
  viewerClientId?: string;
}): Promise<{
  type: CommentContentType;
  slug: string;
  totalComments: number;
  nodes: CommentNode[];
}> {
  const store = await readCommentStore();
  const viewerClientHash = input.viewerClientId ? createClientHash(input.viewerClientId) : "";
  const comments = getCommentsForKey(store, { type: input.type, slug: input.slug });
  const nodes = buildThreadNodes({
    comments,
    viewerClientHash,
  });
  const totalComments = comments.filter((item) => item.status === "visible").length;

  return {
    type: input.type,
    slug: input.slug,
    totalComments,
    nodes,
  };
}

export async function createComment(input: CreateCommentInput): Promise<CommentEntry> {
  const clientId = sanitizeClientId(input.clientId);
  if (!clientId) {
    throw new Error("clientId is required.");
  }

  const body = sanitizeCommentBody(input.body);
  const bodyValidation = validateCommentBody(body);
  if (!bodyValidation.ok) {
    throw new Error(bodyValidation.message);
  }

  const nickname = sanitizeNickname(input.nickname);
  const parentId = typeof input.parentId === "string" && input.parentId.trim() ? input.parentId.trim() : null;
  const authorClientHash = createClientHash(clientId);

  return runExclusiveMutation(async () => {
    const store = await readCommentStore();
    let depth = 0;

    if (parentId) {
      const parent = store.comments[parentId];
      if (!parent || parent.type !== input.type || parent.slug !== input.slug || parent.status !== "visible") {
        throw new Error("Reply target does not exist.");
      }
      depth = parent.depth + 1;
    }

    const now = nowIsoString();
    const entry: CommentEntry = {
      id: generateCommentId(),
      type: input.type,
      slug: input.slug,
      parentId,
      depth,
      nickname,
      body,
      authorClientHash,
      likedClientHashes: [],
      status: "visible",
      needsReview: true,
      createdAt: now,
      updatedAt: now,
    };

    store.comments[entry.id] = entry;
    store.updatedAt = now;
    await writeCommentStore(store);
    return entry;
  });
}

export async function toggleCommentLike(input: ToggleCommentLikeInput): Promise<{
  likes: number;
  likedByMe: boolean;
}> {
  const clientId = sanitizeClientId(input.clientId);
  if (!clientId) {
    throw new Error("clientId is required.");
  }

  return runExclusiveMutation(async () => {
    const store = await readCommentStore();
    const target = store.comments[input.commentId];
    if (!target || target.status !== "visible") {
      throw new Error("Comment not found.");
    }

    const clientHash = createClientHash(clientId);
    const hasLiked = target.likedClientHashes.includes(clientHash);
    if (hasLiked) {
      target.likedClientHashes = target.likedClientHashes.filter((item) => item !== clientHash);
    } else {
      target.likedClientHashes.push(clientHash);
    }
    target.updatedAt = nowIsoString();
    store.updatedAt = target.updatedAt;
    await writeCommentStore(store);

    return {
      likes: target.likedClientHashes.length,
      likedByMe: !hasLiked,
    };
  });
}

export async function deleteOwnComment(input: DeleteOwnCommentInput): Promise<void> {
  const clientId = sanitizeClientId(input.clientId);
  if (!clientId) {
    throw new Error("clientId is required.");
  }

  return runExclusiveMutation(async () => {
    const store = await readCommentStore();
    const target = store.comments[input.commentId];
    if (!target) {
      throw new Error("Comment not found.");
    }

    const clientHash = createClientHash(clientId);
    if (target.authorClientHash !== clientHash) {
      throw new Error("No permission to delete this comment.");
    }

    deleteSubtree(store, target.id);
    store.updatedAt = nowIsoString();
    await writeCommentStore(store);
  });
}

export async function adminHideComment(input: AdminModerateCommentInput): Promise<void> {
  return runExclusiveMutation(async () => {
    const store = await readCommentStore();
    const target = store.comments[input.commentId];
    if (!target) {
      throw new Error("Comment not found.");
    }

    hideSubtree(store, target.id);
    store.updatedAt = nowIsoString();
    await writeCommentStore(store);
  });
}

export async function adminDeleteComment(input: AdminModerateCommentInput): Promise<void> {
  return runExclusiveMutation(async () => {
    const store = await readCommentStore();
    const target = store.comments[input.commentId];
    if (!target) {
      throw new Error("Comment not found.");
    }

    deleteSubtree(store, target.id);
    store.updatedAt = nowIsoString();
    await writeCommentStore(store);
  });
}

export async function listCommentsForAdmin(input?: {
  type?: CommentContentType;
  status?: CommentStatus;
}): Promise<CommentEntry[]> {
  const store = await readCommentStore();
  return Object.values(store.comments)
    .filter((item) => (input?.type ? item.type === input.type : true))
    .filter((item) => (input?.status ? item.status === input.status : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

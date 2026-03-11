import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type NotionMediaKind = "image" | "audio";

export interface CachedNotionMedia {
  blockId: string | null;
  byteLength: number;
  cachedAt: string;
  contentType: string;
  fileName: string;
  filePath: string;
  kind: NotionMediaKind;
  sourceUrl: string;
}

export interface CacheNotionMediaInput {
  blockId?: string | null;
  body: ArrayBuffer | Buffer | Uint8Array;
  cacheDir?: string;
  contentType: string;
  kind: NotionMediaKind;
  sourceUrl: string;
}

export interface FindCachedNotionMediaInput {
  blockId?: string | null;
  cacheDir?: string;
  sourceUrl?: string | null;
}

export type HttpByteRangeParseResult =
  | { status: "absent" }
  | { status: "invalid" }
  | { byteLength: number; end: number; start: number; status: "ok" };

const DEFAULT_NOTION_MEDIA_CACHE_DIR = "/var/lib/gdlab/notion-media-cache";
const CONTENT_TYPE_TO_EXTENSION = new Map([
  ["audio/mp4", ".m4a"],
  ["audio/mpeg", ".mp3"],
  ["audio/ogg", ".ogg"],
  ["audio/wav", ".wav"],
  ["image/gif", ".gif"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeCacheDir(cacheDir?: string): string {
  return cacheDir?.trim() || process.env.NOTION_MEDIA_CACHE_DIR?.trim() || DEFAULT_NOTION_MEDIA_CACHE_DIR;
}

function normalizeSourceUrl(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).toString();
  } catch {
    return sourceUrl.trim();
  }
}

function sanitizeSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-_.]+/g, "_");
}

function buildBlockLookupKey(blockId: string | null | undefined): string | null {
  if (!blockId || !blockId.trim()) {
    return null;
  }

  return `block-${sanitizeSegment(blockId)}`;
}

function buildSourceLookupKey(sourceUrl: string): string {
  return `src-${hashValue(normalizeSourceUrl(sourceUrl))}`;
}

function buildLookupKeys(sourceUrl: string, blockId?: string | null): string[] {
  const blockLookupKey = buildBlockLookupKey(blockId);
  return blockLookupKey ? [blockLookupKey, buildSourceLookupKey(sourceUrl)] : [buildSourceLookupKey(sourceUrl)];
}

export function buildNotionMediaLookupKeys(sourceUrl: string, blockId?: string | null): string[] {
  return buildLookupKeys(sourceUrl, blockId);
}

function getKindRoot(cacheDir: string, kind: NotionMediaKind): string {
  return path.join(cacheDir, kind);
}

function getFilesDir(cacheDir: string, kind: NotionMediaKind): string {
  return path.join(getKindRoot(cacheDir, kind), "files");
}

function getIndexDir(cacheDir: string, kind: NotionMediaKind): string {
  return path.join(getKindRoot(cacheDir, kind), "index");
}

function getIndexPath(cacheDir: string, kind: NotionMediaKind, lookupKey: string): string {
  return path.join(getIndexDir(cacheDir, kind), `${lookupKey}.json`);
}

function getNormalizedContentType(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() || "";
}

function getFileExtension(kind: NotionMediaKind, sourceUrl: string, contentType: string): string {
  const normalizedContentType = getNormalizedContentType(contentType);
  const mappedExtension = CONTENT_TYPE_TO_EXTENSION.get(normalizedContentType);
  if (mappedExtension) {
    return mappedExtension;
  }

  try {
    const extension = path.extname(new URL(sourceUrl).pathname).toLowerCase();
    if (extension) {
      return extension;
    }
  } catch {
    // Ignore malformed source URLs and use the media kind fallback.
  }

  return kind === "audio" ? ".bin" : ".asset";
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeFileAtomic(filePath: string, body: Buffer | string, encoding?: BufferEncoding) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  if (typeof body === "string") {
    await writeFile(tempPath, body, encoding ?? "utf8");
  } else {
    await writeFile(tempPath, body);
  }
  await rename(tempPath, filePath);
}

function toBuffer(body: ArrayBuffer | Buffer | Uint8Array): Buffer {
  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  return Buffer.from(body);
}

async function ensureCacheDirectories(cacheDir: string, kind: NotionMediaKind) {
  await mkdir(getFilesDir(cacheDir, kind), { recursive: true });
  await mkdir(getIndexDir(cacheDir, kind), { recursive: true });
}

async function readCachedEntryByLookupKey(
  kind: NotionMediaKind,
  cacheDir: string,
  lookupKey: string,
): Promise<CachedNotionMedia | null> {
  const indexPath = getIndexPath(cacheDir, kind, lookupKey);
  if (!(await pathExists(indexPath))) {
    return null;
  }

  const raw = await readFile(indexPath, "utf8");
  const cachedEntry = JSON.parse(raw) as Omit<CachedNotionMedia, "filePath">;
  const filePath = path.join(getFilesDir(cacheDir, kind), cachedEntry.fileName);

  if (!(await pathExists(filePath))) {
    return null;
  }

  return {
    ...cachedEntry,
    filePath,
  };
}

export function getNotionMediaCacheDir(cacheDir?: string): string {
  return normalizeCacheDir(cacheDir);
}

export function parseHttpByteRange(
  rangeHeader: string | null,
  totalByteLength: number,
): HttpByteRangeParseResult {
  if (!rangeHeader) {
    return { status: "absent" };
  }

  if (!Number.isFinite(totalByteLength) || totalByteLength <= 0) {
    return { status: "invalid" };
  }

  const matched = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!matched) {
    return { status: "invalid" };
  }

  const [, startRaw, endRaw] = matched;

  if (!startRaw && !endRaw) {
    return { status: "invalid" };
  }

  if (!startRaw) {
    const suffixLength = Number.parseInt(endRaw, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return { status: "invalid" };
    }

    const byteLength = Math.min(suffixLength, totalByteLength);
    return {
      status: "ok",
      start: totalByteLength - byteLength,
      end: totalByteLength - 1,
      byteLength,
    };
  }

  const start = Number.parseInt(startRaw, 10);
  if (!Number.isFinite(start) || start < 0 || start >= totalByteLength) {
    return { status: "invalid" };
  }

  const end = endRaw ? Number.parseInt(endRaw, 10) : totalByteLength - 1;
  if (!Number.isFinite(end) || end < start) {
    return { status: "invalid" };
  }

  const normalizedEnd = Math.min(end, totalByteLength - 1);
  return {
    status: "ok",
    start,
    end: normalizedEnd,
    byteLength: normalizedEnd - start + 1,
  };
}

export async function findCachedNotionMedia(
  input: FindCachedNotionMediaInput & { kind: NotionMediaKind },
): Promise<CachedNotionMedia | null> {
  const cacheDir = normalizeCacheDir(input.cacheDir);
  const sourceUrl = input.sourceUrl?.trim();

  if (!input.blockId?.trim() && !sourceUrl) {
    return null;
  }

  const lookupKeys = sourceUrl ? buildLookupKeys(sourceUrl, input.blockId) : [buildBlockLookupKey(input.blockId)!];

  for (const lookupKey of lookupKeys) {
    const cachedEntry = await readCachedEntryByLookupKey(input.kind, cacheDir, lookupKey);
    if (cachedEntry) {
      return cachedEntry;
    }
  }

  return null;
}

export async function cacheNotionMedia(input: CacheNotionMediaInput): Promise<CachedNotionMedia> {
  const cacheDir = normalizeCacheDir(input.cacheDir);
  const sourceUrl = normalizeSourceUrl(input.sourceUrl);
  const existing = await findCachedNotionMedia({
    kind: input.kind,
    blockId: input.blockId,
    sourceUrl,
    cacheDir,
  });

  const hasSourceMismatch =
    Boolean(existing && input.blockId?.trim()) && existing?.sourceUrl !== sourceUrl;

  if (existing && !hasSourceMismatch) {
    return existing;
  }

  await ensureCacheDirectories(cacheDir, input.kind);

  const buffer = toBuffer(input.body);
  const normalizedContentType = getNormalizedContentType(input.contentType);
  const fileExtension = getFileExtension(input.kind, sourceUrl, normalizedContentType);
  const blockLookupKey = buildBlockLookupKey(input.blockId);
  const sourceLookupKey = buildSourceLookupKey(sourceUrl);
  const storageKey = `${blockLookupKey ?? sourceLookupKey}-${hashValue(sourceUrl).slice(0, 12)}`;
  const fileName = `${storageKey}${fileExtension}`;
  const filePath = path.join(getFilesDir(cacheDir, input.kind), fileName);
  const cachedEntryBase = {
    kind: input.kind,
    blockId: input.blockId?.trim() || null,
    sourceUrl,
    contentType: normalizedContentType,
    byteLength: buffer.length,
    fileName,
    cachedAt: new Date().toISOString(),
  };

  await writeFileAtomic(filePath, buffer);

  const lookupKeys = buildLookupKeys(sourceUrl, input.blockId);
  await Promise.all(
    lookupKeys.map((lookupKey) =>
      writeFileAtomic(
        getIndexPath(cacheDir, input.kind, lookupKey),
        `${JSON.stringify(cachedEntryBase, null, 2)}\n`,
        "utf8",
      ),
    ),
  );

  return {
    ...cachedEntryBase,
    filePath,
  };
}

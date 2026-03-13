import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  EngagementEntry,
  EngagementEventRequestBody,
  EngagementKey,
  EngagementStats,
  EngagementStoreFile,
} from "@/lib/engagement-types";

const DEFAULT_ENGAGEMENT_STATE_FILE = "/var/lib/gdlab/engagement/stats.json";
const STORE_VERSION = 1;

let mutationQueue: Promise<void> = Promise.resolve();

export function getEngagementStateFilePath(): string {
  return process.env.ENGAGEMENT_STATE_FILE?.trim() || DEFAULT_ENGAGEMENT_STATE_FILE;
}

export function buildEngagementEntryKey(input: EngagementKey): string {
  return `${input.type}:${input.slug}`;
}

export function createEmptyEngagementStats(): EngagementStats {
  return {
    views: 0,
    likes: 0,
    shares: 0,
  };
}

function nowIsoString(): string {
  return new Date().toISOString();
}

function createEmptyStore(): EngagementStoreFile {
  return {
    version: STORE_VERSION,
    updatedAt: nowIsoString(),
    entries: {},
  };
}

function normalizeCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.floor(value);
}

function sanitizeClientId(value: string | undefined): string {
  if (!value) {
    return "";
  }

  return value.trim().slice(0, 128);
}

function parseStore(raw: string): EngagementStoreFile {
  const parsed = JSON.parse(raw) as Partial<EngagementStoreFile>;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    parsed.version !== STORE_VERSION ||
    !parsed.entries ||
    typeof parsed.entries !== "object"
  ) {
    return createEmptyStore();
  }

  const nextEntries: Record<string, EngagementEntry> = {};
  for (const [key, entry] of Object.entries(parsed.entries)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const type = "type" in entry && (entry.type === "daily" || entry.type === "insight")
      ? entry.type
      : null;
    const slug = "slug" in entry && typeof entry.slug === "string" ? entry.slug.trim() : "";
    if (!type || !slug) {
      continue;
    }

    const likedClientIds = Array.isArray(entry.likedClientIds)
      ? entry.likedClientIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : [];

    nextEntries[key] = {
      type,
      slug,
      views: normalizeCount(typeof entry.views === "number" ? entry.views : 0),
      likes: normalizeCount(typeof entry.likes === "number" ? entry.likes : likedClientIds.length),
      shares: normalizeCount(typeof entry.shares === "number" ? entry.shares : 0),
      likedClientIds,
      updatedAt:
        "updatedAt" in entry && typeof entry.updatedAt === "string" && entry.updatedAt
          ? entry.updatedAt
          : nowIsoString(),
    };
  }

  return {
    version: STORE_VERSION,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIsoString(),
    entries: nextEntries,
  };
}

function createEmptyEntry(input: EngagementKey): EngagementEntry {
  return {
    ...input,
    ...createEmptyEngagementStats(),
    likedClientIds: [],
    updatedAt: nowIsoString(),
  };
}

export async function readEngagementStore(): Promise<EngagementStoreFile> {
  const filePath = getEngagementStateFilePath();
  try {
    const raw = await readFile(filePath, "utf8");
    return parseStore(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createEmptyStore();
    }

    throw error;
  }
}

export async function writeEngagementStore(store: EngagementStoreFile): Promise<void> {
  const filePath = getEngagementStateFilePath();
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

async function runExclusiveMutation<T>(callback: () => Promise<T>): Promise<T> {
  const chained = mutationQueue.then(callback, callback);
  mutationQueue = chained.then(
    () => undefined,
    () => undefined,
  );
  return chained;
}

function toStats(entry: EngagementEntry): EngagementStats {
  return {
    views: normalizeCount(entry.views),
    likes: normalizeCount(entry.likes),
    shares: normalizeCount(entry.shares),
  };
}

export async function getEngagementStats(input: EngagementKey): Promise<EngagementStats> {
  const store = await readEngagementStore();
  const key = buildEngagementEntryKey(input);
  const entry = store.entries[key];
  if (!entry) {
    return createEmptyEngagementStats();
  }

  return toStats(entry);
}

export async function applyEngagementEvent(
  input: EngagementEventRequestBody,
): Promise<EngagementStats & { likedByMe?: boolean }> {
  return runExclusiveMutation(async () => {
    const store = await readEngagementStore();
    const key = buildEngagementEntryKey(input);
    const currentEntry = store.entries[key] || createEmptyEntry(input);
    const clientId = sanitizeClientId(input.clientId);
    let likedByMe: boolean | undefined;

    switch (input.event) {
      case "view":
        currentEntry.views = normalizeCount(currentEntry.views + 1);
        break;
      case "share":
        currentEntry.shares = normalizeCount(currentEntry.shares + 1);
        break;
      case "like":
        if (!clientId) {
          throw new Error("clientId is required for like event.");
        }
        if (!currentEntry.likedClientIds.includes(clientId)) {
          currentEntry.likedClientIds.push(clientId);
        }
        currentEntry.likes = normalizeCount(currentEntry.likedClientIds.length);
        likedByMe = true;
        break;
      case "unlike":
        if (!clientId) {
          throw new Error("clientId is required for unlike event.");
        }
        currentEntry.likedClientIds = currentEntry.likedClientIds.filter((id) => id !== clientId);
        currentEntry.likes = normalizeCount(currentEntry.likedClientIds.length);
        likedByMe = false;
        break;
      default:
        throw new Error("Unsupported engagement event.");
    }

    currentEntry.updatedAt = nowIsoString();
    store.entries[key] = currentEntry;
    store.updatedAt = currentEntry.updatedAt;
    await writeEngagementStore(store);

    return {
      ...toStats(currentEntry),
      ...(typeof likedByMe === "boolean" ? { likedByMe } : {}),
    };
  });
}

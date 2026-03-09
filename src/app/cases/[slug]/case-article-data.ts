import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  buildCaseContentModel,
  type CaseBlock,
  type CaseContentModel,
} from "@/lib/case-content";
import { CACHE_REVALIDATE_SECONDS } from "@/lib/cache-config";
import { getCaseBlocksByPageId } from "@/lib/case-notion";

import {
  calculateCaseSectionCount,
  countCaseCharacters,
  countCaseMediaBlocks,
  estimateCaseReadMinutes,
} from "./case-reading-stats";

const CASE_ARTICLE_STATE_REVALIDATE_SECONDS = CACHE_REVALIDATE_SECONDS;
const CASE_ARTICLE_SNAPSHOT_VERSION = 1;
const CASE_ARTICLE_SNAPSHOT_DIR = path.join(
  process.cwd(),
  ".next",
  "cache",
  "case-article-state-v1",
);

interface CaseArticleSnapshot {
  savedAt: string;
  state: CaseArticleState;
  version: number;
}

export interface CaseArticleReadyState {
  characterCount: number;
  status: "ready";
  mediaCount: number;
  model: CaseContentModel;
  readMinutes: number;
  sectionCount: number;
}

export type CaseArticleState =
  | CaseArticleReadyState
  | { status: "empty" }
  | { status: "unavailable" };

export function buildCaseArticleStateFromBlocks(blocks: CaseBlock[]): CaseArticleState {
  if (blocks.length === 0) {
    return { status: "unavailable" };
  }

  const model = buildCaseContentModel(blocks);
  if (model.intro.length === 0 && model.sections.length === 0) {
    return { status: "empty" };
  }

  const outlineCount = model.outline.filter((item) => item.level <= 2).length;

  return {
    characterCount: countCaseCharacters(blocks),
    status: "ready",
    mediaCount: countCaseMediaBlocks(blocks),
    model,
    readMinutes: estimateCaseReadMinutes(blocks),
    sectionCount: calculateCaseSectionCount({
      sectionCount: model.sections.length,
      outlineCount,
      hasIntro: model.intro.length > 0,
    }),
  };
}

const caseArticleRefreshLocks = new Map<string, Promise<CaseArticleState>>();

function getCaseArticleSnapshotPath(pageId: string): string {
  return path.join(CASE_ARTICLE_SNAPSHOT_DIR, `${pageId}.json`);
}

function isCaseArticleSnapshotFresh(snapshot: CaseArticleSnapshot): boolean {
  const savedAtTimestamp = Date.parse(snapshot.savedAt);

  if (Number.isNaN(savedAtTimestamp)) {
    return false;
  }

  return Date.now() - savedAtTimestamp < CASE_ARTICLE_STATE_REVALIDATE_SECONDS * 1000;
}

function isCaseArticleState(value: unknown): value is CaseArticleState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const status = "status" in value ? value.status : null;
  return status === "ready" || status === "empty" || status === "unavailable";
}

async function readCaseArticleSnapshot(pageId: string): Promise<CaseArticleSnapshot | null> {
  try {
    const raw = await readFile(getCaseArticleSnapshotPath(pageId), "utf8");
    const parsed = JSON.parse(raw) as Partial<CaseArticleSnapshot>;

    if (
      parsed.version !== CASE_ARTICLE_SNAPSHOT_VERSION ||
      typeof parsed.savedAt !== "string" ||
      !isCaseArticleState(parsed.state)
    ) {
      return null;
    }

    return {
      savedAt: parsed.savedAt,
      state: parsed.state,
      version: parsed.version,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    return null;
  }
}

async function writeCaseArticleSnapshot(pageId: string, state: CaseArticleState): Promise<void> {
  const snapshotPath = getCaseArticleSnapshotPath(pageId);
  const tempPath = `${snapshotPath}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify(
    {
      savedAt: new Date().toISOString(),
      state,
      version: CASE_ARTICLE_SNAPSHOT_VERSION,
    } satisfies CaseArticleSnapshot,
  );

  await mkdir(CASE_ARTICLE_SNAPSHOT_DIR, { recursive: true });
  await writeFile(tempPath, payload, "utf8");

  try {
    await rename(tempPath, snapshotPath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

async function refreshCaseArticleState(pageId: string): Promise<CaseArticleState> {
  const existingRefresh = caseArticleRefreshLocks.get(pageId);

  if (existingRefresh) {
    return existingRefresh;
  }

  const refreshPromise = (async () => {
    const blocks = await getCaseBlocksByPageId(pageId);
    const state = buildCaseArticleStateFromBlocks(blocks);
    await writeCaseArticleSnapshot(pageId, state);
    return state;
  })();

  caseArticleRefreshLocks.set(pageId, refreshPromise);

  try {
    return await refreshPromise;
  } finally {
    if (caseArticleRefreshLocks.get(pageId) === refreshPromise) {
      caseArticleRefreshLocks.delete(pageId);
    }
  }
}

export async function getCaseArticleState(pageId: string): Promise<CaseArticleState> {
  const snapshot = await readCaseArticleSnapshot(pageId);

  if (snapshot && isCaseArticleSnapshotFresh(snapshot)) {
    return snapshot.state;
  }

  try {
    return await refreshCaseArticleState(pageId);
  } catch (error) {
    if (snapshot) {
      return snapshot.state;
    }

    throw error;
  }
}

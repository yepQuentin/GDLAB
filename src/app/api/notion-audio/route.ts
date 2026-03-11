import { Client } from "@notionhq/client";
import type { BlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";

import {
  extractNotionBlockIdFromUrl,
  normalizeNotionId,
} from "@/lib/notion-image-proxy";
import {
  cacheNotionMedia,
  findCachedNotionMedia,
  parseHttpByteRange,
} from "@/lib/notion-media-cache";

const notionToken = process.env.NOTION_TOKEN;
const notionClient = notionToken ? new Client({ auth: notionToken }) : null;

function parseHttpUrl(value: string | null): URL | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

async function resolveFreshNotionAudioUrl(blockId: string): Promise<string | null> {
  if (!notionClient) {
    return null;
  }

  try {
    const block = await notionClient.blocks.retrieve({ block_id: blockId });

    if (!("type" in block) || block.type !== "audio") {
      return null;
    }

    const audioBlock = block as BlockObjectResponse & { type: "audio" };
    if (audioBlock.audio.type === "external") {
      return audioBlock.audio.external.url;
    }

    return audioBlock.audio.file.url;
  } catch {
    return null;
  }
}

async function fetchAudioFromCandidate(url: string): Promise<Response | null> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
    });

    if (!response.ok) {
      return null;
    }

    return response;
  } catch {
    return null;
  }
}

function createAudioResponse(contentType: string, body: Uint8Array, totalByteLength: number): Response {
  const headers = new Headers();

  headers.set("Content-Type", contentType || "audio/mpeg");
  headers.set("Cache-Control", "public, max-age=43200, stale-while-revalidate=86400");
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", String(totalByteLength));

  return new Response(body as BodyInit, {
    status: 200,
    headers,
  });
}

function createRangedAudioResponse(
  contentType: string,
  body: Buffer,
  totalByteLength: number,
  rangeHeader: string | null,
): Response {
  const parsedRange = parseHttpByteRange(rangeHeader, totalByteLength);
  if (parsedRange.status === "invalid") {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${totalByteLength}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  if (parsedRange.status !== "ok") {
    return createAudioResponse(contentType, body, totalByteLength);
  }

  const slicedBody = body.subarray(parsedRange.start, parsedRange.end + 1);
  const headers = new Headers();
  headers.set("Content-Type", contentType || "audio/mpeg");
  headers.set("Cache-Control", "public, max-age=43200, stale-while-revalidate=86400");
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", String(parsedRange.byteLength));
  headers.set("Content-Range", `bytes ${parsedRange.start}-${parsedRange.end}/${totalByteLength}`);

  return new Response(slicedBody as BodyInit, {
    status: 206,
    headers,
  });
}

async function buildCachedAudioResponse(
  blockId: string | null,
  sourceUrl: string | null,
  rangeHeader: string | null,
): Promise<Response | null> {
  const cached = await findCachedNotionMedia({
    kind: "audio",
    blockId,
    sourceUrl,
  });

  if (!cached) {
    return null;
  }

  const body = await readFile(cached.filePath);
  return createRangedAudioResponse(
    cached.contentType,
    body,
    cached.byteLength || body.length,
    rangeHeader,
  );
}

async function fetchAndCacheAudioResponse(
  sourceUrl: string,
  blockId: string | null,
  rangeHeader: string | null,
): Promise<Response | null> {
  const upstream = await fetchAudioFromCandidate(sourceUrl);
  if (!upstream) {
    return null;
  }

  const body = Buffer.from(await upstream.arrayBuffer());
  const contentType = upstream.headers.get("content-type") ?? "audio/mpeg";

  try {
    await cacheNotionMedia({
      kind: "audio",
      blockId,
      sourceUrl,
      contentType,
      body,
    });
  } catch (error) {
    console.warn(
      `[notion-audio] local cache write skipped for ${blockId ?? "no-block"} ${sourceUrl}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return createRangedAudioResponse(contentType, body, body.length, rangeHeader);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sourceParam = url.searchParams.get("src");
  const sourceUrl = parseHttpUrl(sourceParam);
  const explicitBlockId = normalizeNotionId(url.searchParams.get("blockId"));
  const extractedBlockId = sourceParam ? extractNotionBlockIdFromUrl(sourceParam) : null;
  const blockId = explicitBlockId ?? extractedBlockId;
  const rangeHeader = request.headers.get("range");

  if (!sourceUrl && !blockId) {
    return NextResponse.json({ error: "Invalid audio source." }, { status: 400 });
  }

  const cached = await buildCachedAudioResponse(blockId, sourceUrl?.toString() ?? null, rangeHeader);
  if (cached) {
    return cached;
  }

  const candidates: string[] = [];
  if (blockId) {
    const freshAudioUrl = await resolveFreshNotionAudioUrl(blockId);
    if (freshAudioUrl) {
      candidates.push(freshAudioUrl);
    }
  }
  if (sourceUrl) {
    candidates.push(sourceUrl.toString());
  }

  for (const candidate of candidates) {
    const cachedResponse = await fetchAndCacheAudioResponse(candidate, blockId, rangeHeader);
    if (cachedResponse) {
      return cachedResponse;
    }
  }

  return NextResponse.json({ error: "Audio unavailable." }, { status: 502 });
}

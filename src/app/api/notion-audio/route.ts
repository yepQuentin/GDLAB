import { Client } from "@notionhq/client";
import type { BlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { NextResponse } from "next/server";

import {
  extractNotionBlockIdFromUrl,
  normalizeNotionId,
} from "@/lib/notion-image-proxy";

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

async function fetchAudioFromCandidate(url: string, rangeHeader: string | null): Promise<Response | null> {
  try {
    const headers = new Headers();
    if (rangeHeader) {
      headers.set("Range", rangeHeader);
    }

    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      headers,
    });

    if (!response.ok && response.status !== 206) {
      return null;
    }

    return response;
  } catch {
    return null;
  }
}

function createAudioProxyResponse(upstream: Response): Response {
  const headers = new Headers();

  headers.set("Content-Type", upstream.headers.get("content-type") ?? "audio/mpeg");
  headers.set("Cache-Control", "public, max-age=43200, stale-while-revalidate=86400");
  headers.set("Accept-Ranges", upstream.headers.get("accept-ranges") ?? "bytes");

  const optionalHeaders = [
    "content-length",
    "content-range",
    "etag",
    "last-modified",
  ];

  for (const headerName of optionalHeaders) {
    const value = upstream.headers.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  }

  return new Response(upstream.body, {
    status: upstream.status === 206 ? 206 : 200,
    headers,
  });
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
    const upstream = await fetchAudioFromCandidate(candidate, rangeHeader);
    if (upstream) {
      return createAudioProxyResponse(upstream);
    }

    // Fallback for origins that reject ranged requests.
    if (rangeHeader) {
      const fallbackUpstream = await fetchAudioFromCandidate(candidate, null);
      if (fallbackUpstream) {
        return createAudioProxyResponse(fallbackUpstream);
      }
    }
  }

  return NextResponse.json({ error: "Audio unavailable." }, { status: 502 });
}


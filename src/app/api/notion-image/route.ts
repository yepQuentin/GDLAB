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
} from "@/lib/notion-media-cache";

const notionToken = process.env.NOTION_TOKEN;
const notionClient = notionToken ? new Client({ auth: notionToken }) : null;
const NOTION_IMAGE_UPSTREAM_REVALIDATE_SECONDS = 86400;

function parseHttpUrl(value: string | null): URL | null {
  if (!value) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return null;
  }

  return parsed;
}

async function resolveFreshNotionImageUrl(blockId: string): Promise<string | null> {
  if (!notionClient) {
    return null;
  }

  try {
    const block = await notionClient.blocks.retrieve({ block_id: blockId });

    if (!("type" in block) || block.type !== "image") {
      return null;
    }

    const imageBlock = block as BlockObjectResponse & { type: "image" };

    if (imageBlock.image.type === "external") {
      return imageBlock.image.external.url;
    }

    return imageBlock.image.file.url;
  } catch {
    return null;
  }
}

async function fetchImageResponse(url: string): Promise<Response | null> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      next: { revalidate: NOTION_IMAGE_UPSTREAM_REVALIDATE_SECONDS },
    });

    if (!response.ok) {
      return null;
    }

    return response;
  } catch {
    return null;
  }
}

function buildBufferedImageResponse(contentType: string, body: Buffer): Response {
  const headers = new Headers();
  headers.set("Content-Type", contentType || "image/jpeg");
  headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  headers.set("Content-Length", String(body.length));

  return new Response(body as BodyInit, {
    status: 200,
    headers,
  });
}

async function buildCachedImageResponse(
  blockId: string | null,
  sourceUrl: string | null,
): Promise<Response | null> {
  const cached = await findCachedNotionMedia({
    kind: "image",
    blockId,
    sourceUrl,
  });

  if (!cached) {
    return null;
  }

  const body = await readFile(cached.filePath);
  return buildBufferedImageResponse(cached.contentType, body);
}

async function fetchAndCacheImageResponse(
  sourceUrl: string,
  blockId: string | null,
): Promise<Response | null> {
  const upstream = await fetchImageResponse(sourceUrl);
  if (!upstream) {
    return null;
  }

  const body = Buffer.from(await upstream.arrayBuffer());
  const contentType = upstream.headers.get("content-type") ?? "image/jpeg";

  try {
    await cacheNotionMedia({
      kind: "image",
      blockId,
      sourceUrl,
      contentType,
      body,
    });
  } catch (error) {
    console.warn(
      `[notion-image] local cache write skipped for ${blockId ?? "no-block"} ${sourceUrl}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return buildBufferedImageResponse(contentType, body);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const src = searchParams.get("src");
  const srcUrl = parseHttpUrl(src);
  const explicitBlockId = normalizeNotionId(searchParams.get("blockId"));
  const derivedBlockId = src ? extractNotionBlockIdFromUrl(src) : null;
  const blockId = explicitBlockId ?? derivedBlockId;

  if (!srcUrl && !blockId) {
    return NextResponse.json({ error: "Invalid image source." }, { status: 400 });
  }

  const cached = await buildCachedImageResponse(blockId, srcUrl?.toString() ?? null);
  if (cached) {
    return cached;
  }

  if (srcUrl) {
    const cachedResponse = await fetchAndCacheImageResponse(srcUrl.toString(), blockId);
    if (cachedResponse) {
      return cachedResponse;
    }
  }

  if (blockId) {
    const freshUrl = await resolveFreshNotionImageUrl(blockId);
    if (freshUrl) {
      const cachedResponse = await fetchAndCacheImageResponse(freshUrl, blockId);
      if (cachedResponse) {
        return cachedResponse;
      }
    }
  }

  return NextResponse.json({ error: "Image unavailable." }, { status: 502 });
}

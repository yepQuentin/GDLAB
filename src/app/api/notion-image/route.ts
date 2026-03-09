import { Client } from "@notionhq/client";
import type { BlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { NextResponse } from "next/server";

import {
  extractNotionBlockIdFromUrl,
  normalizeNotionId,
} from "@/lib/notion-image-proxy";

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

function buildProxyResponse(upstream: Response): Response {
  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("content-type") ?? "image/jpeg");
  headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");

  const contentLength = upstream.headers.get("content-length");
  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }

  return new Response(upstream.body, {
    status: 200,
    headers,
  });
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

  if (srcUrl) {
    const upstream = await fetchImageResponse(srcUrl.toString());
    if (upstream) {
      return buildProxyResponse(upstream);
    }
  }

  if (blockId) {
    const freshUrl = await resolveFreshNotionImageUrl(blockId);
    if (freshUrl) {
      const upstream = await fetchImageResponse(freshUrl);
      if (upstream) {
        return buildProxyResponse(upstream);
      }
    }
  }

  return NextResponse.json({ error: "Image unavailable." }, { status: 502 });
}

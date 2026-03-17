import { NextResponse } from "next/server";

import { sanitizeClientId } from "@/lib/comment-moderation";
import { getCommentThread } from "@/lib/comment-store";
import type { CommentContentType } from "@/lib/comment-types";

export const runtime = "nodejs";

function isCommentType(value: string): value is CommentContentType {
  return value === "daily" || value === "insight";
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type")?.trim() || "";
  const slug = searchParams.get("slug")?.trim() || "";
  const clientId = sanitizeClientId(searchParams.get("clientId"));

  if (!isCommentType(type)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid query parameter: type.",
      },
      { status: 400 },
    );
  }

  if (!slug) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid query parameter: slug.",
      },
      { status: 400 },
    );
  }

  try {
    const thread = await getCommentThread({
      type,
      slug,
      ...(clientId ? { viewerClientId: clientId } : {}),
    });

    return NextResponse.json({
      ok: true,
      data: thread,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to read comments.",
      },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";

import { requireCommentAdminAuth } from "@/lib/comment-admin-auth";
import { listCommentsForAdmin } from "@/lib/comment-store";
import type { CommentContentType, CommentStatus } from "@/lib/comment-types";

export const runtime = "nodejs";

function isCommentType(value: string): value is CommentContentType {
  return value === "daily" || value === "insight";
}

function isCommentStatus(value: string): value is CommentStatus {
  return value === "visible" || value === "hidden";
}

export async function GET(request: Request): Promise<Response> {
  const auth = requireCommentAdminAuth(request);
  if (!auth.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: auth.message,
      },
      { status: auth.status },
    );
  }

  const { searchParams } = new URL(request.url);
  const rawType = searchParams.get("type")?.trim() || "";
  const rawStatus = searchParams.get("status")?.trim() || "";
  let type: CommentContentType | undefined;
  let status: CommentStatus | undefined;

  if (rawType) {
    if (!isCommentType(rawType)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid query parameter: type.",
        },
        { status: 400 },
      );
    }
    type = rawType;
  }

  if (rawStatus) {
    if (!isCommentStatus(rawStatus)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid query parameter: status.",
        },
        { status: 400 },
      );
    }
    status = rawStatus;
  }

  try {
    const comments = await listCommentsForAdmin({ type, status });

    return NextResponse.json({
      ok: true,
      data: comments.map((item) => ({
        id: item.id,
        type: item.type,
        slug: item.slug,
        parentId: item.parentId,
        depth: item.depth,
        nickname: item.nickname,
        body: item.body,
        status: item.status,
        needsReview: item.needsReview,
        likes: item.likedClientHashes.length,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to read admin comments.",
      },
      { status: 500 },
    );
  }
}

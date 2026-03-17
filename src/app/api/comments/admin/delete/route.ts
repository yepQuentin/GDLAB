import { NextResponse } from "next/server";

import { requireCommentAdminAuth } from "@/lib/comment-admin-auth";
import { adminDeleteComment } from "@/lib/comment-store";

export const runtime = "nodejs";

interface AdminModerateRequestBody {
  commentId?: string;
}

export async function POST(request: Request): Promise<Response> {
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

  let payload: AdminModerateRequestBody;
  try {
    payload = (await request.json()) as AdminModerateRequestBody;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid JSON body.",
      },
      { status: 400 },
    );
  }

  const commentId = payload.commentId?.trim() || "";
  if (!commentId) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid field: commentId.",
      },
      { status: 400 },
    );
  }

  try {
    await adminDeleteComment({ commentId });
    return NextResponse.json({
      ok: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete comment.";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status },
    );
  }
}

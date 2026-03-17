import { NextResponse } from "next/server";

import { sanitizeClientId } from "@/lib/comment-moderation";
import { deleteOwnComment } from "@/lib/comment-store";

export const runtime = "nodejs";

interface DeleteOwnCommentRequestBody {
  commentId?: string;
  clientId?: string;
}

export async function POST(request: Request): Promise<Response> {
  let payload: DeleteOwnCommentRequestBody;
  try {
    payload = (await request.json()) as DeleteOwnCommentRequestBody;
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
  const clientId = sanitizeClientId(payload.clientId);
  if (!commentId) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid field: commentId.",
      },
      { status: 400 },
    );
  }

  if (!clientId) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid field: clientId.",
      },
      { status: 400 },
    );
  }

  try {
    await deleteOwnComment({
      commentId,
      clientId,
    });

    return NextResponse.json({
      ok: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete comment.";
    const status = message.includes("No permission")
      ? 403
      : message.includes("not found")
        ? 404
        : 400;
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status },
    );
  }
}

import { NextResponse } from "next/server";

import { sanitizeClientId } from "@/lib/comment-moderation";
import { toggleCommentLike } from "@/lib/comment-store";

export const runtime = "nodejs";

interface ToggleLikeRequestBody {
  commentId?: string;
  clientId?: string;
}

export async function POST(request: Request): Promise<Response> {
  let payload: ToggleLikeRequestBody;
  try {
    payload = (await request.json()) as ToggleLikeRequestBody;
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
    const result = await toggleCommentLike({
      commentId,
      clientId,
    });

    return NextResponse.json({
      ok: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to toggle like.";
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

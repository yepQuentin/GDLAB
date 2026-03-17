import { NextResponse } from "next/server";

import {
  checkCommentRateLimit,
  containsSensitiveWord,
  createClientHash,
  sanitizeClientId,
  sanitizeCommentBody,
} from "@/lib/comment-moderation";
import { createComment } from "@/lib/comment-store";
import type { CommentContentType } from "@/lib/comment-types";

export const runtime = "nodejs";

interface CreateCommentRequestBody {
  type?: string;
  slug?: string;
  parentId?: string;
  nickname?: string;
  body?: string;
  clientId?: string;
}

function isCommentType(value: string): value is CommentContentType {
  return value === "daily" || value === "insight";
}

function getRequestIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: Request): Promise<Response> {
  let payload: CreateCommentRequestBody;
  try {
    payload = (await request.json()) as CreateCommentRequestBody;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid JSON body.",
      },
      { status: 400 },
    );
  }

  const type = payload.type?.trim() || "";
  const slug = payload.slug?.trim() || "";
  const body = sanitizeCommentBody(payload.body);
  const clientId = sanitizeClientId(payload.clientId);
  const parentId = typeof payload.parentId === "string" ? payload.parentId.trim() : "";

  if (!isCommentType(type)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid field: type.",
      },
      { status: 400 },
    );
  }

  if (!slug) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid field: slug.",
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

  if (containsSensitiveWord(body)) {
    return NextResponse.json(
      {
        ok: false,
        error: "内容含敏感词，不允许发布。",
      },
      { status: 400 },
    );
  }

  const clientHash = createClientHash(clientId);
  const limitCheck = checkCommentRateLimit({
    ip: getRequestIp(request),
    clientHash,
  });
  if (!limitCheck.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: limitCheck.message,
      },
      { status: 429 },
    );
  }

  try {
    const comment = await createComment({
      type,
      slug,
      body,
      clientId,
      nickname: payload.nickname,
      ...(parentId ? { parentId } : {}),
    });

    return NextResponse.json({
      ok: true,
      data: {
        id: comment.id,
        type: comment.type,
        slug: comment.slug,
        parentId: comment.parentId,
        depth: comment.depth,
        nickname: comment.nickname,
        body: comment.body,
        status: comment.status,
        needsReview: comment.needsReview,
        createdAt: comment.createdAt,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create comment.";
    const status = message.includes("does not exist") ? 404 : 400;
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status },
    );
  }
}

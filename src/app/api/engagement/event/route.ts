import { NextResponse } from "next/server";

import { applyEngagementEvent } from "@/lib/engagement-store";
import type {
  EngagementContentType,
  EngagementErrorResponse,
  EngagementEventRequestBody,
  EngagementEventResponse,
  EngagementEventType,
} from "@/lib/engagement-types";

export const runtime = "nodejs";

function isValidType(value: string): value is EngagementContentType {
  return value === "daily" || value === "insight";
}

function isValidEvent(value: string): value is EngagementEventType {
  return value === "view" || value === "like" || value === "unlike" || value === "share";
}

function sanitizeClientId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const next = value.trim().slice(0, 128);
  return next || undefined;
}

export function parseEventBody(payload: unknown):
  | { ok: true; value: EngagementEventRequestBody }
  | { ok: false; message: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, message: "Invalid request body." };
  }

  const body = payload as Record<string, unknown>;
  const type = typeof body.type === "string" ? body.type.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const event = typeof body.event === "string" ? body.event.trim() : "";
  const clientId = sanitizeClientId(body.clientId);

  if (!isValidType(type)) {
    return { ok: false, message: "Invalid field: type." };
  }

  if (!slug) {
    return { ok: false, message: "Invalid field: slug." };
  }

  if (!isValidEvent(event)) {
    return { ok: false, message: "Invalid field: event." };
  }

  if ((event === "like" || event === "unlike") && !clientId) {
    return { ok: false, message: "Invalid field: clientId is required for like/unlike." };
  }

  return {
    ok: true,
    value: {
      type,
      slug,
      event,
      ...(clientId ? { clientId } : {}),
    },
  };
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    const errorPayload: EngagementErrorResponse = {
      ok: false,
      error: "Invalid JSON body.",
    };
    return NextResponse.json(errorPayload, { status: 400 });
  }

  const parsed = parseEventBody(payload);
  if (!parsed.ok) {
    const errorPayload: EngagementErrorResponse = {
      ok: false,
      error: parsed.message,
    };
    return NextResponse.json(errorPayload, { status: 400 });
  }

  try {
    const result = await applyEngagementEvent(parsed.value);
    const responsePayload: EngagementEventResponse = {
      ok: true,
      data: {
        type: parsed.value.type,
        slug: parsed.value.slug,
        ...result,
      },
    };
    return NextResponse.json(responsePayload);
  } catch {
    const errorPayload: EngagementErrorResponse = {
      ok: false,
      error: "Failed to persist engagement event.",
    };
    return NextResponse.json(errorPayload, { status: 500 });
  }
}

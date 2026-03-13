import { NextResponse } from "next/server";

import { getEngagementStats } from "@/lib/engagement-store";
import type {
  EngagementContentType,
  EngagementErrorResponse,
  EngagementStatsResponse,
} from "@/lib/engagement-types";

export const runtime = "nodejs";

function isValidType(value: string): value is EngagementContentType {
  return value === "daily" || value === "insight";
}

export function parseStatsQuery(request: Request):
  | { ok: true; value: { type: EngagementContentType; slug: string } }
  | { ok: false; message: string } {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type")?.trim() || "";
  const slug = searchParams.get("slug")?.trim() || "";

  if (!isValidType(type)) {
    return { ok: false, message: "Invalid query parameter: type." };
  }

  if (!slug) {
    return { ok: false, message: "Invalid query parameter: slug." };
  }

  return {
    ok: true,
    value: {
      type,
      slug,
    },
  };
}

export async function GET(request: Request): Promise<Response> {
  const parsed = parseStatsQuery(request);
  if (!parsed.ok) {
    const payload: EngagementErrorResponse = {
      ok: false,
      error: parsed.message,
    };
    return NextResponse.json(payload, { status: 400 });
  }

  try {
    const stats = await getEngagementStats(parsed.value);
    const payload: EngagementStatsResponse = {
      ok: true,
      data: {
        ...parsed.value,
        ...stats,
      },
    };

    return NextResponse.json(payload);
  } catch {
    const payload: EngagementErrorResponse = {
      ok: false,
      error: "Failed to read engagement stats.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}

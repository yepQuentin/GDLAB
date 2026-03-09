import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { CACHE_TAG_LIST, REVALIDATE_PATH_TARGETS } from "@/lib/cache-config";

function resolveProvidedSecret(request: Request): string | null {
  const headerSecret = request.headers.get("x-revalidate-secret");
  if (headerSecret) {
    return headerSecret;
  }

  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export async function POST(request: Request) {
  const configuredSecret = process.env.REVALIDATE_SECRET;
  if (!configuredSecret) {
    return NextResponse.json(
      { error: "REVALIDATE_SECRET is not configured." },
      { status: 500 },
    );
  }

  const providedSecret = resolveProvidedSecret(request);
  if (providedSecret !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  for (const tag of CACHE_TAG_LIST) {
    revalidateTag(tag, "max");
  }

  for (const target of REVALIDATE_PATH_TARGETS) {
    if ("type" in target) {
      revalidatePath(target.path, target.type);
      continue;
    }

    revalidatePath(target.path);
  }

  return NextResponse.json({
    ok: true,
    revalidatedPaths: REVALIDATE_PATH_TARGETS.map((target) => target.path),
    revalidatedTags: CACHE_TAG_LIST,
  });
}

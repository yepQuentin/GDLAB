import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CACHE_TAG_LIST, REVALIDATE_PATH_TARGETS } from "@/lib/cache-config";

const revalidatePathMock = vi.fn();
const revalidateTagMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
  revalidateTag: revalidateTagMock,
}));

describe("POST /api/internal/revalidate", () => {
  beforeEach(() => {
    delete process.env.REVALIDATE_SECRET;
  });

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("在未配置 secret 时返回 500", async () => {
    const { POST } = await import("./route");

    const response = await POST(new Request("http://localhost/api/internal/revalidate", { method: "POST" }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "REVALIDATE_SECRET is not configured." });
    expect(revalidateTagMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("在 secret 不匹配时返回 401", async () => {
    process.env.REVALIDATE_SECRET = "expected-secret";
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/internal/revalidate", {
        method: "POST",
        headers: {
          "x-revalidate-secret": "wrong-secret",
        },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Unauthorized." });
    expect(revalidateTagMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("在 secret 正确时触发全部 tag 与 path 刷新", async () => {
    process.env.REVALIDATE_SECRET = "expected-secret";
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/internal/revalidate", {
        method: "POST",
        headers: {
          "x-revalidate-secret": "expected-secret",
        },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);

    expect(revalidateTagMock.mock.calls).toEqual(CACHE_TAG_LIST.map((tag) => [tag, "max"]));

    expect(revalidatePathMock.mock.calls).toEqual(
      REVALIDATE_PATH_TARGETS.map((target) =>
        "type" in target ? [target.path, target.type] : [target.path],
      ),
    );
  });
});

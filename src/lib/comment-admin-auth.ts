export function requireCommentAdminAuth(request: Request): { ok: true } | { ok: false; status: number; message: string } {
  const token = process.env.COMMENT_ADMIN_TOKEN?.trim();
  if (!token) {
    return {
      ok: false,
      status: 503,
      message: "COMMENT_ADMIN_TOKEN is not configured.",
    };
  }

  const header = request.headers.get("x-comment-admin-token")?.trim() || "";
  if (!header || header !== token) {
    return {
      ok: false,
      status: 401,
      message: "Unauthorized.",
    };
  }

  return { ok: true };
}

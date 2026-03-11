const UUID_32_HEX_REGEX = /\b[0-9a-fA-F]{32}\b/g;
const UUID_DASHED_REGEX =
  /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
const MARKDOWN_IMAGE_URL_REGEX =
  /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"([^"]*)")?\)/g;

export function normalizeNotionId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const compact = value.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (compact.length !== 32) {
    return null;
  }

  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(
    16,
    20,
  )}-${compact.slice(20)}`;
}

function collectPathIdCandidates(pathname: string): string[] {
  const dashed = pathname.match(UUID_DASHED_REGEX) ?? [];
  const compact = pathname.match(UUID_32_HEX_REGEX) ?? [];
  return [...dashed, ...compact];
}

export function extractNotionBlockIdFromUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const directCandidates = [
    parsed.searchParams.get("id"),
    parsed.searchParams.get("blockId"),
    parsed.searchParams.get("block_id"),
  ];

  for (const candidate of directCandidates) {
    const normalized = normalizeNotionId(candidate);
    if (normalized) {
      return normalized;
    }
  }

  for (const candidate of collectPathIdCandidates(parsed.pathname)) {
    const normalized = normalizeNotionId(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function buildNotionImageProxyUrl(rawUrl: string, explicitBlockId?: string | null): string {
  if (!/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }

  const parsed = new URL(rawUrl);
  if (parsed.pathname === "/api/notion-image") {
    return rawUrl;
  }

  const query = new URLSearchParams({ src: rawUrl });
  const blockId = normalizeNotionId(explicitBlockId) ?? extractNotionBlockIdFromUrl(rawUrl);

  if (blockId) {
    query.set("blockId", blockId);
  }

  return `/api/notion-image?${query.toString()}`;
}

export function rewriteMarkdownImageUrlsWithProxy(markdown: string): string {
  if (!markdown.trim()) {
    return markdown;
  }

  return markdown.replace(
    MARKDOWN_IMAGE_URL_REGEX,
    (_wholeMatch: string, alt: string, url: string, title?: string) => {
      const proxiedUrl = buildNotionImageProxyUrl(url);
      const titlePart = title ? ` "${title}"` : "";

      return `![${alt}](${proxiedUrl}${titlePart})`;
    },
  );
}

import {
  extractNotionBlockIdFromUrl,
  normalizeNotionId,
} from "@/lib/notion-image-proxy";

const AUDIO_URL_EXT_REGEX = /\.(mp3|m4a|wav|ogg|aac|flac)(\?.*)?$/i;
const MARKDOWN_LINK_URL_REGEX =
  /(!?)\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"([^"]*)")?\)/g;

export function buildNotionAudioProxyUrl(
  rawUrl: string,
  explicitBlockId?: string | null,
): string {
  if (!/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }

  const parsed = new URL(rawUrl);
  if (parsed.pathname === "/api/notion-audio") {
    return rawUrl;
  }

  const query = new URLSearchParams({ src: rawUrl });
  const normalizedBlockId =
    normalizeNotionId(explicitBlockId) ?? extractNotionBlockIdFromUrl(rawUrl);

  if (normalizedBlockId) {
    query.set("blockId", normalizedBlockId);
  }

  return `/api/notion-audio?${query.toString()}`;
}

export function rewriteMarkdownAudioUrlsWithProxy(markdown: string): string {
  if (!markdown.trim()) {
    return markdown;
  }

  return markdown.replace(
    MARKDOWN_LINK_URL_REGEX,
    (_whole: string, imageMark: string, text: string, url: string, title?: string) => {
      if (imageMark === "!") {
        return _whole;
      }

      const decodedUrl = decodeURIComponent(url);
      const isAudioByUrl = AUDIO_URL_EXT_REGEX.test(decodedUrl);
      const isAudioByText = /(podcast|audio|播客|音频)/i.test(text);

      if (!isAudioByUrl && !isAudioByText) {
        return _whole;
      }

      const proxiedUrl = buildNotionAudioProxyUrl(url);
      const titlePart = title ? ` "${title}"` : "";
      return `[${text}](${proxiedUrl}${titlePart})`;
    },
  );
}


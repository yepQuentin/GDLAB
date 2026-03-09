import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReactNode } from "react";

import { PodcastAudioPlayer } from "@/components/podcast-audio-player";

interface MarkdownContentProps {
  markdown: string;
}

interface AudioLinkBlockProps {
  src: string;
  label: string;
}

function AudioLinkBlock({ src, label }: AudioLinkBlockProps) {
  return (
    <div className="audio-link-wrapper">
      <PodcastAudioPlayer src={src} label={label} />
    </div>
  );
}

function flattenText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }

  if (Array.isArray(children)) {
    return children.map(flattenText).join("");
  }

  if (children && typeof children === "object" && "props" in children) {
    const childNode = children as { props?: { children?: ReactNode } };
    return flattenText(childNode.props?.children ?? "");
  }

  return "";
}

function isAudioHref(href: string, label: string): boolean {
  if (/^\/api\/notion-audio\b/i.test(href)) {
    return true;
  }

  if (/\.(mp3|m4a|wav|ogg|aac|flac)(\?.*)?$/i.test(href)) {
    return true;
  }

  if (/[?&]mime=audio%2F/i.test(href) || /[?&]mime=audio\//i.test(href)) {
    return true;
  }

  return /(podcast|audio|播客|音频)/i.test(label);
}

function isPlaceholderSourceHref(href: string): boolean {
  try {
    const parsed = new URL(href);
    return parsed.hostname === "example.com" && /^\/source-[a-z0-9-]+$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function normalizeInlineLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s\u200b-\u200d\ufeff`*_~\[\]()：:]/g, "");
}

function isSourceLinkLabel(label: string): boolean {
  const normalized = normalizeInlineLabel(label);
  return (
    normalized === "原文链接" ||
    normalized === "原文" ||
    normalized === "来源" ||
    normalized === "source" ||
    normalized === "sourcelink" ||
    normalized === "bookmark" ||
    normalized.includes("bookmark")
  );
}

function isSourceLeadText(text: string): boolean {
  return /^(原文链接|来源|source)\s*[：:-]?\s*$/i.test(text.trim().normalize("NFKC"));
}

interface MarkdownAstNode {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownAstNode[];
}

function flattenAstText(nodes: MarkdownAstNode[] = []): string {
  return nodes
    .map((node) => {
      if (node.type === "text" && typeof node.value === "string") {
        return node.value;
      }
      return flattenAstText(node.children);
    })
    .join("");
}

function extractHref(node: MarkdownAstNode): string | null {
  const href = node.properties?.href;
  if (typeof href === "string") {
    return href;
  }
  if (Array.isArray(href) && typeof href[0] === "string") {
    return href[0];
  }
  return null;
}

interface SourceLinkInfo {
  href: string;
  placeholder: boolean;
}

function extractSourceLinkInfo(nodes: MarkdownAstNode[] = []): SourceLinkInfo | null {
  if (nodes.length === 1) {
    const anchorNode = nodes[0];
    const isAnchor = anchorNode.type === "element" && anchorNode.tagName === "a";
    if (!isAnchor) {
      return null;
    }

    const href = extractHref(anchorNode);
    const label = flattenAstText(anchorNode.children).trim();
    if (!href) {
      return null;
    }

    if (isPlaceholderSourceHref(href) || isSourceLinkLabel(label)) {
      return { href, placeholder: isPlaceholderSourceHref(href) };
    }

    return null;
  }

  if (nodes.length === 2) {
    const [leadNode, anchorNode] = nodes;
    const isLeadText = leadNode.type === "text" && typeof leadNode.value === "string";
    const isAnchor = anchorNode.type === "element" && anchorNode.tagName === "a";
    if (!isLeadText || !isAnchor || !isSourceLeadText(leadNode.value ?? "")) {
      return null;
    }

    const href = extractHref(anchorNode);
    if (!href) {
      return null;
    }

    return { href, placeholder: isPlaceholderSourceHref(href) };
  }

  return null;
}

export function MarkdownContent({ markdown }: MarkdownContentProps) {
  if (!markdown.trim()) {
    return <p className="empty-markdown">暂无正文内容</p>;
  }

  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, node, ...props }) => {
            void node;
            const label = flattenText(children).trim() || "今日播客音频";
            const isSourceLink = isSourceLinkLabel(label);
            const displayChildren = isSourceLink ? "原文链接" : children;
            const isExternal = Boolean(href && /^https?:\/\//i.test(href));
            const isPlaceholderSource = Boolean(href && isPlaceholderSourceHref(href));
            const className = isSourceLink ? "source-link" : props.className;

            if (isPlaceholderSource) {
              return <span className="source-link-placeholder">原文链接（待更新）</span>;
            }

            if (isExternal) {
              return (
                <a href={href} target="_blank" rel="noreferrer" {...props} className={className}>
                  {displayChildren}
                </a>
              );
            }

            return (
              <a href={href} {...props} className={className}>
                {displayChildren}
              </a>
            );
          },
          p: ({ children, node, ...props }) => {
            const paragraphNode = node as MarkdownAstNode | undefined;
            const astChildren = (paragraphNode?.children ?? []).filter((child) => {
              return !(child.type === "text" && typeof child.value === "string" && child.value.trim() === "");
            });

            if (astChildren.length === 1) {
              const anchorNode = astChildren[0];
              const isAnchor = anchorNode.type === "element" && anchorNode.tagName === "a";
              if (isAnchor) {
                const href = extractHref(anchorNode);
                const label = flattenAstText(anchorNode.children).trim() || "今日播客音频";
                if (href && isAudioHref(href, label)) {
                  return <AudioLinkBlock src={href} label={label} />;
                }
              }
            }

            const sourceLinkInfo = extractSourceLinkInfo(astChildren);
            if (sourceLinkInfo) {
              if (sourceLinkInfo.placeholder) {
                return (
                  <p className="source-link-row">
                    <span className="source-link-placeholder">原文链接（待更新）</span>
                  </p>
                );
              }

              const isExternal = /^https?:\/\//i.test(sourceLinkInfo.href);
              return (
                <p className="source-link-row">
                  <a
                    href={sourceLinkInfo.href}
                    className="source-link"
                    {...(isExternal ? { target: "_blank", rel: "noreferrer" } : {})}
                  >
                    原文链接
                  </a>
                </p>
              );
            }

            return <p {...props}>{children}</p>;
          },
          img: ({ src, alt, ...props }) => {
            if (!src) {
              return null;
            }

            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={alt ?? ""}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                className="article-image"
                {...props}
              />
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

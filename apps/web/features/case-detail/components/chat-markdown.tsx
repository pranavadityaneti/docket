"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";

/**
 * Compact markdown for chat bubbles. react-markdown never renders raw HTML,
 * so inbound email/WhatsApp bodies cannot inject markup. Links open in a new
 * tab; javascript: and other non-http(s)/mailto schemes are dropped.
 */
function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;
  return undefined;
}

const components: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  p: ({ children }) => <p className="mb-1.5 last:mb-0 leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => {
    const safe = safeHref(href);
    if (!safe) return <span>{children}</span>;
    return (
      <a
        href={safe}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-sky-700 underline underline-offset-2 hover:text-sky-800 dark:text-sky-300 dark:hover:text-sky-200"
      >
        {children}
      </a>
    );
  },
  ul: ({ children }) => (
    <ul className="mb-1.5 list-disc space-y-0.5 pl-4 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-1.5 list-decimal space-y-0.5 pl-4 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mb-1.5 border-l-2 border-border/80 pl-2 text-muted-foreground last:mb-0">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const isBlock = Boolean(className);
    if (isBlock) {
      return (
        <code className="my-1.5 block overflow-x-auto rounded-[6px] bg-background/80 px-2 py-1.5 font-mono text-[12px] leading-snug">
          {children}
        </code>
      );
    }
    return (
      <code className="rounded-[4px] bg-background/80 px-1 py-0.5 font-mono text-[12px]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="mb-1.5 last:mb-0">{children}</pre>,
  h1: ({ children }) => (
    <p className="mb-1.5 text-sm font-semibold last:mb-0">{children}</p>
  ),
  h2: ({ children }) => (
    <p className="mb-1.5 text-sm font-semibold last:mb-0">{children}</p>
  ),
  h3: ({ children }) => (
    <p className="mb-1.5 text-sm font-semibold last:mb-0">{children}</p>
  ),
  hr: () => <hr className="my-2 border-border/70" />,
};

export function ChatMarkdown({ text }: { text: string }) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return (
    <div className="max-h-64 overflow-y-auto break-words text-sm [overflow-wrap:anywhere]">
      <ReactMarkdown components={components}>{trimmed}</ReactMarkdown>
    </div>
  );
}

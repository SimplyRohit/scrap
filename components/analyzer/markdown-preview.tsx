import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A renderer for the subset of Markdown the report generator actually emits:
 * ATX headings, horizontal rules, fenced code, blockquotes, one level of nested
 * bullets, and paragraphs — plus bold, italic, inline code, and links.
 *
 * It is deliberately not a general Markdown parser. The input is produced a few
 * lines away in `report-exporter.tsx`, so the grammar is known and closed.
 */

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "rule" }
  | { kind: "code"; language: string; lines: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "list"; items: { text: string; nested: boolean }[] }
  | { kind: "paragraph"; text: string };

function parse(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const blocks: Block[] = [];

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = line.match(/^```(\w*)\s*$/);

    if (fence) {
      const body: string[] = [];

      i += 1;

      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }

      i += 1; // closing fence
      blocks.push({ kind: "code", language: fence[1], lines: body });
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);

    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2],
      });
      i += 1;
      continue;
    }

    if (/^-{3,}\s*$/.test(line)) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }

    if (line.startsWith(">")) {
      const body: string[] = [];

      while (i < lines.length && lines[i].startsWith(">")) {
        body.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }

      blocks.push({ kind: "quote", lines: body });
      continue;
    }

    if (/^\s*-\s+/.test(line)) {
      const items: { text: string; nested: boolean }[] = [];

      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        const indent = lines[i].length - lines[i].trimStart().length;

        items.push({ text: lines[i].trim().replace(/^-\s+/, ""), nested: indent >= 2 });
        i += 1;
      }

      blocks.push({ kind: "list", items });
      continue;
    }

    const paragraph: string[] = [];

    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3}\s|>|```|-{3,}\s*$|\s*-\s)/.test(lines[i])
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }

    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}

const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*([^*\n]+)\*/g;

/** Only http(s) links are rendered as links; anything else stays as text. */
const isSafe = (href: string) => /^https?:\/\//i.test(href);

function inline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];

  let cursor = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  INLINE.lastIndex = 0;

  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));

    const [, bold, code, linkText, href, italic] = match;

    if (bold !== undefined) {
      nodes.push(
        <strong key={key++} className="font-medium text-foreground">
          {bold}
        </strong>,
      );
    } else if (code !== undefined) {
      nodes.push(
        <code key={key++} className="bg-secondary px-1 py-0.5 font-mono text-[12px]">
          {code}
        </code>,
      );
    } else if (linkText !== undefined) {
      nodes.push(
        isSafe(href) ? (
          <a
            key={key++}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="link-underline text-foreground"
          >
            {linkText}
          </a>
        ) : (
          <span key={key++}>{linkText}</span>
        ),
      );
    } else if (italic !== undefined) {
      nodes.push(
        <em key={key++} className="italic">
          {italic}
        </em>,
      );
    }

    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));

  return nodes;
}

export function MarkdownPreview({
  markdown,
  className,
}: {
  markdown: string;
  className?: string;
}) {
  const blocks = React.useMemo(() => parse(markdown), [markdown]);

  return (
    <div className={cn("px-6 py-6", className)}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "heading": {
      if (block.level === 1) {
        return (
          <h1 className="mb-5 text-[22px] font-medium tracking-[-0.025em]">
            {inline(block.text)}
          </h1>
        );
      }

      if (block.level === 2) {
        return (
          <h2 className="mb-3 mt-8 text-[18px] font-medium tracking-[-0.02em]">
            {inline(block.text)}
          </h2>
        );
      }

      return (
        <h3 className="mb-2 mt-7 text-[15px] font-medium tracking-[-0.015em]">
          {inline(block.text)}
        </h3>
      );
    }

    case "rule":
      return <hr className="my-7 border-t" />;

    case "code":
      return (
        <pre className="my-4 overflow-x-auto border bg-paper px-4 py-3 font-mono text-[12px] leading-relaxed text-muted-foreground">
          <code>{block.lines.join("\n")}</code>
        </pre>
      );

    case "quote":
      return (
        <blockquote className="my-4 border-l-2 border-signal bg-paper px-4 py-3">
          {block.lines.map((line, i) => (
            <p
              key={i}
              className={cn(
                "text-[13.5px] leading-relaxed",
                i === 0 ? "text-foreground" : "mt-1 text-muted-foreground",
              )}
            >
              {inline(line)}
            </p>
          ))}
        </blockquote>
      );

    case "list":
      return (
        <ul className="my-3 space-y-1.5">
          {block.items.map((item, i) => (
            <li
              key={i}
              className={cn(
                "flex gap-2.5 text-[13.5px] leading-relaxed text-muted-foreground",
                item.nested && "ml-5",
              )}
            >
              <span aria-hidden className="mt-px font-mono text-foreground/30">
                /
              </span>
              <span className="min-w-0">{inline(item.text)}</span>
            </li>
          ))}
        </ul>
      );

    case "paragraph":
      return (
        <p className="my-3 text-[13.5px] leading-relaxed text-muted-foreground">
          {inline(block.text)}
        </p>
      );
  }
}

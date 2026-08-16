/**
 * Document normalization (gen.md section 6).
 *
 * "Raw scraped HTML must never be the primary knowledge representation."
 * This module is the boundary: HTML or Markdown in, a structured section tree out.
 * Nothing downstream of here ever sees a tag.
 */

import * as cheerio from 'cheerio';

export interface CodeBlock {
  language?: string;
  code: string;
}

export interface DocumentSection {
  /** Heading text for this section, or '' for the document preamble. */
  heading: string;
  /** Ancestor headings, outermost first — gives claims their context. */
  headingTrail: string[];
  level: number;
  /** Prose with list markers preserved, one claim per line where possible. */
  text: string;
  bullets: string[];
  codeBlocks: CodeBlock[];
  /** URL fragment for citation deep-links. */
  anchor?: string;
}

export interface NormalizedDocument {
  title: string;
  sections: DocumentSection[];
  /** Whole-document plain text, used for lexical search fallbacks. */
  text: string;
}

function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function looksLikeHtml(body: string, contentType?: string): boolean {
  if (contentType?.includes('html')) return true;
  if (contentType?.includes('markdown') || contentType?.includes('plain')) return false;
  return /<(html|body|div|p|h[1-6]|article)\b/i.test(body.slice(0, 2000));
}

/** Strips chrome that carries no knowledge and pollutes extraction. */
const NOISE_SELECTORS = 'script, style, nav, header, footer, aside, noscript, svg, form, iframe, .sidebar, .toc, [role="navigation"]';

function htmlToMarkdown(html: string): { title: string; markdown: string } {
  const $ = cheerio.load(html);
  $(NOISE_SELECTORS).remove();

  const title = $('h1').first().text().trim() || $('title').text().trim();

  // Prefer the main content region; documentation sites bury prose in wrappers.
  const root = $('main').first().length
    ? $('main').first()
    : $('article').first().length
      ? $('article').first()
      : $('body');

  const lines: string[] = [];

  root.find('h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, td').each((_, element) => {
    const node = $(element);
    const tag = (element as { tagName?: string }).tagName?.toLowerCase() ?? '';

    if (/^h[1-6]$/.test(tag)) {
      const text = node.text().trim();
      if (text) lines.push(`\n${'#'.repeat(Number(tag[1]))} ${text}`);
      return;
    }

    if (tag === 'pre') {
      const code = node.text().replace(/\n+$/, '');
      const language = node.find('code').attr('class')?.match(/language-([\w+-]+)/)?.[1];
      if (code.trim()) lines.push(`\n\`\`\`${language ?? ''}\n${code}\n\`\`\``);
      return;
    }

    // Skip list items whose text is only a link — navigation, not content.
    if (tag === 'li' && node.children('a').length === 1 && node.text().trim() === node.children('a').text().trim()) {
      return;
    }

    const text = node.text().replace(/\s+/g, ' ').trim();
    if (!text) return;
    lines.push(tag === 'li' ? `- ${text}` : text);
  });

  return { title, markdown: lines.join('\n') };
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FENCE_RE = /^```([\w+-]*)\s*$/;
const BULLET_RE = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/;

export function parseMarkdown(markdown: string, fallbackTitle = ''): NormalizedDocument {
  // GitHub release bodies are CRLF. A trailing \r defeats every `$`-anchored
  // pattern below, because `.` does not match a carriage return.
  const normalized = markdown.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const sections: DocumentSection[] = [];
  const trail: Array<{ level: number; heading: string }> = [];

  let current: DocumentSection = {
    heading: '',
    headingTrail: [],
    level: 0,
    text: '',
    bullets: [],
    codeBlocks: [],
  };
  const buffer: string[] = [];

  const flush = () => {
    current.text = buffer.join('\n').trim();
    if (current.text || current.codeBlocks.length > 0) sections.push(current);
    buffer.length = 0;
  };

  let inFence = false;
  let fenceLanguage: string | undefined;
  let fenceLines: string[] = [];

  for (const line of lines) {
    const fence = FENCE_RE.exec(line.trim());
    if (fence) {
      if (inFence) {
        current.codeBlocks.push({ language: fenceLanguage, code: fenceLines.join('\n') });
        inFence = false;
        fenceLines = [];
      } else {
        inFence = true;
        fenceLanguage = fence[1] || undefined;
      }
      continue;
    }

    if (inFence) {
      fenceLines.push(line);
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      const text = heading[2].trim();

      while (trail.length > 0 && trail[trail.length - 1].level >= level) trail.pop();

      current = {
        heading: text,
        headingTrail: trail.map((entry) => entry.heading),
        level,
        text: '',
        bullets: [],
        codeBlocks: [],
        anchor: slugify(text),
      };
      trail.push({ level, heading: text });
      continue;
    }

    buffer.push(line);

    const bullet = BULLET_RE.exec(line);
    if (bullet && bullet[1].trim()) current.bullets.push(bullet[1].trim());
  }

  if (inFence && fenceLines.length > 0) {
    current.codeBlocks.push({ language: fenceLanguage, code: fenceLines.join('\n') });
  }
  flush();

  const title = sections.find((section) => section.level === 1)?.heading || fallbackTitle;

  return {
    title,
    sections,
    text: normalized,
  };
}

export function normalizeDocument(body: string, contentType?: string, fallbackTitle = ''): NormalizedDocument {
  if (looksLikeHtml(body, contentType)) {
    const { title, markdown } = htmlToMarkdown(body);
    const parsed = parseMarkdown(markdown, title || fallbackTitle);
    return { ...parsed, title: parsed.title || title || fallbackTitle };
  }
  return parseMarkdown(body, fallbackTitle);
}

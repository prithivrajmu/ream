import { type ReactNode, useMemo } from "react";

export type RichNoteInline =
  | { type: "text"; text: string }
  | { type: "link"; href: string; content: RichNoteInline[] }
  | { type: "image"; src: string; alt: string }
  | { type: "strong"; content: RichNoteInline[] }
  | { type: "emphasis"; content: RichNoteInline[] }
  | { type: "strike"; content: RichNoteInline[] }
  | { type: "inlineCode"; code: string };

export type RichNoteBlock =
  | { type: "paragraph"; content: RichNoteInline[] }
  | { type: "heading"; level: number; content: RichNoteInline[] }
  | { type: "blockquote"; blocks: RichNoteBlock[] }
  | { type: "code"; language: string; code: string }
  | { type: "list"; ordered: boolean; items: RichNoteListItem[] }
  | { type: "table"; headers: RichNoteInline[][]; rows: RichNoteInline[][][] }
  | { type: "rule" }
  | { type: "video"; src: string }
  | { type: "embed"; provider: "youtube" | "vimeo"; src: string; href: string; title: string }
  | { type: "linkPreview"; href: string; label: string };

export interface RichNoteListItem {
  content: RichNoteInline[];
  children: RichNoteBlock[];
  checked?: boolean;
}

const URL_PATTERN = /https?:\/\/[^\s<>"')]+/g;
const VIDEO_URL_PATTERN = /^https?:\/\/\S+\.(?:mp4|webm|ogg)(?:[?#]\S*)?$/i;
const LIST_ITEM_PATTERN = /^(\s*)([-*+]|\d+\.)\s+(.+)$/;
const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;
const RULE_PATTERN = /^(?:-{3,}|\*{3,}|_{3,})$/;
const TABLE_SEPARATOR_PATTERN = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

export function parseRichNote(text: string): RichNoteBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: RichNoteBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ type: "code", language, code: codeLines.join("\n") });
      continue;
    }

    const headingMatch = HEADING_PATTERN.exec(trimmed);
    if (headingMatch) {
      blocks.push({ type: "heading", level: headingMatch[1].length, content: parseInline(headingMatch[2]) });
      index += 1;
      continue;
    }

    if (RULE_PATTERN.test(trimmed)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && (lines[index] ?? "").trim().startsWith(">")) {
        quoteLines.push((lines[index] ?? "").replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", blocks: parseRichNote(quoteLines.join("\n")) });
      continue;
    }

    if (isTableStart(lines, index)) {
      const parsed = parseTable(lines, index);
      blocks.push(parsed.block);
      index = parsed.nextIndex;
      continue;
    }

    if (LIST_ITEM_PATTERN.test(line)) {
      const parsed = parseList(lines, index, getListIndent(line));
      blocks.push(parsed.block);
      index = parsed.nextIndex;
      continue;
    }

    const videoBlock = parseVideoBlock(trimmed);
    if (videoBlock) {
      blocks.push(videoBlock);
      index += 1;
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length) {
      const nextLine = lines[index] ?? "";
      const nextTrimmed = nextLine.trim();
      if (!nextTrimmed || nextTrimmed.startsWith("```") || LIST_ITEM_PATTERN.test(nextLine) || HEADING_PATTERN.test(nextTrimmed) || RULE_PATTERN.test(nextTrimmed) || nextTrimmed.startsWith(">") || isTableStart(lines, index) || parseVideoBlock(nextTrimmed)) {
        break;
      }
      paragraphLines.push(nextLine);
      index += 1;
    }
    blocks.push({ type: "paragraph", content: parseInline(paragraphLines.join("\n")) });
  }

  return blocks;
}

export function noteMatchesQuery(text: string, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  return text.toLocaleLowerCase().includes(normalizedQuery);
}

export function RichNoteView({ text, className = "rich-note" }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseRichNote(text), [text]);
  if (!blocks.length) {
    return null;
  }

  return <div className={className}>{blocks.map((block, index) => renderBlock(block, `block-${index}`))}</div>;
}

function parseInline(text: string): RichNoteInline[] {
  const output: RichNoteInline[] = [];
  let index = 0;

  while (index < text.length) {
    const codeEnd = text[index] === "`" ? text.indexOf("`", index + 1) : -1;
    if (codeEnd > index) {
      output.push({ type: "inlineCode", code: text.slice(index + 1, codeEnd) });
      index = codeEnd + 1;
      continue;
    }

    const imageMatch = text.slice(index).match(/^!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/);
    if (imageMatch) {
      output.push({ type: "image", alt: imageMatch[1], src: imageMatch[2] });
      index += imageMatch[0].length;
      continue;
    }

    const linkMatch = text.slice(index).match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/);
    if (linkMatch) {
      output.push({ type: "link", href: linkMatch[2], content: parseInline(linkMatch[1]) });
      index += linkMatch[0].length;
      continue;
    }

    const strongEnd = text.startsWith("**", index) ? text.indexOf("**", index + 2) : text.startsWith("__", index) ? text.indexOf("__", index + 2) : -1;
    if (strongEnd > index) {
      output.push({ type: "strong", content: parseInline(text.slice(index + 2, strongEnd)) });
      index = strongEnd + 2;
      continue;
    }

    const strikeEnd = text.startsWith("~~", index) ? text.indexOf("~~", index + 2) : -1;
    if (strikeEnd > index) {
      output.push({ type: "strike", content: parseInline(text.slice(index + 2, strikeEnd)) });
      index = strikeEnd + 2;
      continue;
    }

    const emphasisEnd = text[index] === "*" ? text.indexOf("*", index + 1) : text[index] === "_" ? text.indexOf("_", index + 1) : -1;
    if (emphasisEnd > index) {
      output.push({ type: "emphasis", content: parseInline(text.slice(index + 1, emphasisEnd)) });
      index = emphasisEnd + 1;
      continue;
    }

    URL_PATTERN.lastIndex = index;
    const urlMatch = URL_PATTERN.exec(text);
    if (urlMatch?.index === index) {
      output.push({ type: "link", href: urlMatch[0], content: [{ type: "text", text: urlMatch[0] }] });
      index += urlMatch[0].length;
      continue;
    }

    const nextSpecial = findNextInlineSpecial(text, index + 1);
    output.push({ type: "text", text: text.slice(index, nextSpecial) });
    index = nextSpecial;
  }

  return output.length ? output : [{ type: "text", text }];
}

function parseList(lines: string[], startIndex: number, indent: number): { block: RichNoteBlock; nextIndex: number } {
  const firstMatch = LIST_ITEM_PATTERN.exec(lines[startIndex] ?? "");
  const ordered = Boolean(firstMatch?.[2]?.endsWith("."));
  const items: RichNoteListItem[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const match = LIST_ITEM_PATTERN.exec(line);
    if (!match) {
      break;
    }

    const currentIndent = match[1].length;
    if (currentIndent < indent) {
      break;
    }

    if (currentIndent > indent) {
      const parent = items[items.length - 1];
      if (!parent) {
        break;
      }
      const child = parseList(lines, index, currentIndent);
      parent.children.push(child.block);
      index = child.nextIndex;
      continue;
    }

    const taskMatch = /^\[([ xX])\]\s+(.+)$/.exec(match[3]);
    items.push({
      checked: taskMatch ? taskMatch[1].toLocaleLowerCase() === "x" : undefined,
      content: parseInline(taskMatch ? taskMatch[2] : match[3]),
      children: []
    });
    index += 1;

    while (index < lines.length) {
      const nextLine = lines[index] ?? "";
      const nextMatch = LIST_ITEM_PATTERN.exec(nextLine);
      if (!nextMatch || nextMatch[1].length <= indent) {
        break;
      }
      const child = parseList(lines, index, nextMatch[1].length);
      items[items.length - 1]?.children.push(child.block);
      index = child.nextIndex;
    }
  }

  return { block: { type: "list", ordered, items }, nextIndex: index };
}

function parseTable(lines: string[], startIndex: number): { block: RichNoteBlock; nextIndex: number } {
  const headers = splitTableRow(lines[startIndex] ?? "").map(parseInline);
  const rows: RichNoteInline[][][] = [];
  let index = startIndex + 2;

  while (index < lines.length && (lines[index] ?? "").includes("|") && (lines[index] ?? "").trim()) {
    rows.push(splitTableRow(lines[index] ?? "").map(parseInline));
    index += 1;
  }

  return { block: { type: "table", headers, rows }, nextIndex: index };
}

function parseVideoBlock(value: string): RichNoteBlock | null {
  if (VIDEO_URL_PATTERN.test(value)) {
    return { type: "video", src: value };
  }

  const youtubeId = getYoutubeId(value);
  if (youtubeId) {
    return {
      type: "embed",
      provider: "youtube",
      src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}`,
      href: value,
      title: "YouTube video"
    };
  }

  const vimeoId = getVimeoId(value);
  if (vimeoId) {
    return {
      type: "embed",
      provider: "vimeo",
      src: `https://player.vimeo.com/video/${encodeURIComponent(vimeoId)}`,
      href: value,
      title: "Vimeo video"
    };
  }

  return null;
}

function isTableStart(lines: string[], index: number): boolean {
  return Boolean((lines[index] ?? "").includes("|") && TABLE_SEPARATOR_PATTERN.test(lines[index + 1] ?? ""));
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function getListIndent(line: string): number {
  return LIST_ITEM_PATTERN.exec(line)?.[1].length ?? 0;
}

function getYoutubeId(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") {
      return url.pathname.slice(1).split("/")[0] || null;
    }
    if (url.hostname.endsWith("youtube.com")) {
      if (url.pathname.startsWith("/embed/")) {
        return url.pathname.split("/")[2] || null;
      }
      return url.searchParams.get("v");
    }
  } catch {
    return null;
  }
  return null;
}

function getVimeoId(value: string): string | null {
  try {
    const url = new URL(value);
    if (!url.hostname.endsWith("vimeo.com")) {
      return null;
    }
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && /^\d+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function findNextInlineSpecial(text: string, startIndex: number): number {
  const candidates = ["`", "![", "[", "**", "__", "~~", "*", "_", "http://", "https://"]
    .map((token) => text.indexOf(token, startIndex))
    .filter((candidate) => candidate >= 0);
  return candidates.length ? Math.min(...candidates) : text.length;
}

function renderBlock(block: RichNoteBlock, key: string): ReactNode {
  if (block.type === "paragraph") {
    return <p key={key}>{renderInline(block.content)}</p>;
  }

  if (block.type === "heading") {
    const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    return <Tag key={key}>{renderInline(block.content)}</Tag>;
  }

  if (block.type === "blockquote") {
    return <blockquote key={key}>{block.blocks.map((child, index) => renderBlock(child, `${key}-quote-${index}`))}</blockquote>;
  }

  if (block.type === "code") {
    return <pre key={key}><code>{block.code}</code></pre>;
  }

  if (block.type === "rule") {
    return <hr key={key} />;
  }

  if (block.type === "video") {
    return <video controls key={key} src={block.src} />;
  }

  if (block.type === "embed") {
    return <div className="rich-note-embed" key={key}><iframe allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen src={block.src} title={block.title} /><a href={block.href} rel="noreferrer" target="_blank">Open {block.title}</a></div>;
  }

  if (block.type === "linkPreview") {
    return <a className="rich-note-video-link" href={block.href} key={key} rel="noreferrer" target="_blank">{block.label}: {block.href}</a>;
  }

  if (block.type === "table") {
    return <div className="rich-note-table-wrap" key={key}><table><thead><tr>{block.headers.map((header, index) => <th key={`${key}-head-${index}`}>{renderInline(header)}</th>)}</tr></thead><tbody>{block.rows.map((row, rowIndex) => <tr key={`${key}-row-${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`${key}-cell-${rowIndex}-${cellIndex}`}>{renderInline(cell)}</td>)}</tr>)}</tbody></table></div>;
  }

  const Tag = block.ordered ? "ol" : "ul";
  return (
    <Tag key={key}>
      {block.items.map((item, index) => (
        <li className={item.checked !== undefined ? "rich-note-task-item" : undefined} key={`${key}-item-${index}`}>
          {item.checked !== undefined ? <input checked={item.checked} readOnly type="checkbox" /> : null}
          <span>{renderInline(item.content)}</span>
          {item.children.map((child, childIndex) => renderBlock(child, `${key}-child-${index}-${childIndex}`))}
        </li>
      ))}
    </Tag>
  );
}

function renderInline(content: RichNoteInline[]): ReactNode {
  return content.map((part, index) => {
    if (part.type === "link") {
      return <a href={part.href} key={`${part.href}-${index}`} rel="noreferrer" target="_blank">{renderInline(part.content)}</a>;
    }
    if (part.type === "image") {
      return <img alt={part.alt} key={`${part.src}-${index}`} src={part.src} />;
    }
    if (part.type === "strong") {
      return <strong key={`strong-${index}`}>{renderInline(part.content)}</strong>;
    }
    if (part.type === "emphasis") {
      return <em key={`em-${index}`}>{renderInline(part.content)}</em>;
    }
    if (part.type === "strike") {
      return <s key={`strike-${index}`}>{renderInline(part.content)}</s>;
    }
    if (part.type === "inlineCode") {
      return <code key={`code-${index}`}>{part.code}</code>;
    }
    return <span key={`${part.text}-${index}`}>{part.text}</span>;
  });
}

import { checkUrl, type UrlVerdict } from "./urls.js";
import { revealHidden } from "./unicode.js";

/**
 * A strict Markdown subset, parsed into a safe AST — never an HTML string.
 *
 * `dangerouslySetInnerHTML` is a lint ERROR everywhere in this repo (see
 * `eslint.config.js`, invariant 10: all user content is hostile). That rule
 * exists because there is no correct case in this product for turning
 * contributor-written text into markup and injecting it as such. Returning an
 * `MdNode[]` instead of a string is what makes that rule impossible to route
 * around: a React renderer that walks this tree and emits `<p>{...}</p>` per
 * node is passing data to React's own escaping, the same as printing any other
 * string. There is no HTML for an attacker's payload to *become* at any point
 * in the pipeline, because none is ever produced.
 *
 * The node set below is exhaustive on purpose. No images (an `<img>` is a
 * request to a third party the moment it renders, with no confirmation step),
 * no tables, no raw HTML passthrough, and no autolinking of non-http schemes.
 * Anything not in this union is not Markdown here — it renders as the literal
 * text the contributor typed.
 */

export type MdNode =
  | { type: "paragraph"; children: MdNode[] }
  | { type: "heading"; level: 2 | 3 | 4; children: MdNode[] }
  | { type: "code_block"; language: string | null; code: string }
  | { type: "inline_code"; code: string }
  | { type: "list"; ordered: boolean; items: MdNode[] }
  | { type: "list_item"; children: MdNode[] }
  | { type: "link"; href: string; verdict: UrlVerdict; children: MdNode[] }
  | { type: "text"; value: string }
  | { type: "strong"; children: MdNode[] }
  | { type: "em"; children: MdNode[] }
  | { type: "blockquote"; children: MdNode[] };

const BLANK_RE = /^\s*$/;
const FENCE_OPEN_RE = /^```\s*([A-Za-z0-9_+-]*)\s*$/;
const FENCE_CLOSE_RE = /^```\s*$/;
// h1 belongs to the page, not to submitted content, so only levels 2-4 are
// recognised; a single leading "#" simply falls through and is treated as
// paragraph text, exactly as the contributor typed it.
const HEADING_RE = /^(#{2,4})\s+(.*)$/;
const BLOCKQUOTE_RE = /^>\s?(.*)$/;
const UL_ITEM_RE = /^\s*[-*+]\s+(.*)$/;
const OL_ITEM_RE = /^\s*\d+[.)]\s+(.*)$/;

/**
 * Parse a strict Markdown subset into a safe AST.
 *
 * Two passes over untrusted content happen unconditionally, before any
 * Markdown structure is even looked at:
 *
 * 1. Hidden Unicode (bidi controls, zero-width characters, the Tag block — see
 *    `unicode.ts`, R-14) is *revealed*, not stripped. R-14 explicitly requires
 *    rendering these visibly rather than silently discarding them, and reveal
 *    is also the only choice that is safe by construction: a stripped bidi
 *    override is gone, but a revealed one is inert ASCII (`<U+202E>`) sitting
 *    in the text, which can no longer reorder anything.
 * 2. Every link href is run through `checkUrl` (`urls.ts`). An unsafe link
 *    never becomes a `link` node — see `buildLinkOrFallback` below.
 */
export function parseMarkdown(input: string): MdNode[] {
  const revealed = revealHidden(input);
  return parseBlocks(revealed.split(/\r\n|\r|\n/));
}

function parseBlocks(lines: string[]): MdNode[] {
  const nodes: MdNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (BLANK_RE.test(line)) {
      i++;
      continue;
    }

    const fenceMatch = FENCE_OPEN_RE.exec(line);
    if (fenceMatch) {
      const languageToken = fenceMatch[1] ?? "";
      const language = languageToken.length > 0 ? languageToken : null;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !FENCE_CLOSE_RE.test(lines[i] ?? "")) {
        codeLines.push(lines[i] ?? "");
        i++;
      }
      i++; // consume the closing fence, or step past the end if it was never closed
      nodes.push({ type: "code_block", language, code: codeLines.join("\n") });
      continue;
    }

    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      const hashes = headingMatch[1] ?? "";
      // HEADING_RE bounds the run of "#" to 2-4, so this narrowing is safe.
      const level = hashes.length as 2 | 3 | 4;
      nodes.push({ type: "heading", level, children: parseInline(headingMatch[2] ?? "") });
      i++;
      continue;
    }

    if (BLOCKQUOTE_RE.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length) {
        const quoteMatch = BLOCKQUOTE_RE.exec(lines[i] ?? "");
        if (!quoteMatch) break;
        quoteLines.push(quoteMatch[1] ?? "");
        i++;
      }
      nodes.push({ type: "blockquote", children: parseBlocks(quoteLines) });
      continue;
    }

    const isOrderedItem = OL_ITEM_RE.test(line);
    const isUnorderedItem = !isOrderedItem && UL_ITEM_RE.test(line);
    if (isOrderedItem || isUnorderedItem) {
      const ordered = isOrderedItem;
      const itemRe = ordered ? OL_ITEM_RE : UL_ITEM_RE;
      const items: MdNode[] = [];
      // Deliberately flat: no nested lists, no multi-line item bodies. Each
      // matching line becomes exactly one list_item, parsed for inline
      // formatting only — a documented simplification of this strict subset.
      while (i < lines.length) {
        const itemMatch = itemRe.exec(lines[i] ?? "");
        if (!itemMatch) break;
        items.push({ type: "list_item", children: parseInline(itemMatch[1] ?? "") });
        i++;
      }
      nodes.push({ type: "list", ordered, items });
      continue;
    }

    // Paragraph: consume consecutive lines until a blank line or the start of
    // another block construct, then inline-parse the joined text.
    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const candidate = lines[i] ?? "";
      if (
        BLANK_RE.test(candidate) ||
        FENCE_OPEN_RE.test(candidate) ||
        HEADING_RE.test(candidate) ||
        BLOCKQUOTE_RE.test(candidate) ||
        UL_ITEM_RE.test(candidate) ||
        OL_ITEM_RE.test(candidate)
      ) {
        break;
      }
      paragraphLines.push(candidate);
      i++;
    }
    nodes.push({ type: "paragraph", children: parseInline(paragraphLines.join(" ")) });
  }

  return nodes;
}

// Priority, left to right: inline code binds tightest and its contents are
// never re-parsed; then an explicit link; then strong; then emphasis. Nesting
// beyond one level (formatting inside link text, emphasis inside strong, …)
// is not supported — `parseLeaf` below only recognises inline code inside
// those — which is a documented limitation of this strict subset, not an
// oversight: it keeps the grammar unambiguous enough to hand-roll safely.
// The href group excludes ")" and does not balance nested parentheses, so a
// literal, unescaped ")" inside a URL (e.g. a Wikipedia-style
// "…/Bash_(Unix_shell)" link) truncates the match early; the remainder is left
// as ordinary trailing text rather than folded into the href. Nothing is lost
// — the full original text still appears, just split across two text nodes —
// but such a link will not render as clickable. A contributor can work around
// it by percent-encoding the parenthesis.
const INLINE_SOURCE =
  "`([^`]+)`" + // 1: inline code
  "|\\[([^\\]]*)\\]\\(([^)\\s]+)\\)" + // 2: link text, 3: href
  "|\\*\\*([^*]+)\\*\\*" + // 4: **strong**
  "|__([^_]+)__" + // 5: __strong__
  "|\\*([^*]+)\\*" + // 6: *em*
  "|_([^_]+)_"; // 7: _em_

function parseInline(text: string): MdNode[] {
  const nodes: MdNode[] = [];
  const re = new RegExp(INLINE_SOURCE, "g");
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }

    const [, code, linkText, linkHref, strongA, strongB, emA, emB] = match;

    if (code !== undefined) {
      nodes.push({ type: "inline_code", code });
    } else if (linkHref !== undefined) {
      nodes.push(...buildLinkOrFallback(linkText ?? "", linkHref));
    } else if (strongA !== undefined || strongB !== undefined) {
      nodes.push({ type: "strong", children: parseLeaf(strongA ?? strongB ?? "") });
    } else if (emA !== undefined || emB !== undefined) {
      nodes.push({ type: "em", children: parseLeaf(emA ?? emB ?? "") });
    }

    lastIndex = re.lastIndex;
    if (match[0].length === 0) re.lastIndex += 1; // guard against zero-width matches
  }

  if (lastIndex < text.length) {
    nodes.push({ type: "text", value: text.slice(lastIndex) });
  }

  return nodes;
}

/** Inline content one level down (link text, strong/em bodies): plain text
 *  plus inline code, nothing else. See the note above `INLINE_SOURCE`. */
function parseLeaf(text: string): MdNode[] {
  const nodes: MdNode[] = [];
  const codeRe = /`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeRe.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push({ type: "text", value: text.slice(lastIndex, match.index) });
    nodes.push({ type: "inline_code", code: match[1] ?? "" });
    lastIndex = codeRe.lastIndex;
  }

  if (lastIndex < text.length) nodes.push({ type: "text", value: text.slice(lastIndex) });

  return nodes;
}

/**
 * Turn a parsed `[text](href)` into either a `link` node or, when `checkUrl`
 * rejects the href, plain text.
 *
 * An unsafe link is never silently deleted: the visible text is kept and the
 * raw href is appended in parentheses, so a reader sees exactly what was
 * submitted and can judge it themselves — the only thing removed is the
 * ability to click it.
 */
function buildLinkOrFallback(linkText: string, href: string): MdNode[] {
  const verdict = checkUrl(href);
  if (!verdict.safe) {
    return [{ type: "text", value: `${linkText} (${href})` }];
  }
  return [{ type: "link", href: verdict.normalised ?? href, verdict, children: parseLeaf(linkText) }];
}

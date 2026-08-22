/**
 * Hidden-Unicode detection and neutralisation. R-14.
 *
 * "Trojan Source" (Boucher & Anderson, Cambridge 2021) showed that bidirectional
 * control characters can make source code *read* one way to a human and *execute*
 * another. The same trick, and its quieter cousins — zero-width joiners, the soft
 * hyphen, a byte-order mark stitched into the middle of a word, the Unicode Tag
 * block — work just as well against a diagnostic playbook as against a compiler:
 * a reordered `rm -rf ${SAFE_DIR}` can be made to read safe while running
 * something else, and a run of invisible tag characters can carry an instruction
 * a careless reviewer (human or model) never sees.
 *
 * Every submission that reaches the renderer passes through here first.
 */

/**
 * Explicit bidirectional control characters (Unicode Bidi Algorithm, UAX #9).
 *
 * These override how neighbouring text is *displayed* without touching its
 * underlying bytes — the entire premise of the Trojan Source attack.
 */
export const BIDI_CONTROLS = [
  0x202a, // LEFT-TO-RIGHT EMBEDDING (LRE)
  0x202b, // RIGHT-TO-LEFT EMBEDDING (RLE)
  0x202c, // POP DIRECTIONAL FORMATTING (PDF)
  0x202d, // LEFT-TO-RIGHT OVERRIDE (LRO)
  0x202e, // RIGHT-TO-LEFT OVERRIDE (RLO)
  0x2066, // LEFT-TO-RIGHT ISOLATE (LRI)
  0x2067, // RIGHT-TO-LEFT ISOLATE (RLI)
  0x2068, // FIRST STRONG ISOLATE (FSI)
  0x2069, // POP DIRECTIONAL ISOLATE (PDI)
] as const;

/**
 * Zero-width and other invisible-by-design characters.
 *
 * U+00AD (soft hyphen) is not technically "zero width" — it is a formatting hint
 * that is invisible unless a line breaks there — but it renders as nothing in
 * every context that matters here, so it is grouped with the rest for scanning
 * purposes.
 */
export const ZERO_WIDTH = [
  0x200b, // ZERO WIDTH SPACE (ZWSP)
  0x200c, // ZERO WIDTH NON-JOINER (ZWNJ)
  0x200d, // ZERO WIDTH JOINER (ZWJ)
  0xfeff, // ZERO WIDTH NO-BREAK SPACE / BYTE ORDER MARK (BOM)
  0x00ad, // SOFT HYPHEN (SHY)
] as const;

/** The Unicode Tag block: U+E0000 (LANGUAGE TAG, deprecated) through U+E007F
 *  (CANCEL TAG). Every codepoint in the block is invisible in normal rendering.
 *  It was designed for language tagging inside emoji flag sequences and has since
 *  been repurposed to smuggle plain-text instructions past both human reviewers
 *  and language models reading the same text — the block renders as nothing, but
 *  the codepoints round-trip through copy, paste and most text pipelines intact. */
const TAG_BLOCK_START = 0xe0000;
const TAG_BLOCK_END = 0xe007f;

export type UnicodeFindingKind = "bidi_control" | "zero_width" | "confusable" | "invisible" | "unassigned_tag";

export interface UnicodeFinding {
  kind: UnicodeFindingKind;
  codepoint: number;
  /** UTF-16 code unit offset into the original string — usable directly with
   *  `String.prototype.slice`. */
  offset: number;
  description: string;
}

const BIDI_SET = new Set<number>(BIDI_CONTROLS);
const ZERO_WIDTH_SET = new Set<number>(ZERO_WIDTH);

function isTagBlock(codepoint: number): boolean {
  return codepoint >= TAG_BLOCK_START && codepoint <= TAG_BLOCK_END;
}

function isHiddenCodepoint(codepoint: number): boolean {
  return BIDI_SET.has(codepoint) || ZERO_WIDTH_SET.has(codepoint) || isTagBlock(codepoint);
}

function hex(codepoint: number): string {
  return codepoint.toString(16).toUpperCase().padStart(4, "0");
}

interface CodePointEntry {
  codepoint: number;
  offset: number;
  length: number;
}

/** Walks a string one Unicode codepoint at a time, tracking the UTF-16 offset of
 *  each one so callers can slice the original string without re-deriving it. Plain
 *  `for...of` over a string already does codepoint iteration, but it discards the
 *  offset, which every function below needs. */
function* codePoints(input: string): Generator<CodePointEntry> {
  let i = 0;
  while (i < input.length) {
    const codepoint = input.codePointAt(i);
    if (codepoint === undefined) break; // unreachable: i < input.length guarantees a code unit
    const length = codepoint > 0xffff ? 2 : 1;
    yield { codepoint, offset: i, length };
    i += length;
  }
}

/**
 * Find every bidi control, zero-width character and Tag-block codepoint in the
 * input, in order of appearance.
 *
 * Confusable-script mixing is reported separately by `hasHomoglyphRisk`: it is a
 * property of a whole token, not of a single codepoint, so it does not fit this
 * per-codepoint scan. `"confusable"` stays in `UnicodeFindingKind` for callers
 * that want a single result type across both checks.
 */
export function scanUnicode(input: string): UnicodeFinding[] {
  const findings: UnicodeFinding[] = [];

  for (const { codepoint, offset } of codePoints(input)) {
    if (BIDI_SET.has(codepoint)) {
      findings.push({
        kind: "bidi_control",
        codepoint,
        offset,
        description:
          `Bidirectional control character U+${hex(codepoint)} can reorder how surrounding text is ` +
          "displayed without changing the underlying bytes (the \"Trojan Source\" technique).",
      });
      continue;
    }

    if (codepoint === 0x00ad) {
      findings.push({
        kind: "invisible",
        codepoint,
        offset,
        description:
          "Soft hyphen (U+00AD) is invisible in normal rendering and can split a token or hide inside " +
          "one without a reader noticing.",
      });
      continue;
    }

    if (ZERO_WIDTH_SET.has(codepoint)) {
      findings.push({
        kind: "zero_width",
        codepoint,
        offset,
        description:
          `Zero-width character U+${hex(codepoint)} is invisible when rendered but present in the ` +
          "text, and can be used to split tokens or evade exact-string matching.",
      });
      continue;
    }

    if (isTagBlock(codepoint)) {
      findings.push({
        kind: "unassigned_tag",
        codepoint,
        offset,
        description:
          `Unicode Tag block character U+${hex(codepoint)} is invisible in normal rendering. This ` +
          "block has been used to smuggle hidden instructions past both human reviewers and language " +
          "models reading the same text.",
      });
    }
  }

  return findings;
}

/**
 * Remove every hidden codepoint from the input.
 *
 * Prefer `revealHidden` for anything a human will read. Stripping is here for
 * cases that genuinely need plain bytes back — a canonicalised value used as a
 * lookup key, for instance — where silently changing what the contributor wrote
 * is the point, not a side effect to worry about.
 */
export function stripHidden(input: string): string {
  let out = "";
  for (const { codepoint, offset, length } of codePoints(input)) {
    if (isHiddenCodepoint(codepoint)) continue;
    out += input.slice(offset, offset + length);
  }
  return out;
}

/**
 * Replace every hidden codepoint with a visible `<U+XXXX>` marker.
 *
 * This is the one to use for display. Stripping silently changes what the
 * contributor wrote — a reviewer sees clean text and has no way to know a bidi
 * override or a page of tag characters used to be sitting inside it. Revealing
 * keeps the byte count honest: nothing is deleted, the invisible thing is simply
 * made visible, and the reader can judge for themselves whether it belongs there.
 * It also defeats the attack directly — a revealed `<U+202E>` no longer reorders
 * anything, it is just seven ASCII characters sitting in the text.
 */
export function revealHidden(input: string): string {
  let out = "";
  for (const { codepoint, offset, length } of codePoints(input)) {
    out += isHiddenCodepoint(codepoint) ? `<U+${hex(codepoint)}>` : input.slice(offset, offset + length);
  }
  return out;
}

const LATIN_RE = /[A-Za-z]/;
// Cyrillic and Greek both contain letterforms that are visually identical or
// near-identical to Latin ones (Cyrillic а/е/о/р/с/х/у, Greek Α/Β/Ε/Ζ/Η/Ι/Κ/Ο/Ρ/Τ/Υ/Χ…).
const CYRILLIC_RE = /[Ѐ-ӿ]/;
const GREEK_RE = /[Ͱ-Ͽ]/;
const TOKEN_RE = /[\p{L}\p{N}_-]+/gu;

/**
 * True when some single token (word, identifier, hostname label — anything with
 * no internal whitespace) mixes Latin letters with Cyrillic or Greek ones.
 *
 * This is a mixed-script heuristic, not the Unicode confusable-skeleton algorithm
 * (UTS #39). It is deliberately simple and its limits are worth stating plainly:
 *
 * - It only catches *mixed*-script tokens. A token written entirely in Cyrillic
 *   look-alikes (e.g. а-р-р-l-е with every Latin letter swapped for its Cyrillic
 *   twin) contains no Latin character at all and will not be flagged here.
 * - It does not attempt to resolve individual glyphs to a canonical skeleton, so
 *   it cannot say *which* characters are the problem, only that the token is
 *   suspicious.
 * - Legitimate multilingual text (a Russian word inside an English sentence) does
 *   not trip this, because tokens are split on whitespace/punctuation first — the
 *   risk this targets is a single identifier or hostname secretly spanning two
 *   scripts, not prose that switches languages between words.
 *
 * Treat a `true` result as "worth a second look", not as proof of an attack.
 */
export function hasHomoglyphRisk(input: string): boolean {
  const tokens = input.match(TOKEN_RE) ?? [];
  for (const token of tokens) {
    const hasLatin = LATIN_RE.test(token);
    if (!hasLatin) continue;
    if (CYRILLIC_RE.test(token) || GREEK_RE.test(token)) return true;
  }
  return false;
}

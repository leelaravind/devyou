import { describe, expect, it } from "vitest";
import {
  hasHomoglyphRisk,
  revealHidden,
  scanUnicode,
  stripHidden,
  type UnicodeFinding,
} from "./unicode.js";
import { SAFE_CONTROLS, UNICODE_ATTACKS } from "../../../tests/fixtures/hostile-content.js";

function findById(id: string) {
  const sample = UNICODE_ATTACKS.find((entry) => entry.id === id);
  if (!sample) throw new Error(`fixture not found: ${id}`);
  return sample;
}

const BIDI_SAMPLE = findById("bidi-override-comment-swap");
const ZWJ_SAMPLE = findById("zwj-split-identifier");
const HOMOGLYPH_SAMPLE = findById("homoglyph-domain-apple");
const TAG_BLOCK_SAMPLE = findById("tag-block-smuggled-instruction");

describe("scanUnicode", () => {
  it("finds a bidi_control finding for every bidi override in a comment/string swap, at the right offsets", () => {
    const findings = scanUnicode(BIDI_SAMPLE.payload);
    const bidiFindings = findings.filter((finding) => finding.kind === "bidi_control");
    expect(bidiFindings).toHaveLength(2);

    const rlo = bidiFindings.find((finding) => finding.codepoint === 0x202e);
    const pdf = bidiFindings.find((finding) => finding.codepoint === 0x202c);
    expect(rlo).toBeDefined();
    expect(pdf).toBeDefined();
    expect(BIDI_SAMPLE.payload.codePointAt((rlo as UnicodeFinding).offset)).toBe(0x202e);
    expect(BIDI_SAMPLE.payload.codePointAt((pdf as UnicodeFinding).offset)).toBe(0x202c);
  });

  it("finds a zero_width finding for a ZWJ hidden inside an identifier, at the right offset", () => {
    const findings = scanUnicode(ZWJ_SAMPLE.payload);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "zero_width", codepoint: 0x200d });
    expect(ZWJ_SAMPLE.payload.codePointAt((findings[0] as UnicodeFinding).offset)).toBe(0x200d);
  });

  it("finds an unassigned_tag finding for every codepoint of a Unicode Tag-block smuggled instruction", () => {
    const findings = scanUnicode(TAG_BLOCK_SAMPLE.payload);
    const tagFindings = findings.filter((finding) => finding.kind === "unassigned_tag");

    // The smuggled instruction plus its trailing cancel tag: one finding per codepoint.
    const hiddenInstructionLength = [...TAG_BLOCK_SAMPLE.payload].filter(
      (ch) => (ch.codePointAt(0) ?? 0) >= 0xe0000 && (ch.codePointAt(0) ?? 0) <= 0xe007f,
    ).length;
    expect(tagFindings).toHaveLength(hiddenInstructionLength);
    for (const finding of tagFindings) {
      expect(finding.codepoint).toBeGreaterThanOrEqual(0xe0000);
      expect(finding.codepoint).toBeLessThanOrEqual(0xe007f);
    }
  });

  it("reports offsets usable directly with String.prototype.slice", () => {
    const findings = scanUnicode(ZWJ_SAMPLE.payload);
    const finding = findings[0] as UnicodeFinding;
    const sliced = ZWJ_SAMPLE.payload.slice(finding.offset, finding.offset + 1);
    expect(sliced.codePointAt(0)).toBe(finding.codepoint);
  });

  it("finds no hidden codepoints in any SAFE_CONTROLS sample", () => {
    for (const sample of SAFE_CONTROLS) {
      expect(scanUnicode(sample.payload), `unexpected finding for ${sample.id}`).toHaveLength(0);
    }
  });

  it("detects something (a scanUnicode finding or a homoglyph flag) for every sample in the whole UNICODE_ATTACKS corpus", () => {
    for (const sample of UNICODE_ATTACKS) {
      const hasScanFinding = scanUnicode(sample.payload).length > 0;
      const hasHomoglyphFinding = hasHomoglyphRisk(sample.payload);
      expect(hasScanFinding || hasHomoglyphFinding, `${sample.id} was not detected by any check`).toBe(true);
    }
  });
});

describe("stripHidden", () => {
  it("removes bidi override characters, leaving the surrounding visible text untouched", () => {
    const stripped = stripHidden(BIDI_SAMPLE.payload);
    expect(stripped).not.toContain(String.fromCharCode(0x202e));
    expect(stripped).not.toContain(String.fromCharCode(0x202c));
    expect(scanUnicode(stripped)).toHaveLength(0);
  });

  it("rejoins a ZWJ-split identifier back to its literal bytes", () => {
    expect(stripHidden(ZWJ_SAMPLE.payload)).toContain("admin");
    expect(stripHidden(ZWJ_SAMPLE.payload)).not.toContain(String.fromCharCode(0x200d));
  });

  it("removes an entire Tag-block smuggled run, leaving only the visible surrounding text", () => {
    const stripped = stripHidden(TAG_BLOCK_SAMPLE.payload);
    expect(stripped).toBe("Great write-up, thanks for sharing! ");
    expect(scanUnicode(stripped)).toHaveLength(0);
  });

  it("leaves SAFE_CONTROLS content byte-for-byte unchanged", () => {
    for (const sample of SAFE_CONTROLS) {
      expect(stripHidden(sample.payload)).toBe(sample.payload);
    }
  });
});

describe("revealHidden", () => {
  it("replaces a hidden codepoint with a visible <U+XXXX> marker", () => {
    const revealed = revealHidden(ZWJ_SAMPLE.payload);
    expect(revealed).toContain("<U+200D>");
    expect(revealed).not.toContain(String.fromCharCode(0x200d));
  });

  it("keeps the byte count honest: nothing from the original is deleted, only made visible", () => {
    const revealed = revealHidden(BIDI_SAMPLE.payload);
    expect(revealed).toContain("<U+202E>");
    expect(revealed).toContain("<U+202C>");
    // The visible letters the bidi override was reordering are still there, just no longer reordered.
    expect(revealed).toContain("resu");
  });

  it("neutralises a Tag-block smuggled instruction into plain, inert ASCII", () => {
    const revealed = revealHidden(TAG_BLOCK_SAMPLE.payload);
    expect(revealed).toContain("<U+E0053>"); // 'S' of "SYSTEM"
    expect(scanUnicode(revealed)).toHaveLength(0);
  });

  it("is idempotent-safe: revealing already-revealed text is a no-op", () => {
    const once = revealHidden(BIDI_SAMPLE.payload);
    const twice = revealHidden(once);
    expect(twice).toBe(once);
  });

  it("leaves SAFE_CONTROLS content byte-for-byte unchanged", () => {
    for (const sample of SAFE_CONTROLS) {
      expect(revealHidden(sample.payload)).toBe(sample.payload);
    }
  });
});

describe("hasHomoglyphRisk", () => {
  it("catches a Latin+Cyrillic mixed-script token in a spoofed hostname", () => {
    expect(hasHomoglyphRisk(HOMOGLYPH_SAMPLE.payload)).toBe(true);
  });

  it("does not fire on plain ASCII", () => {
    const asciiSample = SAFE_CONTROLS.find((sample) => sample.id === "safe-ascii-prose");
    expect(asciiSample).toBeDefined();
    expect(hasHomoglyphRisk((asciiSample as (typeof SAFE_CONTROLS)[number]).payload)).toBe(false);
  });

  it("does not fire on legitimate prose written entirely in a non-Latin script", () => {
    const nonLatinSample = SAFE_CONTROLS.find((sample) => sample.id === "safe-non-latin-prose");
    expect(nonLatinSample).toBeDefined();
    expect(hasHomoglyphRisk((nonLatinSample as (typeof SAFE_CONTROLS)[number]).payload)).toBe(false);
  });

  it("does not fire on any SAFE_CONTROLS sample", () => {
    for (const sample of SAFE_CONTROLS) {
      expect(hasHomoglyphRisk(sample.payload), `unexpected flag for ${sample.id}`).toBe(false);
    }
  });
});

import { describe, expect, it } from "vitest";
import { parseMarkdown, type MdNode } from "./markdown.js";
import { scanUnicode } from "./unicode.js";
import { SAFE_CONTROLS, UNICODE_ATTACKS, XSS_PAYLOADS } from "../../../tests/fixtures/hostile-content.js";

/** Every `MdNode` variant that may legitimately appear in parsed output. There is
 *  no "html"/"raw_html" member of this set because there is no such member of the
 *  `MdNode` union — this list exists to prove that structurally, at runtime, over
 *  real parsed output, not merely by trusting the compiler. */
const SAFE_NODE_TYPES = new Set<MdNode["type"]>([
  "paragraph",
  "heading",
  "code_block",
  "inline_code",
  "list",
  "list_item",
  "link",
  "text",
  "strong",
  "em",
  "blockquote",
]);

function collectNodeTypes(nodes: readonly MdNode[]): MdNode["type"][] {
  const types: MdNode["type"][] = [];
  for (const node of nodes) {
    types.push(node.type);
    switch (node.type) {
      case "paragraph":
      case "heading":
      case "strong":
      case "em":
      case "blockquote":
      case "link":
      case "list_item":
        types.push(...collectNodeTypes(node.children));
        break;
      case "list":
        types.push(...collectNodeTypes(node.items));
        break;
      case "code_block":
      case "inline_code":
      case "text":
        break;
    }
  }
  return types;
}

function collectText(nodes: readonly MdNode[]): string {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out += node.value;
        break;
      case "inline_code":
      case "code_block":
        out += node.code;
        break;
      case "paragraph":
      case "heading":
      case "strong":
      case "em":
      case "blockquote":
      case "link":
      case "list_item":
        out += collectText(node.children);
        break;
      case "list":
        out += collectText(node.items);
        break;
    }
  }
  return out;
}

describe("parseMarkdown — no raw HTML, ever", () => {
  it("never produces a node type outside the safe MdNode union for any XSS_PAYLOADS entry", () => {
    for (const sample of XSS_PAYLOADS) {
      const types = collectNodeTypes(parseMarkdown(sample.payload));
      for (const type of types) {
        expect(SAFE_NODE_TYPES.has(type), `${sample.id} produced an unexpected node type: ${type}`).toBe(true);
      }
    }
  });

  it("never throws while parsing any XSS_PAYLOADS entry", () => {
    for (const sample of XSS_PAYLOADS) {
      expect(() => parseMarkdown(sample.payload), sample.id).not.toThrow();
    }
  });

  it("keeps a <script> tag as inert text, never as a distinct HTML node", () => {
    const sample = XSS_PAYLOADS.find((entry) => entry.id === "xss-script-tag");
    expect(sample).toBeDefined();
    const nodes = parseMarkdown((sample as (typeof XSS_PAYLOADS)[number]).payload);
    expect(collectNodeTypes(nodes)).toEqual(["paragraph", "text"]);
    expect(collectText(nodes)).toContain("<script>");
  });

  it("keeps mixed-case and null-byte-split tag variants as inert text", () => {
    const mixedCase = XSS_PAYLOADS.find((entry) => entry.id === "xss-mixed-case-tag");
    const nullByte = XSS_PAYLOADS.find((entry) => entry.id === "xss-null-byte-split");
    expect(mixedCase).toBeDefined();
    expect(nullByte).toBeDefined();
    for (const sample of [mixedCase, nullByte] as (typeof XSS_PAYLOADS)[number][]) {
      const types = collectNodeTypes(parseMarkdown(sample.payload));
      expect(types.every((type) => SAFE_NODE_TYPES.has(type))).toBe(true);
    }
  });
});

describe("parseMarkdown — unsafe link hrefs downgrade to text", () => {
  it("turns a javascript: markdown link into text, with no link node produced", () => {
    const sample = XSS_PAYLOADS.find((entry) => entry.id === "xss-markdown-javascript-link");
    expect(sample).toBeDefined();
    const nodes = parseMarkdown((sample as (typeof XSS_PAYLOADS)[number]).payload);
    expect(collectNodeTypes(nodes)).not.toContain("link");
    // The href is unbalanced-parenthesis-truncated by design (see markdown.ts's note above
    // INLINE_SOURCE) but nothing is lost — the full original text still reaches the reader,
    // just possibly split across more than one text node.
    expect(collectText(nodes)).toBe((sample as (typeof XSS_PAYLOADS)[number]).payload.replace("[x](", "x ("));
    expect(collectText(nodes)).toContain("javascript:alert(1)");
  });

  it("turns a data: markdown link into text, with the href still visible and no link node produced", () => {
    const href = "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==";
    const nodes = parseMarkdown(`[open](${href})`);
    expect(collectNodeTypes(nodes)).not.toContain("link");
    expect(collectText(nodes)).toBe(`open (${href})`);
  });

  it("keeps a legitimate https: markdown link as a real, safe link node", () => {
    const sample = SAFE_CONTROLS.find((entry) => entry.id === "safe-cloudflare-doc-link");
    expect(sample).toBeDefined();
    const nodes = parseMarkdown(`See [the docs](${(sample as (typeof SAFE_CONTROLS)[number]).payload}) for details.`);
    expect(collectNodeTypes(nodes)).toContain("link");
  });
});

describe("parseMarkdown — hidden Unicode is revealed before parsing", () => {
  it("reveals a zero-width-joiner-split identifier as a visible marker in the parsed text", () => {
    const sample = UNICODE_ATTACKS.find((entry) => entry.id === "zwj-split-identifier");
    expect(sample).toBeDefined();
    const nodes = parseMarkdown((sample as (typeof UNICODE_ATTACKS)[number]).payload);
    const text = collectText(nodes);
    expect(text).toContain("<U+200D>");
    expect(scanUnicode(text)).toHaveLength(0);
  });

  it("reveals a bidi override pair as visible markers in the parsed text", () => {
    const sample = UNICODE_ATTACKS.find((entry) => entry.id === "bidi-override-comment-swap");
    expect(sample).toBeDefined();
    const nodes = parseMarkdown((sample as (typeof UNICODE_ATTACKS)[number]).payload);
    const text = collectText(nodes);
    expect(text).toContain("<U+202E>");
    expect(text).toContain("<U+202C>");
    expect(scanUnicode(text)).toHaveLength(0);
  });
});

describe("parseMarkdown — code fences preserve content verbatim", () => {
  it("does not re-parse or alter code fence content, including an embedded <script> tag", () => {
    const source = "```js\n<script>alert(1)</script>\nconst x = 1;\n```";
    const nodes = parseMarkdown(source);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toEqual({
      type: "code_block",
      language: "js",
      code: "<script>alert(1)</script>\nconst x = 1;",
    });
  });

  it("preserves the SAFE_CONTROLS code block that mentions <script> as teaching text, verbatim", () => {
    const sample = SAFE_CONTROLS.find((entry) => entry.id === "safe-code-block-mentions-script");
    expect(sample).toBeDefined();
    const nodes = parseMarkdown((sample as (typeof SAFE_CONTROLS)[number]).payload);
    expect(nodes).toHaveLength(1);
    const node = nodes[0];
    expect(node).toBeDefined();
    expect(node !== undefined && node.type).toBe("code_block");
    if (node !== undefined && node.type === "code_block") {
      expect(node.code).toContain("<script>alert(1)</script>");
      expect(node.language).toBe("html");
    }
  });
});

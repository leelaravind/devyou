import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source-level guards for the legal document set (ADR-0013).
 *
 * These assert the properties that make the documents trustworthy rather than the
 * prose itself: every legal route exists and is registered, the approved postal
 * address has exactly one source of truth, no invented legal identifier appears
 * anywhere, the terms are linked at every point of submission, and no consent
 * checkbox is pre-ticked. A failure here is a policy defect, not a style one.
 */

const APP_DIR = join(__dirname, "..", "app");

const read = (...segments: string[]): string => readFileSync(join(APP_DIR, ...segments), "utf8");

/** Strip comments before searching, so a fact *described* in a comment — including the
 *  comment in `lib/legal.tsx` that lists the identifiers which must not exist — is not
 *  mistaken for a claim the page renders. Same approach as the admin surface guards. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const LEGAL_PATHS = [
  "/privacy",
  "/terms",
  "/contribution-terms",
  "/content-policy",
  "/acceptable-use",
  "/ai",
] as const;

const LEGAL_ROUTE_FILES = [
  "privacy.tsx",
  "terms.tsx",
  "contribution-terms.tsx",
  "content-policy.tsx",
  "acceptable-use.tsx",
  "ai.tsx",
] as const;

/** The owner-approved public legal address — the only one that may appear. */
const APPROVED_ADDRESS_LINES = [
  "itisyou.app",
  "13 Freeland Park",
  "Wareham Road",
  "Poole",
  "Dorset",
  "BH16 6FA",
  "United Kingdom",
];

/**
 * Legal facts that do not exist for this service and therefore must not be claimed.
 * The owner has supplied a trading name, an address and confirmation that the
 * data-protection fee is paid — nothing else. A document that names a company
 * number, a VAT number, an ICO reference or a phone number has invented it.
 */
const INVENTED_IDENTIFIER_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "company number", re: /company\s+(?:no\b|number)/i },
  { name: "Companies House", re: /companies\s+house/i },
  { name: "VAT number", re: /\bVAT\b/ },
  { name: "ICO registration reference", re: /ICO\s+(?:registration|reference|number)|\bZA\d{6}\b/ },
  { name: "data protection officer", re: /data\s+protection\s+officer|\bDPO\b/ },
  { name: "telephone number", re: /telephone|\bphone\b|\+44\s?\d|\b0[12]\d{2,3}[\s-]?\d{5,7}\b/i },
];

describe("legal routes are registered and public", () => {
  const routes = read("routes.ts");

  it.each(LEGAL_ROUTE_FILES)("routes.ts registers routes/%s", (file) => {
    const path = file.replace(/\.tsx$/, "");
    expect(routes).toContain(`route("${path}", "routes/${file}")`);
  });

  it("every legal path is in the sitemap's static list", () => {
    const sitemap = read("routes", "sitemap.ts");
    for (const path of LEGAL_PATHS) {
      expect(sitemap).toContain(`"${path}"`);
    }
  });

  it("no legal route file reads a session or requires a principal", () => {
    // Public without an account is invariant §0.7. The documents are static; a
    // loader that resolved a principal would be the first step toward gating them.
    for (const file of LEGAL_ROUTE_FILES) {
      const source = read("routes", file);
      expect(source).not.toMatch(/resolvePrincipal|loadAuthState|requireUser|loader\s*\(/);
    }
  });
});

describe("the approved address has one source of truth", () => {
  const legal = read("lib", "legal.tsx");

  it.each(APPROVED_ADDRESS_LINES)("lib/legal.tsx carries the line %j", (line) => {
    expect(legal).toContain(line);
  });

  it("every legal document renders through LegalDoc, which renders the address and the effective date", () => {
    expect(legal).toContain("Effective and last updated");
    expect(legal).toContain("LEGAL_EFFECTIVE");
    for (const file of LEGAL_ROUTE_FILES) {
      const source = read("routes", file);
      expect(source, `${file} must use the shared LegalDoc layout`).toContain("<LegalDoc");
      expect(source).toContain('from "../lib/legal"');
    }
  });

  it("the postal address appears in no route file directly — only via the shared module", () => {
    for (const file of LEGAL_ROUTE_FILES) {
      const source = read("routes", file);
      expect(source, `${file} must not duplicate the address`).not.toContain("Freeland Park");
    }
  });
});

describe("no invented legal identifiers", () => {
  const sources = [
    ["lib/legal.tsx", code(read("lib", "legal.tsx"))],
    ...LEGAL_ROUTE_FILES.map((file) => [`routes/${file}`, code(read("routes", file))] as const),
  ] as const;

  for (const [name, source] of sources) {
    for (const { name: identifier, re } of INVENTED_IDENTIFIER_PATTERNS) {
      it(`${name} does not claim a ${identifier}`, () => {
        expect(source).not.toMatch(re);
      });
    }
  }
});

describe("the footer links the legal set from every page", () => {
  const root = read("root.tsx");

  it("root.tsx renders a Legal nav from the shared link list", () => {
    expect(root).toContain('aria-label="Legal"');
    expect(root).toContain("LEGAL_LINKS");
    expect(root).toContain('from "./lib/legal"');
  });
});

describe("terms are visible at every point of submission (ADR-0013)", () => {
  it("the capture form links the contribution terms and names the AI provider", () => {
    const source = read("routes", "contribute.start.tsx");
    expect(source).toContain("/contribution-terms");
    expect(source).toContain("Anthropic");
    expect(source).toContain("/ai");
  });

  it("the publish gate names the licence grant", () => {
    const source = read("routes", "contribute.$draftId.publish.tsx");
    expect(source).toContain("/contribution-terms");
  });

  it("the reproduction report form links the contribution terms", () => {
    const source = read("routes", "p.$slug.report.tsx");
    expect(source).toContain("/contribution-terms");
  });

  it("the change-proposal form links the contribution terms", () => {
    const source = read("routes", "p.$slug.propose.tsx");
    expect(source).toContain("/contribution-terms");
  });

  it("the contribute signposting page links the contribution terms", () => {
    const source = read("routes", "contribute.tsx");
    expect(source).toContain("/contribution-terms");
  });

  it("sign-in links the terms of use and the privacy notice", () => {
    const source = read("routes", "sign-in.tsx");
    expect(source).toContain('to="/terms"');
    expect(source).toContain('to="/privacy"');
  });
});

describe("no dark patterns in consent", () => {
  it("no route hard-codes a pre-ticked checkbox", () => {
    /*
      What is forbidden is a checkbox that is ticked before the person did anything:
      a bare `defaultChecked`, or a literal-true one. `defaultChecked={expression}`
      is state restoration — the review screen re-rendering a confirmation the author
      already made is the author's own past action, not a default.
    */
    const files = [
      "contribute.start.tsx",
      "contribute.$draftId.review.tsx",
      "contribute.$draftId.edit.tsx",
      "contribute.$draftId.publish.tsx",
      "p.$slug.report.tsx",
      "p.$slug.propose.tsx",
      "sign-in.tsx",
      ...LEGAL_ROUTE_FILES,
    ];
    for (const file of files) {
      const source = code(read("routes", file));
      expect(source, `${file} must not pre-tick a checkbox`).not.toMatch(
        /defaultChecked(?!=\{)|defaultChecked=\{true\}|defaultChecked="/,
      );
    }
  });
});

import { describe, expect, it } from "vitest";
import type { StructureResult } from "@devyou/ai";
import { toDraft } from "./structure.js";

/**
 * Turning a model's answer into a draft, without losing what it found.
 *
 * These are regressions for a defect production run 2026-08-23 exposed. The model read
 * "Node 22.22, pnpm 11 workspaces, wrangler 4.125" out of the submission and said so in
 * its own summary — and the draft persisted `constraints: []`, so the publish gate
 * refused with `no_environment_constraints`. The gate was right. The information had
 * been dropped in transit, twice over: `versionLabel` was parsed and never read, and
 * `slugify("Node")` was matched against canonical slugs only, so `nodejs` was never
 * found and the version attached to it went with it.
 */

/** The taxonomy as `technologyResolver` builds it: canonical slugs, plus aliases that
 *  resolve unambiguously. `node` is an alias of `nodejs` in production. */
const RESOLVER = new Map<string, string>([
  ["nodejs", "nodejs"],
  ["wrangler", "wrangler"],
  ["cloudflare-d1", "cloudflare-d1"],
  ["node", "nodejs"],
]);

const SOURCE = `Running a wrangler D1 command from a pnpm workspace root fails:

    node ./node_modules/wrangler/bin/wrangler.js d1 execute my-db --remote --command "SELECT 1"
    code: 'MODULE_NOT_FOUND'

Node 22.22, pnpm 11 workspaces, wrangler 4.125.`;

function result(overrides: Partial<StructureResult> = {}): StructureResult {
  return {
    problemTitle: {
      value: "MODULE_NOT_FOUND for wrangler",
      provenance: "ai_extracted",
      basis: "quoted",
    },
    problemSummary: {
      value: "wrangler is not resolvable",
      provenance: "ai_extracted",
      basis: "read",
    },
    symptoms: ["MODULE_NOT_FOUND"],
    errorSignatures: [{ errorCode: "MODULE_NOT_FOUND", normalisedMessage: "Cannot find module" }],
    technologies: [
      { name: "Node", versionLabel: "22.22", provenance: "ai_extracted" },
      { name: "wrangler", versionLabel: "4.125", provenance: "ai_extracted" },
    ],
    nodes: [
      {
        id: "a",
        nodeType: "start",
        title: "Reproduce",
        body: "Run it from the root.",
        commandText:
          'node ./node_modules/wrangler/bin/wrangler.js d1 execute my-db --remote --command "SELECT 1"',
        commandLanguage: "bash",
        expectedOutput: "code: 'MODULE_NOT_FOUND'",
        safetyLevel: "informational",
        safetyEffect: null,
      },
    ],
    edges: [],
    sources: [],
    gaps: [],
    suspiciousContent: [],
    ...overrides,
  } as StructureResult;
}

describe("environment information reaching the draft", () => {
  it("turns a reported version into an editable constraint", () => {
    const { document } = toDraft(result(), RESOLVER, SOURCE);

    expect(document.constraints).toHaveLength(2);
    expect(document.constraints).toContainEqual({
      technologySlug: "nodejs",
      minSemver: "22.22",
      maxSemver: "22.22",
      maxInclusive: true,
      architecture: null,
      kind: "known_affected",
    });
  });

  it("resolves a technology through its alias rather than dropping it", () => {
    /*
      The second half of the production defect. The model said "Node"; the taxonomy
      stores `nodejs`; the exact-slug match failed and took the version with it.
      `technology_aliases` carries 171 of these and the structuring path was the one
      place that never consulted it.
    */
    const { document } = toDraft(result(), RESOLVER, SOURCE);
    expect(document.technologySlugs).toContain("nodejs");
    expect(document.constraints.map((constraint) => constraint.technologySlug)).toContain("nodejs");
  });

  it("pins the reported version rather than widening it", () => {
    /* The author said it broke here, not that it breaks from here onwards. Widening
       to an open range would be an inference nobody made; the review screen is where
       widening belongs. */
    const [first] = toDraft(result(), RESOLVER, SOURCE).document.constraints;
    expect(first?.minSemver).toBe(first?.maxSemver);
    expect(first?.kind).toBe("known_affected");
  });

  it("does NOT invent a constraint for a technology with no version", () => {
    /*
      The gate must keep its meaning. A constraint with no version would satisfy
      `constraints.length > 0` while carrying no applicability at all, turning
      `no_environment_constraints` into a formality — which is precisely what this fix
      must not do. The technology is still listed in `technologySlugs`; it does not
      need a hollow constraint as well.
    */
    const { document } = toDraft(
      result({
        technologies: [{ name: "wrangler", versionLabel: null, provenance: "ai_extracted" }],
      }),
      RESOLVER,
      SOURCE,
    );

    expect(document.technologySlugs).toEqual(["wrangler"]);
    expect(document.constraints).toEqual([]);
  });

  it("drops a technology the taxonomy does not know, version and all", () => {
    /* `pnpm` is not in the taxonomy. An approximate match would file the playbook
       where nobody searches, so nothing is guessed. */
    const { document } = toDraft(
      result({ technologies: [{ name: "pnpm", versionLabel: "11", provenance: "ai_extracted" }] }),
      RESOLVER,
      SOURCE,
    );

    expect(document.technologySlugs).toEqual([]);
    expect(document.constraints).toEqual([]);
  });
});

describe("provenance the model cannot self-certify", () => {
  it("tracks commandText at all, which it previously did not", () => {
    /*
      The most dangerous untracked field in the product. A fabricated command carried
      no provenance row, required no confirmation, and reached the publish gate
      indistinguishable from one the author had typed — and a command is the one field
      a reader copies and executes.
    */
    const { provenance } = toDraft(result(), RESOLVER, SOURCE);
    expect(provenance.map((row) => row.fieldPath)).toContain("/nodes/0/commandText");
  });

  it("keeps a command that appears in the submission as extracted", () => {
    const { provenance } = toDraft(result(), RESOLVER, SOURCE);
    const command = provenance.find((row) => row.fieldPath === "/nodes/0/commandText");
    expect(command?.provenance).toBe("ai_extracted");
  });

  it("requires confirmation for a command the author never wrote", () => {
    /*
      Two of the four commands in production run 2026-08-23 contained invented
      placeholder syntax of exactly this shape, and both would have published
      unremarked.
    */
    const invented = result();
    invented.nodes[0]!.commandText = "cd <path/to/package-that-depends-on-wrangler>";

    const { provenance } = toDraft(invented, RESOLVER, SOURCE);
    const command = provenance.find((row) => row.fieldPath === "/nodes/0/commandText");

    expect(command?.provenance).toBe("ai_inferred_requires_confirmation");
    expect(command?.basis).toContain("does not appear in what you wrote");
  });

  it("requires confirmation for a version the author never stated", () => {
    const invented = result({
      technologies: [{ name: "Node", versionLabel: "24.0", provenance: "ai_extracted" }],
    });

    const { provenance } = toDraft(invented, RESOLVER, SOURCE);
    const version = provenance.find((row) => row.fieldPath === "/constraints/0/version");

    expect(version?.provenance).toBe("ai_inferred_requires_confirmation");
  });

  it("leaves prose on the model's own classification", () => {
    /*
      Deliberate, and measured rather than assumed. Against the real production
      submission, normalised containment held for 1 of 22 prose fields and token
      coverage ran 0.00 to 1.00 with faithful text at both ends. Any threshold there
      would demand confirmation on nearly every field of a legitimate draft, and a
      prompt that appears everywhere is one nobody reads. Prose is shown in full on the
      review screen instead.
    */
    const { provenance } = toDraft(result(), RESOLVER, SOURCE);
    const body = provenance.find((row) => row.fieldPath === "/nodes/0/body");
    expect(body?.provenance).toBe("ai_extracted");
  });
});

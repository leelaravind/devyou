import {
  BRANCH_CONDITIONS,
  NODE_TYPES,
  SAFETY_LEVELS,
  SOURCE_TYPES,
  type BranchCondition,
  type NodeType,
  type SafetyLevel,
  type SourceType,
} from "@devyou/core";
import { DraftDocument, nextNodeKey, type DraftDocument as Draft } from "@devyou/schemas";

/**
 * The draft document, to and from an HTML form.
 *
 * Repeated fields are read as parallel arrays in DOM order — `nodeKey[i]` belongs
 * with `nodeTitle[i]` — which works because every control in a node's fieldset is
 * an input or a select, and both are submitted whether or not the user touched
 * them. A checkbox is not, so nothing per-row is a checkbox; inclusivity and
 * similar booleans are selects for exactly that reason. A misaligned array here
 * would silently attach one node's command to another node's title.
 *
 * Everything is clamped rather than rejected on length. The Zod schema is the
 * boundary that decides validity; this decides what a stray paste turns into, and
 * a form that throws away a whole submission because one field ran long is a form
 * people stop using.
 */

export interface ParsedDocument {
  document: Draft;
  /** Field paths the author explicitly ticked as checked, from the review screen. */
  confirmed: Set<string>;
}

/**
 * Which collections a form is responsible for.
 *
 * A form declares these with hidden `scope` inputs, and it is not optional
 * bookkeeping: an absent collection and a deliberately emptied one are the same
 * thing in a `FormData`. Without the declaration, unchecking the last technology or
 * deleting the last branch would be read as "this form does not edit those" and the
 * old values would come back — an author removing something and watching it
 * reappear is the kind of bug people work around rather than report.
 *
 * The review screen owns `nodes` only; the editor owns all four.
 */
export type FormScope = "nodes" | "edges" | "applicability" | "sources";

/**
 * Rebuild the document from a submitted form.
 *
 * `base` supplies everything the form does not carry: the model's `gaps` and
 * `suspiciousContent`, and every collection outside the form's declared scope.
 * Merging from the stored document rather than from hidden inputs means a field the
 * author cannot see is a field they cannot alter.
 */
export function documentFromForm(form: FormData, base: Draft): ParsedDocument {
  const scopes = new Set(form.getAll("scope").map((value) => String(value)));
  const owns = (scope: FormScope): boolean => scopes.has(scope);

  const nodes = owns("nodes") ? parseNodes(form, base) : base.nodes;
  const validKeys = new Set(nodes.map((node) => node.key));

  const document: Draft = {
    title: text(form.get("title"), 200),
    summary: text(form.get("summary"), 1000),
    changeSummary: text(form.get("changeSummary"), 1000),
    problemTitle: text(form.get("problemTitle"), 200),
    problemSummary: text(form.get("problemSummary"), 1000),
    symptoms: list(form, "symptom", 300, 10),
    errorSignatures: parseSignatures(form),
    technologySlugs: owns("applicability")
      ? form
          .getAll("technology")
          .map((value) => String(value).slice(0, 80))
          .filter((value) => value !== "")
          .slice(0, 12)
      : base.technologySlugs,
    constraints: owns("applicability") ? parseConstraints(form) : base.constraints,
    nodes,
    edges: owns("edges")
      ? parseEdges(form, validKeys)
      : base.edges.filter((edge) => validKeys.has(edge.fromKey) && validKeys.has(edge.toKey)),
    sources: owns("sources") ? parseSources(form) : base.sources,
    gaps: base.gaps,
    suspiciousContent: base.suspiciousContent,
  };

  return {
    document,
    confirmed: new Set(form.getAll("confirm").map((value) => String(value).slice(0, 200))),
  };
}

/**
 * Apply a structural change named by the submit button.
 *
 * Structural edits go through the same parse-then-mutate path as a save, so adding
 * a node never discards an unsaved edit elsewhere on the page. Returns null when
 * the intent is not a structural one, which is how a caller tells "save" from
 * "save and add a row".
 */
export function applyStructuralIntent(document: Draft, intent: string): Draft | null {
  if (intent === "add-node") {
    return {
      ...document,
      nodes: [
        ...document.nodes,
        {
          key: nextNodeKey(document),
          nodeType: "test",
          title: "",
          body: "",
          commandText: null,
          commandLanguage: null,
          expectedOutput: null,
          safetyLevel: "informational",
          safetyEffect: null,
        },
      ],
    };
  }

  if (intent.startsWith("remove-node:")) {
    const key = intent.slice("remove-node:".length);
    return {
      ...document,
      nodes: document.nodes.filter((node) => node.key !== key),
      /*
        Removing a node removes its edges too.

        The alternative — leaving them dangling for the validator to report — is
        technically more honest and practically worse: the author gets a list of
        errors about an edge they never drew, on a node that is no longer on screen.
      */
      edges: document.edges.filter((edge) => edge.fromKey !== key && edge.toKey !== key),
    };
  }

  if (intent === "add-edge") {
    const first = document.nodes[0];
    if (!first) return document;
    return {
      ...document,
      edges: [
        ...document.edges,
        { fromKey: first.key, toKey: first.key, condition: "passed", label: null },
      ],
    };
  }

  if (intent.startsWith("remove-edge:")) {
    const index = Number.parseInt(intent.slice("remove-edge:".length), 10);
    return { ...document, edges: document.edges.filter((_, position) => position !== index) };
  }

  if (intent === "add-constraint") {
    return {
      ...document,
      constraints: [
        ...document.constraints,
        {
          technologySlug: "",
          minSemver: null,
          maxSemver: null,
          maxInclusive: false,
          architecture: null,
          kind: "required",
        },
      ],
    };
  }

  if (intent.startsWith("remove-constraint:")) {
    const index = Number.parseInt(intent.slice("remove-constraint:".length), 10);
    return {
      ...document,
      constraints: document.constraints.filter((_, position) => position !== index),
    };
  }

  if (intent === "add-source") {
    return {
      ...document,
      sources: [...document.sources, { url: "", title: "", sourceType: "official_docs" }],
    };
  }

  if (intent.startsWith("remove-source:")) {
    const index = Number.parseInt(intent.slice("remove-source:".length), 10);
    return { ...document, sources: document.sources.filter((_, position) => position !== index) };
  }

  return null;
}

/** Final validation before storage. A document that fails here is a bug in this
 *  file, not in the submission — every value above is already clamped — so the
 *  failure is surfaced rather than absorbed. */
export function validateDocument(document: Draft): { ok: true; value: Draft } | { ok: false; detail: string } {
  const result = DraftDocument.safeParse(document);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    detail: result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; "),
  };
}

/* ------------------------------------------------------------------------- */

function parseNodes(form: FormData, base: Draft): Draft["nodes"] {
  const keys = form.getAll("nodeKey");
  const types = form.getAll("nodeType");
  const titles = form.getAll("nodeTitle");
  const bodies = form.getAll("nodeBody");
  const commands = form.getAll("nodeCommand");
  const languages = form.getAll("nodeLanguage");
  const outputs = form.getAll("nodeExpected");
  const levels = form.getAll("nodeSafety");
  const effects = form.getAll("nodeEffect");

  return keys.slice(0, 40).map((rawKey, index) => {
    const key = String(rawKey);
    const previous = base.nodes.find((node) => node.key === key);
    return {
      key,
      nodeType: oneOf(types[index], NODE_TYPES, previous?.nodeType ?? "test") as NodeType,
      title: text(titles[index], 200),
      body: text(bodies[index], 4000),
      commandText: nullable(commands[index], 2000),
      commandLanguage: nullable(languages[index], 40),
      expectedOutput: nullable(outputs[index], 2000),
      safetyLevel: oneOf(
        levels[index],
        SAFETY_LEVELS,
        previous?.safetyLevel ?? "informational",
      ) as SafetyLevel,
      safetyEffect: nullable(effects[index], 500),
    };
  });
}

function parseEdges(form: FormData, validKeys: ReadonlySet<string>): Draft["edges"] {
  const froms = form.getAll("edgeFrom");
  const tos = form.getAll("edgeTo");
  const conditions = form.getAll("edgeCondition");
  const labels = form.getAll("edgeLabel");

  return froms
    .slice(0, 80)
    .map((from, index) => ({
      fromKey: String(from),
      toKey: String(tos[index] ?? ""),
      condition: oneOf(conditions[index], BRANCH_CONDITIONS, "passed") as BranchCondition,
      label: nullable(labels[index], 120),
    }))
    .filter((edge) => validKeys.has(edge.fromKey) && validKeys.has(edge.toKey));
}

function parseConstraints(form: FormData): Draft["constraints"] {
  const technologies = form.getAll("constraintTech");
  const mins = form.getAll("constraintMin");
  const maxes = form.getAll("constraintMax");
  const inclusives = form.getAll("constraintInclusive");
  const kinds = form.getAll("constraintKind");
  const architectures = form.getAll("constraintArch");

  return technologies
    .slice(0, 12)
    .map((slug, index) => ({
      technologySlug: text(slug, 80),
      minSemver: nullable(mins[index], 40),
      maxSemver: nullable(maxes[index], 40),
      maxInclusive: String(inclusives[index] ?? "") === "inclusive",
      architecture: nullable(architectures[index], 40),
      kind: oneOf(kinds[index], ["required", "known_affected", "known_unaffected"] as const, "required"),
    }))
    .filter((constraint) => constraint.technologySlug !== "");
}

function parseSources(form: FormData): Draft["sources"] {
  const urls = form.getAll("sourceUrl");
  const titles = form.getAll("sourceTitle");
  const types = form.getAll("sourceType");

  return urls
    .slice(0, 10)
    .map((url, index) => ({
      url: text(url, 500),
      title: text(titles[index], 200),
      sourceType: oneOf(types[index], SOURCE_TYPES, "other") as SourceType,
    }))
    .filter((source) => source.url !== "");
}

function parseSignatures(form: FormData): Draft["errorSignatures"] {
  const messages = form.getAll("signatureMessage");
  const codes = form.getAll("signatureCode");

  return messages
    .slice(0, 8)
    .map((message, index) => ({
      errorCode: nullable(codes[index], 80),
      normalisedMessage: text(message, 500),
    }))
    .filter((signature) => signature.normalisedMessage !== "" || signature.errorCode !== null);
}

function list(form: FormData, name: string, maxLength: number, maxCount: number): string[] {
  return form
    .getAll(name)
    .map((value) => text(value, maxLength))
    .filter((value) => value !== "")
    .slice(0, maxCount);
}

function text(value: FormDataEntryValue | null | undefined, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function nullable(value: FormDataEntryValue | null | undefined, maxLength: number): string | null {
  const trimmed = text(value, maxLength);
  return trimmed === "" ? null : trimmed;
}

function oneOf<T extends string>(
  value: FormDataEntryValue | null | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  const candidate = typeof value === "string" ? value : "";
  return (allowed as readonly string[]).includes(candidate) ? (candidate as T) : fallback;
}

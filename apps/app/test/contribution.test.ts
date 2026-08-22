import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyDraftDocument, type DraftDocument } from "@devyou/schemas";
import { ApiError } from "@devyou/core";
import {
  createDraft,
  dispatchStructuring,
  evaluateGate,
  graphFor,
  loadDraft,
  publishDraft,
  recordConfirmations,
  safetySweep,
  saveDocument,
  unconfirmedInferredFields,
} from "../app/lib/contribution.server";
import { documentFromForm } from "../app/lib/draft-form.server";

/**
 * The contribution pipeline, against the real schema and the real triggers.
 *
 * Every test here targets a rule that would be trivially easy to break with a
 * plausible-looking refactor, and impossible to notice afterwards:
 *
 * - a draft is private to its author;
 * - a model's inference cannot reach a reader without a person;
 * - publishing an edit produces a new revision with no evidence, and the old one
 *   keeps its own.
 *
 * These write through the real server functions rather than raw SQL, because what
 * is under test is the pipeline's behaviour and not the table shape —
 * `invariants.test.ts` covers the database's own enforcement.
 */

let counter = 0;
let author: string;
let stranger: string;

async function exec(sql: string, ...bindings: unknown[]): Promise<void> {
  await env.DB.prepare(sql)
    .bind(...(bindings as never[]))
    .run();
}

beforeEach(async () => {
  const n = (counter += 1);
  author = `c${n}_author`;
  stranger = `c${n}_stranger`;

  for (const id of [author, stranger]) {
    await exec(
      "INSERT INTO users (id, created_at, status, role) VALUES (?, 1, 'active', 'contributor')",
      id,
    );
  }
  await exec(
    "INSERT OR IGNORE INTO technologies (id, slug, name, type, status, created_at) VALUES ('tec_node', 'node', 'Node.js', 'runtime', 'active', 1)",
  );
});

/** A document that passes every gate: one start, a test with both outcomes, a
 *  conclusion, one applicability constraint. */
function publishable(): DraftDocument {
  return {
    ...emptyDraftDocument(),
    title: "Build hangs after upgrading",
    summary: "The build produces no output and never exits.",
    problemTitle: "Build hangs with no output",
    problemSummary: "Nothing is printed and the process never exits.",
    symptoms: ["the build hangs with no output"],
    errorSignatures: [{ errorCode: "ETIMEDOUT", normalisedMessage: "operation timed out" }],
    technologySlugs: ["node"],
    constraints: [
      {
        technologySlug: "node",
        minSemver: "20.0.0",
        maxSemver: "22.0.0",
        maxInclusive: false,
        architecture: null,
        kind: "required",
      },
    ],
    nodes: [
      {
        key: "n1",
        nodeType: "start",
        title: "Confirm the symptom",
        body: "Run the build and watch for output.",
        commandText: null,
        commandLanguage: null,
        expectedOutput: null,
        safetyLevel: "informational",
        safetyEffect: null,
      },
      {
        key: "n2",
        nodeType: "test",
        title: "Check whether the cache is stale",
        body: "Look at the cache directory's timestamp.",
        commandText: "ls -la .cache",
        commandLanguage: "bash",
        expectedOutput: "a recent timestamp",
        safetyLevel: "informational",
        safetyEffect: null,
      },
      {
        key: "n3",
        nodeType: "root_cause",
        title: "A stale cache",
        body: "The cache predates the upgrade.",
        commandText: null,
        commandLanguage: null,
        expectedOutput: null,
        safetyLevel: "informational",
        safetyEffect: null,
      },
    ],
    edges: [
      { fromKey: "n1", toKey: "n2", condition: "passed", label: null },
      { fromKey: "n1", toKey: "n2", condition: "failed", label: null },
      { fromKey: "n2", toKey: "n3", condition: "failed", label: "timestamp is old" },
      { fromKey: "n2", toKey: "n3", condition: "passed", label: null },
      { fromKey: "n2", toKey: "n3", condition: "unknown", label: null },
    ],
  };
}

async function readyDraft(document = publishable()): Promise<string> {
  const draftId = await createDraft(env.DB, { authorId: author, rawText: "notes" });
  await saveDocument(env.DB, draftId, document, "editing");
  return draftId;
}

describe("a draft belongs to its author", () => {
  it("is invisible to anybody else", async () => {
    const draftId = await createDraft(env.DB, { authorId: author, rawText: "private notes" });

    expect(await loadDraft(env.DB, draftId, author)).not.toBeNull();
    /* Null, not a permission error — the route turns this into a 404, so an
       unpublished draft's existence cannot be probed for. */
    expect(await loadDraft(env.DB, draftId, stranger)).toBeNull();
  });
});

describe("structuring is dispatched, never awaited", () => {
  it("ledgers the job against the draft and leaves the draft waiting", async () => {
    const draftId = await createDraft(env.DB, { authorId: author, rawText: "some notes" });
    const taskId = await dispatchStructuring(env.DB, env.EVENTS, {
      draftId,
      requestedBy: author,
      rawText: "some notes",
    });

    const task = await env.DB.prepare(
      `SELECT task_type, status, requested_by, input_hash FROM ai_tasks WHERE id = ?1`,
    )
      .bind(taskId)
      .first<{ task_type: string; status: string; requested_by: string; input_hash: string }>();

    expect(task?.task_type).toBe("structure_contribution");
    expect(task?.status).toBe("queued");
    expect(task?.requested_by).toBe(author);
    expect(task?.input_hash).toHaveLength(64);

    const draft = await loadDraft(env.DB, draftId, author);
    expect(draft?.status).toBe("structuring");
    expect(draft?.aiTaskId).toBe(taskId);
    /* Nothing has been proposed yet, and the review screen must cope with that
       rather than wait for it. */
    expect(draft?.document).toBeNull();
  });

  it("records a dispatch failure instead of failing the contribution", async () => {
    const draftId = await createDraft(env.DB, { authorId: author, rawText: "some notes" });
    /* The binding is absent on a deployment where the queue was never wired up.
       The draft must survive that — structuring is assistance, not a dependency. */
    const taskId = await dispatchStructuring(env.DB, undefined, {
      draftId,
      requestedBy: author,
      rawText: "some notes",
    });

    const task = await env.DB.prepare(`SELECT status, error_detail FROM ai_tasks WHERE id = ?1`)
      .bind(taskId)
      .first<{ status: string; error_detail: string }>();

    expect(task?.status).toBe("failed");
    expect(await loadDraft(env.DB, draftId, author)).not.toBeNull();
  });
});

describe("AI output cannot reach a reader on its own", () => {
  it("blocks publication while an inferred field is unconfirmed", async () => {
    const draftId = await readyDraft();
    await exec(
      `INSERT INTO draft_field_provenance (id, draft_id, field_path, provenance, original_value, basis)
       VALUES (?, ?, '/problemTitle', 'ai_inferred_requires_confirmation', 'Build hangs with no output', 'inferred from the stack trace')`,
      `${draftId}_p1`,
      draftId,
    );

    const draft = await loadDraft(env.DB, draftId, author);
    const gate = await evaluateGate(env.DB, draft!, draft!.document!);

    expect(gate.decision.allowed).toBe(false);
    expect(gate.decision.blockers.map((blocker) => blocker.code)).toContain(
      "unconfirmed_ai_fields",
    );
  });

  it("refuses at the write even when the caller asks anyway", async () => {
    const draftId = await readyDraft();
    await exec(
      `INSERT INTO draft_field_provenance (id, draft_id, field_path, provenance, original_value)
       VALUES (?, ?, '/summary', 'ai_inferred_requires_confirmation', 'The build produces no output and never exits.')`,
      `${draftId}_p1`,
      draftId,
    );

    const draft = await loadDraft(env.DB, draftId, author);
    await expect(publishDraft(env.DB, draft!, draft!.document!, author)).rejects.toSatisfy(
      (error: unknown) => ApiError.is(error) && error.code === "CONFLICT",
    );

    const playbooks = await env.DB.prepare(`SELECT COUNT(*) AS n FROM playbooks`).first<{
      n: number;
    }>();
    expect(playbooks?.n).toBe(0);
  });

  it("treats an edited field as the author's own, and an unticked box as unread", async () => {
    const document = publishable();
    const draftId = await readyDraft(document);

    await exec(
      `INSERT INTO draft_field_provenance (id, draft_id, field_path, provenance, original_value)
       VALUES (?, ?, '/problemTitle', 'ai_inferred_requires_confirmation', ?)`,
      `${draftId}_p1`,
      draftId,
      document.problemTitle,
    );
    await exec(
      `INSERT INTO draft_field_provenance (id, draft_id, field_path, provenance, original_value)
       VALUES (?, ?, '/summary', 'ai_inferred_requires_confirmation', ?)`,
      `${draftId}_p2`,
      draftId,
      document.summary,
    );

    // The author rewrites one field and ticks nothing.
    const edited = { ...document, problemTitle: "The build never terminates" };
    await saveDocument(env.DB, draftId, edited, "editing");
    await recordConfirmations(env.DB, draftId, author, edited, new Set());

    expect(await unconfirmedInferredFields(env.DB, draftId)).toEqual(["/summary"]);

    // Now they tick the other one.
    await recordConfirmations(env.DB, draftId, author, edited, new Set(["/summary"]));
    expect(await unconfirmedInferredFields(env.DB, draftId)).toEqual([]);

    // Unticking withdraws it again — a confirmation is not permanent.
    await recordConfirmations(env.DB, draftId, author, edited, new Set());
    expect(await unconfirmedInferredFields(env.DB, draftId)).toEqual(["/summary"]);
  });
});

describe("a form only edits what it declares", () => {
  /** The narrative fields both screens always carry, so a parse has something to
   *  keep. Everything interesting in these tests is what is *absent*. */
  function narrative(form: FormData, document: DraftDocument): void {
    form.set("title", document.title);
    form.set("summary", document.summary);
    form.set("problemTitle", document.problemTitle);
    form.set("problemSummary", document.problemSummary);
    for (const node of document.nodes) {
      form.append("nodeKey", node.key);
      form.append("nodeType", node.nodeType);
      form.append("nodeTitle", node.title);
      form.append("nodeBody", node.body);
      form.append("nodeCommand", node.commandText ?? "");
      form.append("nodeLanguage", node.commandLanguage ?? "");
      form.append("nodeExpected", node.expectedOutput ?? "");
      form.append("nodeSafety", node.safetyLevel);
      form.append("nodeEffect", node.safetyEffect ?? "");
    }
  }

  it("keeps what the review screen never showed", () => {
    const base = publishable();
    const form = new FormData();
    form.append("scope", "nodes");
    narrative(form, base);

    const { document } = documentFromForm(form, base);

    /* The review screen has no technology checkboxes, no branch rows and no
       reference rows. An empty FormData for those must mean "not mine", never
       "the author cleared them". */
    expect(document.technologySlugs).toEqual(base.technologySlugs);
    expect(document.constraints).toEqual(base.constraints);
    expect(document.sources).toEqual(base.sources);
    expect(document.edges).toEqual(base.edges);
  });

  it("lets the editor remove the last of something", () => {
    const base = publishable();
    const form = new FormData();
    for (const scope of ["nodes", "edges", "applicability", "sources"]) {
      form.append("scope", scope);
    }
    narrative(form, base);

    const { document } = documentFromForm(form, base);

    expect(document.technologySlugs).toEqual([]);
    expect(document.constraints).toEqual([]);
    expect(document.edges).toEqual([]);
  });
});

describe("the deterministic checks outrank what anybody declared", () => {
  it("raises a command's safety level above the author's own answer", () => {
    const document = publishable();
    document.nodes[1]!.commandText = "rm -rf /var/lib/postgresql";
    document.nodes[1]!.safetyLevel = "informational";

    const { nodes, upgraded } = graphFor(document);

    expect(nodes[1]!.safetyLevel).toBe("destructive");
    expect(upgraded).toHaveLength(1);
  });

  it("finds a credential pasted into a step after the submission check", () => {
    const document = publishable();
    document.nodes[0]!.body = "export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

    expect(safetySweep(document).length).toBeGreaterThan(0);
  });
});

describe("publishing", () => {
  it("creates a published revision that starts with no reproduction", async () => {
    const draftId = await readyDraft();
    const draft = await loadDraft(env.DB, draftId, author);

    const result = await publishDraft(env.DB, draft!, draft!.document!, author);
    expect(result.revisionNumber).toBe(1);

    const revision = await env.DB.prepare(
      `SELECT r.status, r.published_at, c.band, c.reproduced_passed
       FROM playbook_revisions r
       JOIN revision_confidence c ON c.revision_id = r.id
       WHERE r.id = ?1`,
    )
      .bind(result.revisionId)
      .first<{ status: string; published_at: number; band: string; reproduced_passed: number }>();

    expect(revision?.status).toBe("published");
    expect(revision?.band).toBe("unverified");
    expect(revision?.reproduced_passed).toBe(0);

    const evidence = await env.DB.prepare(
      `SELECT evidence_type FROM evidence_records WHERE revision_id = ?1`,
    )
      .bind(result.revisionId)
      .all<{ evidence_type: string }>();

    /* Exactly one record, and it is the author's own documentation — evidence that
       a procedure was written down, never evidence that it works. */
    expect(evidence.results.map((row) => row.evidence_type)).toEqual([
      "contributor_documentation",
    ]);

    const indexed = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM playbook_fts WHERE revision_id = ?1`,
    )
      .bind(result.revisionId)
      .first<{ n: number }>();
    expect(indexed?.n).toBe(1);

    const draftAfter = await loadDraft(env.DB, draftId, author);
    expect(draftAfter?.status).toBe("published");
  });

  it("does not carry evidence across a revision", async () => {
    const first = await readyDraft();
    const firstDraft = await loadDraft(env.DB, first, author);
    const published = await publishDraft(env.DB, firstDraft!, firstDraft!.document!, author);

    // A reproduction lands on revision 1.
    await exec(
      "INSERT INTO environment_snapshots (id, created_at, label, os_family, fingerprint) VALUES (?, 1, 'Linux', 'linux', ?)",
      `${first}_env`,
      `${first}_fp`,
    );
    await exec(
      `INSERT INTO evidence_records (id, revision_id, evidence_type, result, actor_id, environment_snapshot_id, created_at)
       VALUES (?, ?, 'reproduction', 'passed', ?, ?, 1)`,
      `${first}_ev`,
      published.revisionId,
      stranger,
      `${first}_env`,
    );

    const playbook = await env.DB.prepare(`SELECT id FROM playbooks WHERE slug = ?1`)
      .bind(published.playbookSlug)
      .first<{ id: string }>();

    const second = await createDraft(env.DB, {
      authorId: author,
      rawText: "a correction",
      playbookId: playbook!.id,
      basedOnRevisionId: published.revisionId,
      document: { ...publishable(), changeSummary: "Corrected the cache path." },
    });
    const secondDraft = await loadDraft(env.DB, second, author);
    const next = await publishDraft(env.DB, secondDraft!, secondDraft!.document!, author);

    expect(next.revisionNumber).toBe(2);
    expect(next.playbookSlug).toBe(published.playbookSlug);

    const carried = await env.DB.prepare(
      `SELECT evidence_type FROM evidence_records WHERE revision_id = ?1`,
    )
      .bind(next.revisionId)
      .all<{ evidence_type: string }>();
    expect(carried.results.map((row) => row.evidence_type)).toEqual([
      "contributor_documentation",
    ]);

    const band = await env.DB.prepare(`SELECT band FROM revision_confidence WHERE revision_id = ?1`)
      .bind(next.revisionId)
      .first<{ band: string }>();
    expect(band?.band).toBe("unverified");

    // The old revision keeps its own evidence and stays readable.
    const previous = await env.DB.prepare(
      `SELECT status, superseded_at,
              (SELECT COUNT(*) FROM evidence_records e WHERE e.revision_id = ?1) AS evidence
       FROM playbook_revisions WHERE id = ?1`,
    )
      .bind(published.revisionId)
      .first<{ status: string; superseded_at: number; evidence: number }>();

    expect(previous?.status).toBe("superseded");
    expect(previous?.superseded_at).toBeGreaterThan(0);
    expect(previous?.evidence).toBe(2);

    const current = await env.DB.prepare(`SELECT current_revision_id FROM playbooks WHERE id = ?1`)
      .bind(playbook!.id)
      .first<{ current_revision_id: string }>();
    expect(current?.current_revision_id).toBe(next.revisionId);

    /* One searchable document per playbook: the current revision. A superseded one
       competing in the results would push a different playbook off the page. */
    const documents = await env.DB.prepare(
      `SELECT revision_id FROM playbook_fts WHERE playbook_id = ?1`,
    )
      .bind(playbook!.id)
      .all<{ revision_id: string }>();
    expect(documents.results.map((row) => row.revision_id)).toEqual([next.revisionId]);
  });

  it("refuses a playbook that does not say where it applies", async () => {
    const draftId = await readyDraft({ ...publishable(), constraints: [] });
    const draft = await loadDraft(env.DB, draftId, author);
    const gate = await evaluateGate(env.DB, draft!, draft!.document!);

    expect(gate.decision.blockers.map((blocker) => blocker.code)).toContain(
      "no_environment_constraints",
    );
  });

  it("refuses a test with no route for a failure", async () => {
    const document = publishable();
    document.edges = document.edges.filter(
      (edge) => !(edge.fromKey === "n2" && edge.condition === "failed"),
    );

    const draftId = await readyDraft(document);
    const draft = await loadDraft(env.DB, draftId, author);
    const gate = await evaluateGate(env.DB, draft!, draft!.document!);

    expect(gate.decision.blockers.map((blocker) => blocker.code)).toContain("graph_invalid");
    expect(gate.graph.problems.some((problem) => problem.code === "missing_branch")).toBe(true);
  });
});

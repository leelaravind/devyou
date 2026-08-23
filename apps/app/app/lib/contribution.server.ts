import { ApiError, MAX_RAW_TEXT, newId, slugify, uniqueSlug, type SafetyLevel } from "@devyou/core";
import {
  DraftDocument,
  emptyDraftDocument,
  readFieldPath,
  type DraftFieldProvenance,
} from "@devyou/schemas";
import {
  INITIAL_BAND,
  canPublish,
  validateGraph,
  type GraphEdge,
  type GraphNode,
} from "@devyou/domain";
import {
  classifyCommand,
  isProvablyReadOnly,
  checkUrl,
  looksLikeSecret,
  scanUnicode,
} from "@devyou/security";
import {
  INSERT_DOCUMENT_SQL,
  INSERT_SIGNATURE_DOCUMENT_SQL,
  buildSearchDocument,
  fingerprintSignature,
} from "@devyou/search";

/**
 * The contribution pipeline, server side.
 *
 * The whole of plan §10 lives behind these functions: capture, structuring
 * dispatch, human review, the editor, and the publication gate. Three rules run
 * through all of it and are the reason the code is shaped the way it is.
 *
 * **Nothing a model produced reaches a reader without a person.** The AI writes
 * `structured_json` and a set of `draft_field_provenance` rows, and that is the
 * end of its reach. `publishDraft` refuses while any inferred field is
 * unconfirmed, and it refuses by reading the provenance table rather than by
 * trusting a flag in the document — a contributor editing the JSON cannot clear
 * the requirement, because the requirement is not stored where they can reach it.
 *
 * **Publication is the only path from draft to public, and it always creates a new
 * immutable revision starting at zero evidence.** There is no update path. A
 * revision of an existing playbook supersedes the old one, which keeps its own
 * text and its own evidence at its own permanent URL.
 *
 * **A draft is private to its author and is never deleted.** `loadDraft` is
 * author-scoped and returns null for anybody else — 404 rather than 403, because a
 * 403 confirms the draft exists and turns this into an existence oracle for
 * unpublished work.
 */

export type DraftStatus =
  "capturing" | "structuring" | "awaiting_review" | "editing" | "ready" | "published" | "abandoned";

export interface DraftRecord {
  id: string;
  authorId: string;
  playbookId: string | null;
  basedOnRevisionId: string | null;
  rawText: string;
  /** The parsed document, or null when nothing has been structured or saved yet. */
  document: DraftDocument | null;
  /**
   * True when `structured_json` held something that failed the schema.
   *
   * Distinguished from "no document" so the review screen can say which happened.
   * A column holding JSON will eventually hold something written by an older
   * version of this code, and silently treating that as empty would discard an
   * author's work without telling them.
   */
  documentInvalid: boolean;
  status: DraftStatus;
  aiTaskId: string | null;
  createdAt: number;
  updatedAt: number;
  publishedRevisionId: string | null;
  /** Slug of the playbook this revises, when it revises one. */
  playbookSlug: string | null;
}

interface DraftRow {
  id: string;
  author_id: string;
  playbook_id: string | null;
  based_on_revision_id: string | null;
  raw_text: string;
  structured_json: string | null;
  status: string;
  ai_task_id: string | null;
  created_at: number;
  updated_at: number;
  published_revision_id: string | null;
  playbook_slug: string | null;
}

const DRAFT_COLUMNS = `
  d.id, d.author_id, d.playbook_id, d.based_on_revision_id, d.raw_text, d.structured_json,
  d.status, d.ai_task_id, d.created_at, d.updated_at, d.published_revision_id,
  p.slug AS playbook_slug
  FROM contribution_drafts d
  LEFT JOIN playbooks p ON p.id = d.playbook_id
`;

/** Drafts one contributor may open in a day. Each one is a potential AI call, so
 *  this is a spend ceiling as much as an abuse control — plan §11 asks for
 *  per-contributor limits and this is where they bite. */
export const DRAFTS_PER_DAY = 20;

/* ---------------------------------------------------------------------------
   Reading
   --------------------------------------------------------------------------- */

export async function loadDraft(
  db: D1Database,
  draftId: string,
  authorId: string,
): Promise<DraftRecord | null> {
  const row = await db
    .prepare(`SELECT ${DRAFT_COLUMNS} WHERE d.id = ?1 AND d.author_id = ?2`)
    .bind(draftId, authorId)
    .first<DraftRow>();

  return row ? toRecord(row) : null;
}

export async function listDrafts(db: D1Database, authorId: string): Promise<DraftRecord[]> {
  const rows = await db
    .prepare(`SELECT ${DRAFT_COLUMNS} WHERE d.author_id = ?1 ORDER BY d.updated_at DESC LIMIT 50`)
    .bind(authorId)
    .all<DraftRow>();

  return rows.results.map(toRecord);
}

function toRecord(row: DraftRow): DraftRecord {
  let document: DraftDocument | null = null;
  let documentInvalid = false;

  if (row.structured_json !== null) {
    const parsed = parseDocument(row.structured_json);
    document = parsed.document;
    documentInvalid = parsed.document === null;
  }

  return {
    id: row.id,
    authorId: row.author_id,
    playbookId: row.playbook_id,
    basedOnRevisionId: row.based_on_revision_id,
    rawText: row.raw_text,
    document,
    documentInvalid,
    status: row.status as DraftStatus,
    aiTaskId: row.ai_task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedRevisionId: row.published_revision_id,
    playbookSlug: row.playbook_slug,
  };
}

/** Parse and validate `structured_json`. Validation is not optional here: this is
 *  the boundary between a text column and typed code, and the JSON on the other
 *  side of it was last touched by a model. */
function parseDocument(json: string): { document: DraftDocument | null } {
  try {
    const result = DraftDocument.safeParse(JSON.parse(json));
    return { document: result.success ? result.data : null };
  } catch {
    return { document: null };
  }
}

/* ---------------------------------------------------------------------------
   Creating
   --------------------------------------------------------------------------- */

export interface NewDraft {
  authorId: string;
  rawText: string;
  /** Set when this revises an existing playbook. */
  playbookId?: string | null;
  basedOnRevisionId?: string | null;
  /** Seeded from the current revision when revising, so the author edits rather
   *  than retypes. Null on a first contribution. */
  document?: DraftDocument | null;
}

export async function createDraft(db: D1Database, input: NewDraft): Promise<string> {
  const id = newId("draft");
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `INSERT INTO contribution_drafts
         (id, author_id, playbook_id, based_on_revision_id, raw_text, structured_json,
          status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
    )
    .bind(
      id,
      input.authorId,
      input.playbookId ?? null,
      input.basedOnRevisionId ?? null,
      input.rawText.slice(0, MAX_RAW_TEXT),
      input.document ? JSON.stringify(input.document) : null,
      /*
        A draft that already has a document skips straight to review.

        Revising an existing playbook seeds the document from the current revision,
        so there is nothing for the structuring task to propose — running it anyway
        would spend tokens to re-derive text the author is about to edit.
      */
      input.document ? "awaiting_review" : "structuring",
      now,
    )
    .run();

  return id;
}

/**
 * Ask the jobs Worker to structure a draft.
 *
 * The public Worker holds no AI credential — see `wrangler.jsonc` — so this
 * dispatches and returns. It is deliberately not awaited into a result: plan §11
 * puts AI on a queue, and a request path that blocks on a model call is a request
 * path a visitor can hold open.
 *
 * The `ai_tasks` row is written **before** the send, and updated to `failed` if the
 * send throws. A ledger written after a successful dispatch would have no row for
 * the case worth explaining — the one where the message never left.
 */
export async function dispatchStructuring(
  db: D1Database,
  queue: Queue | undefined,
  input: { draftId: string; requestedBy: string; rawText: string },
): Promise<string> {
  const taskId = newId("aiTask");
  const now = Math.floor(Date.now() / 1000);
  const inputHash = await hashInput(input.rawText);

  await db
    .prepare(
      `INSERT INTO ai_tasks
         (id, task_type, provider, model, prompt_version, input_hash, status, requested_by, created_at)
       VALUES (?1, 'structure_contribution', 'queued', 'queued', 'pending', ?2, 'queued', ?3, ?4)`,
    )
    .bind(taskId, inputHash, input.requestedBy, now)
    .run();

  await db
    .prepare(`UPDATE contribution_drafts SET ai_task_id = ?1, updated_at = ?2 WHERE id = ?3`)
    .bind(taskId, now, input.draftId)
    .run();

  try {
    if (!queue) throw new Error("no EVENTS queue binding on this Worker");
    await queue.send({
      type: "structure_contribution",
      draftId: input.draftId,
      requestedBy: input.requestedBy,
      enqueuedAt: now,
    });
  } catch (error) {
    /*
      A dispatch failure is recorded and swallowed, never thrown.

      Structuring is assistance. A contributor whose draft could not be queued must
      still reach the review screen and write it themselves — failing their
      submission because an optional convenience was unavailable would make the
      model load-bearing, which is exactly what invariant 5 forbids.
    */
    await db
      .prepare(
        `UPDATE ai_tasks SET status = 'failed', error_detail = ?1, completed_at = ?2 WHERE id = ?3`,
      )
      .bind(String(error instanceof Error ? error.message : error).slice(0, 500), now, taskId)
      .run();
  }

  return taskId;
}

export interface AiTaskState {
  status: string;
  errorDetail: string | null;
  model: string;
  promptVersion: string;
  repairAttempted: boolean;
}

export async function loadAiTask(db: D1Database, taskId: string): Promise<AiTaskState | null> {
  const row = await db
    .prepare(
      `SELECT status, error_detail, model, prompt_version, repair_attempted
       FROM ai_tasks WHERE id = ?1`,
    )
    .bind(taskId)
    .first<{
      status: string;
      error_detail: string | null;
      model: string;
      prompt_version: string;
      repair_attempted: number;
    }>();

  return row
    ? {
        status: row.status,
        errorDetail: row.error_detail,
        model: row.model,
        promptVersion: row.prompt_version,
        repairAttempted: row.repair_attempted === 1,
      }
    : null;
}

/* ---------------------------------------------------------------------------
   Saving
   --------------------------------------------------------------------------- */

export async function saveDocument(
  db: D1Database,
  draftId: string,
  document: DraftDocument,
  status: DraftStatus,
): Promise<void> {
  await db
    .prepare(
      `UPDATE contribution_drafts SET structured_json = ?1, status = ?2, updated_at = ?3
       WHERE id = ?4 AND status NOT IN ('published', 'abandoned')`,
    )
    .bind(JSON.stringify(document), status, Math.floor(Date.now() / 1000), draftId)
    .run();
}

export async function abandonDraft(
  db: D1Database,
  draftId: string,
  authorId: string,
): Promise<void> {
  /*
    Abandoning sets a status. It does not delete anything.

    The raw text and every version of the structuring stay on the row and stay
    listed to their author. Contributions disappearing without explanation is the
    behaviour the adoption research names as fatal, and "I gave up on it" is not a
    reason to make an exception.
  */
  await db
    .prepare(
      `UPDATE contribution_drafts SET status = 'abandoned', updated_at = ?1
       WHERE id = ?2 AND author_id = ?3 AND status != 'published'`,
    )
    .bind(Math.floor(Date.now() / 1000), draftId, authorId)
    .run();
}

/* ---------------------------------------------------------------------------
   Provenance
   --------------------------------------------------------------------------- */

export interface ProvenanceRow extends DraftFieldProvenance {
  confirmedAt: number | null;
}

export async function loadProvenance(db: D1Database, draftId: string): Promise<ProvenanceRow[]> {
  const rows = await db
    .prepare(
      `SELECT field_path, provenance, original_value, basis, confirmed_at
       FROM draft_field_provenance WHERE draft_id = ?1 ORDER BY field_path`,
    )
    .bind(draftId)
    .all<{
      field_path: string;
      provenance: string;
      original_value: string | null;
      basis: string | null;
      confirmed_at: number | null;
    }>();

  return rows.results.map((row) => ({
    fieldPath: row.field_path,
    provenance: row.provenance as ProvenanceRow["provenance"],
    originalValue: row.original_value,
    basis: row.basis,
    confirmedAt: row.confirmed_at,
  }));
}

/**
 * Record what the author did with each AI-inferred field.
 *
 * There are exactly two ways an inferred field stops blocking publication, and both
 * require the author to have acted:
 *
 * - They **changed** it. The value in the document no longer matches what the model
 *   proposed, so the field becomes `user_supplied` and the model's version is kept
 *   in `original_value` as the record of what it got wrong.
 * - They **confirmed** it, explicitly, by ticking the box beside it. The provenance
 *   stays `ai_inferred_requires_confirmation` — that it came from a model is a
 *   permanent fact about the field — and `confirmed_at` records that a person read
 *   it.
 *
 * Nothing else clears one. In particular, saving the form does not: an author who
 * clicks through the review screen without reading has published nothing.
 */
export async function recordConfirmations(
  db: D1Database,
  draftId: string,
  userId: string,
  document: DraftDocument,
  confirmedPaths: ReadonlySet<string>,
): Promise<void> {
  const rows = await loadProvenance(db, draftId);
  if (rows.length === 0) return;

  const now = Math.floor(Date.now() / 1000);
  const statements: D1PreparedStatement[] = [];

  for (const row of rows) {
    if (row.provenance !== "ai_inferred_requires_confirmation") continue;

    const current = readFieldPath(document, row.fieldPath);
    const edited = current !== null && current !== row.originalValue;

    if (edited) {
      statements.push(
        db
          .prepare(
            `UPDATE draft_field_provenance
             SET provenance = 'user_supplied', confirmed_at = ?1, confirmed_by = ?2
             WHERE draft_id = ?3 AND field_path = ?4`,
          )
          .bind(now, userId, draftId, row.fieldPath),
      );
      continue;
    }

    if (confirmedPaths.has(row.fieldPath)) {
      statements.push(
        db
          .prepare(
            `UPDATE draft_field_provenance SET confirmed_at = ?1, confirmed_by = ?2
             WHERE draft_id = ?3 AND field_path = ?4`,
          )
          .bind(now, userId, draftId, row.fieldPath),
      );
      continue;
    }

    /*
      An unticked box withdraws a previous confirmation.

      Reconfirming has to be possible to *lose*, or a field confirmed once and then
      re-proposed differently by a re-run would carry the old confirmation forward —
      which is the same defect as evidence surviving an edit, on a smaller scale.
    */
    statements.push(
      db
        .prepare(
          `UPDATE draft_field_provenance SET confirmed_at = NULL, confirmed_by = NULL
           WHERE draft_id = ?1 AND field_path = ?2`,
        )
        .bind(draftId, row.fieldPath),
    );
  }

  if (statements.length > 0) await db.batch(statements);
}

export async function unconfirmedInferredFields(
  db: D1Database,
  draftId: string,
): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT field_path FROM draft_field_provenance
       WHERE draft_id = ?1 AND provenance = 'ai_inferred_requires_confirmation'
         AND confirmed_at IS NULL`,
    )
    .bind(draftId)
    .all<{ field_path: string }>();

  return rows.results.map((row) => row.field_path);
}

/* ---------------------------------------------------------------------------
   The graph, and the safety sweep
   --------------------------------------------------------------------------- */

/**
 * A draft's nodes as the graph validator wants them, with the deterministic
 * command classification applied.
 *
 * The author's `safetyLevel` is a floor, never a ceiling: `classifyCommand` runs
 * over the same text and the more severe answer wins. A model that under-rates
 * `rm -rf` cannot make it look safe, because the regex does not care what the model
 * thought — and neither can an author who picked "read-only" from a dropdown.
 */
export function graphFor(document: DraftDocument): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Nodes where the classifier disagreed with the author, upward. */
  upgraded: Array<{ key: string; title: string; declared: SafetyLevel; classified: SafetyLevel }>;
} {
  const upgraded: Array<{
    key: string;
    title: string;
    declared: SafetyLevel;
    classified: SafetyLevel;
  }> = [];

  const nodes = document.nodes.map((node) => {
    const effective = effectiveSafety(node.commandText, node.safetyLevel);
    if (effective !== node.safetyLevel) {
      upgraded.push({
        key: node.key,
        title: node.title,
        declared: node.safetyLevel,
        classified: effective,
      });
    }
    return {
      id: node.key,
      nodeType: node.nodeType,
      title: node.title,
      commandText: node.commandText,
      safetyLevel: effective,
      safetyEffect: node.safetyEffect,
    };
  });

  const edges = document.edges.map((edge, index) => ({
    id: `e${index}`,
    fromNodeId: edge.fromKey,
    toNodeId: edge.toKey,
    conditionType: edge.condition,
  }));

  return { nodes, edges, upgraded };
}

const SEVERITY: readonly SafetyLevel[] = [
  "informational",
  "state_changing",
  "destructive",
  "credential_sensitive",
];

/**
 * The safety level a reader is actually shown.
 *
 * Two rules, and the asymmetry between them is the point.
 *
 * **Deterministic evidence always wins upward.** If `classifyCommand` finds
 * something more dangerous than the author or the model declared, that wins. A model
 * that under-classifies `rm -rf /` cannot make it look safe, because the regex does
 * not care what the model thought. This direction is never negotiable.
 *
 * **Deterministic evidence may also correct a false alarm downward — but only on
 * positive proof.** `isProvablyReadOnly` returns true for command forms it
 * recognises as reads and false for everything else, including everything it does
 * not understand. That is a different thing from `classifyCommand` returning
 * `informational`, which only means no rule matched: `curl x | sh` scores
 * `informational` and is arbitrary code execution. Capping on "no rule matched"
 * would be a downgrade on absence of evidence; capping on a positive proof is not.
 *
 * The second rule exists because a false danger signal has a cost. Production run
 * 2026-08-23 had the model mark
 * `wrangler ... d1 execute my-db --remote --command "SELECT 1"` as `destructive`
 * — a read. Left standing, a reader learns the red label means nothing, which is
 * exactly the defect `targetsOnlyRegenerablePaths` exists to prevent for
 * `rm -rf ./node_modules`, arriving by a different route.
 */
export function effectiveSafety(command: string | null, declared: SafetyLevel): SafetyLevel {
  if (command === null || command.trim() === "") return declared;

  const { level } = classifyCommand(command);
  if (SEVERITY.indexOf(level) > SEVERITY.indexOf(declared)) return level;

  /* Only a proof lowers anything, and it can never lower below what the classifier
     itself found — `level` is the floor, not `informational`. */
  if (SEVERITY.indexOf(declared) > SEVERITY.indexOf(level) && isProvablyReadOnly(command)) {
    return level;
  }

  return declared;
}

/**
 * The deterministic safety sweep, run at the gate rather than at submission.
 *
 * Submission already refuses hidden Unicode and credential-shaped strings in the
 * raw paste. This runs again over the *edited* document, because everything between
 * capture and here is editable — a contributor can paste a key into a node body on
 * the editor screen, and the check that only guarded the front door would miss it.
 *
 * Findings here block publication. They are deliberately not a moderation
 * suggestion: nothing on this list needs a judgement.
 */
export function safetySweep(document: DraftDocument): string[] {
  const findings: string[] = [];

  const fields: Array<{ label: string; text: string }> = [
    { label: "the title", text: document.title },
    { label: "the summary", text: document.summary },
    { label: "the problem summary", text: document.problemSummary },
    ...document.nodes.flatMap((node) => [
      { label: `"${node.title || node.key}"`, text: node.body },
      { label: `the command in "${node.title || node.key}"`, text: node.commandText ?? "" },
      {
        label: `the expected output of "${node.title || node.key}"`,
        text: node.expectedOutput ?? "",
      },
    ]),
  ];

  for (const field of fields) {
    if (field.text === "") continue;
    if (scanUnicode(field.text).length > 0) {
      findings.push(`${field.label} contains invisible characters.`);
    }
    if (looksLikeSecret(field.text)) {
      findings.push(`${field.label} contains something shaped like a credential.`);
    }
  }

  for (const source of document.sources) {
    const verdict = checkUrl(source.url);
    if (!verdict.safe) {
      findings.push(
        `the reference ${source.url} is not a safe link: ${verdict.reason ?? "rejected"}`,
      );
    }
  }

  return findings;
}

/** Nodes carrying a command with no stated effect above `informational`. The gate
 *  needs the list, not just a count, so the editor can point at them. */
export function unclassifiedCommandNodes(document: DraftDocument): string[] {
  return document.nodes
    .filter((node) => {
      if (node.commandText === null || node.commandText.trim() === "") return false;
      return (
        effectiveSafety(node.commandText, node.safetyLevel) !== "informational" &&
        !node.safetyEffect
      );
    })
    .map((node) => node.title || node.key);
}

/* ---------------------------------------------------------------------------
   The publication gate
   --------------------------------------------------------------------------- */

export interface GateResult {
  decision: ReturnType<typeof canPublish>;
  graph: ReturnType<typeof validateGraph>;
  unconfirmed: string[];
  safety: string[];
}

/**
 * Everything the gate refuses on, assembled in one place.
 *
 * Called by the loader to show the author what is wrong, and again by the action
 * immediately before writing. Both, not either: the loader's answer is stale the
 * moment it renders, and a gate that only guards the screen is not a gate.
 */
export async function evaluateGate(
  db: D1Database,
  draft: DraftRecord,
  document: DraftDocument,
): Promise<GateResult> {
  const { nodes, edges } = graphFor(document);
  const graph = validateGraph(nodes, edges);
  const unconfirmed = await unconfirmedInferredFields(db, draft.id);
  const safety = safetySweep(document);

  const decision = canPublish({
    revision: {
      id: draft.id,
      playbookId: draft.playbookId ?? draft.id,
      revisionNumber: 0,
      status: "draft",
      /*
        A draft has no `publishedAt` by construction, so `already_published` can
        never fire from here. The blocker is checked anyway rather than skipped —
        `canPublish` is the single statement of what publication requires, and a
        caller that passes it a synthesised state it knows will pass one check has
        started deciding which of its rules apply.
      */
      publishedAt: draft.status === "published" ? draft.updatedAt : null,
      supersededAt: null,
      deprecatedAt: null,
      needsReverificationAt: null,
    },
    graphValid: graph.ok,
    unconfirmedInferredFields: unconfirmed,
    unclassifiedCommandNodes: unclassifiedCommandNodes(document),
    blockingSafetyFindings: safety,
    hasEnvironmentConstraints: document.constraints.length > 0,
  });

  return { decision, graph, unconfirmed, safety };
}

/* ---------------------------------------------------------------------------
   Publication
   --------------------------------------------------------------------------- */

export interface PublishResult {
  playbookSlug: string;
  revisionNumber: number;
  revisionId: string;
}

/**
 * Turn a draft into a published revision.
 *
 * One `db.batch`, in one transaction, in this order for a reason the triggers
 * enforce: the revision is inserted as a **draft**, its nodes and edges go in while
 * it is still one, and only then is `published_at` set. After that statement the
 * graph is frozen — `trg_nodes_no_insert_after_publish` rejects any node arriving
 * later, so the ordering here is not a style choice.
 *
 * The last four statements are the invariant, written out rather than implied:
 *
 * - a `contributor_documentation` evidence record, which is evidence that a
 *   procedure was written down and never evidence that it works;
 * - a `revision_confidence` row at `INITIAL_BAND` with explicit zeroes, on a
 *   revision of a playbook that had accumulated any amount of evidence;
 * - the previous revision marked superseded and left readable at its own URL,
 *   with its evidence still attached to it;
 * - the search document rebuilt so the *current* revision is what a reader finds.
 */
export async function publishDraft(
  db: D1Database,
  draft: DraftRecord,
  document: DraftDocument,
  authorId: string,
): Promise<PublishResult> {
  const gate = await evaluateGate(db, draft, document);
  if (!gate.decision.allowed) {
    /*
      Re-evaluated here even though the route already checked.

      The route's check answers a question about the screen the author was looking
      at. This one answers it about the write that is about to happen, which is the
      only version that matters — and a confirmation of a stale gate is exactly how
      an unconfirmed AI inference reaches a reader.
    */
    throw new ApiError("CONFLICT", {
      publicMessage: gate.decision.blockers.map((blocker) => blocker.message).join(" "),
      internalDetail: `draft ${draft.id} failed the gate at write time`,
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const technologyIds = await resolveTechnologies(db, document.technologySlugs);

  const existing = draft.playbookId
    ? await db
        .prepare(
          `SELECT p.id AS playbook_id, p.slug, p.problem_id, r.id AS revision_id,
                  r.revision_number
           FROM playbooks p
           JOIN playbook_revisions r ON r.id = p.current_revision_id
           WHERE p.id = ?1`,
        )
        .bind(draft.playbookId)
        .first<{
          playbook_id: string;
          slug: string;
          problem_id: string;
          revision_id: string;
          revision_number: number;
        }>()
    : null;

  const playbookId = existing?.playbook_id ?? newId("playbook");
  const problemId = existing?.problem_id ?? newId("problem");
  const revisionId = newId("revision");
  const revisionNumber = (existing?.revision_number ?? 0) + 1;

  const slug =
    existing?.slug ??
    uniqueSlug(document.title || document.problemTitle, await takenSlugs(db, document.title));

  const statements: D1PreparedStatement[] = [];

  if (!existing) {
    statements.push(
      db
        .prepare(
          `INSERT INTO problems (id, slug, canonical_title, summary, status, created_by, created_at)
           VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6)`,
        )
        .bind(
          problemId,
          uniqueSlug(document.problemTitle || document.title, await takenProblemSlugs(db)),
          document.problemTitle || document.title,
          document.problemSummary || document.summary,
          authorId,
          now,
        ),
      db
        .prepare(
          `INSERT INTO playbooks (id, problem_id, slug, status, visibility, created_by, created_at)
           VALUES (?1, ?2, ?3, 'draft', 'public', ?4, ?5)`,
        )
        .bind(playbookId, problemId, slug, authorId, now),
    );

    document.symptoms.forEach((description, index) => {
      statements.push(
        db
          .prepare(
            `INSERT INTO symptoms (id, problem_id, description, display_order) VALUES (?1, ?2, ?3, ?4)`,
          )
          .bind(newId("symptom"), problemId, description, index),
      );
    });
  }

  /*
    Error signatures are attached to the problem on every revision, not only the
    first.

    R-18 makes the exact-error path the first thing search tries, and a revision
    that documents a newly observed error string is the commonest way a new
    signature arrives. `INSERT OR IGNORE` on the hash keeps a re-stated one from
    duplicating.
  */
  for (const signature of document.errorSignatures) {
    const signatureId = newId("signature");
    const hash = fingerprintSignature({ errorCode: signature.errorCode });
    statements.push(
      db
        .prepare(
          `INSERT INTO problem_signatures
             (id, problem_id, error_code, normalized_message, signature_hash, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        )
        .bind(
          signatureId,
          problemId,
          signature.errorCode,
          signature.normalisedMessage,
          hash ?? signatureId,
          now,
        ),
      db
        .prepare(INSERT_SIGNATURE_DOCUMENT_SQL)
        .bind(signatureId, problemId, signature.errorCode ?? "", signature.normalisedMessage),
    );
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO playbook_revisions
           (id, playbook_id, revision_number, title, summary, change_summary, status,
            created_by, created_at, supersedes_revision_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'draft', ?7, ?8, ?9)`,
      )
      .bind(
        revisionId,
        playbookId,
        revisionNumber,
        document.title,
        document.summary,
        document.changeSummary === "" ? null : document.changeSummary,
        authorId,
        now,
        existing?.revision_id ?? null,
      ),
  );

  /** Draft node keys become row ids here, and nowhere else. */
  const nodeIdFor = new Map(document.nodes.map((node) => [node.key, newId("node")]));

  document.nodes.forEach((node, index) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO diagnostic_nodes
             (id, revision_id, node_type, title, body, command_text, command_language,
              expected_output, safety_level, safety_effect, display_order)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
        )
        .bind(
          nodeIdFor.get(node.key) as string,
          revisionId,
          node.nodeType,
          node.title,
          node.body,
          node.commandText,
          node.commandLanguage,
          node.expectedOutput,
          // The classifier's answer, not the author's, for the reason in `graphFor`.
          effectiveSafety(node.commandText, node.safetyLevel),
          node.safetyEffect,
          index,
        ),
    );
  });

  document.edges.forEach((edge, index) => {
    const from = nodeIdFor.get(edge.fromKey);
    const to = nodeIdFor.get(edge.toKey);
    if (!from || !to) return;
    statements.push(
      db
        .prepare(
          `INSERT INTO diagnostic_edges
             (id, revision_id, from_node_id, to_node_id, condition_type, condition_label, priority)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        )
        .bind(newId("edge"), revisionId, from, to, edge.condition, edge.label, index),
    );
  });

  /* The first technology the author listed *that resolves* is the primary one.
     Taking `technologySlugs[0]` regardless would leave a revision with no primary
     technology whenever the top entry was a slug the taxonomy does not have. */
  let primaryAssigned = false;
  for (const slug of document.technologySlugs) {
    const technologyId = technologyIds.get(slug);
    if (!technologyId) continue;
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO revision_technologies (revision_id, technology_id, is_primary)
           VALUES (?1, ?2, ?3)`,
        )
        .bind(revisionId, technologyId, primaryAssigned ? 0 : 1),
    );
    primaryAssigned = true;
  }

  for (const constraint of document.constraints) {
    const technologyId = technologyIds.get(constraint.technologySlug) ?? null;
    if (!technologyId) continue;
    statements.push(
      db
        .prepare(
          `INSERT INTO revision_environment_constraints
             (id, revision_id, technology_id, min_semver, max_semver, max_inclusive,
              architecture, constraint_kind)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
        )
        .bind(
          newId("constraint"),
          revisionId,
          technologyId,
          constraint.minSemver,
          constraint.maxSemver,
          constraint.maxInclusive ? 1 : 0,
          constraint.architecture,
          constraint.kind,
        ),
    );
  }

  for (const source of document.sources) {
    const verdict = checkUrl(source.url);
    // Unreachable in practice — `safetySweep` blocks the gate on an unsafe link.
    // Kept so no path exists from this function to an unchecked href.
    if (!verdict.safe || verdict.normalised === null) continue;
    const sourceId = newId("sourceReference");
    statements.push(
      db
        .prepare(
          `INSERT INTO source_references (id, url, title, source_type, retrieved_at)
           VALUES (?1, ?2, ?3, ?4, ?5)`,
        )
        .bind(sourceId, verdict.normalised, source.title, source.sourceType, now),
      db
        .prepare(
          `INSERT OR IGNORE INTO revision_source_references (revision_id, source_reference_id, node_id)
           VALUES (?1, ?2, NULL)`,
        )
        .bind(revisionId, sourceId),
    );
  }

  statements.push(
    // After this statement the graph above is frozen by the triggers.
    db
      .prepare(
        `UPDATE playbook_revisions SET status = 'published', published_at = ?1
         WHERE id = ?2 AND published_at IS NULL`,
      )
      .bind(now, revisionId),
    db
      .prepare(`UPDATE playbooks SET current_revision_id = ?1, status = 'published' WHERE id = ?2`)
      .bind(revisionId, playbookId),
  );

  if (existing) {
    statements.push(
      db
        .prepare(
          `UPDATE playbook_revisions SET status = 'superseded', superseded_at = ?1 WHERE id = ?2`,
        )
        .bind(now, existing.revision_id),
    );
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO evidence_records (id, revision_id, evidence_type, result, actor_id, created_at)
         VALUES (?1, ?2, 'contributor_documentation', 'passed', ?3, ?4)`,
      )
      .bind(newId("evidence"), revisionId, authorId, now),
    /*
      Zeroes, written out rather than left to a default.

      A reviewer skimming this function should be able to see that a new revision
      claims no reproduction it does not have — including a revision of a playbook
      whose previous version had plenty. `INITIAL_BAND` is imported rather than
      spelled, so the one place that decides what a new revision starts at stays the
      one place.
    */
    /*
      `official_references` is zero, and stays zero when the author cited ten
      sources.

      It counts `official_reference` *evidence records* — somebody's judgement that
      a cited document actually supports the claim — not links in a bibliography.
      Seeding it from `sources.length` would make "Supported by a cited official
      source" appear under a revision nobody has assessed, and would then be
      silently corrected to zero the first time `recomputeConfidence` runs, which is
      the worst of both. `scripts/publish-revision.mjs` does seed it that way; that
      is a defect in the seed path and is not copied here.
    */
    db
      .prepare(
        `INSERT INTO revision_confidence
           (revision_id, band, reproduced_passed, reproduced_partial, reproduced_failed,
            independent_confirmations, unique_environments, ci_executions,
            maintainer_attestations, official_references, computed_at)
         VALUES (?1, ?2, 0, 0, 0, 0, 0, 0, 0, 0, ?3)`,
      )
      .bind(revisionId, INITIAL_BAND, now),
  );

  /*
    Search follows the current revision only.

    The superseded revision's document is removed rather than kept alongside: two
    revisions of one playbook competing in the results would push a different
    playbook off the first page, and a reader searching an error wants the procedure
    that is current. The old revision stays reachable by URL and through history,
    which is where somebody looking for it actually goes.
  */
  const searchDocument = buildSearchDocument({
    revisionId,
    playbookId,
    title: document.title,
    summary: document.summary,
    problemTitle: document.problemTitle,
    problemSummary: document.problemSummary,
    errorStrings: document.errorSignatures.flatMap((signature) =>
      [signature.errorCode, signature.normalisedMessage].filter(
        (value): value is string => !!value,
      ),
    ),
    symptoms: document.symptoms,
    nodes: document.nodes.map((node) => ({
      title: node.title,
      body: node.body,
      expectedOutput: node.expectedOutput,
    })),
    technologies: document.technologySlugs.map((slug) => ({ name: slug, aliases: [] })),
    versionLabels: document.constraints.flatMap((constraint) =>
      [constraint.minSemver, constraint.maxSemver].filter((value): value is string => !!value),
    ),
  });

  statements.push(
    db.prepare(`DELETE FROM playbook_fts WHERE playbook_id = ?1`).bind(playbookId),
    db
      .prepare(INSERT_DOCUMENT_SQL)
      .bind(
        searchDocument.revisionId,
        searchDocument.playbookId,
        searchDocument.title,
        searchDocument.summary,
        searchDocument.errorText,
        searchDocument.nodeText,
        searchDocument.technologyText,
      ),
    db
      .prepare(
        `UPDATE contribution_drafts SET status = 'published', published_revision_id = ?1,
                updated_at = ?2 WHERE id = ?3`,
      )
      .bind(revisionId, now, draft.id),
  );

  await db.batch(statements);

  return { playbookSlug: slug, revisionNumber, revisionId };
}

/* ---------------------------------------------------------------------------
   Helpers
   --------------------------------------------------------------------------- */

/**
 * Map the document's technology slugs onto rows that exist.
 *
 * A slug with no row is dropped rather than created. `taxonomy:create` is an
 * administrative capability, and a technology invented at publish time files the
 * playbook under a name nobody searches for and nothing else links to.
 */
async function resolveTechnologies(
  db: D1Database,
  slugs: readonly string[],
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  if (slugs.length === 0) return resolved;

  const placeholders = slugs.map((_, index) => `?${index + 1}`).join(", ");
  const rows = await db
    .prepare(`SELECT id, slug FROM technologies WHERE slug IN (${placeholders})`)
    .bind(...(slugs as never[]))
    .all<{ id: string; slug: string }>();

  for (const row of rows.results) resolved.set(row.slug, row.id);
  return resolved;
}

async function takenSlugs(db: D1Database, title: string): Promise<Set<string>> {
  const base = slugify(title);
  const rows = await db
    .prepare(`SELECT slug FROM playbooks WHERE slug = ?1 OR slug LIKE ?2`)
    .bind(base, `${base}-%`)
    .all<{ slug: string }>();
  return new Set(rows.results.map((row) => row.slug));
}

async function takenProblemSlugs(db: D1Database): Promise<Set<string>> {
  const rows = await db.prepare(`SELECT slug FROM problems`).all<{ slug: string }>();
  return new Set(rows.results.map((row) => row.slug));
}

/** The cache key for a structuring call, and nothing else. Plan §11 caches by
 *  normalised input hash; whitespace is collapsed so a reformatted paste of the
 *  same trace is the same job. */
async function hashInput(text: string): Promise<string> {
  const normalised = text.replace(/\s+/g, " ").trim().toLowerCase();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalised));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A per-contributor daily ceiling, checked before a draft is opened.
 *
 * Returns false when the ceiling is reached. Counted in `rate_counters` rather than
 * inferred from `contribution_drafts`, because an abandoned draft still cost an AI
 * call and deleting rows is not how this product records anything.
 */
export async function withinDraftRate(db: D1Database, userId: string): Promise<boolean> {
  const window = Math.floor(Date.now() / 1000 / 86_400) * 86_400;
  const subject = `user:${userId}`;

  await db
    .prepare(
      `INSERT INTO rate_counters (id, subject, action, window_start, count)
       VALUES (?1, ?2, 'draft_create', ?3, 1)
       ON CONFLICT(subject, action, window_start) DO UPDATE SET count = count + 1`,
    )
    .bind(`rate_${subject}_draft_create_${window}`, subject, window)
    .run();

  const row = await db
    .prepare(
      `SELECT count FROM rate_counters WHERE subject = ?1 AND action = 'draft_create' AND window_start = ?2`,
    )
    .bind(subject, window)
    .first<{ count: number }>();

  return (row?.count ?? 0) <= DRAFTS_PER_DAY;
}

/**
 * Seed a document from a published revision, for a draft that revises one.
 *
 * The seed is a copy, not a reference. Nothing here points at a `diagnostic_nodes`
 * row: the nodes become fresh draft keys, so no amount of editing this document can
 * reach the revision it came from — which is the immutability guarantee arriving
 * before the trigger has to enforce it.
 */
export function seedFromRevision(input: {
  title: string;
  summary: string;
  problemTitle: string;
  problemSummary: string;
  symptoms: readonly string[];
  nodes: ReadonlyArray<{
    id: string;
    nodeType: DraftDocument["nodes"][number]["nodeType"];
    title: string;
    body: string;
    commandText: string | null;
    commandLanguage: string | null;
    expectedOutput: string | null;
    safetyLevel: SafetyLevel;
    safetyEffect: string | null;
  }>;
  edges: ReadonlyArray<{
    fromNodeId: string;
    toNodeId: string;
    conditionType: DraftDocument["edges"][number]["condition"];
  }>;
  technologySlugs: readonly string[];
  constraints: DraftDocument["constraints"];
  sources: DraftDocument["sources"];
}): DraftDocument {
  const keyFor = new Map(input.nodes.map((node, index) => [node.id, `n${index + 1}`]));

  return {
    ...emptyDraftDocument(),
    title: input.title,
    summary: input.summary,
    problemTitle: input.problemTitle,
    problemSummary: input.problemSummary,
    symptoms: [...input.symptoms].slice(0, 10),
    technologySlugs: [...input.technologySlugs].slice(0, 12),
    constraints: input.constraints,
    sources: input.sources,
    nodes: input.nodes.map((node) => ({
      key: keyFor.get(node.id) as string,
      nodeType: node.nodeType,
      title: node.title,
      body: node.body,
      commandText: node.commandText,
      commandLanguage: node.commandLanguage,
      expectedOutput: node.expectedOutput,
      safetyLevel: node.safetyLevel,
      safetyEffect: node.safetyEffect,
    })),
    edges: input.edges.flatMap((edge) => {
      const fromKey = keyFor.get(edge.fromNodeId);
      const toKey = keyFor.get(edge.toNodeId);
      return fromKey && toKey
        ? [{ fromKey, toKey, condition: edge.conditionType, label: null }]
        : [];
    }),
  };
}

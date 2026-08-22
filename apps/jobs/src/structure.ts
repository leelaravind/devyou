import { slugify } from "@devyou/core";
import {
  MODEL_PRICING,
  createAnthropicProvider,
  pricingFor,
  runTask,
  structureContributionTask,
  type StructureResult,
} from "@devyou/ai";
import {
  emptyDraftDocument,
  type DraftDocument,
  type DraftFieldProvenance,
} from "@devyou/schemas";

/**
 * Structuring a contribution.
 *
 * The model reads what a contributor pasted and proposes a shape for it. Three
 * things about that are enforced here rather than hoped for.
 *
 * **It only ever writes to a draft.** The two tables this touches are
 * `contribution_drafts` and `draft_field_provenance`, both private to one author,
 * plus its own `ai_tasks` ledger row. There is no statement in this file that
 * reaches a playbook, a revision, an evidence record or a confidence band, and
 * `@devyou/ai` cannot reach a database at all — so the strongest thing a successful
 * prompt injection can achieve is a bad suggestion on one person's private screen.
 *
 * **It refuses to overwrite a human.** A draft that has moved past `structuring` is
 * left alone. Without that check, a retried message would replace an author's
 * edited document with the model's original proposal, silently, some minutes after
 * they had finished correcting it.
 *
 * **A content failure is final, not retried.** A refusal, a schema mismatch or an
 * exhausted budget is recorded and the draft is released to review. Only an
 * infrastructure fault throws, because a retry is only ever the right answer to a
 * fault — retrying a prompt problem turns one bad submission into three paid calls.
 */

interface DraftRow {
  id: string;
  raw_text: string;
  status: string;
  ai_task_id: string | null;
}

export async function structureContribution(
  env: Env,
  message: { draftId: string; requestedBy: string },
): Promise<void> {
  const draft = await env.DB.prepare(
    `SELECT id, raw_text, status, ai_task_id FROM contribution_drafts WHERE id = ?1`,
  )
    .bind(message.draftId)
    .first<DraftRow>();

  if (!draft) return;

  /*
    The author is ahead of the queue, so the queue stands down.

    This is the case a redelivery creates: the message is retried, or arrives late,
    after the contributor has already reviewed and edited the draft. Writing the
    proposal now would replace their work with the model's — the exact inversion of
    "AI is assistive" — so the job records nothing and stops.
  */
  if (draft.status !== "structuring") return;

  const taskId = draft.ai_task_id;
  if (!taskId) return;

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    await finish(env, draft.id, taskId, {
      status: "refused",
      detail: "no AI credential is configured on this deployment",
    });
    return;
  }

  const remaining = await remainingBudget(env);
  if (remaining <= 0) {
    await finish(env, draft.id, taskId, {
      status: "budget_exceeded",
      detail: "the daily AI spend ceiling for this deployment has been reached",
    });
    return;
  }

  const model = "claude-opus-5";
  const pricing = pricingFor(model);
  const provider = createAnthropicProvider({ apiKey, model });

  await env.DB.prepare(
    `UPDATE ai_tasks SET status = 'running', provider = ?1, model = ?2, prompt_version = ?3 WHERE id = ?4`,
  )
    .bind(provider.name, model, structureContributionTask.promptVersion, taskId)
    .run();

  const started = Date.now();
  const outcome = await runTask(provider, structureContributionTask, draft.raw_text, {
    remainingBudgetMicroUsd: remaining,
    costPerMillionInputMicroUsd: pricing.input,
    costPerMillionOutputMicroUsd: pricing.output,
  });
  const latencyMs = Date.now() - started;

  if (outcome.status !== "ok") {
    await finish(env, draft.id, taskId, {
      status: outcome.status === "failed" ? "failed" : outcome.status,
      detail: "detail" in outcome ? outcome.detail : "",
      latencyMs,
    });
    return;
  }

  const known = await knownTechnologySlugs(env);
  const { document, provenance } = toDraft(outcome.value, known);

  const now = Math.floor(Date.now() / 1000);
  const cost =
    (outcome.usage.inputTokens / 1_000_000) * pricing.input +
    (outcome.usage.outputTokens / 1_000_000) * pricing.output;

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE contribution_drafts SET structured_json = ?1, status = 'awaiting_review', updated_at = ?2
       WHERE id = ?3 AND status = 'structuring'`,
    ).bind(JSON.stringify(document), now, draft.id),
    /*
      Provenance is replaced wholesale rather than merged.

      A second structuring of the same draft describes a different proposal, and a
      confirmation the author gave against the previous one says nothing about this
      one. Carrying it forward would be the same defect as evidence surviving an
      edit, on a smaller scale.
    */
    env.DB.prepare(`DELETE FROM draft_field_provenance WHERE draft_id = ?1`).bind(draft.id),
    ...provenance.map((row, index) =>
      env.DB.prepare(
        `INSERT INTO draft_field_provenance
           (id, draft_id, field_path, provenance, original_value, basis)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(
        `${draft.id}_fp${index}`,
        draft.id,
        row.fieldPath,
        row.provenance,
        row.originalValue,
        row.basis,
      ),
    ),
    env.DB.prepare(
      `UPDATE ai_tasks SET status = 'succeeded', input_tokens = ?1, output_tokens = ?2,
              cost_micro_usd = ?3, latency_ms = ?4, repair_attempted = ?5,
              model = ?6, completed_at = ?7
       WHERE id = ?8`,
    ).bind(
      outcome.usage.inputTokens,
      outcome.usage.outputTokens,
      Math.ceil(cost),
      latencyMs,
      outcome.repaired ? 1 : 0,
      outcome.usage.model,
      now,
      taskId,
    ),
  ]);
}

/* ---------------------------------------------------------------------------
   Mapping the model's answer onto the draft document
   --------------------------------------------------------------------------- */

/**
 * Turn a validated `StructureResult` into a document and its provenance rows.
 *
 * Every tracked field produces a provenance row, and the ones the model classified
 * as `ai_inferred_requires_confirmation` are what the publish gate refuses on until
 * a person has looked at each. The model's own value is kept in `original_value`,
 * which is how "the author changed it" is later distinguished from "the author
 * ticked it" — see `recordConfirmations` in the app.
 *
 * Node fields are recorded as `ai_extracted` rather than as inferences. That is the
 * strongest honest claim available: `structuredNode` carries no per-field
 * provenance, so the model has not told us which parts of a step it read and which
 * it filled in. The review screen says so in those words and asks the author to
 * delete any step they did not actually run.
 */
export function toDraft(
  result: StructureResult,
  knownSlugs: ReadonlySet<string>,
): { document: DraftDocument; provenance: DraftFieldProvenance[] } {
  const keyFor = new Map(result.nodes.map((node, index) => [node.id, `n${index + 1}`]));

  const document: DraftDocument = {
    ...emptyDraftDocument(),
    /* The playbook's own title and summary are seeded from the problem's, because
       the task has no separate field for them and a blank title on the review
       screen reads as a bug rather than as a decision. The author renames it. */
    title: result.problemTitle.value,
    summary: result.problemSummary.value,
    changeSummary: "",
    problemTitle: result.problemTitle.value,
    problemSummary: result.problemSummary.value,
    symptoms: result.symptoms,
    errorSignatures: result.errorSignatures,
    /*
      Only technologies the taxonomy already knows.

      A slug invented here would file the playbook under a name nobody searches for
      and nothing else links to, and creating taxonomy is an administrative
      capability. An unmatched name is dropped silently rather than approximated —
      an approximate match is worse than none for exactly the same reason.
    */
    technologySlugs: result.technologies
      .map((technology) => slugify(technology.name))
      .filter((slug) => knownSlugs.has(slug))
      .slice(0, 12),
    constraints: [],
    nodes: result.nodes.map((node) => ({
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
    edges: result.edges.flatMap((edge) => {
      const fromKey = keyFor.get(edge.from);
      const toKey = keyFor.get(edge.to);
      return fromKey && toKey
        ? [{ fromKey, toKey, condition: edge.condition, label: edge.label }]
        : [];
    }),
    sources: result.sources,
    gaps: result.gaps,
    suspiciousContent: result.suspiciousContent,
  };

  const provenance: DraftFieldProvenance[] = [
    {
      fieldPath: "/problemTitle",
      provenance: result.problemTitle.provenance,
      originalValue: result.problemTitle.value,
      basis: result.problemTitle.basis,
    },
    {
      fieldPath: "/problemSummary",
      provenance: result.problemSummary.provenance,
      originalValue: result.problemSummary.value,
      basis: result.problemSummary.basis,
    },
    {
      fieldPath: "/title",
      provenance: result.problemTitle.provenance,
      originalValue: result.problemTitle.value,
      basis: result.problemTitle.basis,
    },
    {
      fieldPath: "/summary",
      provenance: result.problemSummary.provenance,
      originalValue: result.problemSummary.value,
      basis: result.problemSummary.basis,
    },
  ];

  document.nodes.forEach((node, index) => {
    for (const [field, value] of [
      ["title", node.title],
      ["body", node.body],
      ["expectedOutput", node.expectedOutput],
    ] as const) {
      if (value === null || value === "") continue;
      provenance.push({
        fieldPath: `/nodes/${index}/${field}`,
        provenance: "ai_extracted",
        originalValue: value,
        basis: null,
      });
    }
  });

  return { document, provenance };
}

/* ---------------------------------------------------------------------------
   Ledger and budget
   --------------------------------------------------------------------------- */

/**
 * Record how a job ended and release the draft to review.
 *
 * The draft moves to `awaiting_review` on every terminal outcome, including the
 * failures. A draft left at `structuring` after a refusal shows its author a
 * spinner for a job that will never finish — the review screen names the actual
 * reason instead, and offers the editor either way.
 */
async function finish(
  env: Env,
  draftId: string,
  taskId: string,
  outcome: { status: string; detail: string; latencyMs?: number },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE ai_tasks SET status = ?1, error_detail = ?2, latency_ms = ?3, completed_at = ?4 WHERE id = ?5`,
    ).bind(outcome.status, outcome.detail.slice(0, 500), outcome.latencyMs ?? null, now, taskId),
    env.DB.prepare(
      `UPDATE contribution_drafts SET status = 'awaiting_review', updated_at = ?1
       WHERE id = ?2 AND status = 'structuring'`,
    ).bind(now, draftId),
  ]);
}

/**
 * What is left of today's spend ceiling, in micro-USD.
 *
 * Summed from the ledger rather than counted in KV, so a restarted Worker, a
 * concurrent consumer and a manual retry all see the same number. It is a soft
 * ceiling by construction — two jobs starting in the same second both read the
 * pre-spend total — and a soft ceiling on a queue with `max_batch_size: 1` is
 * accurate to about one call, which is the right trade against the coordination a
 * hard one would need.
 */
async function remainingBudget(env: Env): Promise<number> {
  const ceiling = Number.parseInt(env.AI_DAILY_BUDGET_MICRO_USD, 10);
  if (!Number.isFinite(ceiling) || ceiling <= 0) return 0;

  const since = Math.floor(Date.now() / 1000) - 86_400;
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(cost_micro_usd), 0) AS spent FROM ai_tasks WHERE created_at >= ?1`,
  )
    .bind(since)
    .first<{ spent: number }>();

  return ceiling - (row?.spent ?? 0);
}

async function knownTechnologySlugs(env: Env): Promise<Set<string>> {
  const rows = await env.DB.prepare(
    `SELECT slug FROM technologies WHERE status = 'active'`,
  ).all<{ slug: string }>();
  return new Set(rows.results.map((row) => row.slug));
}

/** Re-exported so the pricing table has exactly one home and a reader of this file
 *  can see which one it is. */
export { MODEL_PRICING };

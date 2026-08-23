import { slugify } from "@devyou/core";
import { downgradeBasis, groundedProvenance } from "@devyou/domain";
import {
  MODEL_PRICING,
  createAnthropicProvider,
  pricingFor,
  runTask,
  structureContributionTask,
  type StructureResult,
} from "@devyou/ai";
import { emptyDraftDocument, type DraftDocument, type DraftFieldProvenance } from "@devyou/schemas";

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

  const resolver = await technologyResolver(env);
  /* The raw submission is passed so provenance can be checked against it rather than
     taken on the model's word. See `groundedProvenance`. */
  const { document, provenance } = toDraft(outcome.value, resolver, draft.raw_text);

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
  resolve: ReadonlyMap<string, string>,
  sourceText: string,
): { document: DraftDocument; provenance: DraftFieldProvenance[] } {
  const keyFor = new Map(result.nodes.map((node, index) => [node.id, `n${index + 1}`]));

  /* Resolved once: the slug list and the constraints must agree about which
     technologies survived, or the playbook would claim to be about something it
     carries no applicability for. */
  const resolved = result.technologies.flatMap((technology) => {
    const slug = resolve.get(slugify(technology.name));
    return slug ? [{ slug, versionLabel: technology.versionLabel }] : [];
  });

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
    technologySlugs: [...new Set(resolved.map((technology) => technology.slug))].slice(0, 12),
    /*
      Applicability, built from the versions the model reported.

      This was `[]`, hard-coded, and the effect was the defect production run
      2026-08-23 exposed: the model read "Node 22.22, pnpm 11 workspaces, wrangler
      4.125" out of the submission, said so in its own summary, and none of it
      reached a field. The publish gate then correctly refused with
      `no_environment_constraints`, which made the failure look like the author's
      omission rather than a value dropped in transit.

      **Only versioned technologies produce a constraint.** A row with no version
      would satisfy `constraints.length > 0` while carrying no applicability at all,
      which would turn the gate into a formality — the one thing this fix must not
      do. A technology without a version is already represented in
      `technologySlugs`; it does not need a hollow constraint as well.

      `known_affected` rather than `required`, and pinned to the single reported
      version: the author said the problem happened here, not that it happens from
      here onwards. Widening that to an open range would be an inference nobody made.
      Both bounds are editable on the review screen, which is where widening belongs.
    */
    constraints: resolved
      .filter((technology) => (technology.versionLabel ?? "").trim() !== "")
      .map((technology) => ({
        technologySlug: technology.slug,
        minSemver: (technology.versionLabel as string).trim(),
        maxSemver: (technology.versionLabel as string).trim(),
        maxInclusive: true,
        architecture: null,
        kind: "known_affected" as const,
      }))
      .slice(0, 12),
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

  /*
    Prose and literals are tracked differently, and the difference is deliberate.

    A title, a summary and a step body are *written* by the model out of what the
    author said. Asking whether such a value is "in the submission" has no useful
    answer: measured against the real production submission, normalised containment
    held for 1 of 22 of these fields, and token coverage ran from 0.00 to 1.00 with
    faithful text at both ends — the terminal step "Resolved, or cause lies elsewhere"
    scored 0.00 and is harmless scaffolding. Any threshold there would demand
    confirmation on nearly every field of a legitimate draft, and a prompt that
    appears everywhere is a prompt nobody reads. Prose therefore keeps the model's own
    classification and is shown in full on the review screen, which is what that
    screen is for.

    A command and an expected output are *quoted*. They are literal artefacts that
    either appear in what the author wrote or do not, and they are the fields a reader
    acts on — somebody copies a command and runs it. `groundedProvenance` checks them
    against the submission and downgrades an ungrounded claim to
    `ai_inferred_requires_confirmation`, which is not a punishment but the accurate
    label for something the model produced that the author never wrote.

    `commandText` was not tracked at all before this. A fabricated command carried no
    provenance row, required no confirmation, and reached the publish gate indistinguishable
    from one the author had typed. Two of the four commands in production run 2026-08-23
    contained invented placeholder syntax — `<path/to/package-that-depends-on-wrangler>`
    — and both would have published unremarked.
  */
  document.nodes.forEach((node, index) => {
    for (const [field, value] of [
      ["title", node.title],
      ["body", node.body],
    ] as const) {
      if (value === null || value === "") continue;
      provenance.push({
        fieldPath: `/nodes/${index}/${field}`,
        provenance: "ai_extracted",
        originalValue: value,
        basis: null,
      });
    }

    for (const [field, value] of [
      ["commandText", node.commandText],
      ["expectedOutput", node.expectedOutput],
    ] as const) {
      if (value === null || value === "") continue;
      const checked = groundedProvenance("ai_extracted", value, sourceText);
      provenance.push({
        fieldPath: `/nodes/${index}/${field}`,
        provenance: checked.provenance,
        originalValue: value,
        basis: checked.downgraded ? downgradeBasis("ai_extracted") : null,
      });
    }
  });

  /*
    Every constraint carries provenance too, for the same reason: a version is a
    literal, and a version the author never mentioned is a claim about where their fix
    applies. Grounding is checked against the raw submission rather than against the
    model's summary of it — a model that restates its own inference in a summary would
    otherwise ground itself.
  */
  document.constraints.forEach((constraint, index) => {
    const version = constraint.minSemver ?? "";
    const claimed =
      result.technologies.find(
        (technology) => resolve.get(slugify(technology.name)) === constraint.technologySlug,
      )?.provenance ?? "ai_extracted";
    const checked = groundedProvenance(claimed, version, sourceText);
    provenance.push({
      fieldPath: `/constraints/${index}/version`,
      provenance: checked.provenance,
      originalValue: version,
      basis: checked.downgraded ? downgradeBasis(claimed) : null,
    });
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

/**
 * Every name the taxonomy answers to, mapped to its canonical slug.
 *
 * Aliases are included, and their absence was a real defect: a model naming "Node"
 * produced `slugify("Node") === "node"`, the taxonomy stores `nodejs`, the exact
 * match failed and the technology was dropped in silence — together with the
 * version attached to it. `technology_aliases` exists precisely to carry the 171
 * ways people write these names, and the structuring path was the one place that did
 * not consult it.
 *
 * An alias that resolves to more than one technology is omitted rather than guessed
 * at. `wrangler` is both a technology and an alias for `cloudflare-workers`; the
 * slug wins, because a name that *is* a canonical slug means that slug. Where there
 * is no such tie-break, an ambiguous alias contributes nothing — filing a playbook
 * under an approximate match is worse than not filing it, for the same reason the
 * original code dropped unmatched names.
 */
async function technologyResolver(env: Env): Promise<ReadonlyMap<string, string>> {
  const batched = await env.DB.batch<{ slug: string; alias?: string }>([
    env.DB.prepare(`SELECT slug FROM technologies WHERE status = 'active'`),
    env.DB.prepare(
      `SELECT a.alias AS alias, t.slug AS slug
         FROM technology_aliases a
         JOIN technologies t ON t.id = a.technology_id
        WHERE t.status = 'active'`,
    ),
  ]);

  /* `noUncheckedIndexedAccess` is on, and it is right to be: a batch that returned
     fewer results than statements would otherwise read as an empty taxonomy, and an
     empty taxonomy silently drops every technology rather than failing. */
  const slugs = batched[0]?.results ?? [];
  const aliases = batched[1]?.results ?? [];

  const canonical = new Set(slugs.map((row) => row.slug));
  const resolver = new Map<string, string>();
  for (const slug of canonical) resolver.set(slug, slug);

  const ambiguous = new Map<string, Set<string>>();
  for (const row of aliases) {
    const alias = slugify(row.alias ?? "");
    if (alias === "" || canonical.has(alias)) continue;
    const targets = ambiguous.get(alias) ?? new Set<string>();
    targets.add(row.slug);
    ambiguous.set(alias, targets);
  }
  for (const [alias, targets] of ambiguous) {
    const only = [...targets];
    if (only.length === 1) resolver.set(alias, only[0] as string);
  }

  return resolver;
}

/** Re-exported so the pricing table has exactly one home and a reader of this file
 *  can see which one it is. */
export { MODEL_PRICING };

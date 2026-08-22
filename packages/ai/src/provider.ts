/**
 * The AI provider boundary.
 *
 * Plan §11 asks for a provider abstraction even with one provider configured, and
 * the reason is not portability — it is that a single chokepoint is the only place
 * where "AI is assistive, never authoritative" can be *enforced* rather than
 * intended.
 *
 * Three properties are structural here, not policy:
 *
 * 1. **No tools.** `AiRequest` has no tool or function-calling field, and the
 *    provider implementation passes none. R-12 and OWASP LLM01: user submissions
 *    reach these prompts, and a model with a tool is a model a submission can
 *    persuade to use one. The model returns text, and text is all it can do.
 * 2. **No write access.** Nothing in this package imports a database client. A task
 *    returns a validated value to its caller, which decides what to persist.
 *    Verification rows in particular are writable only by the reproduction path.
 * 3. **Structured output or nothing.** Every task declares a Zod schema. A response
 *    that does not validate gets exactly one bounded repair attempt and is then a
 *    failure — not a partially-parsed object, not a best guess.
 *
 * The forbidden list in `FORBIDDEN_TASKS` exists so that adding one of them requires
 * deleting a line that says why it is forbidden.
 */

import type { z } from "zod";

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiRequest {
  /** The task's versioned system prompt. Never contains user content. */
  system: string;
  messages: AiMessage[];
  maxOutputTokens: number;
  /**
   * The schema the response must conform to.
   *
   * Carried as the Zod schema rather than as pre-converted JSON Schema, so each
   * provider expresses it the way its API wants — Anthropic's SDK helper also
   * strips the constraints structured outputs cannot enforce (string lengths,
   * numeric bounds) and validates them client-side instead, which a hand-rolled
   * conversion here would get wrong.
   *
   * It is a request parameter, not a request in the prompt. That distinction is
   * the point: a prompt that *asks* for JSON is an instruction, and instructions
   * are exactly what prompt injection targets. A schema is not arguable.
   */
  schema: z.ZodType<unknown>;
  /** Sent to the provider for cost attribution and abuse tracing. */
  taskType: string;
}

/*
  There is deliberately no `temperature`, `top_p` or `top_k` here.

  Current Claude models reject them outright — they were removed from the API, and
  sending one is a 400. Determinism comes from the schema constraint and a tightly
  scoped prompt, not from a sampling parameter that never guaranteed it anyway.
*/

export interface AiResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  stopReason: string;
}

export interface AiProvider {
  readonly name: string;
  complete(request: AiRequest): Promise<AiResponse>;
}

/* ---------------------------------------------------------------------------
   The authority boundary
   --------------------------------------------------------------------------- */

/**
 * What AI is allowed to do in V1.
 *
 * Plan §11. Each of these produces a *proposal* that a human confirms, or a
 * *signal* that a human acts on. None of them writes anything a reader is asked to
 * trust as verification.
 */
export const ALLOWED_TASKS = [
  "structure_contribution",
  "duplicate_candidates",
  "classify_technology",
  "interpret_query",
  "summarise",
  "staleness_compare",
  "moderation_assist",
] as const;
export type AiTaskType = (typeof ALLOWED_TASKS)[number];

/**
 * What AI may never do, with the reason attached.
 *
 * These are not configuration. `assertTaskAllowed` throws on anything not in
 * `ALLOWED_TASKS`, so a new task type cannot be dispatched by accident — it has to
 * be added to that list deliberately, and anybody adding one of the below has to
 * read why it is here first.
 */
export const FORBIDDEN_TASKS: Record<string, string> = {
  decide_verification:
    "AI cannot decide a fix works. Verification records are writable only by an authenticated " +
    "reproduction or a deterministic CI run — R-10, enforced by the fact that this package " +
    "cannot reach the database at all.",
  generate_reproduction:
    "AI cannot produce reproduction results. A fabricated reproduction is indistinguishable from " +
    "a real one in the counts, which destroys the only number this product asks anybody to trust.",
  approve_identity:
    "AI cannot grant a maintainer claim. Identity verification is a human judgement about " +
    "evidence outside this system.",
  publish_draft:
    "AI cannot publish. The publication gate requires human confirmation of every inferred field — " +
    "plan §10 step D.",
  delete_content: "AI cannot delete. It may open a moderation case; a human closes one.",
  suspend_account: "AI cannot suspend an account.",
  execute_code: "Nothing executes user code in V1 — ADR-0007.",
};

export function assertTaskAllowed(taskType: string): asserts taskType is AiTaskType {
  if ((ALLOWED_TASKS as readonly string[]).includes(taskType)) return;

  const reason = FORBIDDEN_TASKS[taskType];
  throw new Error(
    reason
      ? `AI task "${taskType}" is forbidden. ${reason}`
      : `AI task "${taskType}" is not in the allowed list. Add it to ALLOWED_TASKS deliberately, ` +
        `after checking it against the authority boundary in plan §11.`,
  );
}

/* ---------------------------------------------------------------------------
   Task definition
   --------------------------------------------------------------------------- */

export interface AiTask<T> {
  type: AiTaskType;
  /** Bumped whenever the prompt changes. Stored on every `ai_tasks` row so a
   *  regression can be traced to the prompt that caused it. */
  promptVersion: string;
  system: string;
  schema: z.ZodType<T>;
  maxOutputTokens: number;
  /** Hard cap on the user content this task will accept. Exceeding it is a refusal,
   *  never a silent truncation — a stack trace cut in half produces a confidently
   *  wrong structuring rather than an obvious failure. */
  maxInputChars: number;
  buildMessages(input: string): AiMessage[];
}

export type AiOutcome<T> =
  | { status: "ok"; value: T; usage: AiResponse; repaired: boolean }
  | { status: "schema_invalid"; detail: string; usage: AiResponse | null }
  | { status: "refused"; detail: string }
  | { status: "too_large"; detail: string }
  | { status: "budget_exceeded"; detail: string }
  | { status: "failed"; detail: string };

export interface RunOptions {
  /** Remaining daily spend, in micro-USD. Zero or less refuses before calling out. */
  remainingBudgetMicroUsd: number;
  /** Rough cost estimate per 1M tokens, for the pre-flight budget check. */
  costPerMillionInputMicroUsd: number;
  costPerMillionOutputMicroUsd: number;
}

/**
 * Run a task.
 *
 * The single repair attempt is kept even though structured outputs make malformed
 * JSON very unlikely. It is not there for syntax any more — it is there for the
 * case where the response parses and still fails the Zod schema, because Zod
 * enforces things JSON Schema cannot express here (cross-field consistency, the
 * closed vocabularies in `@devyou/core`). One retry recovers most of those. Two
 * recovers almost nothing and doubles the worst case of a prompt that is simply
 * wrong, which is a bug to fix rather than a condition to retry through.
 */
export async function runTask<T>(
  provider: AiProvider,
  task: AiTask<T>,
  input: string,
  options: RunOptions,
): Promise<AiOutcome<T>> {
  assertTaskAllowed(task.type);

  if (input.length > task.maxInputChars) {
    return {
      status: "too_large",
      detail: `input is ${input.length} characters; this task accepts ${task.maxInputChars}`,
    };
  }

  const estimated =
    (input.length / 4 / 1_000_000) * options.costPerMillionInputMicroUsd +
    (task.maxOutputTokens / 1_000_000) * options.costPerMillionOutputMicroUsd;

  if (estimated > options.remainingBudgetMicroUsd) {
    return {
      status: "budget_exceeded",
      detail: `estimated ${Math.ceil(estimated)} µUSD exceeds remaining ${Math.floor(options.remainingBudgetMicroUsd)} µUSD`,
    };
  }

  const request: AiRequest = {
    system: task.system,
    messages: task.buildMessages(input),
    maxOutputTokens: task.maxOutputTokens,
    schema: task.schema as z.ZodType<unknown>,
    taskType: task.type,
  };

  let response: AiResponse;
  try {
    response = await provider.complete(request);
  } catch (error) {
    return { status: "failed", detail: error instanceof Error ? error.message : "provider error" };
  }

  const first = validate(task.schema, response.text);
  if (first.ok) return { status: "ok", value: first.value, usage: response, repaired: false };

  let repaired: AiResponse;
  try {
    repaired = await provider.complete({
      ...request,
      messages: [
        ...request.messages,
        { role: "assistant", content: response.text.slice(0, 4000) },
        {
          role: "user",
          content:
            `That did not match the required schema: ${first.detail}\n\n` +
            "Reply with only the corrected JSON. No explanation, no code fence.",
        },
      ],
    });
  } catch (error) {
    return {
      status: "failed",
      detail: error instanceof Error ? error.message : "provider error during repair",
    };
  }

  const second = validate(task.schema, repaired.text);
  if (second.ok) return { status: "ok", value: second.value, usage: repaired, repaired: true };

  return { status: "schema_invalid", detail: second.detail, usage: repaired };
}

function validate<T>(
  schema: z.ZodType<T>,
  text: string,
): { ok: true; value: T } | { ok: false; detail: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(text));
  } catch {
    return { ok: false, detail: "response was not valid JSON" };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      detail: result.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    };
  }
  return { ok: true, value: result.data };
}

/** Models wrap JSON in a fence often enough that not handling it would spend a
 *  repair attempt on formatting rather than on content. */
function stripFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

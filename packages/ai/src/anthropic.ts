import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { AiProvider, AiRequest, AiResponse } from "./provider.js";

/**
 * The Anthropic provider.
 *
 * Runs in the jobs Worker only. The public Worker holds no AI credential, so there
 * is no request path a visitor can drive that spends tokens — plan §11's cost
 * controls start with that binding decision rather than with a rate limit.
 *
 * Four request-shape decisions, each of which would be a silent defect if wrong:
 *
 * - **`output_config.format`, not a prompt asking for JSON.** The schema is a
 *   request parameter, so the model cannot return something else and a hostile
 *   submission has no instruction to argue with. A prompt that *asks* for JSON is
 *   an instruction, and instructions are what prompt injection targets.
 * - **No `temperature`, `top_p` or `top_k`.** Current models reject them with a 400;
 *   they were removed from the API.
 * - **No `tools`.** The boundary in `provider.ts` has no field for them, and this
 *   passes none. A model with a tool is a model a submission can try to talk into
 *   using one.
 * - **No assistant prefill.** Rejected on current models, and it was only ever a way
 *   to force output shape — which `output_config.format` now does properly.
 */

export interface AnthropicProviderOptions {
  apiKey: string;
  /**
   * Defaults to Claude Opus 5.
   *
   * Plan §11 asks for per-task model routing as a cost control, so this is
   * per-instance rather than global — the jobs Worker can construct a cheaper
   * provider for classification and a stronger one for structuring. It routes by
   * configuration, never by anything a submission can influence.
   */
  model?: string;
  /** Effort level. `low` for mechanical tasks such as classification. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  baseUrl?: string;
}

const DEFAULT_MODEL = "claude-opus-5";

export function createAnthropicProvider(options: AnthropicProviderOptions): AiProvider {
  const client = new Anthropic({
    apiKey: options.apiKey,
    ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
    /*
      One retry, not the default two.

      This runs inside a queue consumer that already has its own retry and a dead
      letter queue. Retrying twice here on top of that turns one poisoned message
      into six provider calls, which is how a transient outage becomes a bill.
    */
    maxRetries: 1,
  });

  const model = options.model ?? DEFAULT_MODEL;

  return {
    name: `anthropic:${model}`,

    async complete(request: AiRequest): Promise<AiResponse> {
      const response = await client.messages.create({
        model,
        max_tokens: request.maxOutputTokens,
        system: request.system,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        output_config: {
          /*
            `zodOutputFormat`, not a hand-rolled Zod → JSON Schema conversion.

            Structured outputs reject several JSON Schema keywords that Zod emits
            freely — string `maxLength`, numeric bounds, array length limits. The
            SDK helper strips exactly those and enforces them client-side instead.
            Converting by hand produces a schema the API refuses, and the refusal is
            a 400 on every request rather than something a test would catch on one.
          */
          format: zodOutputFormat(request.schema),
          ...(options.effort ? { effort: options.effort } : {}),
        },
        metadata: {
          /*
            A per-task identifier, never a per-user one.

            Enough to attribute cost and to trace an abusive pattern to a task type;
            not enough to identify a contributor to the provider. Plan §17 forbids
            unnecessary personal data leaving the product, and a user id here would
            be exactly that.
          */
          user_id: `devyou-task:${request.taskType}`,
        },
      });

      /*
        A refusal is returned as text, not thrown.

        Safety classifiers decline with HTTP 200 and `stop_reason: "refusal"`, with
        the content array empty. Code that reads `content[0]` unconditionally breaks
        on that. Here it becomes an empty response with the stop reason attached, and
        the caller's schema validation turns it into a clean `schema_invalid` outcome
        rather than a crash in a queue consumer.
      */
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");

      return {
        text,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        model: response.model,
        stopReason: response.stop_reason ?? "unknown",
      };
    },
  };
}

/**
 * List prices, in micro-USD per million tokens, for the pre-flight budget check.
 *
 * Deliberately a small hardcoded table rather than a lookup: the budget gate has to
 * work before any call is made, and a price that has drifted produces a slightly
 * wrong *estimate*, while a price fetched at call time produces an outage when the
 * fetch fails. Actual spend is recorded from `usage` on every `ai_tasks` row, so the
 * ledger is exact even when this table is stale.
 */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5_000_000, output: 25_000_000 },
  "claude-sonnet-5": { input: 3_000_000, output: 15_000_000 },
  "claude-haiku-4-5": { input: 1_000_000, output: 5_000_000 },
};

export function pricingFor(model: string): { input: number; output: number } {
  return MODEL_PRICING[model] ?? MODEL_PRICING["claude-opus-5"]!;
}

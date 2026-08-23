import { PROVENANCE, type Provenance } from "@devyou/core";

/**
 * Grounding: is this value actually in what the author wrote?
 *
 * The provenance vocabulary distinguishes what the author supplied, what the model
 * read out of their text, and what the model worked out and could be wrong about.
 * Only the third blocks publication until a human confirms it. Until this module
 * existed, **the model chose which of the three applied to its own output** — and
 * production run 2026-08-23 had it label all 22 tracked fields `ai_extracted`, so the
 * `unconfirmed_ai_fields` blocker never fired once.
 *
 * That is a self-certification: the label that decides whether a human must look is
 * assigned by the thing being checked. This module makes the trusted labels mean
 * something a machine can verify, so a claim of "I read this in your text" can be
 * tested against the text.
 *
 * ## What this deliberately does not do
 *
 * It does not police prose. Measured against the real production submission, the
 * model's titles, summaries and step bodies scored token-coverage anywhere from 0.00
 * to 1.00 with faithful text at both ends — the terminal step "Resolved, or cause
 * lies elsewhere" scored 0.00 and is harmless scaffolding, while a faithful summary
 * scored 0.74. Normalised containment was true for exactly 1 of 22. Any threshold
 * over prose would therefore flag most of a legitimate draft, and a confirmation
 * prompt on nearly every field is one nobody reads — the same warning-fatigue defect
 * this codebase already fixed once for `rm -rf ./node_modules`.
 *
 * So grounding is applied where it discriminates and where being wrong is expensive:
 * **literal values**. A command, a version label, an error code either appears in the
 * submission or it does not. Those are also the fields a reader acts on — somebody
 * copies a command and runs it — which is where an invented value does real harm.
 * Prose stays visible on the review screen, which is what that screen is for.
 *
 * ## The direction of the rule
 *
 * `groundedProvenance` can only ever *reduce* trust. There is no input that turns
 * `ai_inferred_requires_confirmation` into anything else. A model cannot argue its
 * way into a more trusted class, and a future caller cannot accidentally use this to
 * bless something.
 */

/** How well a value is supported by the source text. Ordered from strongest. */
export const GROUNDING = ["verbatim", "normalised", "unsupported"] as const;
export type Grounding = (typeof GROUNDING)[number];

/**
 * Normalise for comparison, not for display.
 *
 * A command copied out of a terminal and retyped into a structured field legitimately
 * differs in whitespace, in the direction of its quotation marks, and in the dash
 * characters an editor substituted. None of those is the model inventing anything, so
 * none of them should cost the author a confirmation click.
 *
 * Case is folded too. `MODULE_NOT_FOUND` and `module_not_found` are the same error,
 * and a shell is case-sensitive but a *quotation* of one is not the place to enforce
 * that — the author sees the real text on the review screen either way.
 */
function normalise(text: string): string {
  return (
    text
      .toLowerCase()
      /* Smart quotes and dashes, which word processors and chat clients substitute
       silently. Mapped to their ASCII forms rather than stripped, so `--remote` and
       an em-dashed `—remote` compare equal. */
      .replace(/[‘’‛]/g, "'")
      .replace(/[“”‟]/g, '"')
      .replace(/[‐-―]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * How well `value` is supported by `source`.
 *
 * `verbatim` is a substring match on the raw text. `normalised` is a substring match
 * after the substitutions above. `unsupported` is everything else — including the
 * case where either side is empty, because nothing is proof of nothing.
 */
export function groundingOf(value: string, source: string): Grounding {
  const trimmed = value.trim();
  if (trimmed === "" || source.trim() === "") return "unsupported";

  if (source.includes(trimmed)) return "verbatim";
  if (normalise(source).includes(normalise(trimmed))) return "normalised";
  return "unsupported";
}

/** Whether a grounding is strong enough to support a claim of having read the value
 *  out of the submission. Both non-`unsupported` levels are; the distinction between
 *  them is kept for the audit trail rather than for the decision. */
export function isGrounded(grounding: Grounding): boolean {
  return grounding !== "unsupported";
}

/**
 * The provenance a literal value is allowed to carry.
 *
 * The rule in one line: **a claim that the value came from the submission survives
 * only if the value is in the submission.**
 *
 * `user_supplied` and `ai_extracted` are both such claims — the first says the author
 * wrote it, the second says the model read it in their text. Neither is checkable by
 * asking the model, and both are checkable against the text. An ungrounded claim of
 * either becomes `ai_inferred_requires_confirmation`, which is not a punishment: it is
 * the accurate label for a value the model produced without the author having written
 * it, and it routes the value to the person who can say whether it is right.
 *
 * A claim of `ai_inferred_requires_confirmation` is returned unchanged whatever the
 * grounding says. A model that correctly admits it inferred something is believed,
 * because that admission is against its own interest and because a grounded coincidence
 * is not evidence the model did not infer.
 */
export function groundedProvenance(
  claimed: Provenance,
  value: string,
  source: string,
): { provenance: Provenance; grounding: Grounding; downgraded: boolean } {
  const grounding = groundingOf(value, source);

  if (claimed === "ai_inferred_requires_confirmation") {
    return { provenance: claimed, grounding, downgraded: false };
  }

  if (isGrounded(grounding)) {
    return { provenance: claimed, grounding, downgraded: false };
  }

  return {
    provenance: "ai_inferred_requires_confirmation",
    grounding,
    downgraded: true,
  };
}

/**
 * A sentence explaining the downgrade, for the `basis` column.
 *
 * The review screen shows this beside the field. "Not found in your submission" is
 * something an author can act on; "provenance downgraded" is not, and a confirmation
 * prompt whose reason is unreadable is a prompt that gets clicked through.
 */
export function downgradeBasis(claimed: Provenance): string {
  const claimText =
    claimed === "user_supplied" ? "attributed this to you" : "said it read this in your submission";
  return (
    `The model ${claimText}, but this exact text does not appear in what you wrote. ` +
    `Check it before publishing — it may be a reasonable rewording, or it may be wrong.`
  );
}

/* A compile-time guard: if `PROVENANCE` ever grows a fourth value, the exhaustive
   handling above stops being exhaustive and this line stops compiling, which is the
   only reliable way to be told. */
const _PROVENANCE_IS_EXHAUSTIVE: readonly [
  "user_supplied",
  "ai_extracted",
  "ai_inferred_requires_confirmation",
] = PROVENANCE;
void _PROVENANCE_IS_EXHAUSTIVE;

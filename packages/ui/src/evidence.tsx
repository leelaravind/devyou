/**
 * Evidence and confidence display.
 *
 * This is the component that most easily becomes a lie, so it is the one written
 * with the most care.
 *
 * The product's central claim is that verification is evidence rather than a badge.
 * A component that renders a green tick is a badge no matter what the schema behind
 * it looks like, so these components are built so that the honest thing is the easy
 * thing:
 *
 * - `ConfidenceBadge` cannot be rendered without the counts that produced the band.
 *   The counts are a required prop, not an optional decoration.
 * - It cannot be rendered without an explanation target. `explainHref` is required,
 *   because plan §6 requires every band to be explainable and a link that is
 *   sometimes absent is a link nobody builds the page for.
 * - `EvidenceCount` refuses to show a percentage below n < 5 (R-4). The rule lives
 *   in the component, not in each caller, because a rule that each caller has to
 *   remember is a rule that leaks.
 * - Every state carries an icon and a word. Never colour alone (R-34, plan §18).
 */

import type { ConfidenceBand, EvidenceType, EvidenceResult, ReproductionOutcome } from "@devyou/core";
import { CONFIDENCE_BAND_LABELS, MIN_SAMPLE_FOR_PERCENTAGE, cn } from "@devyou/core";
import { Icon, type IconName } from "./icon.js";

/* ---------------------------------------------------------------------------
   Confidence band
   --------------------------------------------------------------------------- */

const BAND_STYLE: Record<ConfidenceBand, { className: string; icon: IconName }> = {
  // Documented but unvalidated. Slate, and deliberately the dullest thing on the
  // page — this state should not look like an achievement.
  unverified: { className: "text-status-documented border-status-documented/40", icon: "description" },
  limited_evidence: { className: "text-status-confirmed border-status-confirmed/40", icon: "science" },
  moderate_evidence: { className: "text-status-reproduced border-status-reproduced/40", icon: "fingerprint" },
  strong_evidence: { className: "text-status-ci-verified border-status-ci-verified/50", icon: "shield" },
  needs_reverification: { className: "text-warning-amber border-warning-amber/50", icon: "schedule" },
  deprecated: { className: "text-destructive-red border-destructive-red/50", icon: "block" },
};

export interface EvidenceCounts {
  /** Independent successful reproductions. */
  reproducedPassed: number;
  /** Retained, surfaced, and never hidden to improve a score. Plan §0.3. */
  reproducedFailed: number;
  reproducedPartial: number;
  /** Distinct environment snapshots represented across all reproductions. */
  uniqueEnvironments: number;
}

export interface ConfidenceBadgeProps {
  band: ConfidenceBand;
  /**
   * Required. A band without its counts is the badge this product exists to avoid,
   * so the type system refuses to render one.
   */
  counts: EvidenceCounts;
  /** Required. Where "Why this confidence?" goes. Plan §6. */
  explainHref: string;
  size?: "sm" | "md";
  className?: string;
}

export function ConfidenceBadge({
  band,
  counts,
  explainHref,
  size = "md",
  className,
}: ConfidenceBadgeProps) {
  const style = BAND_STYLE[band];
  const label = CONFIDENCE_BAND_LABELS[band];
  const total = counts.reproducedPassed + counts.reproducedFailed + counts.reproducedPartial;

  return (
    <span className={cn("inline-flex items-center gap-density-high", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded border bg-surface-variant font-mono uppercase",
          style.className,
          size === "sm" ? "px-1.5 py-0.5 text-label-caps" : "px-2 py-1 text-label-caps",
        )}
      >
        <Icon name={style.icon} size={size === "sm" ? 12 : 14} />
        {label}
      </span>

      {/*
        The counts sit outside the coloured chip, in the ordinary text colour.
        Putting them inside would make them read as part of the badge; the point is
        that they are the fact and the badge is the summary.
      */}
      <span className="font-mono text-env-tag text-on-surface-variant">
        {total === 0 ? (
          "no reproductions yet"
        ) : (
          <>
            {counts.reproducedPassed} of {total} reproduced
            {counts.uniqueEnvironments > 0 && (
              <>
                {" "}
                across {counts.uniqueEnvironments} environment
                {counts.uniqueEnvironments === 1 ? "" : "s"}
              </>
            )}
          </>
        )}
      </span>

      <a
        href={explainHref}
        className="font-mono text-env-tag text-evidence-blue underline decoration-dotted underline-offset-2 hover:no-underline"
      >
        Why this confidence?
      </a>
    </span>
  );
}

/* ---------------------------------------------------------------------------
   Percentages
   --------------------------------------------------------------------------- */

export interface EvidenceRateProps {
  passed: number;
  total: number;
  className?: string;
}

/**
 * A success rate, or an honest refusal to state one.
 *
 * Below `MIN_SAMPLE_FOR_PERCENTAGE` this renders the raw fraction instead. "100%"
 * over two reports is a lie told with arithmetic, and it is the single most likely
 * way this product would mislead somebody at 3am.
 */
export function EvidenceRate({ passed, total, className }: EvidenceRateProps) {
  if (total < MIN_SAMPLE_FOR_PERCENTAGE) {
    return (
      <span className={cn("font-mono text-env-tag text-on-surface-variant", className)}>
        {passed}/{total} — too few reports for a rate
      </span>
    );
  }
  const pct = Math.round((passed / total) * 100);
  return (
    <span className={cn("font-mono text-env-tag text-on-surface", className)}>
      {pct}% ({passed}/{total})
    </span>
  );
}

/* ---------------------------------------------------------------------------
   Evidence type and result
   --------------------------------------------------------------------------- */

const EVIDENCE_TYPE_META: Record<EvidenceType, { label: string; icon: IconName }> = {
  contributor_documentation: { label: "Author documented", icon: "description" },
  independent_confirmation: { label: "Independently confirmed", icon: "check_circle" },
  reproduction: { label: "Reproduced", icon: "fingerprint" },
  ci_execution: { label: "CI executed", icon: "terminal" },
  matrix_execution: { label: "Matrix executed", icon: "account_tree" },
  maintainer_attestation: { label: "Maintainer attested", icon: "verified" },
  official_reference: { label: "Official source", icon: "link" },
  failure_observation: { label: "Failure observed", icon: "error" },
};

const RESULT_META: Record<EvidenceResult, { label: string; icon: IconName; className: string }> = {
  passed: { label: "Passed", icon: "check_circle", className: "text-status-ci-verified" },
  partial: { label: "Partial", icon: "warning", className: "text-warning-amber" },
  failed: { label: "Failed", icon: "error", className: "text-destructive-red" },
  inconclusive: { label: "Inconclusive", icon: "help", className: "text-status-documented" },
};

export interface EvidenceChipProps {
  type: EvidenceType;
  result?: EvidenceResult;
  className?: string;
}

export function EvidenceChip({ type, result, className }: EvidenceChipProps) {
  const meta = EVIDENCE_TYPE_META[type];
  const resultMeta = result ? RESULT_META[result] : undefined;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border border-outline-variant bg-surface-variant px-1.5 py-0.5 font-mono text-label-caps uppercase",
        resultMeta?.className ?? "text-on-surface-variant",
        className,
      )}
    >
      <Icon name={resultMeta?.icon ?? meta.icon} size={12} />
      {meta.label}
      {resultMeta && <span className="opacity-70">· {resultMeta.label}</span>}
    </span>
  );
}

/* ---------------------------------------------------------------------------
   Reproduction outcome
   --------------------------------------------------------------------------- */

const OUTCOME_META: Record<
  ReproductionOutcome,
  { label: string; icon: IconName; className: string }
> = {
  worked: { label: "Worked", icon: "check_circle", className: "text-status-ci-verified" },
  partial: { label: "Partial", icon: "warning", className: "text-warning-amber" },
  failed: { label: "Failed", icon: "error", className: "text-destructive-red" },
};

export interface OutcomeChipProps {
  outcome: ReproductionOutcome;
  className?: string;
}

export function OutcomeChip({ outcome, className }: OutcomeChipProps) {
  const meta = OUTCOME_META[outcome];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border border-outline-variant bg-surface-variant px-1.5 py-0.5 font-mono text-label-caps uppercase",
        meta.className,
        className,
      )}
    >
      <Icon name={meta.icon} size={12} />
      {meta.label}
    </span>
  );
}

export { OUTCOME_META, RESULT_META, EVIDENCE_TYPE_META };

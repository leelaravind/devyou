/**
 * The diagnostic tree — "the Map" half of the split view (R-25).
 *
 * Rendered as a vertical rail of nodes with a status dot each, matching the
 * `active_diagnostic_session` reference. Three decisions in here are not cosmetic:
 *
 * **It is a list, not an ARIA tree.** Plan §18 permits `role="tree"` only if the
 * interaction behaviour fully matches the ARIA tree pattern — typeahead, expand and
 * collapse on arrow keys, a single tab stop with roving focus. This component does
 * not implement that pattern, and mislabelled ARIA is worse for a screen-reader user
 * than honest semantics: it promises keys that do nothing. So it is an ordered list
 * of steps, which is what it actually is. The UX research asks for `role="tree"`;
 * the plan overrides it, and this is the place that override becomes real.
 *
 * **Status is never colour alone.** Every node carries an icon and a status word
 * (R-34). The colour is the third signal, not the first.
 *
 * **Incompatible nodes are dimmed, not hidden** (R-29). A developer whose environment
 * does not match still needs to see that a branch exists — hiding it makes the
 * playbook look incomplete and hides the reason it does not apply.
 */

import type { ReactNode } from "react";
import { cn } from "@devyou/core";
import { Icon, type IconName } from "./icon.js";

export type NodeStatus = "passed" | "failed" | "partial" | "active" | "pending" | "skipped";

const STATUS_META: Record<
  NodeStatus,
  { label: string; icon: IconName; dot: string; text: string }
> = {
  passed: {
    label: "Passed",
    icon: "check_circle",
    dot: "bg-status-ci-verified border-status-ci-verified",
    text: "text-status-ci-verified",
  },
  failed: {
    label: "Failed",
    icon: "error",
    dot: "bg-destructive-red border-destructive-red",
    text: "text-destructive-red",
  },
  partial: {
    label: "Different output",
    icon: "warning",
    dot: "bg-warning-amber border-warning-amber",
    text: "text-warning-amber",
  },
  active: {
    label: "In progress",
    icon: "sync",
    dot: "bg-primary border-primary",
    text: "text-primary",
  },
  pending: {
    label: "Pending",
    icon: "schedule",
    dot: "bg-outline-variant border-outline-variant",
    text: "text-on-surface-variant",
  },
  skipped: {
    label: "Skipped",
    icon: "chevron_right",
    dot: "bg-transparent border-outline-variant",
    text: "text-on-surface-variant",
  },
};

export interface DiagnosticNodeProps {
  title: string;
  summary?: string;
  status: NodeStatus;
  /**
   * Whether this node applies to the declared environment. `false` dims it and adds
   * a stated reason — it never removes it from the list.
   */
  applicable?: boolean;
  incompatibleReason?: string;
  /** Present when the node can be revisited. Backtracking invalidates downstream
   *  outcomes, so the caller must confirm before acting on it (plan §8). */
  onRevisit?: () => void;
  /** Rendered inside the active node's card. */
  children?: ReactNode;
  className?: string;
}

export function DiagnosticNode({
  title,
  summary,
  status,
  applicable = true,
  incompatibleReason,
  onRevisit,
  children,
  className,
}: DiagnosticNodeProps) {
  const meta = STATUS_META[status];
  const isActive = status === "active";

  const body = (
    <>
      <span className={cn("flex items-center gap-1 font-mono text-label-caps uppercase", meta.text)}>
        <Icon name={meta.icon} size={13} />
        {meta.label}
      </span>
      <span className="mt-0.5 block font-headline text-body-md font-semibold text-on-surface">
        {title}
      </span>
      {summary && <span className="mt-1 block text-body-sm text-on-surface-variant">{summary}</span>}
      {!applicable && (
        <span className="mt-1 flex items-start gap-1 text-body-sm text-warning-amber">
          <Icon name="info" size={13} className="mt-0.5" />
          {incompatibleReason ?? "Does not apply to your declared environment."}
        </span>
      )}
      {children}
    </>
  );

  return (
    <li className={cn("relative flex gap-gutter pb-6 last:pb-0", !applicable && "opacity-55", className)}>
      {/* The rail. `aria-hidden` because the connector carries no information the
          status word does not already give. */}
      <span
        aria-hidden
        className="absolute top-3 bottom-0 left-[7px] w-px bg-outline-variant last:hidden"
      />
      <span
        aria-hidden
        className={cn(
          "relative z-10 mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-2",
          meta.dot,
          isActive && "ring-4 ring-primary/20",
        )}
      />

      <div className="min-w-0 flex-1">
        {isActive ? (
          <div className="dv-node-active rounded-[var(--radius-node)] border border-outline-variant bg-diagnostic-node-bg p-3">
            {body}
          </div>
        ) : onRevisit ? (
          /*
            A revisitable node is a real button. It is the backtracking affordance
            (R-28), and it must be reachable by keyboard because the whole diagnostic
            path has to be (plan §18).
          */
          <button
            type="button"
            onClick={onRevisit}
            className="w-full rounded-[var(--radius-node)] p-1 text-left transition-colors hover:bg-surface-container"
          >
            {body}
            <span className="mt-1 flex items-center gap-1 font-mono text-env-tag text-evidence-blue">
              <Icon name="history" size={12} />
              Revisit — this clears every later step
            </span>
          </button>
        ) : (
          <div className="p-1">{body}</div>
        )}
      </div>
    </li>
  );
}

export interface DiagnosticTreeProps {
  /** Named for the screen reader, since the visual heading may be elsewhere. */
  label?: string;
  children: ReactNode;
  className?: string;
}

export function DiagnosticTree({ label = "Diagnostic steps", children, className }: DiagnosticTreeProps) {
  return (
    <ol aria-label={label} className={cn("flex list-none flex-col", className)}>
      {children}
    </ol>
  );
}

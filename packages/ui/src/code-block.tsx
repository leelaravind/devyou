/**
 * Code and command display.
 *
 * Two rules from plan §14 shape this component, and both are about ordering:
 *
 * 1. **The safety class is shown before the copy action, not after.** A developer
 *    who has already pasted `rm -rf /var/lib/postgresql` into a production shell is
 *    not helped by a warning underneath the button. The class banner is rendered
 *    above the command, and for destructive or credential-sensitive commands the
 *    copy button will not copy until it has been acknowledged.
 *
 * 2. **Code is always inert.** There is no "run" affordance and no evaluation path.
 *    The content is rendered as text inside `<pre><code>`, never as HTML — the lint
 *    config forbids `dangerouslySetInnerHTML` outright, so this cannot regress into
 *    a syntax highlighter that accepts markup.
 *
 * Keyboard access: `tabIndex={0}` on the `<pre>` puts long blocks in the tab order
 * so they can be scrolled without a mouse (plan §18).
 */

import { useCallback, useId, useState } from "react";
import type { SafetyLevel } from "@devyou/core";
import { SAFETY_LEVEL_LABELS, cn, requiresAcknowledgement } from "@devyou/core";
import { Icon, type IconName } from "./icon.js";

const SAFETY_META: Record<
  SafetyLevel,
  { icon: IconName; className: string; border: string; explain: string }
> = {
  informational: {
    icon: "visibility",
    className: "text-on-surface-variant",
    border: "border-outline-variant",
    explain: "Reads state. Does not change anything.",
  },
  state_changing: {
    icon: "build",
    className: "text-warning-amber",
    border: "border-warning-amber/50",
    explain: "Changes system or service state. Review before running.",
  },
  destructive: {
    icon: "warning",
    className: "text-destructive-red",
    border: "border-destructive-red",
    explain: "Can delete data or break a running service. This is not reversible.",
  },
  credential_sensitive: {
    icon: "shield",
    className: "text-destructive-red",
    border: "border-destructive-red",
    explain: "Touches credentials or secrets. Never paste real secrets into a shared terminal.",
  },
};

export interface CodeBlockProps {
  code: string;
  /** Language label, shown as text. Not used to execute or transform anything. */
  language?: string;
  /**
   * Required when this block is a runnable command. Omit only for illustrative
   * output or configuration excerpts, where `readonly` is not a meaningful claim.
   */
  safety?: SafetyLevel;
  /** Optional prose shown under the safety banner, e.g. what the command affects. */
  effect?: string;
  className?: string;
}

export function CodeBlock({ code, language, safety, effect, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const ackId = useId();

  const meta = safety ? SAFETY_META[safety] : undefined;
  const needsAck = safety ? requiresAcknowledgement(safety) : false;
  const copyBlocked = needsAck && !acknowledged;

  const copy = useCallback(() => {
    if (copyBlocked) return;
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }, [code, copyBlocked]);

  return (
    <div className={cn("overflow-hidden rounded-lg border", meta?.border ?? "border-outline-variant", className)}>
      {/*
        Header. Carries the safety class, the language, and the copy control — in
        that reading order, so the warning is passed before the button is reached.
      */}
      <div className="flex items-center justify-between gap-gutter border-b border-outline-variant bg-surface-container-high px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          {meta && (
            <span className={cn("inline-flex items-center gap-1 font-mono text-label-caps uppercase", meta.className)}>
              <Icon name={meta.icon} size={13} />
              {SAFETY_LEVEL_LABELS[safety as SafetyLevel]}
            </span>
          )}
          {language && (
            <span className="truncate font-mono text-env-tag text-on-surface-variant">{language}</span>
          )}
        </div>

        <button
          type="button"
          onClick={copy}
          disabled={copyBlocked}
          aria-describedby={copyBlocked ? ackId : undefined}
          className={cn(
            "inline-flex items-center gap-1 rounded px-2 py-1 font-mono text-label-caps uppercase transition-colors",
            copyBlocked
              ? "cursor-not-allowed text-on-surface-variant opacity-50"
              : "text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface",
          )}
        >
          <Icon name={copied ? "check" : "content_copy"} size={13} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {meta && (safety !== "informational" || effect) && (
        <div
          className={cn(
            "border-b border-outline-variant bg-surface-container-low px-3 py-2 text-body-sm",
            meta.className,
          )}
        >
          <p>{meta.explain}</p>
          {effect && <p className="mt-1 text-on-surface-variant">{effect}</p>}

          {needsAck && (
            <label
              id={ackId}
              className="mt-2 flex cursor-pointer items-center gap-2 text-body-sm text-on-surface"
            >
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="h-4 w-4 rounded border-outline-variant bg-surface-container"
              />
              I understand what this command does.
            </label>
          )}
        </div>
      )}

      {/*
        `tabIndex={0}` so a long block is scrollable from the keyboard. `whitespace-pre`
        rather than `pre-wrap`: wrapping a shell command changes where a reader thinks
        the line breaks are, and in a command that is a correctness problem.
      */}
      <pre
        tabIndex={0}
        className="dv-scroll-thin overflow-x-auto bg-surface-container-lowest p-3 text-code-block whitespace-pre"
      >
        <code className="font-mono text-on-surface">{code}</code>
      </pre>
    </div>
  );
}

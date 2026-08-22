/**
 * Tag.
 *
 * DESIGN.md: "Environment Tags: Monospaced text inside a subtle bordered pill."
 * These carry technology/version metadata (an OS string, a runtime, a framework
 * name) — facts a developer scans for while triaging, not prose — so they stay
 * mono even where the surrounding UI is Inter.
 *
 * `tone` is a fixed vocabulary rather than a free colour prop: DESIGN.md
 * colour-codes tags by `TechnologyType` category (os/runtime/framework), and an
 * arbitrary colour would let a consumer invent a meaning the rest of the system
 * doesn't recognise.
 */

import type { HTMLAttributes } from "react";
import { cn } from "@devyou/core";

export type TagTone = "neutral" | "os" | "runtime" | "framework";
export type TagSize = "sm" | "md";

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: TagTone;
  size?: TagSize;
}

const TONE_STYLES: Record<TagTone, string> = {
  neutral: "text-on-surface-variant border-outline-variant",
  os: "text-evidence-blue border-evidence-blue/40",
  runtime: "text-technical-teal border-technical-teal/40",
  framework: "text-status-confirmed border-status-confirmed/40",
};

const SIZE_STYLES: Record<TagSize, string> = {
  sm: "px-1 py-0.5 text-[10px]",
  md: "px-1.5 py-0.5",
};

export function Tag({ tone = "neutral", size = "md", className, children, ...rest }: TagProps) {
  return (
    <span
      className={cn(
        "font-mono text-env-tag border rounded inline-flex items-center gap-1 bg-surface-variant",
        TONE_STYLES[tone],
        SIZE_STYLES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

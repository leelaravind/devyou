/**
 * Spinner.
 *
 * A single inline SVG rather than a CSS-only construction, because `role="status"`
 * needs an element to sit on and a bare `div` with a border-spin trick has nowhere
 * accessible to hang an `aria-label`.
 *
 * `prefers-reduced-motion` is not handled here — theme.css's global rule collapses
 * every `animation-duration` to near-zero, so a reduced-motion user sees a static
 * ring instead of a spin, and this component does not need to know that happened.
 */

import { cn } from "@devyou/core";

export interface SpinnerProps {
  /** Pixel size (both dimensions). Defaults to 16 — inline with button/label text. */
  size?: number;
  /** Accessible name for the status region. Defaults to "Loading". */
  label?: string;
  className?: string;
}

export function Spinner({ size = 16, label = "Loading", className }: SpinnerProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      role="status"
      aria-label={label}
      className={cn("animate-spin shrink-0", className)}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

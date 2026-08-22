/**
 * Button.
 *
 * Labels are uppercase JetBrains Mono (`text-label-caps` + `font-mono`), matching
 * every button in the Stitch renders — this is a command console, not a marketing
 * site, and the mono caps treatment is what makes a button read as an *action* next
 * to the mono environment tags and code blocks around it.
 *
 * `loading` swaps `iconLeft` for a `Spinner` rather than the label. A button whose
 * text disappears on click reflows anything sitting next to it and forces the eye
 * to re-find the control; keeping the label in place also means the button's width
 * does not jump the instant a slow request starts.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@devyou/core";
import { Icon, type IconName } from "./icon.js";
import { Spinner } from "./spinner.js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconLeft?: IconName;
  iconRight?: IconName;
  children?: ReactNode;
}

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:opacity-90",
  secondary:
    "bg-surface-container-high text-on-surface border border-outline-variant hover:bg-surface-container-highest",
  ghost: "bg-transparent text-on-surface-variant hover:bg-surface-container-highest",
  // Reserved for genuinely destructive actions (delete, revoke, quarantine) — never
  // for a merely negative-sounding one like "cancel".
  danger: "bg-destructive-red text-white hover:opacity-90",
};

const SIZE_STYLES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 gap-1.5",
  md: "px-4 py-2 gap-density-high",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  iconLeft,
  iconRight,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center rounded text-label-caps uppercase font-mono transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : iconLeft && <Icon name={iconLeft} size={14} />}
      {children}
      {!loading && iconRight && <Icon name={iconRight} size={14} />}
    </button>
  );
}

/**
 * Input, Textarea, and the Field wrapper that ties a label to them.
 *
 * `Field` takes its input as a render prop rather than a plain `children` node
 * because the label/description/error ids have to be generated (via `useId`) and
 * then threaded onto the specific input that needs them — a plain child has no way
 * to receive those ids, and hard-coding a single `<input>` inside `Field` itself
 * would rule out `Textarea` or any future control sharing the same chrome.
 *
 * `Textarea`'s `mono` flag exists because this is where developers paste stack
 * traces and log output — Inter for a stack trace is actively harder to scan than
 * the mono font the rest of the system already uses for anything a machine
 * produced.
 */

import { useId } from "react";
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "@devyou/core";
import { Icon } from "./icon.js";

/* ---------------------------------------------------------------------------
   Field
   --------------------------------------------------------------------------- */

export interface FieldProps {
  label: string;
  description?: string;
  error?: string;
  className?: string;
  children: (ids: { inputId: string; describedBy: string | undefined }) => ReactNode;
}

export function Field({ label, description, error, className, children }: FieldProps) {
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const descriptionId = description ? `${baseId}-description` : undefined;
  const errorId = error ? `${baseId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={inputId} className="text-label-caps uppercase text-on-surface-variant">
        {label}
      </label>
      {description && (
        <p id={descriptionId} className="text-body-sm text-on-surface-variant">
          {description}
        </p>
      )}
      {children({ inputId, describedBy })}
      {error && (
        <p id={errorId} className="flex items-center gap-1 text-body-sm text-destructive-red">
          <Icon name="error" size={14} />
          {error}
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Input
   --------------------------------------------------------------------------- */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ invalid, className, ...rest }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        "rounded border bg-surface-container px-3 py-2 text-body-md text-on-surface placeholder-on-surface-variant transition-colors focus:border-evidence-blue",
        invalid ? "border-destructive-red" : "border-outline-variant",
        className,
      )}
      {...rest}
    />
  );
}

/* ---------------------------------------------------------------------------
   Textarea
   --------------------------------------------------------------------------- */

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  /** Switches to mono + code-block sizing, for pasted stack traces and logs. */
  mono?: boolean;
}

export function Textarea({ invalid, mono, className, ...rest }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(
        "dv-scroll-thin resize-none rounded border bg-surface-container px-3 py-2 text-on-surface placeholder-on-surface-variant transition-colors focus:border-evidence-blue",
        mono ? "font-mono text-code-block" : "text-body-md",
        invalid ? "border-destructive-red" : "border-outline-variant",
        className,
      )}
      {...rest}
    />
  );
}

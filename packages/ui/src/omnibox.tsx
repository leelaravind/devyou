/**
 * The diagnostic omnibox — the product's front door.
 *
 * One field that accepts anything: a 200-line Java stack trace, a minified React
 * error, `kubectl` output, or a sentence. R-23 names the alternative as a concrete
 * abandonment trigger — "forcing users to pick Frontend/React from dropdowns before
 * searching introduces unnecessary extraneous cognitive load".
 *
 * So there is no technology selector here. Technology, version and OS are *extracted*
 * from what was pasted, server-side and deterministically, and shown back as editable
 * chips afterwards. Guessing wrong is recoverable; making somebody classify their own
 * problem before they can search is not.
 *
 * It is a real `<form>` with a real `method="get"`. The results page is a URL, which
 * makes it shareable, crawlable and functional with JavaScript disabled — plan §16
 * and the Phase 12 gate both require that the knowledge path does not depend on
 * client JS.
 */

import { useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { cn } from "@devyou/core";
import { Icon } from "./icon.js";

export interface OmniboxProps {
  /** GET target. Defaults to the search route. */
  action?: string;
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  /** Rendered under the field — normally the environment toggle. */
  footer?: ReactNode;
  /** Optional client-side handler. The form still submits normally without it. */
  onSubmit?: (value: string) => void;
  autoFocus?: boolean;
  className?: string;
}

const MAX_LINE_NUMBERS = 4;

export function Omnibox({
  action = "/search",
  name = "q",
  defaultValue = "",
  placeholder = "Paste an error, stack trace, log, or describe what's broken...",
  footer,
  onSubmit,
  autoFocus,
  className,
}: OmniboxProps) {
  const id = useId();
  const [value, setValue] = useState(defaultValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (!onSubmit) return;
    event.preventDefault();
    onSubmit(value);
  }

  /*
    Ctrl/Cmd+Enter submits.

    Plain Enter must insert a newline: the field's whole purpose is multi-line paste,
    and a stack trace pasted into a field that submits on Enter would submit on the
    first line. The modifier is the convention every developer already has from
    their editor and their chat client.
  */
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <form
      action={action}
      method="get"
      onSubmit={handleSubmit}
      className={cn("flex w-full flex-col", className)}
      role="search"
    >
      <label htmlFor={id} className="sr-only">
        Describe the problem, or paste an error or stack trace
      </label>

      <div className="relative flex w-full flex-col">
        {/* Gutter line numbers. Decorative — they make the field read as a code
            surface, which is the signal that pasting a trace is expected here. */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-4 left-4 flex w-4 flex-col items-end text-right font-mono text-code-block text-outline-variant select-none"
        >
          {Array.from({ length: MAX_LINE_NUMBERS }, (_, index) => (
            <span key={index}>{index + 1}</span>
          ))}
        </div>

        <textarea
          id={id}
          ref={textareaRef}
          name={name}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          autoFocus={autoFocus}
          rows={6}
          className="dv-scroll-thin h-40 w-full resize-none rounded border border-outline-variant bg-surface-container-lowest p-4 pl-12 font-mono text-code-block text-on-surface transition-colors placeholder-on-surface-variant focus:border-evidence-blue"
        />

        <button
          type="submit"
          className="absolute right-4 bottom-4 inline-flex items-center gap-1 rounded bg-primary px-4 py-2 font-mono text-label-caps uppercase text-on-primary transition-opacity hover:opacity-90"
        >
          <Icon name="search" size={14} />
          Diagnose
        </button>
      </div>

      <p className="mt-2 text-body-sm text-on-surface-variant">
        <kbd className="rounded border border-outline-variant bg-surface-variant px-1 font-mono text-env-tag">
          Ctrl
        </kbd>
        {" + "}
        <kbd className="rounded border border-outline-variant bg-surface-variant px-1 font-mono text-env-tag">
          Enter
        </kbd>{" "}
        to search. Enter adds a line.
      </p>

      {footer && <div className="mt-2">{footer}</div>}
    </form>
  );
}

/* ---------------------------------------------------------------------------
   Compact search, for the top navigation
   --------------------------------------------------------------------------- */

export interface CompactSearchProps {
  action?: string;
  name?: string;
  defaultValue?: string;
  className?: string;
}

export function CompactSearch({
  action = "/search",
  name = "q",
  defaultValue = "",
  className,
}: CompactSearchProps) {
  const id = useId();
  return (
    <form action={action} method="get" role="search" className={cn("flex", className)}>
      <label htmlFor={id} className="sr-only">
        Search playbooks
      </label>
      <div className="flex items-center gap-2 rounded border border-outline-variant bg-surface-container px-3 py-1.5">
        <Icon name="search" size={16} className="text-on-surface-variant" />
        <input
          id={id}
          name={name}
          type="search"
          defaultValue={defaultValue}
          placeholder="Search verified playbooks..."
          className="w-64 max-w-full border-none bg-transparent p-0 text-body-sm text-on-surface outline-none placeholder-on-surface-variant"
        />
      </div>
    </form>
  );
}

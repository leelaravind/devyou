/**
 * The primitives every audited action is built from.
 *
 * There is one action form, used everywhere, because the alternative is twenty hand-written
 * forms of which nineteen ask for a reason and the twentieth was added in a hurry. The
 * action layer would still refuse that twentieth form — `performAdminAction` rejects a
 * reason-requiring capability with no code — but the operator would meet the refusal after
 * clicking, having composed nothing, which teaches them the form is broken rather than that
 * the reason is required.
 *
 * So `requiresReason()` from `@devyou/auth` decides the shape of the form as well as the
 * outcome of the submission, and both read the same matrix. The UI and the enforcement
 * cannot disagree because neither owns the rule.
 */

import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { Form, useNavigation } from "react-router";
import { Button, Card, Field, Icon, Input, Tag, Textarea, type ButtonProps } from "@devyou/ui";
import { REASON_CODES, requiresReason, type Capability } from "@devyou/auth";

/* ---------------------------------------------------------------------------
   Labelled controls
   --------------------------------------------------------------------------- */

/**
 * `Field` takes its control as a render prop, because the label, description and error ids
 * are generated with `useId` and have to be threaded onto the specific control that needs
 * them. That is the right design and it is verbose at twenty call sites, so these three
 * wrappers do the threading once.
 *
 * The wrappers exist to make the accessible wiring unavoidable rather than merely
 * available: a control added here is labelled and described correctly because there is no
 * shorter way to add one.
 *
 * `<select>` has no design-system primitive yet, so its classes are spelled out below. It
 * is the one place this module styles a control itself, and it belongs in `@devyou/ui`
 * beside `Input` and `Textarea` — noted rather than forked into a private copy that would
 * then drift.
 */
const SELECT_CLASSES =
  "w-full rounded border border-outline-variant bg-surface-container px-3 py-2 font-mono text-body-sm text-on-surface";

export function TextField({
  label,
  description,
  error,
  ...input
}: {
  label: string;
  description?: string;
  error?: string;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} description={description} error={error}>
      {({ inputId, describedBy }) => (
        <Input id={inputId} aria-describedby={describedBy} invalid={Boolean(error)} {...input} />
      )}
    </Field>
  );
}

export function TextAreaField({
  label,
  description,
  error,
  mono = true,
  ...textarea
}: {
  label: string;
  description?: string;
  error?: string;
  /** Defaults on. Every free-text field in this console is a reason, an identifier or a
   *  JSON value — things a machine produced or that get compared character by character. */
  mono?: boolean;
} & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} description={description} error={error}>
      {({ inputId, describedBy }) => (
        <Textarea
          id={inputId}
          aria-describedby={describedBy}
          invalid={Boolean(error)}
          mono={mono}
          {...textarea}
        />
      )}
    </Field>
  );
}

export function SelectField({
  label,
  description,
  options,
  ...select
}: {
  label: string;
  description?: string;
  /** `[value, label]`, or a bare value used as its own label. */
  options: ReadonlyArray<string | readonly [string, string]>;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} description={description}>
      {({ inputId, describedBy }) => (
        <select id={inputId} aria-describedby={describedBy} className={SELECT_CLASSES} {...select}>
          {options.map((option) => {
            const [value, text] = typeof option === "string" ? [option, option] : option;
            return (
              <option key={value} value={value}>
                {text}
              </option>
            );
          })}
        </select>
      )}
    </Field>
  );
}

/* ---------------------------------------------------------------------------
   Reason fields
   --------------------------------------------------------------------------- */

/**
 * The reason code, as a `<select>` over the fixed vocabulary.
 *
 * Not a free-text box with suggestions. `REASON_CODES` exists because an unconstrained
 * reason becomes "fixing" on every row within a month, and a text input with a datalist
 * is an unconstrained reason wearing a costume. Free text is still captured, beside it,
 * as detail — which is the right place for the specifics nobody can enumerate in advance.
 */
export function ReasonFields({ capability }: { capability: Capability }) {
  const required = requiresReason(capability);

  return (
    <div className="gap-density-high flex flex-col">
      <SelectField
        label="Reason code"
        name="reasonCode"
        required={required}
        defaultValue=""
        description={
          required
            ? "Required. This action is visible to somebody outside this console."
            : "Optional. Defaults to routine maintenance."
        }
        options={[
          ["", required ? "Choose a reason…" : "routine_maintenance"],
          ...REASON_CODES.map((code) => [code, code] as const),
        ]}
      />

      <TextAreaField
        label="Detail"
        name="reasonDetail"
        rows={2}
        maxLength={1000}
        description="Free text, kept alongside the code. Written into an append-only row: it cannot be edited afterwards."
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Action form
   --------------------------------------------------------------------------- */

export interface ActionFormProps {
  /** Which branch of the route's action to run. Read with `requiredField(form, "intent")`. */
  intent: string;
  /** The capability this action exercises. Decides whether a reason code is demanded. */
  capability: Capability;
  label: string;
  variant?: ButtonProps["variant"];
  /** Hidden inputs: the target id, a target status, whatever the action needs. */
  fields?: Record<string, string>;
  /** Extra visible controls — a role picker, a merge target. */
  children?: ReactNode;
}

/**
 * One audited action, as a real `<form method="post">`.
 *
 * A real form rather than a fetcher-driven button, deliberately. It works with no
 * JavaScript, it cannot be triggered by a stray `GET`, and the browser's own
 * double-submit protection applies. `useNavigation` disables the button while the
 * submission is in flight so an impatient second click cannot produce a second audit
 * row for one decision.
 */
export function ActionForm({
  intent,
  capability,
  label,
  variant = "secondary",
  fields = {},
  children,
}: ActionFormProps) {
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";

  return (
    <Form method="post" className="gap-density-high flex flex-col">
      <input type="hidden" name="intent" value={intent} />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {children}
      <ReasonFields capability={capability} />

      <div className="gap-density-high flex items-center">
        <Button type="submit" variant={variant} loading={submitting} size="sm">
          {label}
        </Button>
        <span className="text-env-tag text-on-surface-variant font-mono">{capability}</span>
      </div>
    </Form>
  );
}

/* ---------------------------------------------------------------------------
   Layout
   --------------------------------------------------------------------------- */

export function SurfaceHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-8">
      <h1 className="font-headline text-headline-lg text-on-surface mb-1">{title}</h1>
      <p className="text-body-sm text-on-surface-variant max-w-3xl">{description}</p>
      {children && <div className="mt-4">{children}</div>}
    </header>
  );
}

/**
 * The surface frame.
 *
 * `Page contained={false}` and a scroll container, because these tables are wide and the
 * sidebar already claims 280px. The public site's 1280px content measure is tuned for
 * prose and a diagnostic tree; an audit log wants the width.
 */
export function SurfaceLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="dv-scroll-thin p-margin min-w-0 flex-1 overflow-y-auto py-10">
      <div className="mx-auto w-full max-w-[1100px]">{children}</div>
    </main>
  );
}

/**
 * What to show when a queue is empty.
 *
 * Stated plainly rather than celebrated. "Nothing to review" on a moderation queue is
 * ambiguous — it could mean the corpus is clean or it could mean the reporting path is
 * broken — so the copy says which table was read and found empty.
 */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <Card as="section" className="text-center">
      <Icon name="check_circle" size={22} className="text-on-surface-variant mx-auto mb-2" />
      <p className="text-body-sm text-on-surface-variant">{children}</p>
    </Card>
  );
}

/** A single labelled fact. Used across the detail panes so the eye can scan them. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 py-1">
      <span className="text-env-tag text-on-surface-variant w-40 shrink-0 font-mono uppercase">
        {label}
      </span>
      <span className="text-body-sm text-on-surface min-w-0 break-words">{children}</span>
    </div>
  );
}

/**
 * A status chip.
 *
 * Never colour alone (R-34): the value is always spelled out, and the tone only
 * reinforces it. An operator with a colour vision deficiency reads the same thing.
 */
export function StatusChip({ value, alarming = false }: { value: string; alarming?: boolean }) {
  return (
    <Tag className={alarming ? "border-destructive-red/40 text-destructive-red" : undefined}>
      {value}
    </Tag>
  );
}

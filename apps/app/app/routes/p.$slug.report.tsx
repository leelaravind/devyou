import { Form, Link, data, redirect, useNavigation } from "react-router";
import { Button, Card, Field, Icon, Input, OutcomeChip, Textarea } from "@devyou/ui";
import { REPRODUCTION_OUTCOMES, type ReproductionOutcome } from "@devyou/core";
import { normaliseVersion, type EnvironmentSnapshot } from "@devyou/domain";
import { scanUnicode, revealHidden, looksLikeSecret } from "@devyou/security";
import { resolvePrincipal } from "@devyou/auth";
import type { Route } from "./+types/p.$slug.report";
import { cloudflareContext } from "../context/cloudflare";
import { loadRevisionBySlug } from "../lib/playbook.server";
import { readEnvironmentCookie } from "../lib/environment.server";
import { hashIp, recordReproduction } from "../lib/reproduction.server";

/**
 * Worked / Partial / Failed.
 *
 * R-31 gives this flow a 10-30 second budget, and exceeding it is measured as
 * abandonment rather than as a slightly slower form. Everything here follows from
 * that number:
 *
 * - The outcome arrives **prefilled from the diagnostic page**, so the reader has
 *   already made the only decision that cannot be inferred.
 * - The environment is **prefilled from their declared one**, editable in place. A
 *   reader who has declared an environment does not retype it.
 * - Notes are **entirely optional** and last. The research is specific that forcing
 *   a written justification "guarantees they will close the tab".
 * - There is no sign-in wall. Signing in changes what the report counts for, not
 *   whether it can be filed.
 *
 * What it does *not* do is submit on one click. The reader states the outcome; the
 * system never infers one from having reached a node.
 */

export function meta({ loaderData: loaded }: Route.MetaArgs) {
  return [
    { title: loaded ? `Report a result — ${loaded.revision.title}` : "Report a result" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const revision = await loadRevisionBySlug(env.DB, params.slug);
  if (!revision) throw new Response(null, { status: 404 });

  const url = new URL(request.url);
  const requested = url.searchParams.get("outcome");
  const outcome = isOutcome(requested) ? requested : null;

  return {
    revision,
    outcome,
    reachedNodeId: url.searchParams.get("node"),
    stepsParam: url.searchParams.get("steps"),
    environment: readEnvironmentCookie(request),
    /*
      Whether this report will be counted, stated on the form before it is filed.

      An anonymous report is stored, shown and never counted toward the confidence
      band (R-9). Telling somebody that afterwards, or not at all, is how a product
      earns the reputation of quietly discarding contributions — so the form says it
      up front, and still lets them file it either way.
    */
    signedIn: (await resolvePrincipal(env.DB, request)) !== null,
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const form = await request.formData();

  const revision = await loadRevisionBySlug(env.DB, params.slug);
  if (!revision) throw new Response(null, { status: 404 });

  const outcome = form.get("outcome");
  if (!isOutcome(outcome)) {
    return data({ error: "Choose what happened before submitting." }, { status: 400 });
  }

  const notesRaw = String(form.get("notes") ?? "").slice(0, 2000);

  /*
    The notes are scanned before they are stored, not before they are displayed.

    Hidden Unicode (R-14) and secret-shaped strings are both things a contributor
    pastes without noticing — a bidi override copied out of a terminal, an API key
    left in a log line. Catching them at the point of submission is the only moment
    the person who can fix it is still present.
  */
  const hidden = scanUnicode(notesRaw);
  if (hidden.length > 0) {
    return data(
      {
        error:
          "That note contains invisible characters, which is usually accidental but can be used to " +
          "disguise text. Here is what it actually contains — please check and resubmit.",
        revealed: revealHidden(notesRaw),
      },
      { status: 400 },
    );
  }
  if (looksLikeSecret(notesRaw)) {
    return data(
      {
        error:
          "That looks like it contains a credential. This page is public — please remove it before " +
          "submitting. Nothing has been saved.",
      },
      { status: 400 },
    );
  }

  const environment = buildEnvironment(form);
  if (!environment.osFamily && environment.components.length === 0) {
    return data(
      { error: "Tell us at least your operating system or one version — that is what makes this evidence." },
      { status: 400 },
    );
  }

  const principal = await resolvePrincipal(env.DB, request);

  /*
    One report per account per revision, checked before the address guard below.

    A signed-in contributor is identified, so the identity is the right key — and it
    is the only one that survives a changed network. The database enforces this too
    (unique index on actor + revision); the check here exists to return a sentence
    rather than a constraint violation.
  */
  if (principal) {
    const existing = await env.DB.prepare(
      `SELECT id FROM reproduction_reports WHERE revision_id = ?1 AND actor_id = ?2 LIMIT 1`,
    )
      .bind(revision.revisionId, principal.userId)
      .first<{ id: string }>();

    if (existing) {
      return data(
        {
          error:
            "You have already reported this revision. Reports cannot be edited — if the result " +
            "changed, that is a new revision's evidence, not a correction to this one.",
        },
        { status: 409 },
      );
    }
  }

  const ip = request.headers.get("cf-connecting-ip");
  const ipHash = await hashIp(ip, revision.revisionId);

  /*
    One anonymous report per address per revision.

    Not an anti-abuse measure so much as an accident guard: a double submit, a
    refresh, a shared office address. Real Sybil resistance is the weighting in
    `recomputeConfidence`, which gives an anonymous report zero weight toward the
    band — this only stops the evidence list filling with duplicates.

    Skipped for a signed-in contributor: two colleagues behind one office address
    are two independent reproductions, and blocking the second would silently
    discard real evidence. The account check above already covers the double-submit
    case for them.
  */
  if (ipHash && !principal) {
    const existing = await env.DB.prepare(
      `SELECT id FROM reproduction_reports WHERE revision_id = ?1 AND ip_hash = ?2 LIMIT 1`,
    )
      .bind(revision.revisionId, ipHash)
      .first<{ id: string }>();

    if (existing) {
      return data(
        { error: "A report has already been filed from here for this revision." },
        { status: 409 },
      );
    }
  }

  const reachedNodeId = String(form.get("reachedNodeId") ?? "") || null;
  const validNode =
    reachedNodeId !== null && revision.nodes.some((node) => node.id === reachedNodeId)
      ? reachedNodeId
      : null;

  await recordReproduction(env.DB, {
    revisionId: revision.revisionId,
    actorId: principal?.userId ?? null,
    outcome,
    reachedNodeId: validNode,
    notes: notesRaw.trim() === "" ? null : notesRaw.trim(),
    environment,
    ipHash,
    turnstileVerified: false,
  });

  return redirect(`/p/${revision.playbookSlug}/report?thanks=${outcome}`);
}

export default function Report({ loaderData, actionData }: Route.ComponentProps) {
  const { revision, outcome, reachedNodeId, environment, signedIn } = loaderData;
  const navigation = useNavigation();

  /*
    `actionData` is a union of every shape this route's action returns, so a bare
    `actionData.error` is `unknown` — narrowing by key alone does not give the
    compiler a type. Normalising here keeps the JSX free of casts and makes the two
    optional fields explicit.
  */
  const formError =
    actionData && "error" in actionData && typeof actionData.error === "string"
      ? actionData.error
      : null;
  const revealedText =
    actionData && "revealed" in actionData && typeof actionData.revealed === "string"
      ? actionData.revealed
      : null;
  const submitting = navigation.state === "submitting";

  const url = typeof window === "undefined" ? null : new URL(window.location.href);
  const thanks = url?.searchParams.get("thanks");

  if (thanks && isOutcome(thanks)) {
    return <Receipt revision={revision} outcome={thanks} />;
  }

  return (
    <main id="main" className="mx-auto flex w-full max-w-[640px] flex-col gap-margin px-margin py-8">
      <Link
        to={`/p/${revision.playbookSlug}`}
        className="flex items-center gap-1 font-mono text-env-tag text-on-surface-variant hover:text-on-surface"
      >
        <Icon name="arrow_back" size={13} />
        {revision.title}
      </Link>

      <h1 className="font-headline text-headline-lg text-on-surface">What happened?</h1>

      {formError && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded border border-destructive-red bg-surface-container-low p-3 text-body-sm text-destructive-red"
        >
          <p className="flex items-start gap-2">
            <Icon name="error" size={15} className="mt-0.5 shrink-0" />
            {formError}
          </p>
          {revealedText && (
            <pre className="dv-scroll-thin overflow-x-auto rounded bg-surface-container-lowest p-2 font-mono text-code-block text-on-surface">
              {revealedText}
            </pre>
          )}
        </div>
      )}

      <Form method="post" className="flex flex-col gap-margin">
        <input type="hidden" name="reachedNodeId" value={reachedNodeId ?? ""} />

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-mono text-label-caps uppercase text-on-surface-variant">
            The result
          </legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {REPRODUCTION_OUTCOMES.map((value) => (
              <label
                key={value}
                className="flex cursor-pointer items-center gap-2 rounded border border-outline-variant p-3 text-body-md transition-colors hover:bg-surface-container-highest has-checked:border-evidence-blue"
              >
                <input
                  type="radio"
                  name="outcome"
                  value={value}
                  defaultChecked={outcome === value}
                  required
                  className="h-4 w-4"
                />
                <OutcomeChip outcome={value} />
              </label>
            ))}
          </div>
          <p className="text-body-sm text-on-surface-variant">
            A failure is as useful as a success here — more so, if it is on versions nobody has
            tried yet.
          </p>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 font-mono text-label-caps uppercase text-on-surface-variant">
            Your environment
          </legend>
          {environment ? (
            <p className="text-body-sm text-on-surface-variant">
              Prefilled from what you told us. Correct anything that is wrong — this is the part
              that makes the report evidence rather than an opinion.
            </p>
          ) : (
            <p className="text-body-sm text-on-surface-variant">
              Roughly is fine. Versions are what let the next person tell whether this applies to
              them.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Operating system">
              {({ inputId }) => (
                <Input
                  id={inputId}
                  name="osFamily"
                  defaultValue={environment?.osFamily ?? ""}
                  placeholder="linux"
                />
              )}
            </Field>
            <Field label="OS version">
              {({ inputId }) => (
                <Input
                  id={inputId}
                  name="osVersion"
                  defaultValue={environment?.osVersion ?? ""}
                  placeholder="24.04"
                />
              )}
            </Field>
          </div>

          {[0, 1, 2, 3].map((index) => (
            <Field
              key={index}
              label={index === 0 ? "Versions you were running" : ""}
            >
              {({ inputId }) => (
                <Input
                  id={inputId}
                  name="component"
                  defaultValue={environment?.components[index]?.rawLabel ?? ""}
                  placeholder={
                    index === 0 ? "node 22.3.1" : index === 1 ? "wrangler 4.20.0" : "one per line"
                  }
                  className="font-mono"
                />
              )}
            </Field>
          ))}
        </fieldset>

        <Field
          label="Anything worth adding"
          description="Optional, and genuinely optional. Skip it if you are in a hurry."
        >
          {({ inputId }) => (
            <Textarea id={inputId} name="notes" rows={3} maxLength={2000} placeholder="" />
          )}
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={submitting} iconLeft="check">
            Submit the report
          </Button>
          {signedIn ? (
            <p className="text-body-sm text-on-surface-variant">
              This will be counted toward the confidence figure and attributed to you.
            </p>
          ) : (
            <p className="text-body-sm text-on-surface-variant">
              You are not signed in, so this will be shown but will not count toward the confidence
              figure.{" "}
              <Link to="/sign-in" className="text-evidence-blue underline">
                Sign in
              </Link>{" "}
              if you want it to.
            </p>
          )}
        </div>
        {/*
          One sentence, not a checkbox: R-31 budgets this whole flow at 10-30 seconds,
          and the terms themselves say the load-bearing thing again — a filed report
          is append-only.
        */}
        <p className="text-body-sm text-on-surface-variant">
          Filing a report is covered by the{" "}
          <Link to="/contribution-terms" className="text-evidence-blue underline">
            contribution terms
          </Link>
          ; a filed report is permanent and cannot be withdrawn.
        </p>
      </Form>
    </main>
  );
}

/**
 * The receipt.
 *
 * Named in plan §8 as a deliverable, and it earns its place: a report that vanishes
 * into a redirect teaches the reader that reporting does nothing. This says exactly
 * what was recorded and what it will and will not affect.
 */
function Receipt({
  revision,
  outcome,
}: {
  revision: Awaited<ReturnType<typeof loader>>["revision"];
  outcome: ReproductionOutcome;
}) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-[640px] flex-col gap-margin px-margin py-16">
      <Card>
        <h1 className="mb-2 flex items-center gap-2 font-headline text-headline-md text-on-surface">
          <Icon name="check_circle" size={20} className="text-status-ci-verified" />
          Recorded
        </h1>

        <p className="mb-3 text-body-md text-on-surface-variant">
          Your report of <OutcomeChip outcome={outcome} /> is attached to{" "}
          <strong className="text-on-surface">revision {revision.revisionNumber}</strong> of this
          playbook — the exact text you followed, not whatever it says next year.
        </p>

        <ul className="mb-4 flex list-none flex-col gap-1 text-body-sm text-on-surface-variant">
          <li className="flex items-start gap-2">
            <Icon name="check" size={13} className="mt-0.5 shrink-0" />
            It is permanent. Reports here are never edited or deleted, including failures.
          </li>
          <li className="flex items-start gap-2">
            <Icon name="check" size={13} className="mt-0.5 shrink-0" />
            It is shown on the evidence page with the environment you gave.
          </li>
          <li className="flex items-start gap-2">
            <Icon name="info" size={13} className="mt-0.5 shrink-0" />
            Because you are not signed in, it is displayed but not counted toward the confidence
            band. That is not a judgement of your report — it is the only way the number stays
            hard to forge.
          </li>
        </ul>

        <div className="flex flex-wrap gap-2">
          <Link
            to={`/p/${revision.playbookSlug}/evidence`}
            className="inline-flex items-center gap-2 rounded border border-outline-variant px-4 py-2 font-mono text-label-caps uppercase text-on-surface-variant hover:bg-surface-container-highest"
          >
            <Icon name="fingerprint" size={14} />
            See it on the evidence page
          </Link>
          <Link
            to={`/p/${revision.playbookSlug}`}
            className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 font-mono text-label-caps uppercase text-on-primary"
          >
            Back to the playbook
          </Link>
        </div>
      </Card>
    </main>
  );
}

/* ------------------------------------------------------------------------- */

function isOutcome(value: unknown): value is ReproductionOutcome {
  return typeof value === "string" && (REPRODUCTION_OUTCOMES as readonly string[]).includes(value);
}

function buildEnvironment(form: FormData): EnvironmentSnapshot {
  const components = form
    .getAll("component")
    .map((value) => String(value).trim())
    .filter((value) => value !== "")
    .slice(0, 8)
    .map((rawLabel) => ({
      technologyId: null,
      rawLabel: rawLabel.slice(0, 64),
      semverNormalized: normaliseVersion(rawLabel),
    }));

  return {
    osFamily: str(form.get("osFamily")),
    osVersion: str(form.get("osVersion")),
    architecture: null,
    components,
  };
}

function str(value: FormDataEntryValue | null): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? null : text.slice(0, 64);
}

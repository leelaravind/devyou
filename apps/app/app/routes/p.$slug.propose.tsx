import { Form, Link, data, redirect, useNavigation } from "react-router";
import { Button, Card, Field, Icon, Textarea } from "@devyou/ui";
import { newId } from "@devyou/core";
import { looksLikeSecret, revealHidden, scanUnicode } from "@devyou/security";
import type { Route } from "./+types/p.$slug.propose";
import { cloudflareContext } from "../context/cloudflare";
import { loadRevisionBySlug } from "../lib/playbook.server";

/**
 * Propose a missing test, a correction, or report that a playbook has gone stale.
 *
 * This route is where disagreement goes, and its shape is the argument. R-40: a
 * reader who thinks a playbook is wrong is funnelled into proposing a change to it,
 * not into a comment thread underneath it. There is no comments table in this
 * schema, and that is deliberate — the adoption research is unambiguous that
 * argumentative threads are what made the incumbent hostile, and that a playbook
 * which is wrong should be *fixed or sunk by evidence*, not debated below the fold.
 *
 * A proposal is never silently discarded. A declined one keeps its reason and stays
 * visible to its author (`change_proposals.resolution_reason`), because contributions
 * disappearing without explanation is the specific behaviour the research names as
 * fatal to a contributor base.
 */

const TYPES = [
  {
    value: "missing_test",
    label: "A diagnostic step is missing",
    hint: "The playbook does not check something it should have. This is the most useful kind.",
  },
  {
    value: "additional_branch",
    label: "There is an outcome with nowhere to go",
    hint: "You saw a result the playbook has no branch for.",
  },
  {
    value: "correction",
    label: "Something here is wrong",
    hint: "A command, an expected result, or a stated cause does not match reality.",
  },
  {
    value: "environment_gap",
    label: "It does not say it applies to my setup",
    hint: "The versions or platform you are on are not covered by the stated applicability.",
  },
  {
    value: "stale_report",
    label: "It has gone out of date",
    hint: "It was right once. Something upstream has changed since.",
  },
  {
    value: "safety_report",
    label: "Something here is dangerous",
    hint: "A command could destroy data or leak a credential and is not marked as such.",
  },
] as const;

const MAX_BODY = 4000;

export function meta({ loaderData: loaded }: Route.MetaArgs) {
  return [
    { title: loaded ? `Propose a change — ${loaded.revision.title}` : "Propose a change" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const revision = await loadRevisionBySlug(env.DB, params.slug);
  if (!revision) throw new Response(null, { status: 404 });

  const url = new URL(request.url);
  const nodeId = url.searchParams.get("node");
  const node = nodeId ? revision.nodes.find((candidate) => candidate.id === nodeId) : undefined;

  return {
    revision,
    node: node ? { id: node.id, title: node.title } : null,
    submitted: url.searchParams.get("submitted") === "1",
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const revision = await loadRevisionBySlug(env.DB, params.slug);
  if (!revision) throw new Response(null, { status: 404 });

  const form = await request.formData();
  const proposalType = String(form.get("proposalType") ?? "");
  if (!TYPES.some((type) => type.value === proposalType)) {
    return data({ error: "Choose what kind of change this is." }, { status: 400 });
  }

  const body = String(form.get("body") ?? "").slice(0, MAX_BODY).trim();
  if (body.length < 20) {
    return data(
      { error: "Say a little more — enough for somebody to act on without asking you." },
      { status: 400 },
    );
  }

  /*
    Scanned before storage, for the same reason as the reproduction notes: the only
    moment the person who can fix a pasted credential or an invisible character is
    still present is this one.
  */
  const hidden = scanUnicode(body);
  if (hidden.length > 0) {
    return data(
      {
        error:
          "That contains invisible characters. Usually accidental, occasionally not — here is what " +
          "it actually says. Please check and resubmit.",
        revealed: revealHidden(body),
      },
      { status: 400 },
    );
  }
  if (looksLikeSecret(body)) {
    return data(
      {
        error:
          "That looks like it contains a credential, and proposals are visible to reviewers. " +
          "Please remove it. Nothing has been saved.",
      },
      { status: 400 },
    );
  }

  const nodeId = String(form.get("nodeId") ?? "") || null;
  const validNode =
    nodeId !== null && revision.nodes.some((node) => node.id === nodeId) ? nodeId : null;

  await env.DB.prepare(
    `INSERT INTO change_proposals
       (id, revision_id, node_id, author_id, proposal_type, body, status, created_at)
     VALUES (?1, ?2, ?3, NULL, ?4, ?5, 'open', ?6)`,
  )
    .bind(
      newId("proposal"),
      revision.revisionId,
      validNode,
      proposalType,
      body,
      Math.floor(Date.now() / 1000),
    )
    .run();

  /*
    A safety report opens a moderation case immediately.

    Every other proposal type waits for a reviewer to pick it up. A claim that a
    published command is destructive is different in kind — the cost of it sitting
    in a queue for a week is somebody losing data — so it goes straight into the
    moderation queue at high severity, where it is visible on the admin overview.
  */
  if (proposalType === "safety_report") {
    await env.DB.prepare(
      `INSERT INTO moderation_cases
         (id, subject_type, subject_id, reason, origin, detail, severity, status, created_at)
       VALUES (?1, 'revision', ?2, 'dangerous_command', 'reporter', ?3, 'high', 'open', ?4)`,
    )
      .bind(
        newId("moderationCase"),
        revision.revisionId,
        body.slice(0, 1000),
        Math.floor(Date.now() / 1000),
      )
      .run();
  }

  return redirect(`/p/${revision.playbookSlug}/propose?submitted=1`);
}

export default function Propose({ loaderData, actionData }: Route.ComponentProps) {
  const { revision, node, submitted } = loaderData;
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

  if (submitted) {
    return (
      <main id="main" className="mx-auto flex w-full max-w-[640px] flex-col gap-margin px-margin py-16">
        <Card>
          <h1 className="mb-2 flex items-center gap-2 font-headline text-headline-md text-on-surface">
            <Icon name="check_circle" size={20} className="text-status-ci-verified" />
            Sent for review
          </h1>
          <p className="mb-3 text-body-md text-on-surface-variant">
            Your proposal is attached to revision {revision.revisionNumber}. If it is accepted it
            becomes a new revision — the existing one keeps its own text and its own evidence.
          </p>
          <p className="mb-4 text-body-sm text-on-surface-variant">
            If it is declined, it is declined with a reason rather than quietly closed.
          </p>
          <Link
            to={`/p/${revision.playbookSlug}`}
            className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 font-mono text-label-caps uppercase text-on-primary"
          >
            Back to the playbook
          </Link>
        </Card>
      </main>
    );
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

      <div>
        <h1 className="font-headline text-headline-lg text-on-surface">Propose a change</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">
          There is no comment section here on purpose. If a playbook is wrong or incomplete, the
          useful thing is a change to it — so that is the only thing this form does.
        </p>
        {node && (
          <p className="mt-2 font-mono text-env-tag text-on-surface-variant">
            About step: <span className="text-on-surface">{node.title}</span>
          </p>
        )}
      </div>

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
        <input type="hidden" name="nodeId" value={node?.id ?? ""} />

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-mono text-label-caps uppercase text-on-surface-variant">
            What kind of change
          </legend>
          {TYPES.map((type) => (
            <label
              key={type.value}
              className="flex cursor-pointer items-start gap-3 rounded border border-outline-variant p-3 transition-colors hover:bg-surface-container-highest has-checked:border-evidence-blue"
            >
              <input
                type="radio"
                name="proposalType"
                value={type.value}
                required
                className="mt-1 h-4 w-4 shrink-0"
              />
              <span>
                <span className="block text-body-md text-on-surface">{type.label}</span>
                <span className="block text-body-sm text-on-surface-variant">{type.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <Field
          label="What should change"
          description="What you saw, what you expected, and what you think the playbook should say instead. Commands and output are welcome."
        >
          {({ inputId }) => (
            <Textarea id={inputId} name="body" rows={8} mono maxLength={MAX_BODY} required />
          )}
        </Field>

        <Button type="submit" loading={navigation.state === "submitting"} iconLeft="add">
          Send it for review
        </Button>
        <p className="text-body-sm text-on-surface-variant">
          Sending a proposal is covered by the{" "}
          <Link to="/contribution-terms" className="text-evidence-blue underline">
            contribution terms
          </Link>
          .
        </p>
      </Form>
    </main>
  );
}

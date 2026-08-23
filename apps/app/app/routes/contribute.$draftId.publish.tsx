import { Form, Link, data, redirect, useNavigation } from "react-router";
import { Button, Card, ConfidenceBandChip, Icon } from "@devyou/ui";
import { ApiError } from "@devyou/core";
import { INITIAL_BAND } from "@devyou/domain";
import type { Route } from "./+types/contribute.$draftId.publish";
import { cloudflareContext } from "../context/cloudflare";
import { guardOrigin, loadAuthState } from "../lib/auth.server";
import { evaluateGate, loadDraft, publishDraft } from "../lib/contribution.server";
import { httpError } from "../lib/http.server";

/**
 * The publication gate — plan §10 step F.
 *
 * This is the boundary between the private, mutable half of the system and the
 * public, immutable one, and it is the only crossing. What it does on the way
 * through is fixed and is stated on the screen before the button is pressed,
 * because every part of it surprises somebody:
 *
 * - It creates a **new revision**. Publishing a correction does not change the
 *   existing one; that revision keeps its text, its URL and the evidence it earned,
 *   and stays readable forever.
 * - The new revision starts at **`unverified` with zero evidence**, whatever the
 *   playbook had accumulated. Evidence belongs to the exact text that was tested. A
 *   reviewer deciding that old evidence still applies is a human judgement recorded
 *   as new evidence, never an inheritance.
 * - It **refuses with reasons**, not with a generic failure. Every blocker
 *   `canPublish` returns names the thing a reader would otherwise have been shown
 *   without warning.
 *
 * The gate is evaluated twice: once for this screen, and again inside
 * `publishDraft` against the write that is about to happen. Confirming a stale gate
 * is precisely how an unconfirmed AI inference would reach a reader.
 */

export function meta() {
  return [{ title: "Publish — DEV.ITISYOU" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const auth = await loadAuthState(request, env);
  if (!auth.principal) throw new Response(null, { status: 404 });

  const draft = await loadDraft(env.DB, params.draftId, auth.principal.userId);
  if (!draft) throw new Response(null, { status: 404 });

  if (draft.status === "published" && draft.playbookSlug) {
    throw redirect(`/p/${draft.playbookSlug}`);
  }
  if (!draft.document) throw redirect(`/contribute/${draft.id}/review`);

  const gate = await evaluateGate(env.DB, draft, draft.document);

  return {
    draftId: draft.id,
    title: draft.document.title,
    revising: draft.playbookSlug,
    nodeCount: draft.document.nodes.length,
    blockers: gate.decision.blockers,
    allowed: gate.decision.allowed,
    warnings: gate.graph.problems.filter((problem) => problem.severity === "warning"),
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  guardOrigin(request, env);

  const auth = await loadAuthState(request, env);
  if (!auth.principal) throw new Response(null, { status: 404 });

  const draft = await loadDraft(env.DB, params.draftId, auth.principal.userId);
  if (!draft) throw new Response(null, { status: 404 });
  if (!draft.document) throw redirect(`/contribute/${draft.id}/review`);
  if (draft.status === "published") {
    return data({ error: "This draft has already been published." }, { status: 409 });
  }

  try {
    const result = await publishDraft(env.DB, draft, draft.document, auth.principal.userId);
    return redirect(`/p/${result.playbookSlug}?published=${result.revisionNumber}`);
  } catch (error) {
    /*
      A gate failure at write time comes back as a `CONFLICT` carrying the blockers,
      which is a 409 and a sentence rather than an error boundary. Anything else is
      a real fault and is translated by `httpError`, which keeps a refused publish
      out of the 500 rate the on-call alert watches.
    */
    if (ApiError.is(error) && error.code === "CONFLICT") {
      return data({ error: error.publicMessage }, { status: 409 });
    }
    throw httpError(error);
  }
}

export default function Publish({ loaderData, actionData }: Route.ComponentProps) {
  const { draftId, title, revising, nodeCount, blockers, allowed, warnings } = loaderData;
  const navigation = useNavigation();

  const formError =
    actionData && "error" in actionData && typeof actionData.error === "string"
      ? actionData.error
      : null;

  return (
    <main id="main" className="mx-auto flex w-full max-w-[720px] flex-col gap-margin px-margin py-8">
      <Link
        to={`/contribute/${draftId}/edit`}
        className="flex items-center gap-1 font-mono text-env-tag text-on-surface-variant hover:text-on-surface"
      >
        <Icon name="arrow_back" size={13} />
        Back to the editor
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="font-headline text-headline-lg text-on-surface">
          {revising ? "Publish this revision" : "Publish this playbook"}
        </h1>
        <p className="text-body-md text-on-surface-variant">
          <strong className="text-on-surface">{title || "Untitled"}</strong> — {nodeCount} step
          {nodeCount === 1 ? "" : "s"}.
        </p>
      </header>

      {formError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded border border-destructive-red bg-surface-container-low p-3 text-body-sm text-destructive-red"
        >
          <Icon name="error" size={15} className="mt-0.5 shrink-0" />
          {formError}
        </div>
      )}

      {blockers.length > 0 && (
        <section aria-labelledby="blockers">
          <h2
            id="blockers"
            className="mb-2 flex items-center gap-2 font-headline text-headline-md text-destructive-red"
          >
            <Icon name="error" size={18} />
            Not yet
          </h2>
          <ul className="flex list-none flex-col gap-2">
            {blockers.map((blocker) => (
              <li
                key={blocker.code}
                className="rounded border border-destructive-red bg-surface-container-low p-3 text-body-sm text-on-surface-variant"
              >
                <span className="mb-1 block font-mono text-env-tag uppercase text-destructive-red">
                  {blocker.code.replace(/_/g, " ")}
                </span>
                {blocker.message}
                <span className="mt-1 block">
                  {BLOCKER_ROUTES[blocker.code] === "review" ? (
                    <Link to={`/contribute/${draftId}/review`} className="text-evidence-blue underline">
                      Fix this on the review screen
                    </Link>
                  ) : (
                    <Link to={`/contribute/${draftId}/edit`} className="text-evidence-blue underline">
                      Fix this in the editor
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Card>
        <h2 className="mb-2 font-headline text-headline-md text-on-surface">
          What publishing does
        </h2>
        <ul className="flex list-none flex-col gap-2 text-body-sm text-on-surface-variant">
          <li className="flex items-start gap-2">
            <Icon name="check" size={14} className="mt-0.5 shrink-0" />
            <span>
              It creates {revising ? "a new revision" : "revision 1"} and freezes it. Published
              text is immutable here — a later correction is another revision, never an edit to
              this one.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Icon name="check" size={14} className="mt-0.5 shrink-0" />
            <span className="flex flex-wrap items-center gap-1">
              It starts at <ConfidenceBandChip band={INITIAL_BAND} /> with no reproductions.
              {revising
                ? " Whatever the current revision has earned stays with the current revision — evidence describes the exact text that was tested, so it cannot follow an edit."
                : " Somebody else confirming it is what moves that, and nothing you or the structuring model can do will."}
            </span>
          </li>
          {revising && (
            <li className="flex items-start gap-2">
              <Icon name="check" size={14} className="mt-0.5 shrink-0" />
              <span>
                The current revision is marked superseded and stays readable at its own permanent
                URL, with its evidence attached. A reader who doubts your change can read exactly
                what it replaced.
              </span>
            </li>
          )}
          <li className="flex items-start gap-2">
            <Icon name="check" size={14} className="mt-0.5 shrink-0" />
            <span>
              It becomes publicly readable and indexable immediately, without a login, including by
              crawlers.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Icon name="info" size={14} className="mt-0.5 shrink-0" />
            <span>
              Nothing the structuring model produced is published on its own account. Every field
              here is either something you wrote or something you read and ticked.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Icon name="info" size={14} className="mt-0.5 shrink-0" />
            <span>
              You keep ownership. Publishing licenses this revision to the site under the{" "}
              <Link to="/contribution-terms" className="text-evidence-blue underline">
                contribution terms
              </Link>{" "}
              — and because published revisions are permanent by design, that licence does not
              lapse.
            </span>
          </li>
        </ul>
      </Card>

      {warnings.length > 0 && (
        <details className="rounded border border-outline-variant bg-surface-container-low p-3">
          <summary className="cursor-pointer text-body-sm text-on-surface-variant">
            {warnings.length} thing{warnings.length === 1 ? "" : "s"} the validator would rather you
            looked at, none of which block this
          </summary>
          <ul className="mt-2 flex list-none flex-col gap-1 text-body-sm text-on-surface-variant">
            {warnings.map((problem, index) => (
              <li key={`${problem.code}-${index}`}>{problem.message}</li>
            ))}
          </ul>
        </details>
      )}

      <Form method="post">
        <Button
          type="submit"
          disabled={!allowed}
          loading={navigation.state === "submitting"}
          iconLeft="check"
        >
          {revising ? "Publish the revision" : "Publish it"}
        </Button>
      </Form>
      {!allowed && (
        <p className="text-body-sm text-on-surface-variant">
          The button is disabled because of the reasons above, and the same checks run again on the
          server — turning it back on in a browser console will not publish anything.
        </p>
      )}
    </main>
  );
}

/**
 * Which screen fixes which blocker.
 *
 * A blocker with no route to the thing that fixes it is a dead end, and the two
 * screens are far enough apart that guessing costs a click each time.
 */
const BLOCKER_ROUTES: Record<string, "review" | "edit"> = {
  unconfirmed_ai_fields: "review",
  graph_invalid: "edit",
  unclassified_commands: "edit",
  safety_findings: "edit",
  no_environment_constraints: "edit",
  already_published: "review",
};

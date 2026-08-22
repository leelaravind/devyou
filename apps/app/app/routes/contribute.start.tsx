import { Form, Link, data, redirect, useNavigation } from "react-router";
import { Button, Card, Field, Icon, Textarea } from "@devyou/ui";
import { looksLikeSecret, revealHidden, scanUnicode } from "@devyou/security";
import { MAX_RAW_TEXT } from "@devyou/core";
import type { Route } from "./+types/contribute.start";
import { cloudflareContext } from "../context/cloudflare";
import { loadAuthState, guardOrigin } from "../lib/auth.server";
import { loadRevisionBySlug } from "../lib/playbook.server";
import {
  createDraft,
  dispatchStructuring,
  listDrafts,
  seedFromRevision,
  withinDraftRate,
  type DraftRecord,
} from "../lib/contribution.server";

/**
 * Raw capture — plan §10 step A.
 *
 * Two boxes and no schema. The plan is explicit that normalised fields must not be
 * demanded up front, and the adoption research is specific about why: a first-time
 * contributor asked for a well-formed artefact by a site they have contributed
 * nothing to yet closes the tab. So this takes what somebody already has — the
 * thing that broke and the thing that fixed it — and everything structural happens
 * afterwards, where they can see what they are being asked to confirm.
 *
 * What is *not* deferred is safety. Hidden Unicode and credential-shaped strings
 * are refused here rather than at publication, because this is the only moment the
 * person who can fix a pasted API key is still present and still looking at it.
 *
 * Signing in is required to open a draft and nothing else on this site works that
 * way. It is stated plainly rather than enforced by a redirect into a wall: a draft
 * is a resumable, attributed, private object, and there is nowhere to put one that
 * belongs to nobody.
 */

export function meta() {
  return [
    { title: "Write a playbook — DEV.ITISYOU" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const auth = await loadAuthState(request, env);

  const url = new URL(request.url);
  const revising = url.searchParams.get("playbook");

  /*
    The playbook being revised is resolved for the signed-out case too.

    Somebody who followed "correct this playbook" from a playbook page and is not
    signed in should be told what will happen to the thing they clicked on, not
    shown a generic sign-in prompt that has forgotten why they are here.
  */
  const revision = revising ? await loadRevisionBySlug(env.DB, revising) : null;

  if (!auth.principal) {
    return {
      signedIn: false as const,
      signInAvailable: auth.signInAvailable,
      revising: revision ? { slug: revision.playbookSlug, title: revision.title } : null,
      drafts: [],
    };
  }

  return {
    signedIn: true as const,
    signInAvailable: auth.signInAvailable,
    revising: revision ? { slug: revision.playbookSlug, title: revision.title } : null,
    drafts: (await listDrafts(env.DB, auth.principal.userId)).map(summarise),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  guardOrigin(request, env);

  const auth = await loadAuthState(request, env);
  if (!auth.principal) {
    return data(
      { error: "You need to be signed in to open a draft. Nothing has been saved." },
      { status: 401 },
    );
  }

  const form = await request.formData();
  const problem = String(form.get("problem") ?? "").trim();
  const fix = String(form.get("fix") ?? "").trim();

  if (problem.length < 40) {
    return data(
      {
        error:
          "Say a bit more about what went wrong — an error message, a log line, what you saw. " +
          "Rough is fine; a sentence is not enough for anybody to recognise their own problem in.",
      },
      { status: 400 },
    );
  }

  /*
    The two boxes become one document with headings, because `raw_text` is one
    column and the structuring task reads prose.

    Keeping the labels means the model — and the author, later, when the structuring
    is wrong — can still tell which half is which. Concatenating them without
    markers would lose the single most useful signal in the submission.
  */
  const rawText = `## What went wrong\n\n${problem}\n\n## What fixed it\n\n${fix || "(not stated)"}\n`;

  if (rawText.length > MAX_RAW_TEXT) {
    return data(
      {
        error:
          `That is ${rawText.length.toLocaleString()} characters and the limit is ` +
          `${MAX_RAW_TEXT.toLocaleString()}. It is refused rather than trimmed: a log cut in half ` +
          "produces a confident, wrong structuring instead of an obvious failure.",
      },
      { status: 413 },
    );
  }

  /*
    Scanned before anything is stored, and before anything reaches a model.

    A bidi override copied out of a terminal and an API key left in a log line are
    both things people paste without noticing. The revealed text is shown back
    rather than described, because "your input contains invisible characters" is not
    actionable and seeing where they are is.
  */
  const hidden = scanUnicode(rawText);
  if (hidden.length > 0) {
    return data(
      {
        error:
          "That contains invisible characters. Usually accidental, occasionally not — here is what " +
          "it actually contains. Please check it and submit again.",
        revealed: revealHidden(rawText).slice(0, 4000),
      },
      { status: 400 },
    );
  }

  if (looksLikeSecret(rawText)) {
    return data(
      {
        error:
          "That looks like it contains a credential, and everything published here is public. " +
          "Please remove it before submitting. Nothing has been saved.",
      },
      { status: 400 },
    );
  }

  if (!(await withinDraftRate(env.DB, auth.principal.userId))) {
    return data(
      {
        error:
          "You have opened a lot of drafts today. Finish or abandon one of them and this will " +
          "work again tomorrow — the limit is there because every draft can spend money on " +
          "structuring.",
      },
      { status: 429 },
    );
  }

  const revising = String(form.get("revising") ?? "").trim();
  const revision = revising ? await loadRevisionBySlug(env.DB, revising) : null;

  const draftId = await createDraft(env.DB, {
    authorId: auth.principal.userId,
    rawText,
    playbookId: revision?.playbookId ?? null,
    basedOnRevisionId: revision?.revisionId ?? null,
    /*
      A revision starts from the current text rather than from a blank page.

      It is a copy: the seeded nodes get fresh draft keys and nothing in the
      document points at a `diagnostic_nodes` row, so editing it cannot reach the
      revision it came from. Publishing it will create a new revision with no
      evidence, and the old one keeps its own.
    */
    document: revision
      ? seedFromRevision({
          title: revision.title,
          summary: revision.summary,
          problemTitle: revision.problemTitle,
          problemSummary: revision.summary,
          symptoms: revision.symptoms,
          nodes: revision.nodes.map((node) => {
            const detail = revision.nodeBodies.get(node.id);
            return {
              id: node.id,
              nodeType: node.nodeType,
              title: node.title,
              body: detail?.body ?? "",
              commandText: detail?.commandText ?? null,
              commandLanguage: detail?.commandLanguage ?? null,
              expectedOutput: detail?.expectedOutput ?? null,
              safetyLevel: node.safetyLevel,
              safetyEffect: node.safetyEffect,
            };
          }),
          edges: revision.edges,
          technologySlugs: revision.technologies.map((technology) => technology.slug),
          constraints: [],
          sources: [],
        })
      : null,
  });

  if (!revision) {
    await dispatchStructuring(env.DB, env.EVENTS, {
      draftId,
      requestedBy: auth.principal.userId,
      rawText,
    });
  }

  return redirect(`/contribute/${draftId}/review`);
}

export default function Start({ loaderData, actionData }: Route.ComponentProps) {
  const { signedIn, signInAvailable, revising, drafts } = loaderData;
  const navigation = useNavigation();

  /*
    `actionData` is a union of every shape this action returns, so a bare
    `actionData.error` is `unknown` — narrowing by key alone does not give the
    compiler a type. Normalising here keeps the JSX free of casts.
  */
  const formError =
    actionData && "error" in actionData && typeof actionData.error === "string"
      ? actionData.error
      : null;
  const revealedText =
    actionData && "revealed" in actionData && typeof actionData.revealed === "string"
      ? actionData.revealed
      : null;

  return (
    <main id="main" className="mx-auto flex w-full max-w-[760px] flex-col gap-margin px-margin py-8">
      <Link
        to="/contribute"
        className="flex items-center gap-1 font-mono text-env-tag text-on-surface-variant hover:text-on-surface"
      >
        <Icon name="arrow_back" size={13} />
        Contribute
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="font-headline text-headline-lg text-on-surface">
          {revising ? "Correct a playbook" : "Write a playbook"}
        </h1>
        {revising ? (
          <p className="text-body-md text-on-surface-variant">
            You are proposing a new revision of{" "}
            <Link to={`/p/${revising.slug}`} className="text-evidence-blue underline">
              {revising.title}
            </Link>
            . The existing revision keeps its text and the evidence it earned, at its own permanent
            URL. Yours starts with none.
          </p>
        ) : (
          <p className="text-body-md text-on-surface-variant">
            Paste what you have. Rough notes, a stack trace, the commands you ran — it does not need
            to be tidy and it does not need to be complete. The structuring happens next, and you
            get to correct all of it before anybody else sees a word.
          </p>
        )}
      </header>

      {!signedIn ? (
        <Card>
          <h2 className="mb-2 flex items-center gap-2 font-headline text-headline-md text-on-surface">
            <Icon name="account_circle" size={18} />
            This one needs an account
          </h2>
          <p className="mb-2 text-body-md text-on-surface-variant">
            Reading, searching, running a diagnosis and reporting a result all work without one, and
            always will. A draft is different: it is private, resumable and attributed to you, and
            there is nowhere sensible to keep one that belongs to nobody.
          </p>
          <p className="mb-3 text-body-sm text-on-surface-variant">
            If you would rather not sign in,{" "}
            <Link to="/playbooks" className="text-evidence-blue underline">
              find the playbook this belongs to
            </Link>{" "}
            and propose the change against it. That form takes an anonymous submission and is read
            by the same people.
          </p>
          {signInAvailable ? (
            <Link
              to="/sign-in"
              className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 font-mono text-label-caps uppercase text-on-primary"
            >
              Sign in
            </Link>
          ) : (
            <p className="text-body-sm text-on-surface-variant">
              Sign-in is not configured on this deployment, so drafting is unavailable here.
            </p>
          )}
        </Card>
      ) : (
        <>
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
            <input type="hidden" name="revising" value={revising?.slug ?? ""} />

            <Field
              label="What went wrong"
              description="The error, the log line, the symptom. Paste it as you have it — a stack trace is more useful than a description of one."
            >
              {({ inputId }) => (
                <Textarea
                  id={inputId}
                  name="problem"
                  rows={10}
                  mono
                  maxLength={MAX_RAW_TEXT}
                  required
                />
              )}
            </Field>

            <Field
              label="What fixed it"
              description="The commands, the setting, the version you moved to — and, if you know it, why it worked. Leave it empty if you never found out; that is a playbook too."
            >
              {({ inputId }) => (
                <Textarea id={inputId} name="fix" rows={8} mono maxLength={MAX_RAW_TEXT} />
              )}
            </Field>

            <div className="flex flex-col gap-2">
              <Button
                type="submit"
                loading={navigation.state === "submitting"}
                iconLeft="chevron_right"
              >
                {revising ? "Start the revision" : "Structure this"}
              </Button>
              <p className="text-body-sm text-on-surface-variant">
                Nothing becomes public at this step, or the next one. What you paste is scanned for
                credential-shaped strings and hidden characters before it is stored — but a scanner
                is not a substitute for reading it yourself first.
              </p>
            </div>
          </Form>

          {drafts.length > 0 && <DraftList drafts={drafts} />}
        </>
      )}
    </main>
  );
}

/**
 * Everything the author has started, including what they gave up on.
 *
 * An abandoned draft is listed with its status rather than removed. Contributions
 * vanishing without explanation is the specific behaviour the adoption research
 * names as fatal, and "they stopped working on it" is not a reason to make an
 * exception — the text is still theirs and they may still want it.
 */
function DraftList({ drafts }: { drafts: ReturnType<typeof summarise>[] }) {
  return (
    <section aria-labelledby="drafts" className="flex flex-col gap-2">
      <h2 id="drafts" className="font-headline text-headline-md text-on-surface">
        Your drafts
      </h2>
      <ul className="flex list-none flex-col gap-2">
        {drafts.map((draft) => (
          <li key={draft.id}>
            <Card as="article">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-headline text-body-md font-semibold text-on-surface">
                  {draft.title || "Untitled draft"}
                </h3>
                <span className="font-mono text-env-tag uppercase text-on-surface-variant">
                  {STATUS_LABELS[draft.status] ?? draft.status}
                </span>
              </div>
              <p className="mt-1 text-body-sm text-on-surface-variant">{draft.preview}</p>
              <p className="mt-2 flex flex-wrap gap-3 text-body-sm">
                {draft.status === "published" && draft.playbookSlug ? (
                  <Link to={`/p/${draft.playbookSlug}`} className="text-evidence-blue underline">
                    Read the published playbook
                  </Link>
                ) : (
                  <>
                    <Link
                      to={`/contribute/${draft.id}/review`}
                      className="text-evidence-blue underline"
                    >
                      Review
                    </Link>
                    <Link
                      to={`/contribute/${draft.id}/edit`}
                      className="text-evidence-blue underline"
                    >
                      Edit the steps
                    </Link>
                  </>
                )}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

const STATUS_LABELS: Record<string, string> = {
  capturing: "Not structured yet",
  structuring: "Being structured",
  awaiting_review: "Waiting for you to review",
  editing: "In progress",
  ready: "Ready to publish",
  published: "Published",
  abandoned: "Abandoned — still here",
};

function summarise(draft: DraftRecord) {
  return {
    id: draft.id,
    status: draft.status,
    title: draft.document?.title ?? "",
    playbookSlug: draft.playbookSlug,
    /* The raw paste, not the structuring. A draft is recognisable to its author by
       what they typed, and the structuring may be exactly what they disagreed
       with. */
    preview: `${draft.rawText.replace(/\s+/g, " ").slice(0, 160)}…`,
  };
}

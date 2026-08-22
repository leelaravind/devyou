import { Form, Link, data, redirect, useNavigation } from "react-router";
import { Button, Card, Field, Icon, Input, Textarea } from "@devyou/ui";
import { NODE_TYPES, SAFETY_LEVELS, SAFETY_LEVEL_LABELS } from "@devyou/core";
import { revealHidden } from "@devyou/security";
import { emptyDraftDocument, type DraftDocument } from "@devyou/schemas";
import type { Route } from "./+types/contribute.$draftId.review";
import { cloudflareContext } from "../context/cloudflare";
import { guardOrigin, loadAuthState } from "../lib/auth.server";
import {
  abandonDraft,
  loadAiTask,
  loadDraft,
  loadProvenance,
  recordConfirmations,
  saveDocument,
  type ProvenanceRow,
} from "../lib/contribution.server";
import {
  applyStructuralIntent,
  documentFromForm,
  validateDocument,
} from "../lib/draft-form.server";

/**
 * Structure review — plan §10 step D.
 *
 * This screen exists to make one thing unmissable: **a person is deciding, and the
 * model only suggested.** Everything about its shape follows from that.
 *
 * - The raw submission sits beside the proposal, not behind a link. If the
 *   structuring is wrong, the author needs to see what they actually wrote in order
 *   to notice — and the thing they wrote is the only authority in the room.
 * - Every field is an editable input, including the ones the model was confident
 *   about. A read-only "AI summary" with an edit affordance somewhere else teaches
 *   people to accept it.
 * - Anything marked `ai_inferred_requires_confirmation` carries the model's stated
 *   reason and an explicit checkbox. Publication is blocked until each one is either
 *   ticked or changed, and that block is enforced by `draft_field_provenance` at the
 *   gate, not by this form.
 * - Nothing here is required to have happened at all. A draft with no proposal —
 *   because the provider is unconfigured, the budget is spent, the model refused, or
 *   the author would rather write it themselves — reaches the same editor by the
 *   same route. Structuring is assistance; a pipeline that stalls without it would
 *   have made the model load-bearing.
 */

export function meta() {
  return [{ title: "Review the structure — DEV.ITISYOU" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const auth = await loadAuthState(request, env);
  if (!auth.principal) throw new Response(null, { status: 404 });

  /*
    404 rather than 403 for somebody else's draft.

    A 403 confirms the draft exists, which turns this route into an existence oracle
    for unpublished work — an author's half-written correction to a security
    playbook is exactly what somebody would probe for.
  */
  const draft = await loadDraft(env.DB, params.draftId, auth.principal.userId);
  if (!draft) throw new Response(null, { status: 404 });

  if (draft.status === "published" && draft.playbookSlug) {
    throw redirect(`/p/${draft.playbookSlug}`);
  }

  return {
    draft: {
      id: draft.id,
      status: draft.status,
      /* The paste, with hidden characters made visible rather than stripped. The
         author is the last person who can explain a bidi override in their own
         text, and they cannot explain one they cannot see. */
      rawText: revealHidden(draft.rawText),
      documentInvalid: draft.documentInvalid,
      revising: draft.playbookSlug,
    },
    document: draft.document,
    provenance: draft.document ? await loadProvenance(env.DB, draft.id) : [],
    aiTask: draft.aiTaskId ? await loadAiTask(env.DB, draft.aiTaskId) : null,
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  guardOrigin(request, env);

  const auth = await loadAuthState(request, env);
  if (!auth.principal) throw new Response(null, { status: 404 });

  const draft = await loadDraft(env.DB, params.draftId, auth.principal.userId);
  if (!draft) throw new Response(null, { status: 404 });
  if (draft.status === "published") {
    return data({ error: "This draft has already been published." }, { status: 409 });
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save");

  if (intent === "abandon") {
    await abandonDraft(env.DB, draft.id, auth.principal.userId);
    return redirect("/contribute/start");
  }

  /*
    "Write it myself" is a first-class outcome, not a fallback.

    It produces the same empty document the editor would have produced from a
    refused or unfunded structuring, and it is offered even when a proposal exists —
    an author who thinks the model has misread their notes should be able to throw
    it away in one click rather than correct twelve fields.
  */
  if (intent === "adopt-empty") {
    await saveDocument(env.DB, draft.id, emptyDraftDocument(), "editing");
    return redirect(`/contribute/${draft.id}/edit`);
  }

  const base = draft.document ?? emptyDraftDocument();
  const parsed = documentFromForm(form, base);

  const structural = applyStructuralIntent(parsed.document, intent);
  const next = structural ?? parsed.document;

  const validated = validateDocument(next);
  if (!validated.ok) {
    return data({ error: `That could not be saved: ${validated.detail}` }, { status: 400 });
  }

  await saveDocument(env.DB, draft.id, validated.value, "editing");

  /*
    Confirmations are recorded after the document is stored, and from the stored
    document.

    `recordConfirmations` decides whether a field was *edited* by comparing it to
    what the model proposed, so it has to see the version that was actually saved.
    Comparing against the form would let a field that failed validation count as an
    edit.
  */
  await recordConfirmations(
    env.DB,
    draft.id,
    auth.principal.userId,
    validated.value,
    parsed.confirmed,
  );

  if (structural) return data({ saved: true });
  return redirect(`/contribute/${draft.id}/edit`);
}

export default function Review({ loaderData, actionData }: Route.ComponentProps) {
  const { draft, document, provenance, aiTask } = loaderData;
  const navigation = useNavigation();

  const formError =
    actionData && "error" in actionData && typeof actionData.error === "string"
      ? actionData.error
      : null;

  const byPath = new Map(provenance.map((row) => [row.fieldPath, row]));
  const unconfirmed = provenance.filter(
    (row) => row.provenance === "ai_inferred_requires_confirmation" && row.confirmedAt === null,
  ).length;

  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-[1200px] flex-col gap-margin px-margin py-8"
    >
      <Link
        to="/contribute/start"
        className="flex items-center gap-1 font-mono text-env-tag text-on-surface-variant hover:text-on-surface"
      >
        <Icon name="arrow_back" size={13} />
        Your drafts
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="font-headline text-headline-lg text-on-surface">Review the structure</h1>
        <p className="max-w-[70ch] text-body-md text-on-surface-variant">
          Everything on the right is a <strong className="text-on-surface">suggestion</strong>. It
          was produced by a language model reading the text on the left, it is wrong often enough
          to matter, and none of it becomes public because it is here. You are the author; this is
          a first draft somebody else typed.
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

      <div className="grid gap-margin lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section aria-labelledby="raw" className="flex flex-col gap-2 lg:sticky lg:top-4 lg:self-start">
          <h2 id="raw" className="font-headline text-headline-md text-on-surface">
            What you wrote
          </h2>
          <p className="text-body-sm text-on-surface-variant">
            Kept exactly as submitted. If the structuring has invented something, this is what it
            was supposed to be reading.
          </p>
          <pre className="dv-scroll-thin max-h-[70vh] overflow-auto whitespace-pre-wrap rounded border border-outline-variant bg-surface-container-lowest p-3 font-mono text-code-block text-on-surface">
            {draft.rawText}
          </pre>
        </section>

        <section aria-labelledby="proposal" className="flex flex-col gap-3">
          <h2 id="proposal" className="font-headline text-headline-md text-on-surface">
            The proposal
          </h2>

          {document === null ? (
            <NoProposal
              invalid={draft.documentInvalid}
              status={aiTask?.status ?? null}
              detail={aiTask?.errorDetail ?? null}
              draftStatus={draft.status}
            />
          ) : (
            <ProposalForm
              document={document}
              byPath={byPath}
              unconfirmed={unconfirmed}
              submitting={navigation.state === "submitting"}
              revising={draft.revising}
            />
          )}
        </section>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------------- */

/**
 * What the screen says when there is nothing to review.
 *
 * It names the actual reason rather than showing a spinner. "Being structured" and
 * "the provider refused this text" and "the daily AI budget is spent" are three
 * different situations, and the only one where waiting helps is the first — so the
 * other two say so and offer the way forward instead.
 */
function NoProposal({
  invalid,
  status,
  detail,
  draftStatus,
}: {
  invalid: boolean;
  status: string | null;
  detail: string | null;
  draftStatus: string;
}) {
  const explanation = invalid
    ? "The stored structuring could not be read back. Your original text is intact on the left; " +
      "the proposal is not. Starting from a blank structure is the honest option here."
    : status === "queued" || status === "running" || draftStatus === "structuring"
      ? "The structuring job has been queued. It usually takes a few seconds — reload, or skip it " +
        "and write the structure yourself. Nothing is waiting on it."
      : status === "budget_exceeded"
        ? "The daily AI budget for this deployment is spent, so nothing was structured. That is a " +
          "cost ceiling, not a fault with your submission."
        : status === "refused" || status === "schema_invalid"
          ? "The model did not return a usable structure for this text. That happens, and it is " +
            "not a judgement of the contribution."
          : "No structuring is available for this draft.";

  return (
    <Card>
      <h3 className="mb-2 flex items-center gap-2 font-headline text-body-md font-semibold text-on-surface">
        <Icon name="info" size={16} />
        No proposal to review
      </h3>
      <p className="mb-2 text-body-sm text-on-surface-variant">{explanation}</p>
      {detail && (
        <p className="mb-3 font-mono text-env-tag text-on-surface-variant">{detail.slice(0, 200)}</p>
      )}
      <p className="mb-3 text-body-sm text-on-surface-variant">
        The editor works the same either way. A playbook written by hand is not a lesser
        contribution — it is the normal one.
      </p>
      <Form method="post">
        <input type="hidden" name="intent" value="adopt-empty" />
        <Button type="submit" iconLeft="build">
          Write the structure myself
        </Button>
      </Form>
    </Card>
  );
}

function ProposalForm({
  document,
  byPath,
  unconfirmed,
  submitting,
  revising,
}: {
  document: DraftDocument;
  byPath: Map<string, ProvenanceRow>;
  unconfirmed: number;
  submitting: boolean;
  revising: string | null;
}) {
  return (
    <Form method="post" className="flex flex-col gap-margin">
      {/* This screen edits the wording of the steps and nothing structural. The
          branches, applicability and references it does not show are carried over
          from the stored document rather than round-tripped through hidden inputs
          somebody could rewrite. */}
      <input type="hidden" name="scope" value="nodes" />

      {unconfirmed > 0 && (
        <div className="flex items-start gap-2 rounded border border-outline-variant bg-surface-container-low p-3 text-body-sm text-on-surface-variant">
          <Icon name="info" size={15} className="mt-0.5 shrink-0" />
          <span>
            <strong className="text-on-surface">
              {unconfirmed} field{unconfirmed === 1 ? "" : "s"} the model worked out rather than
              read.
            </strong>{" "}
            Each one is marked below with the reason it gave. Tick it if it is right, or change it
            — publication is blocked until every one has been looked at, and clicking through this
            screen does not count as looking.
          </span>
        </div>
      )}

      <Field label="Playbook title" description="What a reader will see in search results.">
        {({ inputId }) => (
          <Input id={inputId} name="title" defaultValue={document.title} maxLength={200} />
        )}
      </Field>
      <Provenance row={byPath.get("/title")} path="/title" />

      <Field
        label="Summary"
        description="One or two sentences. What the problem is and what this procedure does about it."
      >
        {({ inputId }) => (
          <Textarea id={inputId} name="summary" rows={3} defaultValue={document.summary} maxLength={1000} />
        )}
      </Field>
      <Provenance row={byPath.get("/summary")} path="/summary" />

      {revising && (
        <Field
          label="What changed"
          description="Shown in the playbook's history, so a reader can judge whether the previous revision's evidence still applies. That judgement is theirs, and evidence never moves across automatically."
        >
          {({ inputId }) => (
            <Textarea
              id={inputId}
              name="changeSummary"
              rows={2}
              defaultValue={document.changeSummary}
              maxLength={1000}
            />
          )}
        </Field>
      )}

      <Field label="The problem, as a title" description="Independent of any one fix for it.">
        {({ inputId }) => (
          <Input
            id={inputId}
            name="problemTitle"
            defaultValue={document.problemTitle}
            maxLength={200}
          />
        )}
      </Field>
      <Provenance row={byPath.get("/problemTitle")} path="/problemTitle" />

      <Field label="The problem, described">
        {({ inputId }) => (
          <Textarea
            id={inputId}
            name="problemSummary"
            rows={3}
            defaultValue={document.problemSummary}
            maxLength={1000}
          />
        )}
      </Field>
      <Provenance row={byPath.get("/problemSummary")} path="/problemSummary" />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-mono text-label-caps uppercase text-on-surface-variant">
          Symptoms a reader would recognise
        </legend>
        {[0, 1, 2, 3, 4].map((index) => (
          <Input
            key={index}
            name="symptom"
            defaultValue={document.symptoms[index] ?? ""}
            maxLength={300}
            placeholder={index === 0 ? "the build hangs with no output" : ""}
          />
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-mono text-label-caps uppercase text-on-surface-variant">
          Exact error strings
        </legend>
        <p className="text-body-sm text-on-surface-variant">
          These are searched before anything else, so an exact code beats a good description of
          one. Leave a row empty to drop it.
        </p>
        {[0, 1, 2, 3].map((index) => {
          const signature = document.errorSignatures[index];
          return (
            <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <Input
                name="signatureCode"
                defaultValue={signature?.errorCode ?? ""}
                maxLength={80}
                className="font-mono"
                placeholder={index === 0 ? "SQLITE_BUSY" : ""}
                aria-label="Error code"
              />
              <Input
                name="signatureMessage"
                defaultValue={signature?.normalisedMessage ?? ""}
                maxLength={500}
                className="font-mono"
                placeholder={index === 0 ? "database is locked" : ""}
                aria-label="Error message"
              />
            </div>
          );
        })}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-mono text-label-caps uppercase text-on-surface-variant">
          The steps
        </legend>
        <p className="text-body-sm text-on-surface-variant">
          Wording here; the branches and the order come next. A step the model invented is worse
          than a missing one — if you did not actually run it, delete it on the next screen.
        </p>
        {document.nodes.map((node, index) => (
          <div
            key={node.key}
            className="flex flex-col gap-2 rounded border border-outline-variant bg-surface-container-low p-3"
          >
            <input type="hidden" name="nodeKey" value={node.key} />
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-label-caps uppercase text-on-surface-variant">
                  Kind
                </span>
                <select
                  name="nodeType"
                  defaultValue={node.nodeType}
                  className="rounded border border-outline-variant bg-surface-container px-3 py-2 text-body-md text-on-surface"
                >
                  {NODE_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {value.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-label-caps uppercase text-on-surface-variant">
                  Title
                </span>
                <Input name="nodeTitle" defaultValue={node.title} maxLength={200} />
              </label>
            </div>
            <Provenance row={byPath.get(`/nodes/${index}/title`)} path={`/nodes/${index}/title`} />

            <label className="flex flex-col gap-1">
              <span className="font-mono text-label-caps uppercase text-on-surface-variant">
                What the reader does
              </span>
              <Textarea name="nodeBody" rows={3} defaultValue={node.body} maxLength={4000} />
            </label>
            <Provenance row={byPath.get(`/nodes/${index}/body`)} path={`/nodes/${index}/body`} />

            <label className="flex flex-col gap-1">
              <span className="font-mono text-label-caps uppercase text-on-surface-variant">
                Command, if there is one
              </span>
              <Textarea
                name="nodeCommand"
                rows={2}
                mono
                defaultValue={node.commandText ?? ""}
                maxLength={2000}
              />
            </label>
            <input type="hidden" name="nodeLanguage" value={node.commandLanguage ?? ""} />

            <label className="flex flex-col gap-1">
              <span className="font-mono text-label-caps uppercase text-on-surface-variant">
                What they should see
              </span>
              <Textarea
                name="nodeExpected"
                rows={2}
                mono
                defaultValue={node.expectedOutput ?? ""}
                maxLength={2000}
              />
            </label>
            <Provenance
              row={byPath.get(`/nodes/${index}/expectedOutput`)}
              path={`/nodes/${index}/expectedOutput`}
            />

            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-label-caps uppercase text-on-surface-variant">
                  Safety
                </span>
                <select
                  name="nodeSafety"
                  defaultValue={node.safetyLevel}
                  className="rounded border border-outline-variant bg-surface-container px-3 py-2 text-body-md text-on-surface"
                >
                  {SAFETY_LEVELS.map((value) => (
                    <option key={value} value={value}>
                      {SAFETY_LEVEL_LABELS[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-label-caps uppercase text-on-surface-variant">
                  What it changes
                </span>
                <Input name="nodeEffect" defaultValue={node.safetyEffect ?? ""} maxLength={500} />
              </label>
            </div>
          </div>
        ))}
      </fieldset>

      {document.gaps.length > 0 && (
        <Card>
          <h3 className="mb-1 font-headline text-body-md font-semibold text-on-surface">
            What the model said it could not work out
          </h3>
          <p className="mb-2 text-body-sm text-on-surface-variant">
            This is the most useful thing on the screen. A structuring that quietly fills its own
            gaps produces a playbook whose holes nobody knows about.
          </p>
          <ul className="flex list-none flex-col gap-1 text-body-sm text-on-surface-variant">
            {document.gaps.map((gap) => (
              <li key={gap} className="flex items-start gap-2">
                <Icon name="chevron_right" size={13} className="mt-1 shrink-0" />
                {gap}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {document.suspiciousContent.length > 0 && (
        <div className="rounded border border-destructive-red bg-surface-container-low p-3">
          <h3 className="mb-1 flex items-center gap-2 font-headline text-body-md font-semibold text-destructive-red">
            <Icon name="warning" size={16} />
            Text in your submission that reads like an instruction
          </h3>
          <p className="mb-2 text-body-sm text-on-surface-variant">
            Reported as content, never acted on. If you pasted a log that happens to contain this,
            it is nothing; if you did not write it, look at where it came from.
          </p>
          <ul className="flex list-none flex-col gap-1 font-mono text-code-block text-on-surface">
            {document.suspiciousContent.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" name="intent" value="save" loading={submitting} iconLeft="chevron_right">
          Accept and edit the steps
        </Button>
        <Button type="submit" name="intent" value="adopt-empty" variant="secondary" iconLeft="close">
          Discard this and start blank
        </Button>
        <Button type="submit" name="intent" value="abandon" variant="ghost">
          Abandon the draft
        </Button>
      </div>
      <p className="text-body-sm text-on-surface-variant">
        An abandoned draft keeps everything you typed and stays listed under your drafts. Nothing
        here is deleted.
      </p>
    </Form>
  );
}

/**
 * The provenance note beside a field.
 *
 * Renders nothing for a field the author supplied — a badge on every field is a
 * badge nobody reads, and the only case that needs attention is the one where a
 * model decided something. `ai_extracted` gets a quiet line; only
 * `ai_inferred_requires_confirmation` gets a checkbox, because only that one blocks
 * publication.
 */
function Provenance({ row, path }: { row: ProvenanceRow | undefined; path: string }) {
  if (!row || row.provenance === "user_supplied") return null;

  if (row.provenance === "ai_extracted") {
    return (
      <p className="flex items-start gap-2 text-body-sm text-on-surface-variant">
        <Icon name="info" size={13} className="mt-0.5 shrink-0" />
        <span>
          Read out of your text rather than stated by you.
          {row.basis ? ` ${row.basis}` : ""}
        </span>
      </p>
    );
  }

  return (
    <label className="flex cursor-pointer items-start gap-2 rounded border border-outline-variant bg-surface-container-low p-2 text-body-sm text-on-surface-variant has-checked:border-evidence-blue">
      <input
        type="checkbox"
        name="confirm"
        value={path}
        defaultChecked={row.confirmedAt !== null}
        className="mt-1 h-4 w-4 shrink-0"
      />
      <span>
        <span className="block text-on-surface">
          The model worked this out. It is not something you said.
        </span>
        {row.basis && <span className="block">Its reason: {row.basis}</span>}
        <span className="block">
          Tick this only if it is right. Changing the field counts instead — an edited field becomes
          yours.
        </span>
      </span>
    </label>
  );
}

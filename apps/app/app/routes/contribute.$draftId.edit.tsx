import { Form, Link, data, redirect, useNavigation } from "react-router";
import { Button, Icon, Input, Textarea } from "@devyou/ui";
import {
  BRANCH_CONDITIONS,
  BRANCH_CONDITION_LABELS,
  NODE_TYPES,
  SAFETY_LEVELS,
  SAFETY_LEVEL_LABELS,
  SOURCE_TYPES,
} from "@devyou/core";
import { emptyDraftDocument, type DraftDocument } from "@devyou/schemas";
import type { GraphProblem } from "@devyou/domain";
import { validateGraph } from "@devyou/domain";
import type { Route } from "./+types/contribute.$draftId.edit";
import { cloudflareContext } from "../context/cloudflare";
import { guardOrigin, loadAuthState } from "../lib/auth.server";
import {
  graphFor,
  loadDraft,
  safetySweep,
  saveDocument,
  unclassifiedCommandNodes,
} from "../lib/contribution.server";
import {
  applyStructuralIntent,
  documentFromForm,
  validateDocument,
} from "../lib/draft-form.server";

/**
 * The draft editor — plan §10 step E.
 *
 * A diagnostic playbook is a graph, and the reason this screen is not a rich text
 * box is that the constraints which make one useful cannot be expressed in prose: a
 * single entry point, a route out of every outcome a reader might observe, and a
 * path that actually reaches a conclusion. `validateGraph` states them; this screen
 * shows what it said, in the author's own node titles rather than as a count.
 *
 * Errors block publication and warnings do not. The distinction is honest rather
 * than cosmetic — a missing "I can't tell" branch may genuinely be covered by the
 * failure branch, and forcing an author to draw an edge they have already covered
 * teaches them the validator is noise.
 *
 * Structural edits round-trip through the whole form. Adding a node re-parses
 * everything on screen, applies the change and re-renders, so nothing typed is lost
 * to a layout button — a text editor that discards work on an unrelated click is
 * one people copy their text out of first.
 */

export function meta() {
  return [{ title: "Edit the steps — DEV.ITISYOU" }, { name: "robots", content: "noindex, nofollow" }];
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

  /*
    A draft with no document yet goes back to review rather than opening an empty
    editor. The review screen is where the choice between "use the proposal" and
    "write it myself" is made, and skipping it would make that choice for them.
  */
  if (!draft.document) throw redirect(`/contribute/${draft.id}/review`);

  const technologies = await env.DB.prepare(
    `SELECT slug, name FROM technologies WHERE status = 'active' ORDER BY name`,
  ).all<{ slug: string; name: string }>();

  const { nodes, edges, upgraded } = graphFor(draft.document);

  return {
    draftId: draft.id,
    document: draft.document,
    revising: draft.playbookSlug,
    technologies: technologies.results,
    problems: validateGraph(nodes, edges).problems,
    upgraded,
    unclassified: unclassifiedCommandNodes(draft.document),
    safety: safetySweep(draft.document),
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

  const base = draft.document ?? emptyDraftDocument();
  const parsed = documentFromForm(form, base);
  const structural = applyStructuralIntent(parsed.document, intent);
  const next = structural ?? parsed.document;

  const validated = validateDocument(next);
  if (!validated.ok) {
    return data({ error: `That could not be saved: ${validated.detail}` }, { status: 400 });
  }

  /*
    A graph that fails validation is still saved.

    Saving and publishing are different acts, and refusing to store half-finished
    work is how an author loses an afternoon to a browser refresh. The gate at
    `/publish` is the thing that cares whether it is valid.
  */
  await saveDocument(env.DB, draft.id, validated.value, "editing");

  if (intent === "publish") return redirect(`/contribute/${draft.id}/publish`);
  return data({ saved: true });
}

export default function Edit({ loaderData, actionData }: Route.ComponentProps) {
  const { draftId, document, revising, technologies, problems, upgraded, unclassified, safety } =
    loaderData;
  const navigation = useNavigation();

  const formError =
    actionData && "error" in actionData && typeof actionData.error === "string"
      ? actionData.error
      : null;
  const saved = actionData !== undefined && actionData !== null && "saved" in actionData;

  const errors = problems.filter((problem) => problem.severity === "error");
  const warnings = problems.filter((problem) => problem.severity === "warning");
  const titleFor = new Map(document.nodes.map((node) => [node.key, node.title || node.key]));

  return (
    <main id="main" className="mx-auto flex w-full max-w-[900px] flex-col gap-margin px-margin py-8">
      <Link
        to={`/contribute/${draftId}/review`}
        className="flex items-center gap-1 font-mono text-env-tag text-on-surface-variant hover:text-on-surface"
      >
        <Icon name="arrow_back" size={13} />
        Back to the structure review
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="font-headline text-headline-lg text-on-surface">Edit the steps</h1>
        <p className="max-w-[70ch] text-body-md text-on-surface-variant">
          A reader works through this one step at a time and answers what they saw. Every answer
          they can give needs somewhere to go — the reader who most needs help is the one whose
          test failed in a way you did not expect.
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
      {saved && !formError && (
        <p className="flex items-center gap-2 text-body-sm text-status-ci-verified" role="status">
          <Icon name="check_circle" size={15} />
          Saved.
        </p>
      )}

      <ValidationPanel
        errors={errors}
        warnings={warnings}
        titleFor={titleFor}
        upgraded={upgraded}
        unclassified={unclassified}
        safety={safety}
      />

      <Form method="post" className="flex flex-col gap-margin">
        {/* The editor owns every collection on the page, which is what lets an
            author remove the last branch or untick the last technology and have it
            stay removed. */}
        <input type="hidden" name="scope" value="nodes" />
        <input type="hidden" name="scope" value="edges" />
        <input type="hidden" name="scope" value="applicability" />
        <input type="hidden" name="scope" value="sources" />

        <input type="hidden" name="title" value={document.title} />
        <input type="hidden" name="summary" value={document.summary} />
        <input type="hidden" name="changeSummary" value={document.changeSummary} />
        <input type="hidden" name="problemTitle" value={document.problemTitle} />
        <input type="hidden" name="problemSummary" value={document.problemSummary} />
        {document.symptoms.map((symptom, index) => (
          <input key={index} type="hidden" name="symptom" value={symptom} />
        ))}
        {document.errorSignatures.map((signature, index) => (
          <span key={index}>
            <input type="hidden" name="signatureCode" value={signature.errorCode ?? ""} />
            <input type="hidden" name="signatureMessage" value={signature.normalisedMessage} />
          </span>
        ))}

        <Steps document={document} />
        <Branches document={document} />
        <Applicability document={document} technologies={technologies} />
        <References document={document} />

        <div className="flex flex-wrap items-center gap-3 border-t border-outline-variant pt-4">
          <Button type="submit" name="intent" value="save" variant="secondary" loading={navigation.state === "submitting"}>
            Save
          </Button>
          <Button type="submit" name="intent" value="publish" iconLeft="chevron_right">
            Save and go to publication
          </Button>
          {revising && (
            <p className="text-body-sm text-on-surface-variant">
              Publishing this creates a new revision. The current one keeps its text and its
              evidence.
            </p>
          )}
        </div>
      </Form>
    </main>
  );
}

/* ------------------------------------------------------------------------- */

function ValidationPanel({
  errors,
  warnings,
  titleFor,
  upgraded,
  unclassified,
  safety,
}: {
  errors: GraphProblem[];
  warnings: GraphProblem[];
  titleFor: Map<string, string>;
  upgraded: Array<{ key: string; title: string; declared: string; classified: string }>;
  unclassified: string[];
  safety: string[];
}) {
  const nothing =
    errors.length === 0 && warnings.length === 0 && upgraded.length === 0 && unclassified.length === 0 && safety.length === 0;

  if (nothing) {
    return (
      <p className="flex items-center gap-2 text-body-sm text-status-ci-verified">
        <Icon name="check_circle" size={15} />
        The diagnostic path holds together. Nothing here would strand a reader.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {errors.length > 0 && (
        <div className="rounded border border-destructive-red bg-surface-container-low p-3">
          <h2 className="mb-2 flex items-center gap-2 font-headline text-body-md font-semibold text-destructive-red">
            <Icon name="error" size={16} />
            These stop it being published
          </h2>
          <ul className="flex list-none flex-col gap-1 text-body-sm text-on-surface-variant">
            {errors.map((problem, index) => (
              <li key={`${problem.code}-${index}`} className="flex items-start gap-2">
                <Icon name="chevron_right" size={13} className="mt-1 shrink-0" />
                <span>
                  {problem.message}
                  {problem.nodeId && titleFor.has(problem.nodeId) && (
                    <span className="text-on-surface"> — {titleFor.get(problem.nodeId)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {safety.length > 0 && (
        <div className="rounded border border-destructive-red bg-surface-container-low p-3">
          <h2 className="mb-2 flex items-center gap-2 font-headline text-body-md font-semibold text-destructive-red">
            <Icon name="warning" size={16} />
            Found in the text itself
          </h2>
          <ul className="flex list-none flex-col gap-1 text-body-sm text-on-surface-variant">
            {safety.map((finding) => (
              <li key={finding}>{finding}</li>
            ))}
          </ul>
        </div>
      )}

      {unclassified.length > 0 && (
        <div className="rounded border border-outline-variant bg-surface-container-low p-3 text-body-sm text-on-surface-variant">
          <p className="mb-1 text-on-surface">
            These steps run a command that changes something and do not say what:
          </p>
          <p>{unclassified.join(", ")}.</p>
          <p className="mt-1">
            A reader is shown a copy button either way, so a command with no stated effect is a
            command somebody runs without knowing what it does.
          </p>
        </div>
      )}

      {upgraded.length > 0 && (
        <div className="rounded border border-outline-variant bg-surface-container-low p-3 text-body-sm text-on-surface-variant">
          <p className="mb-1 text-on-surface">Reclassified after reading the command:</p>
          <ul className="flex list-none flex-col gap-1">
            {upgraded.map((item) => (
              <li key={item.key}>
                <span className="text-on-surface">{item.title || item.key}</span> — you marked it{" "}
                {item.declared.replace("_", " ")}; the scanner reads it as{" "}
                {item.classified.replace("_", " ")}, and the more severe answer is what a reader
                will see. It is a pattern match on text, so it is sometimes wrong in this
                direction; it is never wrong in the other one.
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <details className="rounded border border-outline-variant bg-surface-container-low p-3">
          <summary className="cursor-pointer text-body-sm text-on-surface-variant">
            {warnings.length} thing{warnings.length === 1 ? "" : "s"} worth a look, none of which
            block publication
          </summary>
          <ul className="mt-2 flex list-none flex-col gap-1 text-body-sm text-on-surface-variant">
            {warnings.map((problem, index) => (
              <li key={`${problem.code}-${index}`}>{problem.message}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Steps({ document }: { document: DraftDocument }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 font-mono text-label-caps uppercase text-on-surface-variant">
        Steps
      </legend>
      {document.nodes.map((node) => (
        <div
          key={node.key}
          className="flex flex-col gap-2 rounded border border-outline-variant bg-surface-container-low p-3"
        >
          <input type="hidden" name="nodeKey" value={node.key} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-env-tag uppercase text-on-surface-variant">
              {node.key}
            </span>
            <Button
              type="submit"
              name="intent"
              value={`remove-node:${node.key}`}
              variant="ghost"
              size="sm"
              iconLeft="close"
            >
              Remove
            </Button>
          </div>

          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-label-caps uppercase text-on-surface-variant">Kind</span>
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

          <label className="flex flex-col gap-1">
            <span className="font-mono text-label-caps uppercase text-on-surface-variant">
              What the reader does
            </span>
            <Textarea name="nodeBody" rows={3} defaultValue={node.body} maxLength={4000} />
          </label>

          <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-label-caps uppercase text-on-surface-variant">
                Command
              </span>
              <Textarea
                name="nodeCommand"
                rows={2}
                mono
                defaultValue={node.commandText ?? ""}
                maxLength={2000}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-label-caps uppercase text-on-surface-variant">
                Language
              </span>
              <Input
                name="nodeLanguage"
                defaultValue={node.commandLanguage ?? ""}
                maxLength={40}
                placeholder="bash"
                className="font-mono"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-label-caps uppercase text-on-surface-variant">
              Expected output
            </span>
            <Textarea
              name="nodeExpected"
              rows={2}
              mono
              defaultValue={node.expectedOutput ?? ""}
              maxLength={2000}
            />
          </label>

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
              <Input
                name="nodeEffect"
                defaultValue={node.safetyEffect ?? ""}
                maxLength={500}
                placeholder="deletes the local build cache"
              />
            </label>
          </div>
        </div>
      ))}

      <Button type="submit" name="intent" value="add-node" variant="secondary" iconLeft="add">
        Add a step
      </Button>
    </fieldset>
  );
}

function Branches({ document }: { document: DraftDocument }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-mono text-label-caps uppercase text-on-surface-variant">
        Branches
      </legend>
      <p className="text-body-sm text-on-surface-variant">
        One row per outcome. A test needs a route for &ldquo;passed&rdquo; and one for
        &ldquo;failed&rdquo; before it can be published, and somewhere for
        &ldquo;I can&rsquo;t tell&rdquo; if a reader could plausibly be unable to say — that route
        may legitimately be the same step as the failure one.
      </p>

      {document.edges.map((edge, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
          <select
            name="edgeFrom"
            defaultValue={edge.fromKey}
            aria-label="From step"
            className="rounded border border-outline-variant bg-surface-container px-3 py-2 text-body-md text-on-surface"
          >
            {document.nodes.map((node) => (
              <option key={node.key} value={node.key}>
                {node.title || node.key}
              </option>
            ))}
          </select>
          <select
            name="edgeCondition"
            defaultValue={edge.condition}
            aria-label="When the reader saw"
            className="rounded border border-outline-variant bg-surface-container px-3 py-2 text-body-md text-on-surface"
          >
            {BRANCH_CONDITIONS.map((value) => (
              <option key={value} value={value}>
                {BRANCH_CONDITION_LABELS[value]}
              </option>
            ))}
          </select>
          <select
            name="edgeTo"
            defaultValue={edge.toKey}
            aria-label="Go to step"
            className="rounded border border-outline-variant bg-surface-container px-3 py-2 text-body-md text-on-surface"
          >
            {document.nodes.map((node) => (
              <option key={node.key} value={node.key}>
                {node.title || node.key}
              </option>
            ))}
          </select>
          <Input
            name="edgeLabel"
            defaultValue={edge.label ?? ""}
            maxLength={120}
            placeholder="connection refused"
            aria-label="Your wording for this outcome"
          />
          <Button
            type="submit"
            name="intent"
            value={`remove-edge:${index}`}
            variant="ghost"
            size="sm"
            iconLeft="close"
          >
            Remove
          </Button>
        </div>
      ))}

      <Button type="submit" name="intent" value="add-edge" variant="secondary" iconLeft="add">
        Add a branch
      </Button>
    </fieldset>
  );
}

/**
 * Where the playbook applies.
 *
 * Required before publication, and the gate says so in those words. An unscoped
 * playbook cannot be matched to a reader's environment, cannot be segmented by
 * version and can never be marked stale — it opts out of three of the four things
 * this product claims to do, silently.
 */
function Applicability({
  document,
  technologies,
}: {
  document: DraftDocument;
  technologies: Array<{ slug: string; name: string }>;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-mono text-label-caps uppercase text-on-surface-variant">
        Where this applies
      </legend>
      <p className="text-body-sm text-on-surface-variant">
        Versions you actually tested on. &ldquo;Works on Linux&rdquo; with no version is a guess,
        not applicability — and it is what stops this being matched to anybody&rsquo;s environment.
      </p>

      <div className="flex flex-wrap gap-2">
        {technologies.map((technology) => (
          <label
            key={technology.slug}
            className="flex cursor-pointer items-center gap-2 rounded border border-outline-variant px-3 py-1.5 text-body-sm text-on-surface-variant has-checked:border-evidence-blue"
          >
            <input
              type="checkbox"
              name="technology"
              value={technology.slug}
              defaultChecked={document.technologySlugs.includes(technology.slug)}
              className="h-4 w-4"
            />
            {technology.name}
          </label>
        ))}
      </div>

      {document.constraints.map((constraint, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
          <select
            name="constraintTech"
            defaultValue={constraint.technologySlug}
            aria-label="Technology"
            className="rounded border border-outline-variant bg-surface-container px-3 py-2 text-body-md text-on-surface"
          >
            <option value="">choose one</option>
            {technologies.map((technology) => (
              <option key={technology.slug} value={technology.slug}>
                {technology.name}
              </option>
            ))}
          </select>
          <Input
            name="constraintMin"
            defaultValue={constraint.minSemver ?? ""}
            maxLength={40}
            placeholder="from 20.0.0"
            className="font-mono"
            aria-label="Minimum version"
          />
          <Input
            name="constraintMax"
            defaultValue={constraint.maxSemver ?? ""}
            maxLength={40}
            placeholder="to 22.0.0"
            className="font-mono"
            aria-label="Maximum version"
          />
          <select
            name="constraintInclusive"
            defaultValue={constraint.maxInclusive ? "inclusive" : "exclusive"}
            aria-label="Is the maximum included"
            className="rounded border border-outline-variant bg-surface-container px-3 py-2 text-body-md text-on-surface"
          >
            <option value="exclusive">up to, not including</option>
            <option value="inclusive">up to and including</option>
          </select>
          <select
            name="constraintKind"
            defaultValue={constraint.kind}
            aria-label="Kind of claim"
            className="rounded border border-outline-variant bg-surface-container px-3 py-2 text-body-md text-on-surface"
          >
            <option value="required">only applies here</option>
            <option value="known_affected">seen here</option>
            <option value="known_unaffected">does not apply here</option>
          </select>
          <input type="hidden" name="constraintArch" value={constraint.architecture ?? ""} />
          <Button
            type="submit"
            name="intent"
            value={`remove-constraint:${index}`}
            variant="ghost"
            size="sm"
            iconLeft="close"
          >
            Remove
          </Button>
        </div>
      ))}

      <Button type="submit" name="intent" value="add-constraint" variant="secondary" iconLeft="add">
        Add a version range
      </Button>
    </fieldset>
  );
}

function References({ document }: { document: DraftDocument }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-mono text-label-caps uppercase text-on-surface-variant">
        References
      </legend>
      <p className="text-body-sm text-on-surface-variant">
        The issue, the changelog entry, the documentation page. Links are checked before
        publication and an unsafe one blocks it rather than being quietly dropped.
      </p>

      {document.sources.map((source, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
          <Input
            name="sourceUrl"
            defaultValue={source.url}
            maxLength={500}
            placeholder="https://…"
            aria-label="URL"
          />
          <Input
            name="sourceTitle"
            defaultValue={source.title}
            maxLength={200}
            aria-label="Title"
          />
          <select
            name="sourceType"
            defaultValue={source.sourceType}
            aria-label="Kind of source"
            className="rounded border border-outline-variant bg-surface-container px-3 py-2 text-body-md text-on-surface"
          >
            {SOURCE_TYPES.map((value) => (
              <option key={value} value={value}>
                {value.replace("_", " ")}
              </option>
            ))}
          </select>
          <Button
            type="submit"
            name="intent"
            value={`remove-source:${index}`}
            variant="ghost"
            size="sm"
            iconLeft="close"
          >
            Remove
          </Button>
        </div>
      ))}

      <Button type="submit" name="intent" value="add-source" variant="secondary" iconLeft="add">
        Add a reference
      </Button>
    </fieldset>
  );
}

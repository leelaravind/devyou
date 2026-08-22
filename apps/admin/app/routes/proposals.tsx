import { Form, Link, useSearchParams } from "react-router";
import { Card } from "@devyou/ui";
import { ApiError } from "@devyou/core";
import { can } from "@devyou/auth";
import type { Route } from "./+types/proposals";
import { beginAdminAction, requireAdmin, runAction } from "../lib/route.server";
import { performAdminAction, reasonFrom, requiredField } from "../lib/audit.server";
import {
  ActionForm,
  Detail,
  EmptyState,
  SelectField,
  StatusChip,
  SurfaceHeader,
  SurfaceLayout,
} from "../components/admin-forms";
import { formatAge, formatInstant, shortId } from "../lib/format";

/**
 * Change proposals.
 *
 * R-40: disagreement is funnelled into proposing a branch or a test, never into a comment
 * thread. This is where that funnel lands, and the reason it is an admin surface at all is
 * the finding underneath it — the adoption research names silently discarding
 * contributions as fatal. So a declined proposal keeps its reason, stays visible to its
 * author, and is never deleted.
 *
 * **Accepting a proposal does not create a revision here, and that is deliberate.**
 * `proposals:accept` and `revisions:publish` are separate capabilities because they are
 * separate judgements: accepting says a change is good, publishing puts it in front of
 * readers. Turning an accepted proposal into a new revision runs through the contribution
 * pipeline — safety preprocessing, the provenance gate, the publication safety gate — and
 * an admin route that shortcut all three would be a way to publish text that no gate had
 * read. So this surface sets the decision and leaves `resulting_revision_id` null until
 * the pipeline fills it in, which is visible on the row rather than implied.
 */

export function meta() {
  return [{ title: "Proposals — DevYou admin" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, actor } = await requireAdmin(context, "proposals:view");
  const status = new URL(request.url).searchParams.get("status") ?? "open";

  const proposals = await env.DB.prepare(
    status === "all"
      ? `SELECT p.id, p.revision_id, p.node_id, p.proposal_type, p.body, p.status,
                p.resolution_reason, p.resulting_revision_id, p.created_at, p.resolved_at,
                pr.handle AS author_handle, r.title AS revision_title, pb.slug AS playbook_slug
           FROM change_proposals p
           LEFT JOIN profiles pr ON pr.user_id = p.author_id
           JOIN playbook_revisions r ON r.id = p.revision_id
           JOIN playbooks pb ON pb.id = r.playbook_id
          ORDER BY p.created_at DESC LIMIT 80`
      : `SELECT p.id, p.revision_id, p.node_id, p.proposal_type, p.body, p.status,
                p.resolution_reason, p.resulting_revision_id, p.created_at, p.resolved_at,
                pr.handle AS author_handle, r.title AS revision_title, pb.slug AS playbook_slug
           FROM change_proposals p
           LEFT JOIN profiles pr ON pr.user_id = p.author_id
           JOIN playbook_revisions r ON r.id = p.revision_id
           JOIN playbooks pb ON pb.id = r.playbook_id
          WHERE p.status = ?1
          ORDER BY p.created_at ASC LIMIT 80`,
  )
    .bind(...(status === "all" ? [] : [status]))
    .all<ProposalRow>();

  return {
    proposals: proposals.results,
    status,
    mayAccept: can(actor.role, "proposals:accept"),
    mayDecline: can(actor.role, "proposals:decline"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  return runAction(async () => {
    const { env, actor, form, intent } = await beginAdminAction(request, context);
    const proposalId = requiredField(form, "proposalId");
    const reason = reasonFrom(form);

    const accepting = intent === "accept";
    if (!accepting && intent !== "decline") {
      throw new ApiError("BAD_REQUEST", { internalDetail: `unknown proposal intent ${intent}` });
    }

    const nextStatus = accepting ? "accepted" : "declined";

    await performAdminAction(
      env.DB,
      {
        actor,
        capability: accepting ? "proposals:accept" : "proposals:decline",
        subjectType: "change_proposal",
        subjectId: proposalId,
        ...reason,
        change: { status: ["open", nextStatus] },
      },
      [
        /*
          The `status = 'open'` predicate is the concurrency guard.

          Two reviewers with the queue open in two tabs is the normal case, not the
          pathological one. Without the predicate the second submission would overwrite
          the first decision and write a second audit row claiming a transition that had
          already happened. With it, the second update matches nothing — the audit row
          still records that somebody attempted the decision, which is the honest record.
        */
        env.DB.prepare(
          `UPDATE change_proposals
              SET status = ?1, resolution_reason = ?2, resolved_by = ?3, resolved_at = unixepoch()
            WHERE id = ?4 AND status = 'open'`,
        ).bind(nextStatus, reason.reasonCode, actor.userId, proposalId),
      ],
    );

    return { ok: true as const, message: `Proposal ${shortId(proposalId)} ${nextStatus}.` };
  });
}

export default function Proposals({ loaderData, actionData }: Route.ComponentProps) {
  const { proposals, status, mayAccept, mayDecline } = loaderData;
  const [params] = useSearchParams();
  const focus = params.get("focus");

  return (
    <SurfaceLayout>
      <SurfaceHeader
        title="Proposals"
        description="Corrections, missing tests and additional branches proposed against a published revision. A declined proposal keeps its reason and stays visible to its author — silently discarding contributions is the behaviour the adoption research names as fatal."
      >
        <Form method="get" className="gap-gutter flex items-end">
          <SelectField
            label="Status"
            name="status"
            defaultValue={status}
            options={["open", "accepted", "declined", "merged", "all"]}
          />
          <button
            type="submit"
            className="bg-primary text-label-caps text-on-primary rounded px-4 py-2 font-mono uppercase"
          >
            Filter
          </button>
        </Form>
      </SurfaceHeader>

      {actionData?.ok && (
        <p className="border-status-confirmed/40 bg-surface-container text-body-sm text-status-confirmed mb-6 rounded border p-3">
          {actionData.message}
        </p>
      )}

      {proposals.length === 0 ? (
        <EmptyState>No proposals with this status.</EmptyState>
      ) : (
        <ol className="gap-gutter flex list-none flex-col">
          {proposals.map((proposal) => (
            <li key={proposal.id}>
              <Card as="article">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <StatusChip value={proposal.proposal_type} />
                  <StatusChip
                    value={proposal.status}
                    alarming={proposal.proposal_type === "safety_report"}
                  />
                  <span className="text-env-tag text-on-surface-variant font-mono">
                    {formatAge(proposal.created_at)} old
                  </span>
                </div>

                <h2 className="font-headline text-body-md text-on-surface mb-1">
                  {proposal.revision_title}
                </h2>
                <p className="text-env-tag text-on-surface-variant mb-2 font-mono">
                  /p/{proposal.playbook_slug} · {shortId(proposal.revision_id)}
                  {proposal.node_id ? ` · node ${shortId(proposal.node_id)}` : ""}
                </p>

                {/*
                  The proposal body is rendered as plain text inside a `<p>`, never as
                  Markdown and never as HTML.

                  It is text a stranger wrote, and invariant 10 applies most sharply on the
                  one origin where every viewer holds a privileged role. React escapes it;
                  no sanitiser is needed because nothing is being interpreted.
                */}
                <p className="text-body-sm text-on-surface mb-3 whitespace-pre-wrap">
                  {proposal.body}
                </p>

                <Detail label="Author">{proposal.author_handle ?? "deleted account"}</Detail>
                <Detail label="Filed">{formatInstant(proposal.created_at)}</Detail>
                {proposal.resolved_at && (
                  <Detail label="Decided">
                    {formatInstant(proposal.resolved_at)} · {proposal.resolution_reason ?? "—"}
                  </Detail>
                )}
                <Detail label="Resulting revision">
                  {proposal.resulting_revision_id ?? (
                    <span className="text-on-surface-variant">
                      none yet — accepting records the decision; the contribution pipeline produces
                      the revision, so nothing here can publish text past the safety gates
                    </span>
                  )}
                </Detail>

                {proposal.status === "open" &&
                  (focus === proposal.id ? (
                    <div className="gap-gutter border-outline-variant mt-4 grid border-t pt-4 lg:grid-cols-2">
                      {mayAccept && (
                        <ActionForm
                          intent="accept"
                          capability="proposals:accept"
                          label="Accept"
                          fields={{ proposalId: proposal.id }}
                        />
                      )}
                      {mayDecline && (
                        <ActionForm
                          intent="decline"
                          capability="proposals:decline"
                          label="Decline"
                          variant="ghost"
                          fields={{ proposalId: proposal.id }}
                        />
                      )}
                    </div>
                  ) : (
                    <Link
                      to={`?${new URLSearchParams({ status, focus: proposal.id })}`}
                      className="text-body-sm text-evidence-blue mt-2 inline-block underline"
                    >
                      Decide
                    </Link>
                  ))}
              </Card>
            </li>
          ))}
        </ol>
      )}
    </SurfaceLayout>
  );
}

interface ProposalRow {
  id: string;
  revision_id: string;
  node_id: string | null;
  proposal_type: string;
  body: string;
  status: string;
  resolution_reason: string | null;
  resulting_revision_id: string | null;
  created_at: number;
  resolved_at: number | null;
  author_handle: string | null;
  revision_title: string;
  playbook_slug: string;
}

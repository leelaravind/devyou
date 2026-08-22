import { Link, useSearchParams } from "react-router";
import { Card } from "@devyou/ui";
import { ApiError } from "@devyou/core";
import { can } from "@devyou/auth";
import type { Route } from "./+types/claims";
import { beginAdminAction, requireAdmin, runAction } from "../lib/route.server";
import { performAdminAction, reasonFrom, requiredField } from "../lib/audit.server";
import {
  ActionForm,
  Detail,
  EmptyState,
  StatusChip,
  SurfaceHeader,
  SurfaceLayout,
} from "../components/admin-forms";
import { formatInstant } from "../lib/format";

/**
 * Maintainer and vendor identity claims.
 *
 * A claim, never a role. The research is explicit that loosely verified "official" status
 * is worse than none — it reads as pay-to-play the moment anybody doubts it — so a granted
 * claim confers exactly one thing: the ability to file `maintainer_attestation` evidence.
 * That is one signal among several and never outranks reproduction. It grants no
 * moderation power, no visible badge of authority, and no weight in any confidence
 * calculation beyond that single evidence type.
 *
 * The consequence for whoever works this queue: **granting is a factual finding, not a
 * courtesy.** The question is whether the presented proof actually demonstrates control —
 * a DNS TXT record on the project's own domain, a commit signed with a known key, a post
 * on a site the project controls. A convincing email signature is not proof, and the cost
 * of being wrong is not that one person gets a badge, it is that the word "official" stops
 * meaning anything on the whole site.
 *
 * The evidence URL is shown as text and is deliberately not a link. It was supplied by the
 * person asking to be believed; making it clickable from a privileged origin is a
 * one-click phishing target aimed at exactly the people with the most capabilities.
 */

export function meta() {
  return [{ title: "Identity claims — DevYou admin" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, actor } = await requireAdmin(context, "identity_claims:view");
  const status = new URL(request.url).searchParams.get("status") ?? "pending";

  const claims = await env.DB.prepare(
    status === "all"
      ? `SELECT c.id, c.user_id, c.technology_id, c.claim_type, c.evidence_url, c.evidence_detail,
                c.status, c.review_reason, c.reviewed_at, c.created_at,
                p.handle, t.name AS technology_name, t.slug AS technology_slug
           FROM official_identity_claims c
           LEFT JOIN profiles p ON p.user_id = c.user_id
           LEFT JOIN technologies t ON t.id = c.technology_id
          ORDER BY c.created_at DESC LIMIT 80`
      : `SELECT c.id, c.user_id, c.technology_id, c.claim_type, c.evidence_url, c.evidence_detail,
                c.status, c.review_reason, c.reviewed_at, c.created_at,
                p.handle, t.name AS technology_name, t.slug AS technology_slug
           FROM official_identity_claims c
           LEFT JOIN profiles p ON p.user_id = c.user_id
           LEFT JOIN technologies t ON t.id = c.technology_id
          WHERE c.status = ?1
          ORDER BY c.created_at ASC LIMIT 80`,
  )
    .bind(...(status === "all" ? [] : [status]))
    .all<ClaimRow>();

  return {
    claims: claims.results,
    status,
    permissions: {
      grant: can(actor.role, "identity_claims:grant"),
      refuse: can(actor.role, "identity_claims:refuse"),
      revoke: can(actor.role, "identity_claims:revoke"),
    },
  };
}

const TRANSITIONS = {
  grant: { capability: "identity_claims:grant", next: "granted", from: "pending" },
  refuse: { capability: "identity_claims:refuse", next: "refused", from: "pending" },
  revoke: { capability: "identity_claims:revoke", next: "revoked", from: "granted" },
} as const;

export async function action({ request, context }: Route.ActionArgs) {
  return runAction(async () => {
    const { env, actor, form, intent } = await beginAdminAction(request, context);
    const claimId = requiredField(form, "claimId");
    const reason = reasonFrom(form);

    const transition = TRANSITIONS[intent as keyof typeof TRANSITIONS];
    if (!transition) {
      throw new ApiError("BAD_REQUEST", { internalDetail: `unknown claim intent ${intent}` });
    }

    await performAdminAction(
      env.DB,
      {
        actor,
        capability: transition.capability,
        subjectType: "identity_claim",
        subjectId: claimId,
        ...reason,
        change: { status: [transition.from, transition.next] },
      },
      [
        /*
          The `status = <from>` predicate encodes the legal transitions in the statement
          itself: pending → granted/refused, granted → revoked, and nothing else. A revoked
          claim cannot be granted again — the person files a fresh claim with fresh proof,
          which is the correct thing to ask of somebody whose previous claim was withdrawn.
        */
        env.DB.prepare(
          `UPDATE official_identity_claims
              SET status = ?1, review_reason = ?2, reviewed_by = ?3, reviewed_at = unixepoch()
            WHERE id = ?4 AND status = ?5`,
        ).bind(transition.next, reason.reasonCode, actor.userId, claimId, transition.from),
      ],
    );

    return { ok: true as const, message: `Claim ${transition.next}.` };
  });
}

export default function Claims({ loaderData, actionData }: Route.ComponentProps) {
  const { claims, status, permissions } = loaderData;
  const [params] = useSearchParams();
  const focus = params.get("focus");

  return (
    <SurfaceLayout>
      <SurfaceHeader
        title="Identity claims"
        description="A granted claim confers exactly one thing: the ability to file maintainer_attestation evidence, which never outranks reproduction. It grants no moderation power and no badge of authority. Grant only on proof of control — a DNS record, a signed commit, a post on the project's own domain."
      >
        <div className="gap-gutter flex">
          {(["pending", "granted", "refused", "revoked", "all"] as const).map((option) => (
            <Link
              key={option}
              to={`?status=${option}`}
              className={`text-env-tag font-mono ${
                status === option ? "text-on-surface underline" : "text-on-surface-variant"
              }`}
            >
              {option}
            </Link>
          ))}
        </div>
      </SurfaceHeader>

      {actionData?.ok && (
        <p className="border-status-confirmed/40 bg-surface-container text-body-sm text-status-confirmed mb-6 rounded border p-3">
          {actionData.message}
        </p>
      )}

      {claims.length === 0 ? (
        <EmptyState>No claims with this status.</EmptyState>
      ) : (
        <ol className="gap-gutter flex list-none flex-col">
          {claims.map((claim) => (
            <li key={claim.id}>
              <Card as="article">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <StatusChip value={claim.status} alarming={claim.status === "revoked"} />
                  <StatusChip value={claim.claim_type} />
                </div>

                <h2 className="font-headline text-body-md text-on-surface mb-1">
                  {claim.handle ?? claim.user_id} → {claim.technology_name ?? claim.technology_id}
                </h2>

                <Detail label="Filed">{formatInstant(claim.created_at)}</Detail>
                {/* Text, not a link. See the note at the top of this file. */}
                <Detail label="Proof URL">
                  <span className="font-mono break-all">{claim.evidence_url ?? "—"}</span>
                </Detail>
                <Detail label="Proof detail">{claim.evidence_detail ?? "—"}</Detail>
                {claim.reviewed_at && (
                  <Detail label="Reviewed">
                    {formatInstant(claim.reviewed_at)} · {claim.review_reason ?? "—"}
                  </Detail>
                )}

                {focus === claim.id ? (
                  <div className="gap-gutter border-outline-variant mt-4 grid border-t pt-4 lg:grid-cols-2">
                    {claim.status === "pending" && permissions.grant && (
                      <ActionForm
                        intent="grant"
                        capability="identity_claims:grant"
                        label="Grant claim"
                        fields={{ claimId: claim.id }}
                      />
                    )}
                    {claim.status === "pending" && permissions.refuse && (
                      <ActionForm
                        intent="refuse"
                        capability="identity_claims:refuse"
                        label="Refuse claim"
                        variant="ghost"
                        fields={{ claimId: claim.id }}
                      />
                    )}
                    {claim.status === "granted" && permissions.revoke && (
                      <ActionForm
                        intent="revoke"
                        capability="identity_claims:revoke"
                        label="Revoke claim"
                        variant="danger"
                        fields={{ claimId: claim.id }}
                      />
                    )}
                  </div>
                ) : (
                  <Link
                    to={`?${new URLSearchParams({ status, focus: claim.id })}`}
                    className="text-body-sm text-evidence-blue mt-2 inline-block underline"
                  >
                    Review
                  </Link>
                )}
              </Card>
            </li>
          ))}
        </ol>
      )}
    </SurfaceLayout>
  );
}

interface ClaimRow {
  id: string;
  user_id: string;
  technology_id: string;
  claim_type: string;
  evidence_url: string | null;
  evidence_detail: string | null;
  status: string;
  review_reason: string | null;
  reviewed_at: number | null;
  created_at: number;
  handle: string | null;
  technology_name: string | null;
  technology_slug: string | null;
}

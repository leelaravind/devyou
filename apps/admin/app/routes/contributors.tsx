import { Form, Link, useSearchParams } from "react-router";
import { Card } from "@devyou/ui";
import { ApiError } from "@devyou/core";
import { ROLES, can } from "@devyou/auth";
import type { Route } from "./+types/contributors";
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
  TextField,
} from "../components/admin-forms";
import { formatInstant, shortId } from "../lib/format";

/**
 * Contributor management.
 *
 * The one thing to keep in mind while reading this file: **a role grants a capability and
 * confers no standing.** There is no rank here, no score, and nothing a contributor can do
 * to climb one — `contributor` is not "above" `user`, it is a different set of buttons. The
 * adoption research is unambiguous that a reputation ladder is what drove contributors off
 * the incumbent, so this surface deliberately shows no contribution count, no leaderboard
 * position and no derived standing of any kind.
 *
 * What it does show is `actor_trust`, which is not the same thing. Trust weights exist to
 * decide how much a *reproduction* counts toward confidence when clustering suggests
 * coordinated reporting. It is recomputed by a job, has no display surface on the public
 * site, and is shown here only because an operator investigating a suspected gaming
 * cluster cannot do so without it.
 *
 * Deleting an account is absent, and the absence is the design. `users.status` supports
 * `deleted`, which anonymises the row and keeps the evidence — removing a reproduction
 * would silently change a playbook's confidence for everybody else. Anonymisation is a
 * data-subject request with legal shape, not an admin button, so it is not offered here.
 */

export function meta() {
  return [{ title: "Contributors — DevYou admin" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, actor } = await requireAdmin(context, "contributors:list");
  const search = new URL(request.url).searchParams.get("q")?.trim() ?? "";

  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (search) {
    bindings.push(`%${search}%`);
    conditions.push(
      `(u.id LIKE ?${bindings.length} OR u.email LIKE ?${bindings.length} OR p.handle LIKE ?${bindings.length} OR p.github_login LIKE ?${bindings.length})`,
    );
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const users = await env.DB.prepare(
    `SELECT u.id, u.status, u.role, u.created_at, u.email_verified_at,
            p.handle, p.display_name, p.github_login,
            t.weight, t.suspected_cluster, t.reproduction_count, t.distinct_environments,
            (SELECT count(*) FROM sessions s
              WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > unixepoch())
              AS live_sessions
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       LEFT JOIN actor_trust t ON t.user_id = u.id
       ${where}
      ORDER BY u.created_at DESC
      LIMIT 60`,
  )
    .bind(...bindings)
    .all<UserRow>();

  /*
    The email address is deliberately not selected.

    It is the join key the perimeter uses, and it is personal data with no operational use
    on a list screen — an operator looking somebody up has their handle or their id. It is
    searchable (the `LIKE` above) without being displayed, which supports "this address
    reported abuse, who is it" without turning the list into an address book.
  */

  return {
    users: users.results,
    search,
    self: actor.userId,
    permissions: {
      suspend: can(actor.role, "contributors:suspend"),
      unsuspend: can(actor.role, "contributors:unsuspend"),
      setRole: can(actor.role, "contributors:set_role"),
      revokeSessions: can(actor.role, "contributors:revoke_sessions"),
    },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  return runAction(async () => {
    const { env, actor, form, intent } = await beginAdminAction(request, context);
    const userId = requiredField(form, "userId");
    const reason = reasonFrom(form);

    /*
      No administrator may act on their own account, on any of these three operations.

      Two failures it prevents, and both have happened to somebody. Setting your own role
      is privilege escalation with a paper trail — a `support_admin` promoting themselves
      to `dev_admin` writes a perfectly valid audit row. Suspending yourself is a lockout
      that cannot be undone from this console, because the account that would undo it is
      the one that was suspended.

      A second administrator is always required, which is a small cost on a two-person
      team and the correct shape when it grows.
    */
    if (userId === actor.userId) {
      throw new ApiError("FORBIDDEN", {
        publicMessage:
          "You cannot act on your own account here. Ask another administrator — self-service role changes are privilege escalation with a receipt.",
        internalDetail: "admin self-action refused",
      });
    }

    switch (intent) {
      case "suspend":
      case "unsuspend": {
        const suspending = intent === "suspend";
        await performAdminAction(
          env.DB,
          {
            actor,
            capability: suspending ? "contributors:suspend" : "contributors:unsuspend",
            subjectType: "user",
            subjectId: userId,
            ...reason,
            change: { status: suspending ? ["active", "suspended"] : ["suspended", "active"] },
          },
          suspending
            ? [
                env.DB.prepare(
                  `UPDATE users SET status = 'suspended' WHERE id = ?1 AND status = 'active'`,
                ).bind(userId),
                /*
                  Sessions are revoked in the same transaction as the suspension.

                  `resolvePrincipal` already refuses a non-active user, so a live session
                  is inert the moment the status changes and this is strictly belt and
                  braces. It is worth the extra statement anyway: the session rows
                  otherwise sit there looking live, and the next person to read the table
                  during an incident has to know about that indirection to interpret what
                  they are seeing.
                */
                env.DB.prepare(
                  `UPDATE sessions SET revoked_at = unixepoch()
                    WHERE user_id = ?1 AND revoked_at IS NULL`,
                ).bind(userId),
              ]
            : [
                /* Unsuspending restores the account and deliberately does **not** restore
                   sessions. Revocation is one-way: the person signs in again, which is a
                   trivial cost and removes any doubt about whose session it was. */
                env.DB.prepare(
                  `UPDATE users SET status = 'active' WHERE id = ?1 AND status = 'suspended'`,
                ).bind(userId),
              ],
        );
        return { ok: true as const, message: `${shortId(userId)} ${intent}ed.` };
      }

      case "revoke_sessions": {
        await performAdminAction(
          env.DB,
          {
            actor,
            capability: "contributors:revoke_sessions",
            subjectType: "user",
            subjectId: userId,
            ...reason,
            change: { sessions: ["live", "revoked"] },
          },
          [
            env.DB.prepare(
              `UPDATE sessions SET revoked_at = unixepoch()
                WHERE user_id = ?1 AND revoked_at IS NULL`,
            ).bind(userId),
          ],
        );
        return { ok: true as const, message: `Sessions revoked for ${shortId(userId)}.` };
      }

      case "set_role": {
        const role = requiredField(form, "role");
        if (!(ROLES as readonly string[]).includes(role)) {
          throw new ApiError("BAD_REQUEST", { internalDetail: `unknown role ${role}` });
        }

        const current = await env.DB.prepare(`SELECT role FROM users WHERE id = ?1`)
          .bind(userId)
          .first<{ role: string }>();
        if (!current) {
          throw new ApiError("NOT_FOUND", { internalDetail: "user not found for set_role" });
        }
        if (current.role === role) {
          throw new ApiError("CONFLICT", {
            publicMessage: `That account is already ${role}.`,
            internalDetail: "set_role no-op refused",
          });
        }

        await performAdminAction(
          env.DB,
          {
            actor,
            capability: "contributors:set_role",
            subjectType: "user",
            subjectId: userId,
            ...reason,
            change: { role: [current.role, role] },
          },
          [
            env.DB.prepare(`UPDATE users SET role = ?1 WHERE id = ?2`).bind(role, userId),
            /*
              A role change revokes the account's sessions.

              A live session carries no role — `resolvePrincipal` re-reads `users.role` on
              every request — so this is not required for a *demotion* to take effect. It
              is here for the promotion case: a session minted while the account was an
              ordinary contributor should not silently become an administrator's session
              mid-browse. Signing in again is the boundary between the two.
            */
            env.DB.prepare(
              `UPDATE sessions SET revoked_at = unixepoch()
                WHERE user_id = ?1 AND revoked_at IS NULL`,
            ).bind(userId),
          ],
        );
        return { ok: true as const, message: `${shortId(userId)} is now ${role}.` };
      }

      default:
        throw new ApiError("BAD_REQUEST", {
          internalDetail: `unknown contributor intent ${intent}`,
        });
    }
  });
}

export default function Contributors({ loaderData, actionData }: Route.ComponentProps) {
  const { users, search, self, permissions } = loaderData;
  const [params] = useSearchParams();
  const focus = params.get("focus");

  return (
    <SurfaceLayout>
      <SurfaceHeader
        title="Contributors"
        description="Account lookup, suspension, roles and session revocation. A role grants a capability and confers no standing — there is no rank here, and nothing on this page is a score."
      >
        <Form method="get" className="gap-gutter flex items-end">
          <TextField
            label="Id, handle, GitHub login or email"
            name="q"
            defaultValue={search}
            placeholder="usr_… or handle"
          />
          <button
            type="submit"
            className="bg-primary text-label-caps text-on-primary rounded px-4 py-2 font-mono uppercase"
          >
            Search
          </button>
        </Form>
      </SurfaceHeader>

      {actionData?.ok && (
        <p className="border-status-confirmed/40 bg-surface-container text-body-sm text-status-confirmed mb-6 rounded border p-3">
          {actionData.message}
        </p>
      )}

      {users.length === 0 ? (
        <EmptyState>No account matches that search.</EmptyState>
      ) : (
        <ol className="gap-gutter flex list-none flex-col">
          {users.map((user) => (
            <li key={user.id}>
              <Card as="article">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <StatusChip value={user.status} alarming={user.status !== "active"} />
                  <StatusChip value={user.role} />
                  {user.suspected_cluster && (
                    <StatusChip value={`cluster ${user.suspected_cluster}`} alarming />
                  )}
                  {user.id === self && <StatusChip value="you" />}
                </div>

                <h2 className="font-headline text-body-md text-on-surface mb-1">
                  {user.display_name ?? user.handle ?? "(no profile)"}
                </h2>
                <p className="text-env-tag text-on-surface-variant mb-2 font-mono">
                  {user.id}
                  {user.handle ? ` · @${user.handle}` : ""}
                  {user.github_login ? ` · github:${user.github_login}` : ""}
                </p>

                <Detail label="Joined">{formatInstant(user.created_at)}</Detail>
                <Detail label="Live sessions">{user.live_sessions}</Detail>
                <Detail label="Evidence weight">
                  {user.weight ?? 100}
                  {user.weight === 0 && " — contributes nothing to confidence, still visible"}
                </Detail>
                <Detail label="Reproductions filed">{user.reproduction_count ?? 0}</Detail>
                <Detail label="Distinct environments">{user.distinct_environments ?? 0}</Detail>

                {user.id === self ? (
                  <p className="text-body-sm text-on-surface-variant mt-3">
                    No controls on your own account. Self-service role changes are privilege
                    escalation with a receipt, and self-suspension is a lockout nobody here can
                    undo.
                  </p>
                ) : focus === user.id ? (
                  <div className="gap-gutter border-outline-variant mt-4 grid border-t pt-4 lg:grid-cols-2">
                    {user.status === "active" && permissions.suspend && (
                      <ActionForm
                        intent="suspend"
                        capability="contributors:suspend"
                        label="Suspend account"
                        variant="danger"
                        fields={{ userId: user.id }}
                      />
                    )}
                    {user.status === "suspended" && permissions.unsuspend && (
                      <ActionForm
                        intent="unsuspend"
                        capability="contributors:unsuspend"
                        label="Restore account"
                        fields={{ userId: user.id }}
                      />
                    )}
                    {permissions.revokeSessions && user.live_sessions > 0 && (
                      <ActionForm
                        intent="revoke_sessions"
                        capability="contributors:revoke_sessions"
                        label="Revoke all sessions"
                        fields={{ userId: user.id }}
                      />
                    )}
                    {permissions.setRole && (
                      <ActionForm
                        intent="set_role"
                        capability="contributors:set_role"
                        label="Set role"
                        variant="danger"
                        fields={{ userId: user.id }}
                      >
                        <SelectField
                          label="Role"
                          description="Changing a role revokes this account's sessions, so a promotion never applies mid-browse."
                          name="role"
                          required
                          defaultValue={user.role}
                          options={ROLES}
                        />
                      </ActionForm>
                    )}
                  </div>
                ) : (
                  <Link
                    to={`?${new URLSearchParams({ q: search, focus: user.id })}`}
                    className="text-body-sm text-evidence-blue mt-2 inline-block underline"
                  >
                    Act on this account
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

interface UserRow {
  id: string;
  status: string;
  role: string;
  created_at: number;
  email_verified_at: number | null;
  handle: string | null;
  display_name: string | null;
  github_login: string | null;
  weight: number | null;
  suspected_cluster: string | null;
  reproduction_count: number | null;
  distinct_environments: number | null;
  live_sessions: number;
}

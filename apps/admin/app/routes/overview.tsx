import { Link } from "react-router";
import { Card, Icon } from "@devyou/ui";
import { can, type Capability } from "@devyou/auth";
import type { Route } from "./+types/overview";
import { requireAdmin } from "../lib/route.server";
import { SurfaceHeader, SurfaceLayout } from "../components/admin-forms";
import { SURFACES } from "../lib/surfaces";

/**
 * The actionable overview.
 *
 * Plan §13 asks for an "actionable overview", and the word doing the work is
 * *actionable*. This page counts things that are **waiting for a human decision** and
 * nothing else. There is no total playbook count, no contributor count, no chart of
 * activity over time — those make an operations dashboard, which is a surface people
 * glance at and then stop reading because it never asks anything of them.
 *
 * Every tile therefore answers "is there a queue, and how long has its oldest item been
 * sitting there". A tile whose count is zero still renders, because a queue that has
 * disappeared from the page is indistinguishable from a queue that is empty, and one of
 * those means the reporting path has broken.
 *
 * Gated on `health:view`, the one capability every admin role holds. Individual tiles are
 * then filtered by the capability of the surface they link to — an operator is not shown
 * a count of things they cannot open.
 */

export function meta() {
  return [{ title: "Overview — DevYou admin" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env, actor } = await requireAdmin(context, "health:view");

  /*
    One batch rather than eight awaits.

    D1 charges per round trip, and eight sequential aggregate queries on the landing page
    is the difference between a console that feels instant and one nobody opens. Each
    statement is independent; the batch is for the round trip, not for atomicity.
  */
  const [
    moderation,
    proposals,
    claims,
    quarantined,
    reverification,
    suppressed,
    aiFailures,
    unpublished,
  ] = await env.DB.batch<QueueRow>([
    env.DB.prepare(
      `SELECT count(*) AS total, min(created_at) AS oldest
         FROM moderation_cases WHERE status IN ('open', 'investigating')`,
    ),
    env.DB.prepare(
      `SELECT count(*) AS total, min(created_at) AS oldest
         FROM change_proposals WHERE status = 'open'`,
    ),
    env.DB.prepare(
      `SELECT count(*) AS total, min(created_at) AS oldest
         FROM official_identity_claims WHERE status = 'pending'`,
    ),
    env.DB.prepare(
      `SELECT count(*) AS total, min(created_at) AS oldest
         FROM playbooks WHERE status = 'quarantined'`,
    ),
    env.DB.prepare(
      `SELECT count(*) AS total, min(needs_reverification_at) AS oldest
         FROM playbook_revisions WHERE status = 'needs_reverification'`,
    ),
    env.DB.prepare(
      `SELECT count(*) AS total, min(suppressed_at) AS oldest
         FROM evidence_records WHERE suppressed_at IS NOT NULL`,
    ),
    /*
      `schema_invalid` is counted with the outright failures but is a different problem:
      the model answered and the answer did not validate, which is a prompt regression
      rather than an outage. The AI surface separates them; here they share a tile
      because both mean "somebody needs to look at the AI ledger today".
    */
    env.DB.prepare(
      `SELECT count(*) AS total, min(created_at) AS oldest
         FROM ai_tasks
        WHERE status IN ('failed', 'schema_invalid', 'budget_exceeded')
          AND created_at > unixepoch() - 86400`,
    ),
    env.DB.prepare(
      `SELECT count(*) AS total, min(created_at) AS oldest
         FROM playbooks WHERE current_revision_id IS NULL`,
    ),
  ]);

  const queues: Queue[] = [
    tile("Moderation cases open", "/moderation", "moderation:view", moderation),
    tile("Proposals awaiting review", "/proposals", "proposals:view", proposals),
    tile("Identity claims pending", "/claims", "identity_claims:view", claims),
    tile("Playbooks quarantined", "/playbooks", "playbooks:view_unpublished", quarantined),
    tile(
      "Revisions needing reverification",
      "/playbooks",
      "playbooks:view_unpublished",
      reverification,
    ),
    tile("Playbooks never published", "/playbooks", "playbooks:view_unpublished", unpublished),
    tile("Evidence records suppressed", "/evidence", "evidence:view_suppressed", suppressed),
    tile("AI tasks failed in 24h", "/ai", "ai_operations:view", aiFailures),
  ];

  return {
    queues: queues.filter((queue) => can(actor.role, queue.capability)),
    surfaces: SURFACES.filter((surface) => can(actor.role, surface.capability)),
  };
}

export default function Overview({ loaderData }: Route.ComponentProps) {
  const { queues, surfaces } = loaderData;

  return (
    <SurfaceLayout>
      <SurfaceHeader
        title="Overview"
        description="Everything on this page is waiting for a decision. Counts that stay at zero are still shown — a queue that vanishes from the page looks the same as a queue that is empty, and one of those means reporting has broken."
      />

      <ul className="gap-gutter mb-10 grid list-none sm:grid-cols-2 lg:grid-cols-3">
        {queues.map((queue) => (
          <li key={queue.label}>
            <Card as="article" interactive className="h-full">
              <Link to={queue.href} className="flex h-full flex-col gap-1">
                <span className="text-env-tag text-on-surface-variant font-mono uppercase">
                  {queue.label}
                </span>
                <span
                  className={`font-headline text-headline-lg ${
                    queue.total > 0 ? "text-on-surface" : "text-on-surface-variant"
                  }`}
                >
                  {queue.total}
                </span>
                {/*
                  Age of the oldest item, not of the newest.

                  A queue of forty things worked in order is healthy; a queue of two
                  where the older has been sitting for eleven days is not, and a count
                  alone cannot tell them apart.
                */}
                <span className="text-env-tag text-on-surface-variant mt-auto font-mono">
                  {queue.total > 0 ? `oldest ${queue.oldestAgeDays}d` : "nothing waiting"}
                </span>
              </Link>
            </Card>
          </li>
        ))}
      </ul>

      <h2 className="font-headline text-headline-md text-on-surface mb-3">Surfaces</h2>
      <ul className="gap-gutter grid list-none sm:grid-cols-2">
        {surfaces.map((surface) => (
          <li key={surface.path}>
            <Card as="article" interactive className="h-full">
              <Link to={surface.path} className="gap-density-high flex items-start">
                <Icon name={surface.icon} size={18} className="text-on-surface-variant mt-0.5" />
                <span>
                  <span className="font-headline text-body-md text-on-surface block">
                    {surface.label}
                  </span>
                  <span className="text-body-sm text-on-surface-variant block">
                    {surface.description}
                  </span>
                </span>
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </SurfaceLayout>
  );
}

interface QueueRow {
  total: number;
  oldest: number | null;
}

interface Queue {
  label: string;
  href: string;
  capability: Capability;
  total: number;
  oldestAgeDays: number;
}

/**
 * `result` is optional because destructuring a `db.batch` array is index access, and
 * `noUncheckedIndexedAccess` correctly points out that the compiler cannot know the array
 * has eight entries. Treating a missing result as an empty queue is right in any case: a
 * tile that renders zero is a tile somebody can see is wrong, where a thrown error would
 * take the whole landing page down over one aggregate.
 */
function tile(
  label: string,
  href: string,
  capability: Capability,
  result: D1Result<QueueRow> | undefined,
): Queue {
  const row = result?.results[0];
  const total = row?.total ?? 0;
  const oldest = row?.oldest ?? null;
  return {
    label,
    href,
    capability,
    total,
    oldestAgeDays: oldest ? Math.floor((Date.now() / 1000 - oldest) / 86_400) : 0,
  };
}

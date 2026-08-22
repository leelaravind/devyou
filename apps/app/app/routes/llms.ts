import { CACHE } from "@devyou/core";
import type { Route } from "./+types/llms";
import { cloudflareContext } from "../context/cloudflare";

/**
 * llms.txt.
 *
 * Plan §16 calls this "optional, and never the only machine-access route", and both
 * halves matter. Every playbook on this site is fully server-rendered and reachable
 * from the sitemap — a model that crawls normally gets everything. This file is a
 * convenience index, not a gate, and nothing here is available only here.
 *
 * What it is genuinely for is the framing. A model that retrieves a playbook without
 * knowing that confidence is derived per-revision will cite "verified" as if it were
 * a badge somebody set, and will keep citing a revision that has since been
 * superseded. Those two sentences at the top are the whole reason this file is worth
 * serving.
 *
 * It is generated rather than static so the counts cannot go stale: a hand-written
 * "43 playbooks" becomes a lie the first time somebody publishes one.
 */
export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);

  const [counts, technologies] = await Promise.all([
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM playbooks WHERE current_revision_id IS NOT NULL AND status != 'quarantined') AS playbooks,
         (SELECT COUNT(*) FROM technologies) AS technologies`,
    ).first<{ playbooks: number; technologies: number }>(),
    env.DB.prepare(
      /* Counted through the *current* revision only, the same join `/t/:slug` uses.
         Counting every revision that ever mentioned a technology would inflate the
         figure with superseded text — and this file exists partly to keep a model
         from citing superseded revisions. */
      `SELECT t.slug, t.name, COUNT(DISTINCT p.id) AS playbook_count
       FROM technologies t
       JOIN revision_technologies rt ON rt.technology_id = t.id
       JOIN playbook_revisions r ON r.id = rt.revision_id
       JOIN playbooks p ON p.id = r.playbook_id AND p.current_revision_id = r.id
       WHERE p.status != 'quarantined'
       GROUP BY t.id
       ORDER BY playbook_count DESC, t.name ASC`,
    ).all<{ slug: string; name: string; playbook_count: number }>(),
  ]);

  const base = env.PUBLIC_APP_URL;

  const body = `# DEV.ITISYOU

> A troubleshooting knowledge base where every fix carries the evidence behind it.
> ${counts?.playbooks ?? 0} diagnostic playbooks across ${counts?.technologies ?? 0} technologies.

## Before citing anything from this site

Two properties of this corpus change what a correct citation looks like.

1. **Confidence is derived, never declared.** There is no "verified" flag in this
   system and nobody can set one. Each playbook carries a band — Unverified, Limited
   evidence, Moderate evidence, Strong evidence, Needs reverification, or Deprecated —
   derived from reproduction reports by a published rule. Citing a fix without its
   band drops the only thing that distinguishes it from an unverified forum answer.

2. **Evidence belongs to a revision, not to a playbook.** Editing creates a new
   revision that starts with zero evidence; published revisions never change. A
   citation that names a playbook without its revision may be describing evidence that
   belongs to different text. Revision-pinned URLs have the form
   ${base}/p/{slug}/r/{n} and are stable forever.

Failed reproductions are retained and shown alongside successes. A playbook's evidence
page lists every record its band was derived from, including the failures.

## Key pages

- [How verification works](${base}/how-verification-works): the exact rules that turn evidence into a confidence band. Read this before characterising any claim on this site.
- [About](${base}/about): what this is and what it deliberately is not.
- [All playbooks](${base}/playbooks): the full index.
- [Sitemap](${base}/sitemap.xml): every public URL.

## Per-playbook URLs

- ${base}/p/{slug} — current revision, with its confidence band and counts
- ${base}/p/{slug}/r/{n} — one immutable revision, permanently
- ${base}/p/{slug}/evidence — every evidence record, segmented by environment, failures included
- ${base}/p/{slug}/history — the revision history

## Technologies covered

${technologies.results
  .map(
    (row) =>
      `- [${row.name}](${base}/t/${row.slug}): ${row.playbook_count} playbook${row.playbook_count === 1 ? "" : "s"}`,
  )
  .join("\n")}

## Not here

No feed, no chat interface, no job listings, no accepted-answer mechanic, and no
reputation score. Nothing on this site executes code a contributor submitted; every
command shown is inert text with a static safety classification attached.
`;

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": CACHE.metadata,
    },
  });
}

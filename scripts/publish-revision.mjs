#!/usr/bin/env node
/**
 * Publish a new revision of an existing playbook.
 *
 * This script exists for one reason: **the multi-revision path is the mechanism the
 * whole evidence model rests on, and until a real superseded revision exists in a
 * real database, none of it has been exercised.** A corpus where every playbook is at
 * revision 1 cannot demonstrate the one property this product is built on — that
 * editing a playbook does not carry its credibility forward.
 *
 * What it does is exactly what a contributor's publish does, from the curation
 * account:
 *
 *   1. Create revision N+1 as a **draft**, pointing at the current revision through
 *      `supersedes_revision_id`.
 *   2. Insert its nodes and edges while it is still a draft — the triggers freeze a
 *      revision's graph at publication, so this ordering is not a style choice.
 *   3. Publish it, mark the previous revision `superseded`, and repoint
 *      `playbooks.current_revision_id`.
 *   4. Give the new revision a `revision_confidence` row at **`unverified` with
 *      zeroes**, and exactly one `contributor_documentation` evidence record.
 *
 * Step 4 is the point. The new revision does **not** inherit a single reproduction
 * from the old one, and there is no code path here that could make it — the evidence
 * table has no column pointing at a playbook, only at a revision. The old revision
 * keeps its evidence and stays readable at its stable URL forever, because the
 * evidence trail that justified the change is the thing a sceptical reader needs
 * most.
 *
 *   node scripts/publish-revision.mjs --env staging --remote --file packages/config/corpus/revisions/<name>.json
 *   node scripts/publish-revision.mjs --env staging --remote --file <path> --dry-run
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const WRANGLER_BIN = join(
  createRequire(import.meta.url).resolve("wrangler/package.json", {
    paths: [join(process.cwd(), "apps", "app")],
  }),
  "..",
  "bin",
  "wrangler.js",
);

const args = process.argv.slice(2);
const env = valueOf("--env");
const file = valueOf("--file");
const local = args.includes("--local");
const remote = args.includes("--remote");
const dryRun = args.includes("--dry-run");

if (!env || !["staging", "production"].includes(env)) fail("--env must be 'staging' or 'production'.");
if (local === remote) fail("Pass exactly one of --local or --remote.");
if (!file) fail("--file is required and must point at a revision JSON file.");

const database = env === "production" ? "devyou-db-production" : "devyou-db-staging";

const SEED_AUTHOR_ID = "usr_devyou_curation";
const NOW = Math.floor(Date.now() / 1000);

const spec = JSON.parse(readFileSync(file, "utf8"));
for (const field of ["slug", "changeSummary", "title", "summary", "nodes", "edges"]) {
  if (spec[field] === undefined) fail(`Revision file is missing required field "${field}".`);
}

/*
  Read the current state rather than assuming it.

  A revision number computed from a stale assumption collides with the unique index
  on (playbook_id, revision_number), and the failure would arrive halfway through a
  batch with some statements already applied.
*/
const current = rows(
  `SELECT p.id AS playbook_id, r.id AS revision_id, r.revision_number
   FROM playbooks p
   JOIN playbook_revisions r ON r.id = p.current_revision_id
   WHERE p.slug = ${q(spec.slug)};`,
).at(0);

if (!current) fail(`No published playbook with slug "${spec.slug}" in ${database}.`);

const nextNumber = Number(current.revision_number) + 1;
const key = `${spec.slug.replace(/-/g, "_")}_${nextNumber}`;
const revisionId = `rev_${spec.slug.replace(/-/g, "_")}_${nextNumber}`;

const existing = rows(
  `SELECT id FROM playbook_revisions WHERE id = ${q(revisionId)};`,
).at(0);
if (existing) {
  console.log(
    `\n${spec.slug} is already at revision ${nextNumber} in ${database}. Nothing to do.\n` +
      "Published revisions are immutable — to change this one, publish another.\n",
  );
  process.exit(0);
}

const statements = [];

statements.push(
  `INSERT INTO playbook_revisions
     (id, playbook_id, revision_number, title, summary, change_summary, status,
      created_by, created_at, supersedes_revision_id)
   VALUES (${q(revisionId)}, ${q(current.playbook_id)}, ${nextNumber}, ${q(spec.title)},
           ${q(spec.summary)}, ${q(spec.changeSummary)}, 'draft', ${q(SEED_AUTHOR_ID)}, ${NOW},
           ${q(current.revision_id)});`,
);

for (const [index, node] of spec.nodes.entries()) {
  statements.push(
    `INSERT INTO diagnostic_nodes
       (id, revision_id, node_type, title, body, command_text, command_language,
        expected_output, safety_level, safety_effect, display_order)
     VALUES (${q(`nod_${key}_${node.id}`)}, ${q(revisionId)}, ${q(node.type)}, ${q(node.title)},
             ${q(node.body ?? "")}, ${q(node.command ?? null)}, ${q(node.commandLanguage ?? null)},
             ${q(node.expectedOutput ?? null)}, ${q(node.safetyLevel ?? "informational")},
             ${q(node.safetyEffect ?? null)}, ${index});`,
  );
}

for (const [index, edge] of spec.edges.entries()) {
  statements.push(
    `INSERT INTO diagnostic_edges
       (id, revision_id, from_node_id, to_node_id, condition_type, condition_label, priority)
     VALUES (${q(`edg_${key}_${index}`)}, ${q(revisionId)}, ${q(`nod_${key}_${edge.from}`)},
             ${q(`nod_${key}_${edge.to}`)}, ${q(edge.condition)}, ${q(edge.label ?? null)}, ${index});`,
  );
}

for (const [index, technologySlug] of (spec.technologies ?? []).entries()) {
  statements.push(
    `INSERT OR IGNORE INTO revision_technologies (revision_id, technology_id, is_primary)
     VALUES (${q(revisionId)}, ${q(`tec_${technologySlug.replace(/-/g, "_")}`)}, ${index === 0 ? 1 : 0});`,
  );
}

for (const [index, constraint] of (spec.constraints ?? []).entries()) {
  statements.push(
    `INSERT INTO revision_environment_constraints
       (id, revision_id, technology_id, min_semver, max_semver, max_inclusive, architecture, constraint_kind)
     VALUES (${q(`cst_${key}_${index}`)}, ${q(revisionId)},
             ${q(`tec_${constraint.technology.replace(/-/g, "_")}`)},
             ${q(constraint.minSemver ?? null)}, ${q(constraint.maxSemver ?? null)},
             ${constraint.maxInclusive ? 1 : 0}, ${q(constraint.architecture ?? null)},
             ${q(constraint.kind ?? "required")});`,
  );
}

for (const [index, source] of (spec.sources ?? []).entries()) {
  const sourceId = `src_${key}_${index}`;
  statements.push(
    `INSERT OR IGNORE INTO source_references (id, url, title, source_type, publisher, retrieved_at)
     VALUES (${q(sourceId)}, ${q(source.url)}, ${q(source.title)}, ${q(source.type)},
             ${q(source.publisher ?? null)}, ${NOW});`,
    `INSERT OR IGNORE INTO revision_source_references (revision_id, source_reference_id, node_id)
     VALUES (${q(revisionId)}, ${q(sourceId)}, NULL);`,
  );
}

statements.push(
  // Publish. After this statement the graph above is frozen by the triggers.
  `UPDATE playbook_revisions SET status = 'published', published_at = ${NOW}
   WHERE id = ${q(revisionId)} AND published_at IS NULL;`,
  /*
    The previous revision is marked superseded and is NOT deleted, NOT hidden, and
    NOT redirected. Plan §9 requires historical URLs to survive; a 404 here would
    destroy the evidence trail that justified publishing a replacement, which is
    exactly what a reader doubting the new revision would want to read.
  */
  `UPDATE playbook_revisions SET status = 'superseded', superseded_at = ${NOW}
   WHERE id = ${q(current.revision_id)};`,
  `UPDATE playbooks SET current_revision_id = ${q(revisionId)} WHERE id = ${q(current.playbook_id)};`,
  `INSERT INTO evidence_records (id, revision_id, evidence_type, result, actor_id, created_at)
   VALUES (${q(`evd_${key}_doc`)}, ${q(revisionId)}, 'contributor_documentation', 'passed',
           ${q(SEED_AUTHOR_ID)}, ${NOW});`,
  /*
    Zeroes, explicitly, rather than by omission.

    Anybody reading this script should be able to see that a new revision claims no
    reproduction it does not have — including a revision of a playbook that had
    accumulated plenty. Writing the zeroes out is how that stays visible to a
    reviewer who is skimming.
  */
  `INSERT INTO revision_confidence
     (revision_id, band, reproduced_passed, reproduced_partial, reproduced_failed,
      independent_confirmations, unique_environments, ci_executions,
      maintainer_attestations, official_references, computed_at)
   VALUES (${q(revisionId)}, 'unverified', 0, 0, 0, 0, 0, 0, 0,
           ${(spec.sources ?? []).length}, ${NOW});`,
);

/*
  Search follows the current revision only.

  The old revision's document is removed rather than kept alongside: a reader
  searching for an error wants the procedure that is current, and two revisions of
  the same playbook competing in the results would push a different playbook off the
  first page. The superseded revision stays reachable by URL and through history,
  which is where somebody looking for it actually goes.
*/
const errorText = [
  ...(spec.signatures ?? []).map((signature) => signature.normalisedMessage),
  ...(spec.signatures ?? []).map((signature) => signature.errorCode ?? ""),
  ...spec.nodes.map((node) => node.expectedOutput ?? ""),
]
  .filter(Boolean)
  .join("\n");

const nodeText = spec.nodes
  .flatMap((node) => [node.title, node.body ?? "", node.command ?? ""])
  .filter(Boolean)
  .join("\n");

statements.push(
  `DELETE FROM playbook_fts WHERE playbook_id = ${q(current.playbook_id)};`,
  `INSERT INTO playbook_fts (revision_id, playbook_id, title, summary, error_text, node_text, technology_text)
   VALUES (${q(revisionId)}, ${q(current.playbook_id)},
           ${q(`${spec.title} — ${spec.problemTitle ?? spec.title}`)},
           ${q([spec.summary, ...(spec.symptoms ?? [])].join("\n"))},
           ${q(errorText)}, ${q(nodeText)}, ${q((spec.technologies ?? []).join(" "))});`,
);

if (dryRun) {
  console.log(`\n--dry-run: ${statements.length} statements would be applied to ${database}.\n`);
  console.log(statements.join("\n\n"));
  process.exit(0);
}

console.log(
  `\nPublishing ${spec.slug} revision ${nextNumber} into ${database} ` +
    `(superseding revision ${current.revision_number})…\n`,
);

execute(statements.join("\n"));

const check = rows(
  `SELECT r.revision_number, r.status,
          (SELECT COUNT(*) FROM evidence_records e WHERE e.revision_id = r.id) AS evidence,
          (SELECT band FROM revision_confidence c WHERE c.revision_id = r.id) AS band
   FROM playbook_revisions r
   WHERE r.playbook_id = ${q(current.playbook_id)}
   ORDER BY r.revision_number;`,
);

console.log("\nRevisions now on record:\n");
for (const row of check) {
  console.log(
    `  r${row.revision_number}  ${String(row.status).padEnd(11)} ` +
      `band=${String(row.band ?? "—").padEnd(20)} evidence records=${row.evidence}`,
  );
}
console.log(
  "\nThe new revision carries no reproduction from the old one. That is the invariant,\n" +
    "and the numbers above are what it looks like.\n",
);

/* ------------------------------------------------------------------------- */

function q(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function wrangler(extra) {
  return execFileSync(
    process.execPath,
    [WRANGLER_BIN, "d1", "execute", database, local ? "--local" : "--remote", ...extra],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 },
  );
}

function execute(sql) {
  const path = join(mkdtempSync(join(tmpdir(), "devyou-revision-")), "revision.sql");
  writeFileSync(path, sql, "utf8");
  try {
    wrangler(["--file", path, "--yes"]);
  } catch (error) {
    fail(`${error.stdout ?? ""}${error.stderr ?? ""}`.slice(0, 2500));
  }
}

function rows(sql) {
  try {
    const out = wrangler(["--command", sql, "--json", "--yes"]);
    return JSON.parse(out.slice(out.indexOf("["))).at(0)?.results ?? [];
  } catch {
    return [];
  }
}

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1];
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

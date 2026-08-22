#!/usr/bin/env node
/**
 * Seed the playbook corpus.
 *
 * Reads every `*.json` under `packages/config/corpus/` and publishes each playbook
 * as revision 1, then builds its search documents and its confidence row.
 *
 * Two properties this script must have, and does:
 *
 * **It publishes honestly.** Every seeded revision gets exactly one evidence record:
 * `contributor_documentation`, result `passed`, meaning "the author wrote this down
 * and says they tested it". Nothing else. Plan §20 is explicit — *"Do not fabricate
 * community reproduction counts"* — so every seeded playbook starts at `unverified`
 * and stays there until a real person reproduces it. A corpus that launched showing
 * invented reproduction counts would poison the one number this product exists to
 * make trustworthy.
 *
 * **It respects the triggers.** Nodes and edges are inserted while the revision is
 * still a draft, and the revision is published afterwards. There is no way to add a
 * node to a published revision, including from here.
 *
 *   node scripts/seed-playbooks.mjs --env staging --remote
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

const CORPUS_DIR = "packages/config/corpus";
const args = process.argv.slice(2);
const env = valueOf("--env");
const local = args.includes("--local");
const remote = args.includes("--remote");

if (!env || !["staging", "production"].includes(env)) {
  fail("--env must be 'staging' or 'production'.");
}
if (local === remote) fail("Pass exactly one of --local or --remote.");

const database = env === "production" ? "devyou-db-production" : "devyou-db-staging";

/** The seed author. A real, named account rather than a synthetic "system" row: a
 *  playbook with no author is a playbook nobody is accountable for. */
const SEED_AUTHOR = {
  id: "usr_devyou_curation",
  handle: "devyou-curation",
  displayName: "DevYou curation",
  bio: "Seeded playbooks written and tested during launch preparation. Not independently reproduced.",
};

const PUBLISHED_AT = Math.floor(Date.parse("2026-08-22T00:00:00Z") / 1000);

const files = readdirSync(CORPUS_DIR).filter((name) => name.endsWith(".json"));
if (files.length === 0) fail(`No corpus files found in ${CORPUS_DIR}`);

const playbooks = files.flatMap((file) => {
  const parsed = JSON.parse(readFileSync(join(CORPUS_DIR, file), "utf8"));
  return parsed.playbooks ?? [];
});

/*
  Already-published playbooks are skipped, not re-inserted.

  `INSERT OR IGNORE` is not enough on a second run: the immutability trigger fires
  BEFORE INSERT and rejects a node aimed at a published revision regardless of
  whether the row would have been ignored as a duplicate. That is the trigger
  working exactly as intended — a published revision cannot gain a node — so this
  script is add-only rather than idempotent-by-overwrite. Changing a seeded playbook
  means publishing a new revision, the same as it does for any contributor.
*/
const alreadyPublished = new Set(
  rows(
    "SELECT p.slug FROM playbooks p JOIN playbook_revisions r ON r.id = p.current_revision_id" +
      " WHERE r.published_at IS NOT NULL;",
  ).map((row) => row.slug),
);

const pending = playbooks.filter((playbook) => !alreadyPublished.has(playbook.slug));

if (pending.length === 0) {
  console.log(
    `\nAll ${playbooks.length} playbooks are already published in ${database}. Nothing to do.\n` +
      "To change one, publish a new revision — published revisions are immutable.\n",
  );
  process.exit(0);
}

console.log(
  `\nSeeding ${pending.length} new playbook(s) into ${database}` +
    (alreadyPublished.size > 0 ? ` (${alreadyPublished.size} already published, skipped)` : "") +
    "…\n",
);

const statements = [
  `INSERT OR IGNORE INTO users (id, created_at, status, role)
   VALUES ('${SEED_AUTHOR.id}', ${PUBLISHED_AT}, 'active', 'contributor');`,
  `INSERT OR IGNORE INTO profiles (user_id, display_name, handle, bio, created_at)
   VALUES ('${SEED_AUTHOR.id}', ${q(SEED_AUTHOR.displayName)}, ${q(SEED_AUTHOR.handle)},
           ${q(SEED_AUTHOR.bio)}, ${PUBLISHED_AT});`,
];

let nodeCount = 0;
let edgeCount = 0;

for (const playbook of pending) {
  const key = playbook.slug.replace(/-/g, "_");
  const problemId = `prb_${key}`;
  const playbookId = `pbk_${key}`;
  const revisionId = `rev_${key}_1`;

  statements.push(
    `INSERT OR IGNORE INTO problems (id, slug, canonical_title, summary, status, created_by, created_at)
     VALUES ('${problemId}', ${q(playbook.slug)}, ${q(playbook.problemTitle)},
             ${q(playbook.problemSummary)}, 'active', '${SEED_AUTHOR.id}', ${PUBLISHED_AT});`,
  );

  for (const [index, symptom] of (playbook.symptoms ?? []).entries()) {
    statements.push(
      `INSERT OR IGNORE INTO symptoms (id, problem_id, description, display_order)
       VALUES ('sym_${key}_${index}', '${problemId}', ${q(symptom)}, ${index});`,
    );
  }

  for (const [index, signature] of (playbook.signatures ?? []).entries()) {
    statements.push(
      `INSERT OR IGNORE INTO problem_signatures
         (id, problem_id, error_code, normalized_message, signature_hash, language_hint, runtime_hint, created_at)
       VALUES ('sig_${key}_${index}', '${problemId}', ${q(signature.errorCode ?? null)},
               ${q(signature.normalisedMessage)}, ${q(signature.signatureHash ?? `seed_${key}_${index}`)},
               ${q(signature.languageHint ?? null)}, ${q(signature.runtimeHint ?? null)}, ${PUBLISHED_AT});`,
      `INSERT INTO signature_fts (signature_id, problem_id, error_code, normalized_message)
       VALUES ('sig_${key}_${index}', '${problemId}', ${q(signature.errorCode ?? "")},
               ${q(signature.normalisedMessage)});`,
    );
  }

  statements.push(
    `INSERT OR IGNORE INTO playbooks (id, problem_id, slug, status, visibility, created_by, created_at)
     VALUES ('${playbookId}', '${problemId}', ${q(playbook.slug)}, 'published', 'public',
             '${SEED_AUTHOR.id}', ${PUBLISHED_AT});`,
    /* Draft first. The triggers freeze a revision's graph at publication, so the
       nodes below could not be inserted if this said 'published'. */
    `INSERT OR IGNORE INTO playbook_revisions
       (id, playbook_id, revision_number, title, summary, change_summary, status, created_by, created_at)
     VALUES ('${revisionId}', '${playbookId}', 1, ${q(playbook.title)}, ${q(playbook.summary)},
             'Initial published revision.', 'draft', '${SEED_AUTHOR.id}', ${PUBLISHED_AT});`,
  );

  for (const [index, node] of playbook.nodes.entries()) {
    nodeCount += 1;
    statements.push(
      `INSERT OR IGNORE INTO diagnostic_nodes
         (id, revision_id, node_type, title, body, command_text, command_language,
          expected_output, safety_level, safety_effect, display_order)
       VALUES ('nod_${key}_${node.id}', '${revisionId}', ${q(node.type)}, ${q(node.title)},
               ${q(node.body ?? "")}, ${q(node.command ?? null)}, ${q(node.commandLanguage ?? null)},
               ${q(node.expectedOutput ?? null)}, ${q(node.safetyLevel ?? "informational")},
               ${q(node.safetyEffect ?? null)}, ${index});`,
    );
  }

  for (const [index, edge] of playbook.edges.entries()) {
    edgeCount += 1;
    statements.push(
      `INSERT OR IGNORE INTO diagnostic_edges
         (id, revision_id, from_node_id, to_node_id, condition_type, condition_label, priority)
       VALUES ('edg_${key}_${index}', '${revisionId}', 'nod_${key}_${edge.from}', 'nod_${key}_${edge.to}',
               ${q(edge.condition)}, ${q(edge.label ?? null)}, ${index});`,
    );
  }

  for (const technologySlug of playbook.technologies ?? []) {
    const technologyId = `tec_${technologySlug.replace(/-/g, "_")}`;
    statements.push(
      `INSERT OR IGNORE INTO revision_technologies (revision_id, technology_id, is_primary)
       VALUES ('${revisionId}', '${technologyId}',
               ${technologySlug === playbook.technologies[0] ? 1 : 0});`,
    );
  }

  for (const [index, constraint] of (playbook.constraints ?? []).entries()) {
    const technologyId = `tec_${constraint.technology.replace(/-/g, "_")}`;
    statements.push(
      `INSERT OR IGNORE INTO revision_environment_constraints
         (id, revision_id, technology_id, min_semver, max_semver, max_inclusive, architecture, constraint_kind)
       VALUES ('cst_${key}_${index}', '${revisionId}', '${technologyId}',
               ${q(constraint.minSemver ?? null)}, ${q(constraint.maxSemver ?? null)},
               ${constraint.maxInclusive ? 1 : 0}, ${q(constraint.architecture ?? null)},
               ${q(constraint.kind ?? "required")});`,
    );
  }

  for (const [index, source] of (playbook.sources ?? []).entries()) {
    const sourceId = `src_${key}_${index}`;
    statements.push(
      `INSERT OR IGNORE INTO source_references (id, url, title, source_type, publisher, retrieved_at)
       VALUES ('${sourceId}', ${q(source.url)}, ${q(source.title)}, ${q(source.type)},
               ${q(source.publisher ?? null)}, ${PUBLISHED_AT});`,
      `INSERT OR IGNORE INTO revision_source_references (revision_id, source_reference_id, node_id)
       VALUES ('${revisionId}', '${sourceId}', NULL);`,
    );
  }

    /*
      An `official_reference` evidence record per cited source.

      The confidence row's `official_references` count used to be written straight
      from the number of source links, with no evidence record behind it. That is the
      exact failure this product exists to prevent — a number asserted rather than
      derived. It was not merely cosmetic: `deriveConfidenceBand` reads
      `officialReferences` on the path that promotes a revision to `moderate_evidence`,
      and `recomputeConfidence` would have silently reset the count to zero on the
      first real reproduction, so the figure was both unbacked and unstable.

      Each record is a true claim: this revision cites this piece of official
      documentation. It supports the cause the playbook names, never the procedure —
      `explainConfidence` says so in those words, and the band thresholds keep it away
      from anything reproduction-shaped.
    */
  for (const [index, _source] of (playbook.sources ?? []).entries()) {
    statements.push(
      `INSERT OR IGNORE INTO evidence_records
         (id, revision_id, evidence_type, result, actor_id, source_reference_id, created_at)
       VALUES ('evd_${key}_ref${index}', '${revisionId}', 'official_reference', 'passed',
               '${SEED_AUTHOR.id}', 'src_${key}_${index}', ${PUBLISHED_AT});`,
    );
  }

  // Publish, then record the author's own documentation as the only evidence.
  statements.push(
    `UPDATE playbook_revisions SET status = 'published', published_at = ${PUBLISHED_AT}
     WHERE id = '${revisionId}' AND published_at IS NULL;`,
    `UPDATE playbooks SET current_revision_id = '${revisionId}' WHERE id = '${playbookId}';`,
    `INSERT OR IGNORE INTO evidence_records
       (id, revision_id, evidence_type, result, actor_id, created_at)
     VALUES ('evd_${key}_doc', '${revisionId}', 'contributor_documentation', 'passed',
             '${SEED_AUTHOR.id}', ${PUBLISHED_AT});`,
    /*
      The confidence row says `unverified`, with zeroes.

      This is the honest starting state and it is stated explicitly rather than left
      to a default, so that anybody reading this script can see that no seeded
      playbook claims a reproduction it does not have.
    */
    `INSERT OR IGNORE INTO revision_confidence
       (revision_id, band, reproduced_passed, reproduced_partial, reproduced_failed,
        independent_confirmations, unique_environments, ci_executions,
        maintainer_attestations, official_references, computed_at)
     VALUES ('${revisionId}', 'unverified', 0, 0, 0, 0, 0, 0, 0,
             ${(playbook.sources ?? []).length}, ${PUBLISHED_AT});`,
  );

  // Search document.
  const errorText = [
    ...(playbook.signatures ?? []).map((signature) => signature.normalisedMessage),
    ...(playbook.signatures ?? []).map((signature) => signature.errorCode ?? ""),
    ...playbook.nodes.map((node) => node.expectedOutput ?? ""),
  ]
    .filter(Boolean)
    .join("\n");

  const nodeText = playbook.nodes
    .flatMap((node) => [node.title, node.body ?? "", node.command ?? ""])
    .filter(Boolean)
    .join("\n");

  const technologyText = (playbook.technologies ?? []).join(" ");

  statements.push(
    `DELETE FROM playbook_fts WHERE revision_id = '${revisionId}';`,
    `INSERT INTO playbook_fts (revision_id, playbook_id, title, summary, error_text, node_text, technology_text)
     VALUES ('${revisionId}', '${playbookId}',
             ${q(`${playbook.title} — ${playbook.problemTitle}`)},
             ${q([playbook.summary, playbook.problemSummary, ...(playbook.symptoms ?? [])].join("\n"))},
             ${q(errorText)}, ${q(nodeText)}, ${q(technologyText)});`,
  );
}

/* Batched rather than one call per playbook: process start dominates everything
   else, and 40 playbooks is 40 × 5 seconds if each gets its own invocation. */
const BATCH = 120;
for (let index = 0; index < statements.length; index += BATCH) {
  execute(statements.slice(index, index + BATCH).join("\n"));
  process.stdout.write(".");
}

const counts = rows(
  `SELECT (SELECT count(*) FROM playbooks WHERE status = 'published') AS playbooks,
          (SELECT count(*) FROM playbook_revisions WHERE published_at IS NOT NULL) AS revisions,
          (SELECT count(*) FROM diagnostic_nodes) AS nodes,
          (SELECT count(*) FROM diagnostic_edges) AS edges,
          (SELECT count(*) FROM playbook_fts) AS documents;`,
).at(0);

console.log(
  `\n\nSeeded. ${counts?.playbooks ?? "?"} published playbooks, ` +
    `${counts?.nodes ?? nodeCount} nodes, ${counts?.edges ?? edgeCount} edges, ` +
    `${counts?.documents ?? "?"} search documents.\n` +
    `Every one starts at "unverified" with zero reproductions, which is the truth.\n`,
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
  const path = join(mkdtempSync(join(tmpdir(), "devyou-corpus-")), "seed.sql");
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
  return index === -1 ? undefined : args[index + 1];
}

function fail(message) {
  console.error(`\n  ERROR  ${message}\n`);
  process.exit(1);
}

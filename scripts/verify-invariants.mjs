#!/usr/bin/env node
/**
 * Prove the database enforces the invariants — against the real database.
 *
 * Unit tests prove the domain layer refuses these operations. That is necessary and
 * not sufficient: the whole point of the triggers is to stop things that never go
 * through the domain layer at all — an admin console query, a migration script, a
 * future refactor that reaches for `db.update()` directly.
 *
 * So this script talks straight to D1 over wrangler, with no application code in
 * the path, and asserts that each forbidden statement is rejected by SQLite itself.
 *
 * It is destructive to its own fixtures only: every row it creates is prefixed
 * `zz_verify_`, and it removes them at the end. It **refuses to run against
 * production** — the fixtures publish a revision, and a published revision cannot be
 * deleted by design, so a run against production would leave permanent rubbish in
 * the corpus.
 *
 *   node scripts/verify-invariants.mjs --env staging --remote
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
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
const local = args.includes("--local");

if (env !== "staging") {
  console.error(
    "\n  REFUSED  This script only runs against staging. It publishes a revision, and a\n" +
      "           published revision cannot be deleted — that is the invariant it tests.\n",
  );
  process.exit(1);
}

const database = "devyou-db-staging";
const P = "zz_verify_";

const results = [];

console.log(`\nInvariant verification → ${database}\n`);

cleanup();
seed();

/* ------------------------------------------------------------------------- */

check(
  "A published revision's title cannot be changed",
  `UPDATE playbook_revisions SET title = 'rewritten' WHERE id = '${P}rev1';`,
  "immutable",
);

check(
  "A published revision cannot be unpublished",
  `UPDATE playbook_revisions SET published_at = NULL WHERE id = '${P}rev1';`,
  "cannot be unpublished",
);

check(
  "A published revision cannot be deleted",
  `DELETE FROM playbook_revisions WHERE id = '${P}rev1';`,
  "never deleted",
);

check(
  "A node cannot be added to a published revision",
  `INSERT INTO diagnostic_nodes (id, revision_id, node_type, title, body, safety_level, display_order)
   VALUES ('${P}nodeX', '${P}rev1', 'test', 'sneaked in', '', 'informational', 9);`,
  "cannot add a node",
);

check(
  "A node in a published revision cannot be edited",
  `UPDATE diagnostic_nodes SET title = 'rewritten' WHERE id = '${P}node1';`,
  "published revision",
);

check(
  "A node cannot be removed from a published revision",
  `DELETE FROM diagnostic_nodes WHERE id = '${P}node1';`,
  "cannot remove a node",
);

/*
  Tested against the DRAFT revision, not a published one.

  The first version of this check targeted revision 2, which is published — so it
  was rejected by `trg_edges_no_insert_after_publish` before the cross-revision
  trigger was ever consulted. It passed for the wrong reason, which is the failure
  mode a verification script exists to avoid. Revision 3 is a draft, so the only
  thing that can reject this edge is the rule under test.
*/
check(
  "An edge cannot join two different revisions",
  `INSERT INTO diagnostic_edges (id, revision_id, from_node_id, to_node_id, condition_type, priority)
   VALUES ('${P}edgeX', '${P}rev3draft', '${P}node1', '${P}node2', 'passed', 0);`,
  "belong to this revision",
);

/* And the positive control for the same trigger: an edge wholly inside one draft
   revision must still be accepted, or the rule is just an outage. */
expectAllowed(
  "An edge within a single draft revision is allowed",
  `INSERT INTO diagnostic_nodes (id, revision_id, node_type, title, body, safety_level, display_order)
     VALUES ('${P}node1c', '${P}rev3draft', 'start', 'Start', '', 'informational', 0),
            ('${P}node2c', '${P}rev3draft', 'root_cause', 'Cause', '', 'informational', 1);
   INSERT INTO diagnostic_edges (id, revision_id, from_node_id, to_node_id, condition_type, priority)
     VALUES ('${P}edgeOk', '${P}rev3draft', '${P}node1c', '${P}node2c', 'passed', 0);`,
);

check(
  "An evidence record cannot be edited",
  `UPDATE evidence_records SET result = 'passed' WHERE id = '${P}ev1';`,
  "append-only",
);

check(
  "An evidence record cannot be deleted",
  `DELETE FROM evidence_records WHERE id = '${P}ev1';`,
  "append-only",
);

check(
  "A failed reproduction cannot be deleted",
  `DELETE FROM reproduction_reports WHERE id = '${P}rep1';`,
  "append-only",
);

check(
  "A reproduction report cannot be rewritten",
  `UPDATE reproduction_reports SET outcome = 'worked' WHERE id = '${P}rep1';`,
  "append-only",
);

check(
  "An audit event cannot be deleted",
  `DELETE FROM admin_audit_events WHERE id = '${P}aud1';`,
  "append-only",
);

check(
  "Evidence cannot attach to an unpublished revision",
  `INSERT INTO evidence_records (id, revision_id, evidence_type, result, created_at)
   VALUES ('${P}evX', '${P}rev3draft', 'reproduction', 'passed', 1);`,
  "published revision",
);

/* --- the positive controls: the things that MUST still work -------------- */

expectAllowed(
  "Lifecycle state can still move on a published revision",
  `UPDATE playbook_revisions SET status = 'needs_reverification', needs_reverification_at = 1
   WHERE id = '${P}rev1';`,
);

expectAllowed(
  "Evidence can be suppressed without being deleted",
  `UPDATE evidence_records SET suppressed_at = 1, suppression_reason = 'test'
   WHERE id = '${P}ev1';`,
);

/* --- the headline invariant: evidence does not follow an edit ------------ */

const boundToOld = rows(
  `SELECT revision_id FROM evidence_records WHERE id = '${P}ev1';`,
).at(0)?.revision_id;

record(
  "Evidence stays bound to the revision it validated, after a newer one is published",
  boundToOld === `${P}rev1`,
  boundToOld === `${P}rev1`
    ? `still points at ${P}rev1`
    : `expected ${P}rev1, found ${String(boundToOld)}`,
);

const carried = rows(
  `SELECT count(*) AS n FROM evidence_records WHERE revision_id = '${P}rev2';`,
).at(0)?.n;

record(
  "The newer revision inherited no evidence at all",
  Number(carried) === 0,
  `revision 2 has ${String(carried)} evidence record(s)`,
);

const failedStillThere = rows(
  `SELECT count(*) AS n FROM reproduction_reports WHERE revision_id = '${P}rev1' AND outcome = 'failed';`,
).at(0)?.n;

record(
  "A failed reproduction is still queryable",
  Number(failedStillThere) === 1,
  `${String(failedStillThere)} failed report(s) retained`,
);

/* ------------------------------------------------------------------------- */

cleanup();

const failures = results.filter((result) => !result.ok);

console.log("");
for (const result of results) {
  console.log(`  ${result.ok ? "PASS" : "FAIL"}  ${result.name}`);
  if (!result.ok) console.log(`        ${result.detail}`);
}
console.log(
  `\n${results.length - failures.length}/${results.length} invariants hold.\n`,
);
process.exit(failures.length === 0 ? 0 : 1);

/* ------------------------------------------------------------------------- */

function seed() {
  execute(`
    INSERT INTO users (id, created_at, status, role) VALUES ('${P}user', 1, 'active', 'contributor');
    INSERT INTO technologies (id, slug, name, type, status, created_at)
      VALUES ('${P}tech', '${P}tech', 'Verify Tech', 'runtime', 'active', 1);
    INSERT INTO problems (id, slug, canonical_title, summary, status, created_by, created_at)
      VALUES ('${P}prob', '${P}prob', 'Verification fixture', 'fixture', 'active', '${P}user', 1);
    INSERT INTO playbooks (id, problem_id, slug, status, visibility, created_by, created_at)
      VALUES ('${P}pb', '${P}prob', '${P}pb', 'published', 'public', '${P}user', 1);

    -- Revision 1: nodes and edges inserted while it is still a draft, then published.
    INSERT INTO playbook_revisions (id, playbook_id, revision_number, title, summary, status, created_by, created_at)
      VALUES ('${P}rev1', '${P}pb', 1, 'Revision one', 'first', 'draft', '${P}user', 1);
    INSERT INTO diagnostic_nodes (id, revision_id, node_type, title, body, safety_level, display_order)
      VALUES ('${P}node1', '${P}rev1', 'start', 'Start', '', 'informational', 0),
             ('${P}node2', '${P}rev1', 'root_cause', 'Cause', '', 'informational', 1);
    INSERT INTO diagnostic_edges (id, revision_id, from_node_id, to_node_id, condition_type, priority)
      VALUES ('${P}edge1', '${P}rev1', '${P}node1', '${P}node2', 'passed', 0);
    UPDATE playbook_revisions SET published_at = 1, status = 'published' WHERE id = '${P}rev1';
    UPDATE playbooks SET current_revision_id = '${P}rev1' WHERE id = '${P}pb';

    -- Revision 2: the edit. A separate immutable snapshot, with its own graph.
    INSERT INTO playbook_revisions (id, playbook_id, revision_number, title, summary, status, created_by, created_at, supersedes_revision_id)
      VALUES ('${P}rev2', '${P}pb', 2, 'Revision two', 'edited', 'draft', '${P}user', 2, '${P}rev1');
    INSERT INTO diagnostic_nodes (id, revision_id, node_type, title, body, safety_level, display_order)
      VALUES ('${P}node1b', '${P}rev2', 'start', 'Start', '', 'informational', 0),
             ('${P}node2b', '${P}rev2', 'root_cause', 'Cause', '', 'informational', 1);
    UPDATE playbook_revisions SET published_at = 2, status = 'published' WHERE id = '${P}rev2';

    -- Revision 3 stays a draft, for the "evidence needs a published revision" check.
    INSERT INTO playbook_revisions (id, playbook_id, revision_number, title, summary, status, created_by, created_at)
      VALUES ('${P}rev3draft', '${P}pb', 3, 'Draft', 'draft', 'draft', '${P}user', 3);

    INSERT INTO environment_snapshots (id, created_at, label, os_family, fingerprint)
      VALUES ('${P}env', 1, 'Verify Linux', 'linux', '${P}fp');

    -- Evidence against revision 1, including a failure that must survive.
    INSERT INTO evidence_records (id, revision_id, evidence_type, result, actor_id, environment_snapshot_id, created_at)
      VALUES ('${P}ev1', '${P}rev1', 'reproduction', 'failed', '${P}user', '${P}env', 1);
    INSERT INTO reproduction_reports (id, revision_id, actor_id, environment_snapshot_id, outcome, evidence_record_id, created_at)
      VALUES ('${P}rep1', '${P}rev1', '${P}user', '${P}env', 'failed', '${P}ev1', 1);

    INSERT INTO admin_audit_events (id, actor_id, capability, subject_type, subject_id, reason_code, created_at)
      VALUES ('${P}aud1', '${P}user', 'playbooks:quarantine', 'playbook', '${P}pb', 'fixture', 1);
  `);
}

/**
 * Remove the fixtures.
 *
 * The append-only triggers apply to the fixtures too, so they cannot simply be
 * deleted — which is itself a small proof that the triggers are real. Enforcement
 * is turned off for the teardown only, in a database whose whole purpose is being
 * thrown away.
 */
function cleanup() {
  execute(`
    PRAGMA foreign_keys = OFF;
    DROP TRIGGER IF EXISTS trg_evidence_append_only_delete;
    DROP TRIGGER IF EXISTS trg_reproduction_append_only_delete;
    DROP TRIGGER IF EXISTS trg_audit_append_only_delete;
    DROP TRIGGER IF EXISTS trg_revision_no_delete_published;
    DROP TRIGGER IF EXISTS trg_nodes_no_delete_after_publish;

    DELETE FROM reproduction_reports WHERE id LIKE '${P}%';
    DELETE FROM evidence_records WHERE id LIKE '${P}%';
    DELETE FROM admin_audit_events WHERE id LIKE '${P}%';
    DELETE FROM environment_snapshots WHERE id LIKE '${P}%';
    DELETE FROM diagnostic_edges WHERE id LIKE '${P}%';
    DELETE FROM diagnostic_nodes WHERE id LIKE '${P}%';
    DELETE FROM playbook_revisions WHERE id LIKE '${P}%';
    DELETE FROM playbooks WHERE id LIKE '${P}%';
    DELETE FROM problems WHERE id LIKE '${P}%';
    DELETE FROM technologies WHERE id LIKE '${P}%';
    DELETE FROM users WHERE id LIKE '${P}%';
  `);
  restoreTriggers();
}

/** Recreate exactly the triggers the teardown had to drop. */
function restoreTriggers() {
  execute(`
    CREATE TRIGGER IF NOT EXISTS trg_evidence_append_only_delete
    BEFORE DELETE ON evidence_records FOR EACH ROW
    BEGIN
      SELECT RAISE(ABORT, 'evidence_records is append-only — evidence is never deleted, including failures');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_reproduction_append_only_delete
    BEFORE DELETE ON reproduction_reports FOR EACH ROW
    BEGIN
      SELECT RAISE(ABORT, 'reproduction_reports is append-only — a failed reproduction is evidence');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_audit_append_only_delete
    BEFORE DELETE ON admin_audit_events FOR EACH ROW
    BEGIN
      SELECT RAISE(ABORT, 'admin_audit_events is append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_revision_no_delete_published
    BEFORE DELETE ON playbook_revisions FOR EACH ROW
    WHEN OLD.published_at IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'playbook_revisions: published revisions are never deleted — evidence points at them');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_nodes_no_delete_after_publish
    BEFORE DELETE ON diagnostic_nodes FOR EACH ROW
    WHEN (SELECT published_at FROM playbook_revisions WHERE id = OLD.revision_id) IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'diagnostic_nodes: cannot remove a node from a published revision');
    END;
  `);
}

/** A statement that must be rejected, with the message that must appear. */
function check(name, sql, expectedFragment) {
  try {
    execute(sql, { quiet: true });
    record(name, false, "the statement was ACCEPTED — the invariant is not enforced");
  } catch (error) {
    const message = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    const matched = message.toLowerCase().includes(expectedFragment.toLowerCase());
    record(
      name,
      matched,
      matched ? "rejected by the database" : `rejected, but not for the expected reason: ${firstError(message)}`,
    );
  }
}

/** A statement that must still be allowed. A guard that blocks everything is not a
 *  guard, it is an outage. */
function expectAllowed(name, sql) {
  try {
    execute(sql, { quiet: true });
    record(name, true, "allowed, as it should be");
  } catch (error) {
    record(name, false, `wrongly rejected: ${firstError(`${error.stdout ?? ""}${error.stderr ?? ""}`)}`);
  }
}

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  process.stdout.write(ok ? "." : "x");
}

/** The message out of a wrangler failure, with its colour codes removed. */
function firstError(text) {
  /*
    The escape byte is constructed rather than written as a literal.

    A raw ESC inside a regex literal trips `no-control-regex`, and the honest reading
    of that rule is that a control character in a pattern is usually a mistake. Here
    it is the point — these are ANSI colour codes — so building it from its code
    point says so more clearly than a disable comment would.

    Stripping has to happen before matching: wrangler puts the colour codes between
    the "[ERROR]" marker and the message, so a pattern applied to the raw text finds
    the marker and then captures nothing. That is how a genuinely failing check once
    reported "rejected, but not for the expected reason:" with an empty reason.
  */
  const esc = String.fromCharCode(27);
  const plain = text.replace(new RegExp(esc + "\\[[0-9;]*m", "g"), "");
  const match = plain.match(/\[ERROR\]\s*(.+)/);
  return (match?.[1] ?? plain).trim().slice(0, 200);
}

function wrangler(extra) {
  return execFileSync(
    process.execPath,
    [WRANGLER_BIN, "d1", "execute", database, local ? "--local" : "--remote", ...extra],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 },
  );
}

function execute(sql, options = {}) {
  const path = join(mkdtempSync(join(tmpdir(), "devyou-verify-")), "s.sql");
  writeFileSync(path, sql, "utf8");
  try {
    return wrangler(["--file", path, "--yes"]);
  } catch (error) {
    if (!options.quiet) {
      console.error(`\nsetup failed:\n${firstError(`${error.stdout ?? ""}${error.stderr ?? ""}`)}\n`);
    }
    throw error;
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

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * The invariants, tested inside workerd against the real migrations.
 *
 * There is a script — `scripts/verify-invariants.mjs` — that asserts the same rules
 * against the deployed staging database. This file is not a duplicate of it: the
 * script proves the rules hold on the deployed database *today*, and this proves
 * they hold on every branch *before* it merges. Neither one replaces the other, and
 * a migration that quietly dropped a trigger would be caught here first.
 *
 * These write raw SQL rather than going through the ORM, deliberately. The whole
 * value of a database-level guard is that it survives code that does not know about
 * it, so a test that used the domain layer would be testing the wrong thing.
 */

async function exec(sql: string, ...bindings: unknown[]): Promise<void> {
  await env.DB.prepare(sql)
    .bind(...(bindings as never[]))
    .run();
}

async function expectRejected(sql: string, ...bindings: unknown[]): Promise<string> {
  try {
    await exec(sql, ...bindings);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`Expected the database to reject this, and it did not:\n${sql}`);
}

/**
 * Fresh identifiers per test.
 *
 * Storage is shared across the tests in this file, so a fixed set of fixture ids
 * collides on the second `beforeEach` with a primary-key violation. A counter is
 * simpler than tearing the fixtures down — and tearing them down would have to
 * disable the very triggers under test, which is exactly the sort of convenience
 * that ends up disabled in the real code too.
 */
let fixtureCounter = 0;

interface Fixture {
  user: string;
  problem: string;
  playbook: string;
  rev1: string;
  rev2: string;
  draft: string;
  node1: string;
  node2: string;
  env: string;
  evidence: string;
  report: string;
}

function nextFixture(): Fixture {
  const n = (fixtureCounter += 1);
  return {
    user: `t${n}_user`,
    problem: `t${n}_prob`,
    playbook: `t${n}_pb`,
    rev1: `t${n}_rev1`,
    rev2: `t${n}_rev2`,
    draft: `t${n}_draft`,
    node1: `t${n}_n1`,
    node2: `t${n}_n2`,
    env: `t${n}_env`,
    evidence: `t${n}_ev`,
    report: `t${n}_rep`,
  };
}

let IDS: Fixture;

beforeEach(async () => {
  IDS = nextFixture();

  await exec("INSERT INTO users (id, created_at, status, role) VALUES (?, 1, 'active', 'contributor')", IDS.user);
  await exec(
    "INSERT INTO problems (id, slug, canonical_title, summary, status, created_by, created_at) VALUES (?, ?, 'T', 'T', 'active', ?, 1)",
    IDS.problem,
    IDS.problem,
    IDS.user,
  );
  await exec(
    "INSERT INTO playbooks (id, problem_id, slug, status, visibility, created_by, created_at) VALUES (?, ?, ?, 'published', 'public', ?, 1)",
    IDS.playbook,
    IDS.problem,
    IDS.playbook,
    IDS.user,
  );

  // Revision 1 — built as a draft, then published. That order matters: the triggers
  // freeze the graph at publication, so a fixture that published first could not
  // add its own nodes.
  await exec(
    "INSERT INTO playbook_revisions (id, playbook_id, revision_number, title, summary, status, created_by, created_at) VALUES (?, ?, 1, 'One', 'first', 'draft', ?, 1)",
    IDS.rev1,
    IDS.playbook,
    IDS.user,
  );
  await exec(
    "INSERT INTO diagnostic_nodes (id, revision_id, node_type, title, body, safety_level, display_order) VALUES (?, ?, 'start', 'Start', '', 'informational', 0)",
    IDS.node1,
    IDS.rev1,
  );
  await exec(
    "INSERT INTO diagnostic_nodes (id, revision_id, node_type, title, body, safety_level, display_order) VALUES (?, ?, 'root_cause', 'Cause', '', 'informational', 1)",
    IDS.node2,
    IDS.rev1,
  );
  await exec(
    "UPDATE playbook_revisions SET published_at = 1, status = 'published' WHERE id = ?",
    IDS.rev1,
  );

  await exec(
    "INSERT INTO environment_snapshots (id, created_at, label, os_family, fingerprint) VALUES (?, 1, 'Linux', 'linux', 'fp1')",
    IDS.env,
  );
  await exec(
    "INSERT INTO evidence_records (id, revision_id, evidence_type, result, actor_id, environment_snapshot_id, created_at) VALUES (?, ?, 'reproduction', 'failed', ?, ?, 1)",
    IDS.evidence,
    IDS.rev1,
    IDS.user,
    IDS.env,
  );
  await exec(
    "INSERT INTO reproduction_reports (id, revision_id, actor_id, environment_snapshot_id, outcome, evidence_record_id, created_at) VALUES (?, ?, ?, ?, 'failed', ?, 1)",
    IDS.report,
    IDS.rev1,
    IDS.user,
    IDS.env,
    IDS.evidence,
  );
});

describe("a published revision is immutable", () => {
  it("refuses a change to its title", async () => {
    const message = await expectRejected(
      "UPDATE playbook_revisions SET title = 'rewritten' WHERE id = ?",
      IDS.rev1,
    );
    expect(message).toMatch(/immutable/i);
  });

  it("refuses to be unpublished", async () => {
    await expectRejected("UPDATE playbook_revisions SET published_at = NULL WHERE id = ?", IDS.rev1);
  });

  it("refuses deletion", async () => {
    await expectRejected("DELETE FROM playbook_revisions WHERE id = ?", IDS.rev1);
  });

  it("refuses a new node", async () => {
    await expectRejected(
      "INSERT INTO diagnostic_nodes (id, revision_id, node_type, title, body, safety_level, display_order) VALUES (?, ?, 'test', 'X', '', 'informational', 9)",
      `${IDS.rev1}_sneak`,
      IDS.rev1,
    );
  });

  it("still allows lifecycle state to move", async () => {
    /*
      The positive control. A guard that blocks everything is not a guard, it is an
      outage — a revision that could never be marked deprecated would be worse than
      a mutable one.
    */
    await exec(
      "UPDATE playbook_revisions SET status = 'needs_reverification', needs_reverification_at = 2 WHERE id = ?",
      IDS.rev1,
    );
    const row = await env.DB.prepare("SELECT status FROM playbook_revisions WHERE id = ?")
      .bind(IDS.rev1)
      .first<{ status: string }>();
    expect(row?.status).toBe("needs_reverification");
  });
});

describe("evidence is append-only and revision-bound", () => {
  it("refuses to edit an evidence record", async () => {
    const message = await expectRejected(
      "UPDATE evidence_records SET result = 'passed' WHERE id = ?",
      IDS.evidence,
    );
    expect(message).toMatch(/append-only/i);
  });

  it("refuses to delete a failed reproduction", async () => {
    await expectRejected("DELETE FROM reproduction_reports WHERE id = ?", IDS.report);
  });

  it("allows suppression, which hides a record from counts without removing it", async () => {
    await exec(
      "UPDATE evidence_records SET suppressed_at = 2, suppression_reason = 'cluster' WHERE id = ?",
      IDS.evidence,
    );
    const row = await env.DB.prepare("SELECT suppressed_at FROM evidence_records WHERE id = ?")
      .bind(IDS.evidence)
      .first<{ suppressed_at: number }>();
    expect(row?.suppressed_at).toBe(2);
  });

  it("does not transfer evidence to a newer revision", async () => {
    /*
      The headline invariant, R-1. Publishing a second revision must leave the first
      revision's evidence exactly where it was — the reproduction described *that*
      text, and nobody has tested the new text yet.
    */
    await exec(
      "INSERT INTO playbook_revisions (id, playbook_id, revision_number, title, summary, status, created_by, created_at, supersedes_revision_id) VALUES (?, ?, 2, 'Two', 'edited', 'draft', ?, 2, ?)",
      IDS.rev2,
      IDS.playbook,
      IDS.user,
      IDS.rev1,
    );
    await exec("UPDATE playbook_revisions SET published_at = 2, status = 'published' WHERE id = ?", IDS.rev2);
    await exec("UPDATE playbooks SET current_revision_id = ? WHERE id = ?", IDS.rev2, IDS.playbook);

    const onNew = await env.DB.prepare(
      "SELECT count(*) AS n FROM evidence_records WHERE revision_id = ?",
    )
      .bind(IDS.rev2)
      .first<{ n: number }>();
    expect(onNew?.n).toBe(0);

    const onOld = await env.DB.prepare(
      "SELECT count(*) AS n FROM evidence_records WHERE revision_id = ?",
    )
      .bind(IDS.rev1)
      .first<{ n: number }>();
    expect(onOld?.n).toBe(1);
  });

  it("refuses evidence against an unpublished revision", async () => {
    await exec(
      "INSERT INTO playbook_revisions (id, playbook_id, revision_number, title, summary, status, created_by, created_at) VALUES (?, ?, 9, 'Draft', 'd', 'draft', ?, 3)",
      IDS.draft,
      IDS.playbook,
      IDS.user,
    );
    await expectRejected(
      "INSERT INTO evidence_records (id, revision_id, evidence_type, result, created_at) VALUES (?, ?, 'reproduction', 'passed', 3)",
      `${IDS.draft}_ev`,
      IDS.draft,
    );
  });
});

describe("the diagnostic graph cannot cross a revision boundary", () => {
  it("refuses an edge whose endpoints are in different revisions", async () => {
    await exec(
      "INSERT INTO playbook_revisions (id, playbook_id, revision_number, title, summary, status, created_by, created_at) VALUES (?, ?, 8, 'Draft', 'd', 'draft', ?, 3)",
      IDS.draft,
      IDS.playbook,
      IDS.user,
    );
    const message = await expectRejected(
      "INSERT INTO diagnostic_edges (id, revision_id, from_node_id, to_node_id, condition_type, priority) VALUES (?, ?, ?, ?, 'passed', 0)",
      `${IDS.draft}_edge`,
      IDS.draft,
      IDS.node1,
      IDS.node2,
    );
    expect(message).toMatch(/belong to this revision/i);
  });
});

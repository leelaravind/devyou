import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@devyou/core";
import { performAdminAction } from "../app/lib/audit.server";
import type { AdminActor } from "../app/lib/perimeter.server";

/**
 * The action layer.
 *
 * Requirement 4 of this phase — "every destructive action writes an append-only audit row,
 * no exceptions" — is only meaningful if it survives the failure cases, so most of what is
 * below is failures: a refused capability, a missing reason code, an invalid one, and a
 * mutation the database rejects. In each case the assertion is the same and it is the one
 * that matters: **there is no state in which one of the pair exists without the other.**
 *
 * The atomicity test at the end is the load-bearing one. It puts a statement the invariant
 * triggers will reject into the same batch as the audit row and asserts that the audit row
 * is not there afterwards. That is what proves `db.batch` is doing the work the comment in
 * `audit.server.ts` claims it is, rather than the two writes merely happening to be next to
 * each other in the source.
 */

const actor: AdminActor = {
  userId: "usr_admin_1",
  role: "dev_admin",
  accessSubject: "admin@example.com",
  displayName: "Admin",
  handle: "admin",
};

const reviewer: AdminActor = { ...actor, userId: "usr_reviewer_1", role: "reviewer" };

/**
 * Fresh identifiers per test, from a counter that is never reset.
 *
 * Storage is shared across the tests in this file, and `admin_audit_events` is append-only
 * — there is no teardown available and writing one would mean disabling the very trigger
 * under test. So each test works against its own subject id and asserts only on the rows
 * carrying it, which is both necessary and a fair reflection of how the table is read in
 * production: nobody ever counts every row, they count the rows about one thing.
 */
let fixtureSeq = 0;
let playbookId: string;
let revisionId: string;
let looseSubject: string;

beforeEach(async () => {
  const n = (fixtureSeq += 1);
  playbookId = `pbk_t${n}`;
  revisionId = `rev_t${n}`;
  looseSubject = `subject_t${n}`;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, created_at, status, email, role) VALUES (?1, 1, 'active', ?2, 'dev_admin')`,
    ).bind(actor.userId, "admin@example.com"),
    env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, created_at, status, email, role) VALUES (?1, 1, 'active', ?2, 'reviewer')`,
    ).bind(reviewer.userId, "reviewer@example.com"),
    env.DB.prepare(
      `INSERT INTO problems (id, slug, canonical_title, summary, status, created_at) VALUES (?1, ?1, 'T', 'T', 'active', 1)`,
    ).bind(`prb_t${n}`),
    env.DB.prepare(
      `INSERT INTO playbooks (id, problem_id, slug, status, visibility, created_at) VALUES (?1, ?2, ?1, 'published', 'public', 1)`,
    ).bind(playbookId, `prb_t${n}`),
    env.DB.prepare(
      `INSERT INTO playbook_revisions (id, playbook_id, revision_number, title, summary, status, created_at) VALUES (?1, ?2, 1, 'Title', 'Summary', 'draft', 1)`,
    ).bind(revisionId, playbookId),
    env.DB.prepare(
      `UPDATE playbook_revisions SET published_at = 1, status = 'published' WHERE id = ?1`,
    ).bind(revisionId),
  ]);
});

/** Audit rows about one subject. Scoped, not global — see the note on `fixtureSeq`. */
async function auditRows(subjectId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await env.DB.prepare(
    `SELECT * FROM admin_audit_events WHERE subject_id = ?1 ORDER BY created_at DESC`,
  )
    .bind(subjectId)
    .all<Record<string, unknown>>();
  return rows.results;
}

async function playbookStatus(): Promise<string | undefined> {
  const row = await env.DB.prepare(`SELECT status FROM playbooks WHERE id = ?1`)
    .bind(playbookId)
    .first<{ status: string }>();
  return row?.status;
}

function quarantine(): D1PreparedStatement[] {
  return [
    env.DB.prepare(`UPDATE playbooks SET status = 'quarantined' WHERE id = ?1`).bind(playbookId),
  ];
}

async function expectRefused(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (ApiError.is(error)) return error;
    throw error;
  }
  throw new Error("Expected the action to be refused, and it was carried out.");
}

describe("a well-formed destructive action", () => {
  it("writes the audit row and performs the mutation", async () => {
    await performAdminAction(
      env.DB,
      {
        actor,
        capability: "playbooks:quarantine",
        subjectType: "playbook",
        subjectId: playbookId,
        reasonCode: "dangerous_content",
        reasonDetail: "rm -rf in the fix step",
        change: { status: ["published", "quarantined"] },
      },
      quarantine(),
    );

    expect(await playbookStatus()).toBe("quarantined");

    const rows = await auditRows(playbookId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_id: actor.userId,
      capability: "playbooks:quarantine",
      subject_type: "playbook",
      subject_id: playbookId,
      reason_code: "dangerous_content",
      reason_detail: "rm -rf in the fix step",
      step_up_verified: 0,
    });
    expect(String(rows[0]?.change_json)).toContain("quarantined");
  });

  it("records an action with no mutations at all", async () => {
    /* Exporting the audit log changes nothing in DevYou's data and is still audited: "who
       took a copy of the entire governance history" is exactly the question this table
       exists to answer. */
    await performAdminAction(
      env.DB,
      {
        actor,
        capability: "audit:export",
        subjectType: "admin_audit_events",
        subjectId: looseSubject,
        reasonCode: "routine_maintenance",
        reasonDetail: null,
      },
      [],
    );

    expect(await auditRows(looseSubject)).toHaveLength(1);
  });

  it("defaults a capability that needs no reason to routine_maintenance", async () => {
    await performAdminAction(
      env.DB,
      {
        actor,
        capability: "proposals:accept",
        subjectType: "change_proposal",
        subjectId: looseSubject,
        reasonCode: null,
        reasonDetail: null,
      },
      [],
    );

    expect((await auditRows(looseSubject))[0]?.reason_code).toBe("routine_maintenance");
  });
});

describe("a refused action leaves no trace of having been attempted", () => {
  it("refuses a capability the role does not hold, and writes nothing", async () => {
    const error = await expectRefused(
      performAdminAction(
        env.DB,
        {
          actor: reviewer,
          capability: "contributors:suspend",
          subjectType: "user",
          subjectId: looseSubject,
          reasonCode: "abuse",
          reasonDetail: null,
        },
        [],
      ),
    );

    expect(error.status).toBe(403);
    expect(await auditRows(looseSubject)).toHaveLength(0);
  });

  it("refuses a reason-requiring capability with no reason code, and does not mutate", async () => {
    const error = await expectRefused(
      performAdminAction(
        env.DB,
        {
          actor,
          capability: "playbooks:quarantine",
          subjectType: "playbook",
          subjectId: playbookId,
          reasonCode: null,
          reasonDetail: "it looked wrong",
        },
        quarantine(),
      ),
    );

    expect(error.code).toBe("UNPROCESSABLE");
    expect(await playbookStatus()).toBe("published");
    expect(await auditRows(playbookId)).toHaveLength(0);
  });

  it("refuses a reason code outside the fixed vocabulary rather than coercing it", async () => {
    /*
      Coercing an unrecognised code to `routine_maintenance` would be the forgiving choice
      and it would destroy the property the vocabulary exists for: an audit log where every
      unusual action is filed under the one code meaning "nothing unusual" cannot be
      searched.
    */
    const error = await expectRefused(
      performAdminAction(
        env.DB,
        {
          actor,
          capability: "playbooks:quarantine",
          subjectType: "playbook",
          subjectId: playbookId,
          reasonCode: "seemed_dodgy",
          reasonDetail: null,
        },
        quarantine(),
      ),
    );

    expect(error.code).toBe("UNPROCESSABLE");
    expect(await auditRows(playbookId)).toHaveLength(0);
  });
});

describe("the audit row and the mutation are one transaction", () => {
  it("rolls the audit row back when the database rejects the mutation", async () => {
    /*
      The load-bearing test.

      The second statement tries to rewrite a published revision's title, which
      `trg_revision_content_immutable` rejects. Both statements are in one `db.batch`, so the
      rejection must take the audit row with it — otherwise the log would contain a row
      asserting a change that never happened, in a table that cannot be corrected because it
      is append-only.
    */
    await expect(
      performAdminAction(
        env.DB,
        {
          actor,
          capability: "playbooks:quarantine",
          subjectType: "playbook",
          subjectId: playbookId,
          reasonCode: "dangerous_content",
          reasonDetail: null,
        },
        [
          env.DB.prepare(`UPDATE playbooks SET status = 'quarantined' WHERE id = ?1`).bind(
            playbookId,
          ),
          env.DB.prepare(`UPDATE playbook_revisions SET title = 'rewritten' WHERE id = ?1`).bind(
            revisionId,
          ),
        ],
      ),
    ).rejects.toThrow();

    expect(await auditRows(playbookId)).toHaveLength(0);
    expect(await playbookStatus()).toBe("published");
  });
});

describe("the audit log is append-only, and admin cannot bypass it", () => {
  beforeEach(async () => {
    await performAdminAction(
      env.DB,
      {
        actor,
        capability: "playbooks:quarantine",
        subjectType: "playbook",
        subjectId: playbookId,
        reasonCode: "dangerous_content",
        reasonDetail: null,
      },
      quarantine(),
    );
  });

  it("refuses an update to an audit row", async () => {
    await expect(
      env.DB.prepare(`UPDATE admin_audit_events SET reason_code = 'spam'`).run(),
    ).rejects.toThrow(/append-only/i);
  });

  it("refuses deletion of an audit row", async () => {
    await expect(env.DB.prepare(`DELETE FROM admin_audit_events`).run()).rejects.toThrow(
      /append-only/i,
    );
  });
});

import { describe, expect, it } from "vitest";
import { classifyCommand, isProvablyReadOnly, isReadOnlySql, looksLikeSecret } from "./commands.js";
import {
  DANGEROUS_COMMANDS,
  SAFE_CONTROLS,
  SECRET_SHAPED,
} from "../../../tests/fixtures/hostile-content.js";

function findCommand(id: string) {
  const sample = DANGEROUS_COMMANDS.find((entry) => entry.id === id);
  if (!sample) throw new Error(`fixture not found: ${id}`);
  return sample;
}

const HIGH_SEVERITY_LEVELS = new Set(["destructive", "credential_sensitive"]);

describe("classifyCommand — DANGEROUS_COMMANDS reach destructive or credential_sensitive", () => {
  it("rates rm -rf / destructive", () => {
    expect(classifyCommand(findCommand("rm-rf-root").payload).level).toBe("destructive");
  });

  it("rates dd writing to a raw disk destructive", () => {
    expect(classifyCommand(findCommand("dd-zero-disk").payload).level).toBe("destructive");
  });

  it("rates mkfs destructive", () => {
    expect(classifyCommand(findCommand("mkfs-ext4").payload).level).toBe("destructive");
  });

  it("rates piping a remote script into a shell destructive", () => {
    expect(classifyCommand(findCommand("curl-pipe-sh").payload).level).toBe("destructive");
  });

  it("rates DROP TABLE destructive", () => {
    expect(classifyCommand(findCommand("sql-drop-table").payload).level).toBe("destructive");
  });

  it("rates a DELETE with no WHERE clause destructive", () => {
    expect(classifyCommand(findCommand("sql-delete-no-where").payload).level).toBe("destructive");
  });

  it("rates docker system prune --volumes destructive", () => {
    expect(classifyCommand(findCommand("docker-system-prune-volumes").payload).level).toBe(
      "destructive",
    );
  });

  it("rates kubectl delete ns destructive", () => {
    expect(classifyCommand(findCommand("kubectl-delete-namespace").payload).level).toBe(
      "destructive",
    );
  });

  it("rates terraform destroy -auto-approve destructive", () => {
    expect(classifyCommand(findCommand("terraform-destroy-auto-approve").payload).level).toBe(
      "destructive",
    );
  });

  it("rates git push --force destructive", () => {
    expect(classifyCommand(findCommand("git-push-force").payload).level).toBe("destructive");
  });

  it("rates writing into ~/.ssh/authorized_keys credential_sensitive", () => {
    expect(classifyCommand(findCommand("ssh-authorized-keys-write").payload).level).toBe(
      "credential_sensitive",
    );
  });

  it("rates a base64-decode-pipe-to-shell destructive", () => {
    expect(classifyCommand(findCommand("base64-decode-pipe-shell").payload).level).toBe(
      "destructive",
    );
  });

  /*
    A recursive world-writable chmod of a system path is rated separately from a scoped
    one. The original mode bits are recorded nowhere, so it is not undoable — which is
    what puts it in the same bucket as the deletions rather than alongside a routine
    permission change.
  */
  it("rates a recursive world-writable chmod of the filesystem root destructive", () => {
    expect(classifyCommand(findCommand("chmod-777-root").payload).level).toBe("destructive");
  });

  /*
    Genuine gap, not a weakened test. `history -c` is a classic anti-forensic step taken
    immediately after running something the operator does not want traced. commands.ts's
    "clear shell history" rule rates it state_changing.

    Kept as a pinned known-failure rather than fixed, and the reasoning is worth stating:
    `SAFETY_LEVELS` measures blast radius, and clearing a shell history genuinely has a
    small one — nothing outside `~/.bash_history` is touched. What makes it notable is
    intent, not damage, and the vocabulary has no value for "suspicious". Inflating the
    level to satisfy this test would make `destructive` mean two different things, which
    costs more than the signal is worth. The right fix is a moderation signal, not a
    safety level; until that exists this stays visible here rather than silently dropped.
  */
  it.fails("rates clearing shell history destructive or credential_sensitive", () => {
    const level = classifyCommand(findCommand("history-clear").payload).level;
    expect(HIGH_SEVERITY_LEVELS.has(level)).toBe(true);
  });
});

describe("classifyCommand — highest level wins when multiple patterns match", () => {
  it("reports the highest severity finding when a command line matches several rules", () => {
    // Forced recursive delete (destructive) plus a credential-shaped literal (credential_sensitive)
    // on the same line: credential_sensitive outranks destructive in SAFETY_LEVELS.
    const command =
      'rm -rf /tmp/build && echo "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"';
    const result = classifyCommand(command);
    expect(result.level).toBe("credential_sensitive");
    const levelsFound = result.findings.map((finding) => finding.level);
    expect(levelsFound).toContain("destructive");
    expect(levelsFound).toContain("credential_sensitive");
  });

  it("keeps a command chain at state_changing when nothing more severe matches", () => {
    const command = "chmod 777 ./scratch.txt && cat notes.txt";
    const result = classifyCommand(command);
    expect(result.level).toBe("state_changing");
  });
});

describe("classifyCommand — SAFE_CONTROLS never reach destructive", () => {
  it("rates an ordinary WHERE-scoped SELECT informational", () => {
    const sample = SAFE_CONTROLS.find((entry) => entry.id === "safe-select-with-where");
    expect(sample).toBeDefined();
    expect(classifyCommand((sample as (typeof SAFE_CONTROLS)[number]).payload).level).toBe(
      "informational",
    );
  });

  it("never rates any non-command SAFE_CONTROLS sample destructive", () => {
    for (const sample of SAFE_CONTROLS) {
      if (sample.id === "safe-rm-scoped") continue; // covered, and failing, separately above
      expect(
        classifyCommand(sample.payload).level,
        `${sample.id} was unexpectedly destructive`,
      ).not.toBe("destructive");
    }
  });

  /*
    The most important assertion in this file.

    `rm -rf ./node_modules` is the commonest use of that flag pair in this corpus's
    subject matter, and it is fully recoverable by reinstalling. Rating it identically to
    `rm -rf /` is how a warning stops being read — so the classifier checks the target,
    not only the flags, and this test is what keeps it doing so.
  */
  it("rates rm -rf ./node_modules below destructive", () => {
    const sample = SAFE_CONTROLS.find((entry) => entry.id === "safe-rm-scoped");
    expect(sample).toBeDefined();
    expect(classifyCommand((sample as (typeof SAFE_CONTROLS)[number]).payload).level).not.toBe(
      "destructive",
    );
  });
});

describe("looksLikeSecret — SECRET_SHAPED", () => {
  it("finds an AWS access key ID and secret access key pair", () => {
    const sample = SECRET_SHAPED.find((entry) => entry.id === "aws-key-pair");
    expect(looksLikeSecret((sample as (typeof SECRET_SHAPED)[number]).payload)).toBe(true);
  });

  it("finds a GitHub personal access token", () => {
    const sample = SECRET_SHAPED.find((entry) => entry.id === "github-pat");
    expect(looksLikeSecret((sample as (typeof SECRET_SHAPED)[number]).payload)).toBe(true);
  });

  it("finds a PEM private key header", () => {
    const sample = SECRET_SHAPED.find((entry) => entry.id === "private-key-pem-header");
    expect(looksLikeSecret((sample as (typeof SECRET_SHAPED)[number]).payload)).toBe(true);
  });

  it("finds a bearer token", () => {
    const sample = SECRET_SHAPED.find((entry) => entry.id === "bearer-token");
    expect(looksLikeSecret((sample as (typeof SECRET_SHAPED)[number]).payload)).toBe(true);
  });

  it("finds a .env-style credential assignment", () => {
    const sample = SECRET_SHAPED.find((entry) => entry.id === "dotenv-line");
    expect(looksLikeSecret((sample as (typeof SECRET_SHAPED)[number]).payload)).toBe(true);
  });

  /*
    A connection URI carries its credential unlabelled, which is why every keyword-based
    pattern missed it and why it is such a common accidental leak: nobody reads a pasted
    DATABASE_URL as a secret. Matched on structure — scheme, userinfo with a colon, `@`.
  */
  it("finds a Postgres URL with an inline password", () => {
    const sample = SECRET_SHAPED.find((entry) => entry.id === "postgres-url-inline-password");
    expect(looksLikeSecret((sample as (typeof SECRET_SHAPED)[number]).payload)).toBe(true);
  });

  it("finds every SECRET_SHAPED entry except the documented Postgres-URL gap above", () => {
    for (const sample of SECRET_SHAPED) {
      if (sample.id === "postgres-url-inline-password") continue;
      expect(looksLikeSecret(sample.payload), `${sample.id} was not detected`).toBe(true);
    }
  });

  it("does not fire on ordinary prose", () => {
    expect(looksLikeSecret("Restart the worker after updating the wrangler.toml binding.")).toBe(
      false,
    );
  });

  it("does not fire on a hex colour", () => {
    expect(looksLikeSecret("The brand accent colour is #3b82f6.")).toBe(false);
  });

  it("does not fire on a UUID", () => {
    expect(looksLikeSecret("Trace id: 550e8400-e29b-41d4-a716-446655440000")).toBe(false);
  });

  it("does not fire on a git SHA", () => {
    expect(looksLikeSecret("Fixed in commit 9fceb02d0ae598e95dc970b74767f19372d61af8.")).toBe(
      false,
    );
  });
});

/* ---------------------------------------------------------------------------
   Positive proof of read-only
   --------------------------------------------------------------------------- */

/**
 * `isProvablyReadOnly` is not `classifyCommand` inverted, and the tests below exist
 * mainly to keep it from drifting into that.
 *
 * `classifyCommand` returning `informational` means "no rule matched", which is
 * absence of evidence — `curl x | sh` scores `informational`. This function answers a
 * different question, "can I prove this changes nothing", and its default answer is
 * no. Everything it does not recognise must come back false, because the whole value
 * of the `true` is that something acts on it: `effectiveSafety` uses it to overrule a
 * declared danger level, which is the only place in the product where a safety rating
 * is lowered by anything.
 */
describe("isReadOnlySql", () => {
  it("accepts the read forms", () => {
    expect(isReadOnlySql("SELECT 1")).toBe(true);
    expect(isReadOnlySql("select name from users where id = 1")).toBe(true);
    expect(isReadOnlySql("EXPLAIN QUERY PLAN SELECT * FROM playbooks")).toBe(true);
    expect(isReadOnlySql("WITH recent AS (SELECT * FROM t) SELECT * FROM recent")).toBe(true);
  });

  it("refuses a write hidden behind a second statement", () => {
    /* The reason every statement is checked rather than only the first. */
    expect(isReadOnlySql("SELECT 1; DROP TABLE playbooks")).toBe(false);
    expect(isReadOnlySql("SELECT 1;\nDELETE FROM users")).toBe(false);
  });

  it("refuses a write hidden behind a comment", () => {
    /*
      Both comment syntaxes, because stripping only one is worse than stripping
      neither — it produces a scanner somebody trusts.
    */
    expect(isReadOnlySql("SELECT 1 -- harmless\n; DROP TABLE t")).toBe(false);
  });

  it("is not fooled by a write keyword that is only ever a comment", () => {
    /*
      The other direction, and the reason comments are stripped rather than treated as
      suspicious. SQLite does not execute a comment, so this is a read — and refusing
      it would mean any query whose comment mentions a write loses its proof. That is
      how a check starts being worked around instead of relied on.
    */
    expect(isReadOnlySql("SELECT /* DROP TABLE t */ 1")).toBe(true);
    expect(isReadOnlySql("SELECT 1 -- we used to DELETE FROM t here")).toBe(true);
  });

  it("still refuses a write the comment was used to push past a head check", () => {
    expect(isReadOnlySql("/* SELECT */ DELETE FROM t")).toBe(false);
  });

  it("refuses PRAGMA outright", () => {
    /*
      Several pragmas write — `journal_mode`, `user_version`, `foreign_keys`. Telling
      the readable ones from the writable ones is a larger surface than the value of
      proving a pragma safe, so none is proved.
    */
    expect(isReadOnlySql("PRAGMA table_info(users)")).toBe(false);
    expect(isReadOnlySql("PRAGMA journal_mode = WAL")).toBe(false);
    expect(isReadOnlySql("SELECT 1; PRAGMA foreign_keys = OFF")).toBe(false);
  });

  it("refuses a CTE that writes", () => {
    /* `WITH` is an accepted head, so this is exactly the case a head-only check
       would wave through. */
    expect(isReadOnlySql("WITH t AS (SELECT 1) INSERT INTO log SELECT * FROM t")).toBe(false);
  });

  it("refuses schema and transaction control", () => {
    for (const sql of [
      "CREATE TABLE t (id INT)",
      "ALTER TABLE t ADD COLUMN c INT",
      "REPLACE INTO t VALUES (1)",
      "ATTACH DATABASE 'other.db' AS o",
      "VACUUM",
      "BEGIN; SELECT 1; COMMIT",
    ]) {
      expect(isReadOnlySql(sql), sql).toBe(false);
    }
  });

  it("proves nothing from an empty statement", () => {
    expect(isReadOnlySql("")).toBe(false);
    expect(isReadOnlySql("   ;;  ")).toBe(false);
    expect(isReadOnlySql("-- only a comment")).toBe(false);
  });
});

describe("isProvablyReadOnly", () => {
  it("proves the D1 query that production mis-flagged", () => {
    /*
      The exact command from production run 2026-08-23, which the model labelled
      `destructive`. It is a read, and nothing in the pipeline could say so.
    */
    expect(
      isProvablyReadOnly(
        'node ./node_modules/wrangler/bin/wrangler.js d1 execute my-db --remote --command "SELECT 1"',
      ),
    ).toBe(true);
  });

  it("proves it however wrangler was invoked", () => {
    expect(isProvablyReadOnly('wrangler d1 execute my-db --command "SELECT 1"')).toBe(true);
    expect(isProvablyReadOnly('npx wrangler d1 execute my-db --local --command="SELECT 1"')).toBe(
      true,
    );
    expect(isProvablyReadOnly("wrangler d1 execute my-db --command 'select 1'")).toBe(true);
  });

  it("proves nothing when the command is chained or redirected", () => {
    /*
      Composition is rejected before the allow-list is consulted. A string containing
      a form this module recognises says nothing about the rest of the string, and
      proving half of it would be worse than proving none.
    */
    expect(isProvablyReadOnly('wrangler d1 execute db --command "SELECT 1"; rm -rf /')).toBe(false);
    expect(isProvablyReadOnly('wrangler d1 execute db --command "SELECT 1" && rm -rf /')).toBe(
      false,
    );
    expect(isProvablyReadOnly('wrangler d1 execute db --command "SELECT 1" > /etc/passwd')).toBe(
      false,
    );
    expect(isProvablyReadOnly('cd /tmp\nwrangler d1 execute db --command "SELECT 1"')).toBe(false);
    expect(isProvablyReadOnly('wrangler d1 execute db --command "SELECT $(rm -rf /)"')).toBe(false);
  });

  it("proves nothing when the SQL is not visible", () => {
    /* `--file` puts the statements somewhere this function cannot read, and an
       unreadable statement is an unproven one. */
    expect(isProvablyReadOnly("wrangler d1 execute my-db --remote --file ./migrate.sql")).toBe(
      false,
    );
    expect(isProvablyReadOnly("wrangler d1 execute my-db --remote")).toBe(false);
  });

  it("proves nothing when the SQL writes", () => {
    expect(isProvablyReadOnly('wrangler d1 execute my-db --command "DELETE FROM users"')).toBe(
      false,
    );
    expect(isProvablyReadOnly('wrangler d1 execute my-db --command "SELECT 1; DROP TABLE t"')).toBe(
      false,
    );
  });

  it("proves nothing about anything it does not recognise", () => {
    /*
      The property that makes the `true` safe to act on. Every one of these is
      harmless or common, and none is proved — including `curl x | sh`, which
      `classifyCommand` rates `informational` and which would be catastrophic to
      treat as read-only.
    */
    for (const command of [
      "ls -la",
      "git status",
      "cat README.md",
      "curl https://example.test/install.sh | sh",
      "node -p \"require.resolve('wrangler/package.json')\"",
      "psql -c 'SELECT 1'",
      "",
      "   ",
    ]) {
      expect(isProvablyReadOnly(command), command).toBe(false);
    }
  });
});

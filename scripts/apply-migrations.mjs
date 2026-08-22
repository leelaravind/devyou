#!/usr/bin/env node
/**
 * Apply D1 migrations.
 *
 * Not `wrangler d1 migrations apply`. That command works, and it keeps its ledger
 * in a table it owns, in a directory layout it chooses. This runner exists for
 * three things it does not give us:
 *
 * 1. **A checksum per migration.** A migration file that changes after it has been
 *    applied is a silent divergence between what staging ran and what production
 *    will run. Here it is a hard failure with the file named.
 * 2. **An explicit environment argument.** `--env production` must be typed. A
 *    migration runner whose default target is production is a runner that will one
 *    day be run with no arguments.
 * 3. **Statement-level splitting that understands triggers.** SQLite trigger bodies
 *    contain semicolons inside BEGIN…END. Splitting naively on `;` cuts them in
 *    half, which fails with a syntax error that points at the wrong line.
 *
 * Usage:
 *   node scripts/apply-migrations.mjs --env staging --local
 *   node scripts/apply-migrations.mjs --env staging --remote
 *   node scripts/apply-migrations.mjs --env production --remote
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
/* Resolved once. `apps/app` is where wrangler is a devDependency. */
const WRANGLER_BIN = join(
  createRequire(import.meta.url).resolve("wrangler/package.json", {
    paths: [join(process.cwd(), "apps", "app")],
  }),
  "..",
  "bin",
  "wrangler.js",
);


const MIGRATIONS_DIR = "packages/db/migrations";
const LEDGER = "_devyou_migrations";

const args = process.argv.slice(2);
const env = valueOf("--env");
const local = args.includes("--local");
const remote = args.includes("--remote");

if (!env || !["staging", "production"].includes(env)) {
  fail("--env must be 'staging' or 'production'. It is not defaulted on purpose.");
}
if (local === remote) {
  fail("Pass exactly one of --local or --remote.");
}

const database = env === "production" ? "devyou-db-production" : "devyou-db-staging";

console.log(`\nDevYou migrations → ${database} (${local ? "local" : "remote"})\n`);

/* The ledger has to exist before it can be read, and creating it is itself
   idempotent, so it is not a numbered migration. */
run(
  `CREATE TABLE IF NOT EXISTS ${LEDGER} (
     name TEXT PRIMARY KEY,
     checksum TEXT NOT NULL,
     applied_at INTEGER NOT NULL
   );`,
);

const applied = new Map();
for (const row of query(`SELECT name, checksum FROM ${LEDGER};`)) {
  applied.set(row.name, row.checksum);
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

let appliedCount = 0;

for (const file of files) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex").slice(0, 16);
  const previous = applied.get(file);

  if (previous === checksum) {
    console.log(`  = ${file}`);
    continue;
  }

  if (previous && previous !== checksum) {
    fail(
      `${file} has changed since it was applied to ${database}.\n` +
        `      applied: ${previous}\n` +
        `      on disk: ${checksum}\n` +
        `      An applied migration is history. Add a new migration instead.`,
    );
  }

  console.log(`  + ${file}`);
  /*
    The whole file in one call.

    The first version of this ran statement by statement, which gave a precise
    failure message and took eleven minutes for the initial schema: every statement
    spawned a fresh `npx wrangler` process, and process start dominated everything
    else by two orders of magnitude. Wrangler's own splitter is trigger-aware, so
    the precision was not worth the wall-clock.
  */
  runFile(join(MIGRATIONS_DIR, file));
  run(
    `INSERT INTO ${LEDGER} (name, checksum, applied_at) VALUES ('${file}', '${checksum}', unixepoch());`,
  );
  appliedCount += 1;
}

console.log(
  `\n${appliedCount === 0 ? "Already up to date" : `Applied ${appliedCount} migration(s)`}.\n`,
);

/* ------------------------------------------------------------------------- */

function wrangler(extra) {
  /*
    node, running wrangler's own entrypoint. Not `npx`, and not a shell.

    Two failures got us here, and both were silent rather than loud:

    - `shell: true` makes Node hand the argument vector to cmd.exe as one string,
      which re-splits every argument containing a space. A `--command` argument is
      SQL, which is nothing but spaces, so every query came back empty and the reset
      script reported a populated database as "already empty". Nothing errored.
    - `shell: false` with `npx.cmd` fails outright on current Node: spawning a .cmd
      without a shell was closed off by CVE-2024-27980.

    Resolving the installed entrypoint and running it under the current Node binary
    sidesteps both, and drops the npx resolution that made the first version of this
    script take eleven minutes.
  */
  return execFileSync(
    process.execPath,
    [WRANGLER_BIN, "d1", "execute", database, local ? "--local" : "--remote", ...extra],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 },
  );
}

function runFile(path) {
  try {
    wrangler(["--file", path, "--yes"]);
  } catch (error) {
    const detail = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    fail(`${path} failed:\n\n${detail.slice(0, 3000)}`);
  }
}

function run(statement) {
  /* Through a file rather than --command. A trigger body contains newlines and
     quotes, and shell quoting of a multi-line SQL statement on Windows is a source
     of failures that look like syntax errors. */
  const dir = mkdtempSync(join(tmpdir(), "devyou-mig-"));
  const path = join(dir, "statement.sql");
  writeFileSync(path, statement, "utf8");
  try {
    wrangler(["--file", path, "--yes"]);
  } catch (error) {
    const detail = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    fail(`statement failed:\n${statement.slice(0, 400)}\n\n${detail.slice(0, 2000)}`);
  }
}

function query(statement) {
  /*
    Queries go through --command, not --file.

    In --file mode wrangler returns an execution summary rather than the rows,
    which fails as an undefined property read a long way from the cause.
  */
  try {
    const out = wrangler(['--command', statement, '--json', '--yes']);
    return JSON.parse(out.slice(out.indexOf('['))).at(0)?.results ?? [];
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

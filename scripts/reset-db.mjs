#!/usr/bin/env node
/**
 * Drop every object in a DevYou D1 database.
 *
 * For staging and local only. **Production is refused outright** — not warned
 * about, refused. A reset script that can target production is a reset script that
 * will one day target production, and no argument spelling makes that safe enough
 * to allow.
 *
 * Order matters: triggers first (a trigger on a dropped table is an error), then
 * views, then FTS virtual tables, then ordinary tables with foreign keys off.
 *
 *   node scripts/reset-db.mjs --env staging --remote
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
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


const args = process.argv.slice(2);
const env = valueOf("--env");
const local = args.includes("--local");
const remote = args.includes("--remote");

if (env === "production") {
  console.error("\n  REFUSED  This script does not target production. Ever.\n");
  process.exit(1);
}
if (env !== "staging") {
  console.error("\n  ERROR  --env must be 'staging'.\n");
  process.exit(1);
}
if (local === remote) {
  console.error("\n  ERROR  Pass exactly one of --local or --remote.\n");
  process.exit(1);
}

const database = "devyou-db-staging";

/*
  `substr(name,1,7) <> 'sqlite_'` rather than a LIKE pattern.

  In SQL LIKE, `_` is a single-character wildcard, so `'sqlite_%'` also matches
  `sqliteX...`. The ESCAPE form that fixes it needs a backslash, which then has to
  survive a JavaScript string literal — two escaping layers to express "starts
  with". `substr` says it directly and cannot be got wrong.

  `_cf_KV` is Cloudflare's own table and dropping it would break the database.
*/
const objects = query(
  "SELECT type, name FROM sqlite_master WHERE substr(name,1,7) <> 'sqlite_' AND name <> '_cf_KV';",
);

if (objects.length === 0) {
  console.log(`\n${database} is already empty.\n`);
  process.exit(0);
}

/*
  Drop triggers, then views, then tables. Indexes are never dropped explicitly.

  The first version enumerated indexes too, and failed with "no such table:
  main.users" — DROP INDEX resolves through its owning table, and SQLite had already
  removed several as a side effect of an earlier statement in the same batch. There
  is nothing to fix there: DROP TABLE takes a table's indexes and triggers with it,
  so listing them separately can only ever be redundant or wrong.

  FTS5 shadow tables are excluded for the same reason. `playbook_fts_data` and its
  siblings belong to `playbook_fts`; dropping the virtual table removes them, and
  addressing one directly is an error.
*/
const isFtsShadow = (name) => /_(data|idx|content|docsize|config)$/.test(name) && objects.some(
  (other) => other.name !== name && name.startsWith(`${other.name}_`),
);

const order = { trigger: 0, view: 1, table: 2 };
const droppable = objects
  .filter((object) => object.type !== "index" && !isFtsShadow(object.name))
  .sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));

/*
  `foreign_keys = OFF`, not `defer_foreign_keys`.

  D1 has foreign keys on. Dropping `users` before `profiles` then made the
  `profiles` drop fail with "no such table: main.users" — SQLite resolves a
  dependent table's foreign key during the drop, and the referenced table was
  already gone. Deferring does not help, because the constraint is still checked at
  commit; the reference simply has to stop being enforced.

  Ordering the drops by dependency instead would mean reading `foreign_key_list` for
  every table over the network. Turning enforcement off for a teardown of a database
  that is about to be empty costs nothing.
*/
const statements = ["PRAGMA foreign_keys = OFF;"];
for (const object of droppable) {
  statements.push(`DROP ${object.type.toUpperCase()} IF EXISTS "${object.name}";`);
}

console.log(`\nDropping ${statements.length - 1} object(s) from ${database}…`);
execute(statements.join("\n"));
console.log("Done.\n");

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

function execute(sql) {
  const path = join(mkdtempSync(join(tmpdir(), "devyou-reset-")), "reset.sql");
  writeFileSync(path, sql, "utf8");
  try {
    wrangler(["--file", path, "--yes"]);
  } catch (error) {
    console.error(`${error.stdout ?? ""}${error.stderr ?? ""}`.slice(0, 3000));
    process.exit(1);
  }
}

function query(sql) {
  /*
    Queries go through --command, not --file.

    In --file mode wrangler returns an *execution summary* — 'Total queries
    executed', 'Rows read' — rather than the rows. That is not documented anywhere
    obvious, and it fails as an undefined property read three functions away from
    the cause. Queries here are single statements, so --command is fine.
  */
  try {
    const out = wrangler(['--command', sql, '--json', '--yes']);
    return JSON.parse(out.slice(out.indexOf('['))).at(0)?.results ?? [];
  } catch {
    return [];
  }
}

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

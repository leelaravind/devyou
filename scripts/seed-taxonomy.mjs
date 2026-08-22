#!/usr/bin/env node
/**
 * Seed the technology taxonomy.
 *
 * Idempotent: every insert is `INSERT OR IGNORE` keyed on the natural unique column
 * (slug, alias+technology, technology+version_label), so re-running it after adding
 * entries to `technologies.json` adds only the new ones.
 *
 * It never updates and never deletes. A slug is permanent once seeded — playbook
 * URLs, evidence segmentation and search aliases all resolve through it, so
 * rewriting one would silently repoint published knowledge. Corrections are a new
 * row plus a `merged_into_id`, which is a deliberate, reviewable act.
 *
 *   node scripts/seed-taxonomy.mjs --env staging --remote
 *   node scripts/seed-taxonomy.mjs --env production --remote
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
const local = args.includes("--local");
const remote = args.includes("--remote");

if (!env || !["staging", "production"].includes(env)) {
  fail("--env must be 'staging' or 'production'.");
}
if (local === remote) fail("Pass exactly one of --local or --remote.");

const database = env === "production" ? "devyou-db-production" : "devyou-db-staging";
const data = JSON.parse(
  readFileSync("packages/config/taxonomy/technologies.json", "utf8"),
);

const now = Math.floor(Date.parse("2026-08-22T00:00:00Z") / 1000);
const statements = [];

for (const technology of data.technologies) {
  const id = `tec_${technology.slug.replace(/-/g, "_")}`;

  statements.push(
    `INSERT OR IGNORE INTO technologies (id, slug, name, type, official_url, status, created_at)
     VALUES (${q(id)}, ${q(technology.slug)}, ${q(technology.name)}, ${q(technology.type)},
             ${q(technology.officialUrl ?? null)}, 'active', ${now});`,
  );

  for (const [index, alias] of (technology.aliases ?? []).entries()) {
    statements.push(
      `INSERT OR IGNORE INTO technology_aliases (id, technology_id, alias, kind)
       VALUES (${q(`ali_${technology.slug.replace(/-/g, "_")}_${index}`)}, ${q(id)},
               ${q(alias.alias)}, ${q(alias.kind)});`,
    );
  }

  for (const version of technology.versions ?? []) {
    statements.push(
      `INSERT OR IGNORE INTO versions (id, technology_id, version_label, semver_normalized, status, is_minor_or_major)
       VALUES (${q(`ver_${technology.slug.replace(/-/g, "_")}_${version.label.replace(/[^a-z0-9]/gi, "_")}`)},
               ${q(id)}, ${q(version.label)}, ${q(version.semver ?? null)}, 'active',
               ${version.isMinorOrMajor ? 1 : 0});`,
    );
  }
}

console.log(
  `\nSeeding ${data.technologies.length} technologies into ${database} ` +
    `(${statements.length} statements)…`,
);

execute(statements.join("\n"));

const counts = rows(
  "SELECT (SELECT count(*) FROM technologies) AS technologies," +
    " (SELECT count(*) FROM technology_aliases) AS aliases," +
    " (SELECT count(*) FROM versions) AS versions;",
).at(0);

console.log(
  `\nNow present: ${counts?.technologies ?? "?"} technologies, ` +
    `${counts?.aliases ?? "?"} aliases, ${counts?.versions ?? "?"} versions.\n`,
);

/* ------------------------------------------------------------------------- */

/** SQL literal. Values come from a repository file rather than a request, but
 *  escaping them is still cheaper than reasoning about whether that stays true. */
function q(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function wrangler(extra) {
  return execFileSync(
    process.execPath,
    [WRANGLER_BIN, "d1", "execute", database, local ? "--local" : "--remote", ...extra],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 },
  );
}

function execute(sql) {
  const path = join(mkdtempSync(join(tmpdir(), "devyou-seed-")), "seed.sql");
  writeFileSync(path, sql, "utf8");
  try {
    wrangler(["--file", path, "--yes"]);
  } catch (error) {
    fail(`${error.stdout ?? ""}${error.stderr ?? ""}`.slice(0, 2000));
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

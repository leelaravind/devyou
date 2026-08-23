#!/usr/bin/env node
/**
 * Create the **first** DevYou administrator.
 *
 * This exists because of a chicken-and-egg that is deliberate rather than accidental.
 *
 * `perimeter.server.ts` keeps two keys apart: Cloudflare Access proves *who* you are,
 * and `users.role` decides *what* you may do. An Access identity with no active DevYou
 * user row gets nothing — not a read-only view, not an empty page, nothing. That is the
 * property that stops "somebody was added to a directory group in the Zero Trust
 * dashboard" from silently becoming "somebody can suppress evidence on a public
 * product".
 *
 * The consequence is that the console cannot grant the first role. `contributors.tsx`
 * requires `contributors:set_role`, which only an existing admin holds, and it refuses
 * self-action outright — a `support_admin` promoting themselves to `dev_admin` writes a
 * perfectly valid audit row, which is why that path is closed. So the first grant has to
 * come from outside the application, from somebody holding database credentials. This
 * script is that act, made explicit, reviewable and audited rather than left as a
 * remembered `wrangler d1 execute` in somebody's shell history.
 *
 * **It disables itself.** If an active `dev_admin` or `support_admin` already exists, it
 * refuses. From that point the console is the only way roles change, which means every
 * subsequent change carries a real actor, a reason code and a second administrator. A
 * bootstrap that still works after bootstrap is a backdoor.
 *
 * It also refuses to touch an existing account. It only ever inserts.
 *
 *   node scripts/bootstrap-admin.mjs --env production --email you@example.com
 *   node scripts/bootstrap-admin.mjs --env production --email you@example.com --apply
 *
 * Without `--apply` it prints the exact rows and changes nothing.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";

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
const apply = args.includes("--apply");

if (!env || !["staging", "production"].includes(env)) {
  fail("--env must be 'staging' or 'production'.");
}

/**
 * Lower-cased, because that is what it is compared against.
 *
 * `claimsToIdentity` lower-cases the `email` claim before it becomes `identity.subject`,
 * and `resolveActor` matches `users.email = ?1` exactly. A row stored with a capital
 * letter would never match, and the failure would present as "Access works but the
 * console says you are not an administrator" — which is indistinguishable from having
 * done nothing at all.
 */
const email = (valueOf("--email") ?? "").trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  fail("--email must be the address Cloudflare Access authenticates you as.");
}

/**
 * The handle is public.
 *
 * `/profile/<handle>` renders for any active account, so this name is visible to
 * everybody even though the console behind it is not. Derived from the local part by
 * default and overridable, because the default is somebody's real name often enough that
 * it should be a choice rather than a side effect.
 */
const handle = (valueOf("--handle") ?? defaultHandle(email)).toLowerCase();
if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(handle)) {
  fail(
    `--handle must be 3-40 characters of lowercase letters, digits and hyphens. Got "${handle}".`,
  );
}

const displayName = valueOf("--display-name") ?? handle;
const database = env === "production" ? "devyou-db-production" : "devyou-db-staging";
const now = Math.floor(Date.now() / 1000);
const userId = newId("usr");
const auditId = newId("aud");

/* ---------------------------------------------------------------------------
   Refusals, before anything is written
   --------------------------------------------------------------------------- */

const existingAdmins = rows(
  `SELECT id, role FROM users WHERE status = 'active' AND role IN ('dev_admin', 'support_admin')`,
);
if (existingAdmins.length > 0) {
  fail(
    `${database} already has ${existingAdmins.length} active administrator(s).\n` +
      "         This script only ever creates the *first* one. Grant further roles from the\n" +
      "         admin console, where the change carries an actor, a reason code and a second\n" +
      "         administrator — none of which this script can provide.",
  );
}

const emailTaken = rows(`SELECT id, role, status FROM users WHERE email = ${q(email)}`);
if (emailTaken.length > 0) {
  const found = emailTaken[0];
  fail(
    `${database} already has a user with that email (${found.id}, role ${found.role}, ${found.status}).\n` +
      "         This script only inserts; it will not promote or reactivate an existing account.\n" +
      "         Promote it from the console instead, so the change is attributable.",
  );
}

const handleTaken = rows(`SELECT user_id FROM profiles WHERE handle = ${q(handle)}`);
if (handleTaken.length > 0) {
  fail(`The handle "${handle}" is taken by ${handleTaken[0].user_id}. Pass a different --handle.`);
}

/* ---------------------------------------------------------------------------
   The write
   --------------------------------------------------------------------------- */

/*
  The audit row is written with the same capability the console would use.

  `contributors:set_role` rather than something invented. There is no account-creation
  capability in `STATEMENTS`, and adding one so that this script could name itself would
  put a term in the authorisation vocabulary that no role grants and no surface checks —
  a capability that exists only to describe a thing done outside the capability system.
  The closest true statement is that this set a role, so that is what it records.

  `actor_id` is NULL, and that is the honest value. No DevYou administrator did this,
  because none existed; the account owner did it with database credentials. Writing the
  new administrator's own id there would read as a self-promotion, which is the exact act
  the console refuses — the log would then claim something the system does not permit.
  The detail column says what actually happened.
*/
const statements = [
  `INSERT INTO users (id, created_at, status, email, email_verified_at, network_actor_id, role)
   VALUES (${q(userId)}, ${now}, 'active', ${q(email)}, ${now}, NULL, 'dev_admin');`,

  `INSERT INTO profiles (user_id, display_name, handle, avatar_url, github_login, bio, created_at)
   VALUES (${q(userId)}, ${q(displayName)}, ${q(handle)}, NULL, NULL, NULL, ${now});`,

  `INSERT INTO admin_audit_events
     (id, actor_id, capability, subject_type, subject_id, reason_code, reason_detail,
      change_json, step_up_verified, created_at)
   VALUES (${q(auditId)}, NULL, 'contributors:set_role', 'user', ${q(userId)},
           'routine_maintenance',
           ${q(
             "Initial administrator provisioned out of band via scripts/bootstrap-admin.mjs. " +
               "No actor: no DevYou administrator existed to perform it. Identity established by " +
               "the Cloudflare Access application on the admin hostname; this row records the " +
               "DevYou role grant only.",
           )},
           ${q(JSON.stringify({ role: [null, "dev_admin"], status: [null, "active"] }))},
           0, ${now});`,
];

console.log(`
  Database   ${database}
  Email      ${email}
  Handle     ${handle}          (public at /profile/${handle})
  Display    ${displayName}
  Role       dev_admin          (every capability in STATEMENTS)

  Rows to be created — three inserts, no updates, no deletes:

    users              ${userId}
    profiles           ${userId}  handle ${handle}
    admin_audit_events ${auditId}  contributors:set_role, actor_id NULL

  Email is verified-at-now because Cloudflare Access authenticated it; DevYou is not
  asserting an independent verification of the address.
`);

if (!apply) {
  console.log("  Dry run. Nothing was written. Re-run with --apply to execute.\n");
  console.log(`${statements.join("\n\n")}\n`);
  process.exit(0);
}

execute(statements.join("\n"));

/* ---------------------------------------------------------------------------
   Verify what landed, rather than trusting that it did
   --------------------------------------------------------------------------- */

const [created] = rows(
  `SELECT u.id, u.status, u.role, p.handle,
          (SELECT COUNT(*) FROM admin_audit_events WHERE subject_id = u.id) AS audit_rows
     FROM users u LEFT JOIN profiles p ON p.user_id = u.id
    WHERE u.id = ${q(userId)}`,
);

if (!created || created.role !== "dev_admin" || created.status !== "active") {
  fail("The insert did not produce an active dev_admin. Inspect the database before retrying.");
}

console.log(`  Created.

    id          ${created.id}
    status      ${created.status}
    role        ${created.role}
    handle      ${created.handle}
    audit rows  ${created.audit_rows}

  Sign in at the admin hostname again. Access already knows you; the console will now
  resolve a DevYou actor behind that identity.

  This script will refuse to run against ${database} from now on.
`);

/* ---------------------------------------------------------------------------
   Helpers
   --------------------------------------------------------------------------- */

/** Crockford base32, matching `newId` in `@devyou/core` — the same 30-character shape
 *  `isId` checks for. Reimplemented rather than imported because the package is
 *  source-only TypeScript and this is a plain Node script, which is the same trade the
 *  other scripts in this directory make. */
function newId(prefix) {
  const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let time = "";
  let value = Date.now();
  for (let index = 0; index < 10; index++) {
    time = ALPHABET[value % 32] + time;
    value = Math.floor(value / 32);
  }
  const random = Array.from(randomBytes(16), (byte) => ALPHABET[byte % 32]).join("");
  return `${prefix}_${time}${random}`;
}

function defaultHandle(address) {
  return (
    address
      .split("@")[0]
      .replace(/[^a-zA-Z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "admin"
  );
}

function q(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function wrangler(extra) {
  return execFileSync(
    process.execPath,
    [WRANGLER_BIN, "d1", "execute", database, "--remote", ...extra],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 },
  );
}

function execute(sql) {
  const path = join(mkdtempSync(join(tmpdir(), "devyou-bootstrap-")), "bootstrap.sql");
  writeFileSync(path, sql, "utf8");
  try {
    wrangler(["--file", path, "--yes"]);
  } catch (error) {
    fail(`${error.stdout ?? ""}${error.stderr ?? ""}`.slice(0, 2000));
  }
}

/**
 * Reads throw rather than returning `[]`.
 *
 * Every caller above is a *refusal* check — "does an admin already exist", "is this email
 * taken". Swallowing an error there would turn an unreachable database into an empty
 * result set, and an empty result set into permission to proceed. The seeding scripts can
 * afford to be forgiving here; a script that grants every capability in the product
 * cannot.
 */
function rows(sql) {
  const out = wrangler(["--command", sql, "--json", "--yes"]);
  return JSON.parse(out.slice(out.indexOf("["))).at(0)?.results ?? [];
}

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function fail(message) {
  console.error(`\n  ERROR  ${message}\n`);
  process.exit(1);
}

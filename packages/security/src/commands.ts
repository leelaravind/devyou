import { SAFETY_LEVELS, type SafetyLevel } from "@devyou/core";

/**
 * Static danger classification for shell commands in a playbook. R-15.
 *
 * This is a heuristic, built out of pattern matches on text. It **will** have
 * false negatives: a determined author can rename a script, wrap `rm -rf` in a
 * variable, or base64-encode the whole thing one layer deeper than we unwrap,
 * and none of that is detectable by scanning a string. That is a stated,
 * accepted limitation, not an oversight to be "fixed" by trying to parse shell
 * syntax properly — a full parser buys precision, not safety, because the
 * fundamental problem (natural-language text cannot prove what a shell will do)
 * does not go away.
 *
 * What makes that acceptable is ADR-0007: DevYou never executes anything a
 * contributor submits. Every command shown on this product is inert text that a
 * human reads and then chooses, themselves, to run in their own shell. A miss
 * here is therefore a missing warning in front of a human who was always the one
 * deciding whether to run the command — not a compromised host, not an RCE, not
 * a sandbox escape. The purpose of this module is to warn, not to permit or deny
 * execution, and it should never be mistaken for the latter.
 */

export interface CommandFinding {
  /** A short, human-readable label for what matched — not the raw regex. */
  pattern: string;
  level: SafetyLevel;
  explanation: string;
}

interface Rule {
  pattern: string;
  level: SafetyLevel;
  explanation: string;
  test: (command: string) => boolean;
}

/**
 * Extract the "clause" following each match of `head` in `command` — from the
 * match up to the next statement separator (`;`, a newline, `&&` or `||`). Used
 * so a flag check (e.g. "does this `rm` invocation have both `-r` and `-f`?")
 * only looks within one command's own arguments, not the rest of a chained
 * command line.
 */
function clauseAfter(command: string, head: RegExp): string[] {
  const re = new RegExp(head.source, head.flags.includes("g") ? head.flags : `${head.flags}g`);
  const clauses: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(command)) !== null) {
    const rest = command.slice(match.index);
    const boundary = rest.search(/;|\n|&&|\|\|/);
    clauses.push(boundary === -1 ? rest : rest.slice(0, boundary));
    if (match[0].length === 0) re.lastIndex += 1; // guard against zero-width matches
  }
  return clauses;
}

/** Whether `clause` contains a short-option cluster whose letters include
 *  `letterClass` (a regex character-class fragment, e.g. `"f"` or `"[rR]"`),
 *  in any position and combined with any other short flags — matches `-rf`,
 *  `-fr`, `-Rf`, `-vf`, `-f` alike. */
function hasShortFlag(clause: string, letterClass: string): boolean {
  return new RegExp(`(^|\\s)-[A-Za-z]*${letterClass}[A-Za-z]*(\\s|$)`).test(clause);
}

/**
 * Paths whose entire content is regenerable by a command in the same project.
 *
 * `rm -rf ./node_modules` is the single most common use of that flag combination
 * in the world this product documents, and it is completely recoverable by
 * `npm install`. Rating it identically to `rm -rf /` is not caution — it is the
 * mechanism by which a warning stops being read. R-15 exists to make a genuine
 * destructive command stand out, and a classifier that shouts at routine work
 * destroys exactly that.
 *
 * Kept narrow on purpose. Every entry here is a directory that a build tool
 * recreates from committed inputs. A directory that merely *looks* disposable —
 * `tmp`, `data`, `logs` — is not on this list, because "the author probably did not
 * mean anything important" is not a safety argument.
 */
const REGENERABLE_DIRECTORIES = [
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  "vendor",
  "__pycache__",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".pytest_cache",
  ".venv",
  "venv",
  ".wrangler",
];

/** Roots where a recursive operation reaches beyond the project: `/`, `~`, `$HOME`,
 *  a bare variable that could expand to anything, or a glob at the top level. */
const DANGEROUS_ROOT_RE = /(^|\s)(\/|~|\$HOME\b|\$\{HOME\}|\/\*|~\/\*|\$\w+)(\s|$|\/\*\s*$)/;

/**
 * The operands of a command clause: everything that is not the command name and
 * not a flag. Crude — it does not understand quoting or option arguments — and
 * deliberately so, because it is used only to decide between two warning levels,
 * never to permit anything.
 */
function operandsOf(clause: string): string[] {
  return clause
    .trim()
    .split(/\s+/)
    .slice(1)
    .filter((token) => !token.startsWith("-"));
}

/** Whether every operand names a regenerable project-local directory, with no
 *  absolute path, no home reference, no variable and no glob among them. */
function targetsOnlyRegenerablePaths(clause: string): boolean {
  const operands = operandsOf(clause);
  if (operands.length === 0) return false;
  if (DANGEROUS_ROOT_RE.test(clause)) return false;

  return operands.every((operand) => {
    if (operand.startsWith("/") || operand.startsWith("~") || operand.includes("$")) return false;
    if (operand.includes("*") || operand.includes("?")) return false;

    const segments = operand.replace(/\/+$/, "").split("/");
    const last = segments[segments.length - 1];
    return last !== undefined && REGENERABLE_DIRECTORIES.includes(last);
  });
}

function rmForceRecursiveClauses(command: string): string[] {
  return clauseAfter(command, /\brm\b/i).filter((clause) => {
    const recursive = hasShortFlag(clause, "[rR]") || /--recursive\b/.test(clause);
    const force = hasShortFlag(clause, "f") || /--force\b/.test(clause);
    return recursive && force;
  });
}

/** `rm -rf` aimed at something that is not merely a rebuildable artefact. */
function isRmForceRecursive(command: string): boolean {
  return rmForceRecursiveClauses(command).some((clause) => !targetsOnlyRegenerablePaths(clause));
}

/** `rm -rf` aimed only at rebuildable artefacts — still a real deletion, still
 *  worth a note, but not the same warning as an unrecoverable one. */
function isRmForceRecursiveRegenerable(command: string): boolean {
  const clauses = rmForceRecursiveClauses(command);
  return clauses.length > 0 && clauses.every(targetsOnlyRegenerablePaths);
}

function isChmodWideOpen(command: string): boolean {
  return /\bchmod\b[^;\n]*\b0?777\b/i.test(command);
}

/**
 * `chmod -R 777 /` and its neighbours.
 *
 * Recursively making a filesystem root — or a home directory, or `/etc`, `/usr`,
 * `/var` — world-writable is not "changes state". It is a system-wide compromise
 * that no `chmod` undoes, because the original mode bits are gone. Separated from
 * the scoped case so the two do not share a warning level.
 */
function isChmodWideOpenRecursiveSystemWide(command: string): boolean {
  return clauseAfter(command, /\bchmod\b/i).some((clause) => {
    if (!/\b0?777\b/.test(clause)) return false;
    const recursive = hasShortFlag(clause, "R") || /--recursive\b/.test(clause);
    if (!recursive) return false;

    return operandsOf(clause).some((operand) =>
      /^(\/|~|\$HOME\b|\$\{HOME\})(\/?$|\/(etc|usr|var|bin|sbin|lib|opt|boot|root|home)\b)/.test(
        operand,
      ),
    );
  });
}

function isChownRecursive(command: string): boolean {
  return clauseAfter(command, /\bchown\b/i).some(
    (clause) => hasShortFlag(clause, "R") || /--recursive\b/.test(clause),
  );
}

function isGitCleanForce(command: string): boolean {
  return clauseAfter(command, /\bgit\s+clean\b/i).some(
    (clause) => hasShortFlag(clause, "f") || /--force\b/.test(clause),
  );
}

function isGitPushForce(command: string): boolean {
  return clauseAfter(command, /\bgit\s+push\b/i).some(
    (clause) => hasShortFlag(clause, "f") || /--force(-with-lease)?\b/.test(clause),
  );
}

const SQL_DROP_TRUNCATE_RE = /\b(DROP\s+(TABLE|DATABASE|SCHEMA|INDEX)|TRUNCATE(\s+TABLE)?)\b/i;

function hasUnfilteredDelete(command: string): boolean {
  return command
    .split(";")
    .some((statement) => /\bDELETE\s+FROM\b/i.test(statement) && !/\bWHERE\b/i.test(statement));
}

const PIPE_TO_SHELL_RE =
  /\b(curl|wget)\b[^\n;]*\|\s*(sudo\s+)?\b(sh|bash|zsh|ksh|dash)\b|\b(sh|bash|zsh)\s+<\(\s*(curl|wget)\b/i;

const BASE64_EXEC_RE =
  /\bbase64\b[^\n;]*(-d\b|--decode\b)[^\n;]*\|\s*(sudo\s+)?\b(sh|bash|zsh|ksh|dash|python3?|perl)\b/i;

const HISTORY_EVASION_RE = /\bhistory\s+-c\b|\bHISTFILE\s*=\s*\/dev\/null\b|\bunset\s+HISTFILE\b/i;

const SSH_WRITE_RE = /(>{1,2}\s*\S*\.ssh\/|\b(tee|cp|mv|install)\b[^\n;]*\.ssh\/)/i;

const ETC_WRITE_RE = /(>{1,2}\s*\/etc\/|\b(tee|cp|mv|install)\b[^\n;]*\/etc\/)/i;

/**
 * Patterns that look like a real credential rather than a placeholder.
 *
 * Shared with `looksLikeSecret`. These are shape-based, not entropy-based: no
 * attempt is made to score "randomness", only to recognise the well-known
 * structural fingerprints of common credential formats. That misses anything
 * bespoke (an internal service's own token format) and it will occasionally
 * flag a value that merely looks the part — both are the right side to err on
 * for a public page.
 */
const SECRET_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "AWS access key ID", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "AWS temporary access key ID", re: /\bASIA[0-9A-Z]{16}\b/ },
  { name: "AWS secret access key", re: /\baws_secret_access_key\s*=\s*[A-Za-z0-9/+=]{40}\b/i },
  { name: "GitHub token", re: /\bgh[opsu]_[A-Za-z0-9]{36,}\b/ },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "bearer token", re: /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}=*/i },
  { name: "private key header", re: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH|PGP)?\s*PRIVATE KEY-----/i },
  {
    name: "credential-shaped assignment",
    re: /\b(api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9\-_]{16,}["']?/i,
  },
  {
    /*
      A password embedded in a connection URI — `postgres://user:pass@host/db`.

      This is the shape a pasted `DATABASE_URL` takes, and it is one of the most
      common accidental leaks there is: nobody thinks of a connection string as a
      credential, because the credential is not labelled. Every pattern above
      requires a literal keyword before the value, so this shape slipped through all
      of them.

      Matched on structure rather than on a keyword: a scheme, a userinfo section
      containing a colon, and an `@`. The password is required to be at least four
      characters so that `http://localhost:8787/path` and other colon-bearing URLs
      with no userinfo do not match.
    */
    name: "credential in a connection URI",
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/?#@]+:[^\s/?#@]{4,}@[^\s/?#]+/i,
  },
];

function matchesAnySecretPattern(text: string): boolean {
  return SECRET_PATTERNS.some((entry) => entry.re.test(text));
}

const RULES: Rule[] = [
  {
    pattern: "rm -rf (or equivalent)",
    level: "destructive",
    explanation: "Recursively force-deletes without confirmation. Unrecoverable outside a backup.",
    test: isRmForceRecursive,
  },
  {
    pattern: "dd",
    level: "destructive",
    explanation:
      "Writes raw blocks; the wrong `of=` target overwrites a disk or partition with no warning.",
    test: (command) => /\bdd\b[^\n;]*\b(if|of)=/i.test(command),
  },
  {
    pattern: "mkfs",
    level: "destructive",
    explanation: "Formats a filesystem, erasing everything currently on it.",
    test: (command) => /\bmkfs(\.\w+)?\b/i.test(command),
  },
  {
    pattern: "redirect to a raw block device",
    level: "destructive",
    explanation:
      "Writing directly to /dev/sd*, /dev/hd*, /dev/nvme* or /dev/xvd* can destroy a disk's contents.",
    test: (command) => />\s*\/dev\/(sd|hd|nvme|xvd)\w*/i.test(command),
  },
  {
    pattern: "rm -rf of a rebuildable directory",
    level: "state_changing",
    explanation:
      "Deletes a directory that a build tool regenerates (node_modules, dist, a cache). Still a real " +
      "deletion — anything you edited in there is gone — but recoverable by reinstalling or rebuilding.",
    test: isRmForceRecursiveRegenerable,
  },
  {
    pattern: "chmod -R 777 on a system path",
    level: "destructive",
    explanation:
      "Recursively makes a filesystem root or system directory world-writable. The original permissions " +
      "are not recorded anywhere, so this cannot be undone, and any local user can then modify anything.",
    test: isChmodWideOpenRecursiveSystemWide,
  },
  {
    pattern: "chmod 777",
    level: "state_changing",
    explanation:
      "Makes a path world-readable, world-writable and world-executable. Doesn't destroy data by itself, " +
      "but is a common precursor to a much worse compromise.",
    test: isChmodWideOpen,
  },
  {
    pattern: "chown -R",
    level: "state_changing",
    explanation:
      "Recursively changes ownership; can lock out a service account or break existing permissions.",
    test: isChownRecursive,
  },
  {
    pattern: "DROP / TRUNCATE",
    level: "destructive",
    explanation:
      "Removes an entire table, database, schema or index. There is no WHERE clause to narrow this.",
    test: (command) => SQL_DROP_TRUNCATE_RE.test(command),
  },
  {
    pattern: "DELETE without WHERE",
    level: "destructive",
    explanation: "A DELETE FROM with no WHERE clause removes every row in the table.",
    test: hasUnfilteredDelete,
  },
  {
    pattern: "docker system prune",
    level: "destructive",
    explanation:
      "Removes stopped containers, unused networks, dangling images and (with -a/--volumes) volumes.",
    test: (command) => /\bdocker\s+system\s+prune\b/i.test(command),
  },
  {
    pattern: "kubectl delete",
    level: "destructive",
    explanation:
      "Deletes a live cluster resource — a pod, deployment, namespace or persistent volume claim.",
    test: (command) => /\bkubectl\s+delete\b/i.test(command),
  },
  {
    pattern: "terraform destroy",
    level: "destructive",
    explanation: "Tears down every resource the Terraform state manages.",
    test: (command) => /\bterraform\s+destroy\b/i.test(command),
  },
  {
    pattern: "git push --force",
    level: "destructive",
    explanation:
      "Overwrites remote history. Anyone who already pulled the old history can lose commits.",
    test: isGitPushForce,
  },
  {
    pattern: "git clean -f",
    level: "destructive",
    explanation:
      "Permanently deletes untracked (and, with -d/-x, ignored) files with no way to undo it via git.",
    test: isGitCleanForce,
  },
  {
    pattern: "pipe a remote script into a shell",
    level: "destructive",
    explanation:
      "curl/wget piped straight into sh/bash runs whatever the remote server returns at that moment, " +
      "unreviewed and unpinned. The content can differ per request or per requester.",
    test: (command) => PIPE_TO_SHELL_RE.test(command),
  },
  {
    pattern: "eval",
    level: "destructive",
    explanation:
      "Executes a constructed string as a command. What actually runs is opaque until it does.",
    test: (command) => /\beval\b/i.test(command),
  },
  {
    pattern: "decode and execute",
    level: "destructive",
    explanation:
      "A base64-decoded payload piped into an interpreter — the actual command is hidden from a skim-read.",
    test: (command) => BASE64_EXEC_RE.test(command),
  },
  {
    pattern: "credential-shaped literal",
    level: "credential_sensitive",
    explanation:
      "This text matches the shape of a real credential (AWS key, bearer token, private key header, or " +
      "similar). If it is genuine it is already exposed on this page and must be rotated.",
    test: matchesAnySecretPattern,
  },
  {
    pattern: "clear shell history",
    level: "state_changing",
    explanation:
      "Erases the local command history. Legitimate uses exist, but it is also a common anti-forensic step.",
    test: (command) => HISTORY_EVASION_RE.test(command),
  },
  {
    pattern: "write into ~/.ssh",
    level: "credential_sensitive",
    explanation:
      "Writes into an SSH key directory — a common way to plant or overwrite key material.",
    test: (command) => SSH_WRITE_RE.test(command),
  },
  {
    pattern: "write into /etc",
    level: "destructive",
    explanation: "Writes into system configuration. A bad write here can break the host outright.",
    test: (command) => ETC_WRITE_RE.test(command),
  },
];

function highestLevel(levels: readonly SafetyLevel[]): SafetyLevel {
  let best: SafetyLevel = "informational";
  for (const level of levels) {
    if (SAFETY_LEVELS.indexOf(level) > SAFETY_LEVELS.indexOf(best)) best = level;
  }
  return best;
}

/**
 * Classify a command (or a whole script) by the most dangerous thing found in
 * it. The overall level is the highest level among all findings; the default,
 * when nothing matches, is `"informational"` — never absence of a result.
 */
export function classifyCommand(command: string): {
  level: SafetyLevel;
  findings: CommandFinding[];
} {
  const findings: CommandFinding[] = [];
  for (const rule of RULES) {
    if (rule.test(command)) {
      findings.push({ pattern: rule.pattern, level: rule.level, explanation: rule.explanation });
    }
  }
  return { level: highestLevel(findings.map((finding) => finding.level)), findings };
}

/**
 * Whether `text` contains something shaped like a real secret.
 *
 * Meant to run *before* a contributor submits a playbook step — a client-side
 * "this looks like a live credential, are you sure?" nudge — not only after
 * publication. Shares its pattern list with `classifyCommand`; see the comment
 * on `SECRET_PATTERNS` for what this does and does not catch.
 */
export function looksLikeSecret(text: string): boolean {
  return matchesAnySecretPattern(text);
}

/* ---------------------------------------------------------------------------
   Positive proof of read-only
   --------------------------------------------------------------------------- */

/**
 * Whether a command can be *proved* to change nothing.
 *
 * This is not the negation of `classifyCommand`. That function returns
 * `informational` when no dangerous rule matched, which is absence of evidence —
 * `curl x | sh` scores `informational` and is arbitrary code execution. Nothing may
 * ever be downgraded on the strength of "we found no problem".
 *
 * This function is the opposite shape: it returns `true` only for command forms it
 * positively recognises as reads, and `false` for everything else including
 * everything it does not understand. The default answer is "cannot prove it", and
 * that default is what makes it safe to act on the `true`.
 *
 * It exists because a *false* danger signal has a cost too. The AI structuring path
 * lets a model propose a safety level, and a model told "if you are unsure whether
 * something is destructive, say it is" will mark a read-only query `destructive`.
 * Left uncorrected, a reader learns that the red label means nothing — which is the
 * same defect `targetsOnlyRegenerablePaths` exists to prevent for `rm -rf`, arriving
 * by a different route.
 */

/** Anything that could chain, redirect, substitute or expand into a second command.
 *  If one of these is present the string is more than one command and this function
 *  does not attempt to reason about it. */
const SHELL_COMPOSITION_RE = /[;&|<>`\n\r]|\$\(|\$\{|\|\||&&/;

/** Statements that read. `explain` is included because `EXPLAIN` and
 *  `EXPLAIN QUERY PLAN` compile a statement without running it — but only when the
 *  statement being explained is itself read-only, which the keyword ban below
 *  enforces over the whole string. */
const READ_ONLY_SQL_HEAD_RE = /^(select|explain|with)\b/;

/**
 * Every keyword that can write, alter schema, change transaction state, or reach
 * outside the current database.
 *
 * `pragma` is here deliberately: several pragmas write (`journal_mode`,
 * `user_version`, `foreign_keys`), and distinguishing the readable ones from the
 * writable ones is a bigger surface than the value of proving a pragma safe.
 * `attach`/`detach` are here because they reach another file. `with` is permitted as
 * a *head* above but a CTE followed by `INSERT ... SELECT` is a write, and this ban
 * catches it because the keyword appears somewhere in the statement.
 */
const WRITE_SQL_KEYWORD_RE =
  /\b(insert|update|delete|drop|alter|create|replace|truncate|attach|detach|pragma|vacuum|reindex|begin|commit|rollback|savepoint|release|analyze)\b/;

/** Strip SQL comments before any keyword test. `SELECT 1 -- ; DROP TABLE t` and
 *  `SELECT/*x*\/1` both exist to defeat a naive scanner. */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/**
 * Whether every statement in a SQL string is a read.
 *
 * Exported for its own tests: the interesting cases (a write hidden after a
 * comment, a second statement after a semicolon, a CTE that inserts) are properties
 * of this function rather than of the command wrapping it.
 */
export function isReadOnlySql(sql: string): boolean {
  const cleaned = stripSqlComments(sql).toLowerCase();
  if (WRITE_SQL_KEYWORD_RE.test(cleaned)) return false;

  const statements = cleaned
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");

  /* An empty string is not a proof of anything. */
  if (statements.length === 0) return false;

  return statements.every((statement) => READ_ONLY_SQL_HEAD_RE.test(statement));
}

/** The `--command "<sql>"` / `--command=<sql>` operand, or null when absent or not
 *  a single quoted literal this function can read. */
function d1CommandOperand(command: string): string | null {
  const quoted = /--command(?:=|\s+)(["'])([\s\S]*?)\1/.exec(command);
  if (quoted) return quoted[2] ?? null;
  return null;
}

/**
 * Whether the command is a D1 query whose SQL is visible and read-only.
 *
 * `wrangler d1 execute` is matched however it was invoked — bare, through `npx`, or
 * as `node .../wrangler.js`, which is the form that appears when somebody works
 * around pnpm's non-hoisted layout. What is *not* accepted is `--file`, because the
 * SQL then lives somewhere this function cannot see, and an unreadable statement is
 * an unproven one.
 */
function isReadOnlyD1Execute(command: string): boolean {
  if (!/\bd1\s+execute\b/.test(command)) return false;
  if (!/\bwrangler\b/.test(command)) return false;
  if (/--file\b/.test(command)) return false;

  const sql = d1CommandOperand(command);
  return sql !== null && isReadOnlySql(sql);
}

/**
 * The allow-list. Each entry recognises one command form and proves it reads.
 *
 * Deliberately short. Every addition is a new way for something to be marked safe,
 * so this grows one reviewed entry at a time rather than by pattern-matching on
 * "looks harmless".
 */
const READ_ONLY_PROOFS: ReadonlyArray<{ name: string; test: (command: string) => boolean }> = [
  { name: "wrangler d1 execute with a read-only --command", test: isReadOnlyD1Execute },
];

export function isProvablyReadOnly(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed === "") return false;

  /*
    Composition is checked before the allow-list, not after.

    `wrangler d1 execute db --command "SELECT 1"; rm -rf /` contains a form this
    module recognises, and proving the recognised half says nothing about the rest.
    A string holding more than one command is never proved here.
  */
  if (SHELL_COMPOSITION_RE.test(trimmed)) return false;

  return READ_ONLY_PROOFS.some((proof) => proof.test(trimmed));
}

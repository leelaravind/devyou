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

function isRmForceRecursive(command: string): boolean {
  return clauseAfter(command, /\brm\b/i).some((clause) => {
    const recursive = hasShortFlag(clause, "[rR]") || /--recursive\b/.test(clause);
    const force = hasShortFlag(clause, "f") || /--force\b/.test(clause);
    return recursive && force;
  });
}

function isChmodWideOpen(command: string): boolean {
  return /\bchmod\b[^;\n]*\b0?777\b/i.test(command);
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
    explanation: "Writes raw blocks; the wrong `of=` target overwrites a disk or partition with no warning.",
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
    explanation: "Writing directly to /dev/sd*, /dev/hd*, /dev/nvme* or /dev/xvd* can destroy a disk's contents.",
    test: (command) => />\s*\/dev\/(sd|hd|nvme|xvd)\w*/i.test(command),
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
    explanation: "Recursively changes ownership; can lock out a service account or break existing permissions.",
    test: isChownRecursive,
  },
  {
    pattern: "DROP / TRUNCATE",
    level: "destructive",
    explanation: "Removes an entire table, database, schema or index. There is no WHERE clause to narrow this.",
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
    explanation: "Removes stopped containers, unused networks, dangling images and (with -a/--volumes) volumes.",
    test: (command) => /\bdocker\s+system\s+prune\b/i.test(command),
  },
  {
    pattern: "kubectl delete",
    level: "destructive",
    explanation: "Deletes a live cluster resource — a pod, deployment, namespace or persistent volume claim.",
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
    explanation: "Overwrites remote history. Anyone who already pulled the old history can lose commits.",
    test: isGitPushForce,
  },
  {
    pattern: "git clean -f",
    level: "destructive",
    explanation: "Permanently deletes untracked (and, with -d/-x, ignored) files with no way to undo it via git.",
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
    explanation: "Executes a constructed string as a command. What actually runs is opaque until it does.",
    test: (command) => /\beval\b/i.test(command),
  },
  {
    pattern: "decode and execute",
    level: "destructive",
    explanation: "A base64-decoded payload piped into an interpreter — the actual command is hidden from a skim-read.",
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
    explanation: "Erases the local command history. Legitimate uses exist, but it is also a common anti-forensic step.",
    test: (command) => HISTORY_EVASION_RE.test(command),
  },
  {
    pattern: "write into ~/.ssh",
    level: "credential_sensitive",
    explanation: "Writes into an SSH key directory — a common way to plant or overwrite key material.",
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
export function classifyCommand(command: string): { level: SafetyLevel; findings: CommandFinding[] } {
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

/**
 * Query normalisation and error fingerprinting.
 *
 * This is the file that decides whether a pasted stack trace finds anything.
 *
 * The problem it solves: two developers hit the same bug and paste text that shares
 * almost no tokens. One has `/home/alice/app/src/db.ts:41`, a timestamp, a request
 * id and a container hostname; the other has `/Users/bob/work/api/src/db.ts:57` and
 * a different everything. What they share is the exception type, the frame
 * sequence and the error code — and those are what this extracts.
 *
 * Ordering follows R-18: the fingerprint is built from the stack trace first, then
 * the exception, then the message, because the message is the part most polluted by
 * volatile data. That is the Sentry grouping model, adopted because it is the one
 * with a decade of production evidence behind it.
 *
 * Everything here is deterministic and pure. Plan §11 forbids an AI call on an exact
 * error search, and this is why one is not needed.
 */

/* ---------------------------------------------------------------------------
   Volatile-data patterns
   --------------------------------------------------------------------------- */

/**
 * Patterns replaced by a placeholder before fingerprinting.
 *
 * Order matters within this list: UUIDs are matched before hex blobs, and absolute
 * paths before bare numbers, so a more specific pattern claims its text first.
 *
 * Each placeholder keeps its *kind*. Replacing a UUID with `<uuid>` rather than
 * deleting it preserves the shape of the line, which is itself signal — two errors
 * that both carry a UUID in the same position are more alike than one that does and
 * one that does not.
 */
const VOLATILE: ReadonlyArray<{ name: string; pattern: RegExp; replacement: string }> = [
  {
    name: "iso-timestamp",
    pattern: /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g,
    replacement: "<ts>",
  },
  { name: "uuid", pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, replacement: "<uuid>" },
  // Cloudflare ray ids, request ids, trace ids: long hex runs.
  { name: "hex-blob", pattern: /\b[0-9a-f]{16,}\b/gi, replacement: "<hex>" },
  { name: "ipv4", pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: "<ip>" },
  { name: "port", pattern: /:\d{2,5}\b/g, replacement: ":<port>" },
  /*
    Absolute paths become `<path>/<file>`, keeping the filename.

    The directory tells you whose machine it was; the filename is often the only
    thing that identifies the code. `/home/alice/app/src/db.ts` and
    `/Users/bob/work/api/src/db.ts` should fingerprint identically as `<path>/db.ts`.
  */
  { name: "unix-path", pattern: /(?:\/[\w.@-]+){2,}\/([\w.-]+)/g, replacement: "<path>/$1" },
  { name: "windows-path", pattern: /[A-Za-z]:\\(?:[\w.@ -]+\\)+([\w.-]+)/g, replacement: "<path>/$1" },
  { name: "line-col", pattern: /:\d+:\d+/g, replacement: ":<line>" },
  { name: "hash-suffix", pattern: /-[0-9a-z]{8}\.(js|css|mjs|map)\b/gi, replacement: "-<hash>.$1" },
  { name: "pid", pattern: /\bpid[= ]\d+/gi, replacement: "pid=<n>" },
  { name: "duration", pattern: /\b\d+(?:\.\d+)?\s?(ms|s|sec|seconds|minutes)\b/gi, replacement: "<duration>" },
  { name: "bytes", pattern: /\b\d{4,}\s?(bytes|B|KB|MB|GB)\b/gi, replacement: "<size>" },
];

/**
 * Tokens that must survive normalisation untouched.
 *
 * These are the highest-signal strings a query can contain, and several of them
 * would otherwise be eaten by the rules above — `SQLSTATE 40001` looks like a bare
 * number, `Error 1101` looks like a count. Matched and protected before any
 * substitution runs.
 */
const ERROR_CODE_PATTERNS: readonly RegExp[] = [
  /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, // SQLITE_BUSY, ERR_MODULE_NOT_FOUND, ECONNREFUSED-style compounds
  /\bE[A-Z]{3,}\b/g, // ECONNREFUSED, ENOTFOUND, EACCES
  /\bSQLSTATE\s?\d{5}\b/gi,
  /\bHTTP\s?[45]\d{2}\b/gi,
  /\berror\s+\d{3,5}\b/gi,
  /\bexit\s+(?:code\s+)?\d{1,3}\b/gi,
  /\b0x[0-9a-f]{4,8}\b/gi,
  /\bGHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}\b/gi,
  /\bCVE-\d{4}-\d{4,7}\b/gi,
];

export interface NormalisedQuery {
  /** What the reader typed, trimmed and length-capped. Never stored in telemetry. */
  raw: string;
  /** Volatile data replaced. The basis for the fingerprint. */
  normalised: string;
  /** Stable hash of `normalised`, or null when there was nothing error-shaped. */
  signatureHash: string | null;
  /** Error codes found, preserved verbatim. The strongest ranking signal there is. */
  errorCodes: string[];
  /** Exception or error class names — `TypeError`, `java.lang.NullPointerException`. */
  exceptionTypes: string[];
  /** Package, module and file names pulled from stack frames. */
  frames: string[];
  /** Version-looking strings, for environment inference. */
  versionHints: string[];
  /** What kind of thing this appears to be. Drives which retrieval path runs first. */
  shape: QueryShape;
  /** Terms for the FTS query, already escaped. */
  ftsTerms: string[];
}

export type QueryShape = "exact_error" | "stack_trace" | "log" | "natural_language" | "mixed";

/** Anything longer is truncated. A 4000-character paste is a log file, and the
 *  signal is in its first lines; accepting the rest costs CPU on every search. */
export const MAX_QUERY_LENGTH = 4000;

export function normaliseQuery(input: string): NormalisedQuery {
  const raw = input.slice(0, MAX_QUERY_LENGTH).trim();

  const errorCodes = unique(collect(raw, ERROR_CODE_PATTERNS));
  const exceptionTypes = unique(collectExceptions(raw));
  const frames = unique(collectFrames(raw));
  const versionHints = unique(collectVersions(raw));

  let normalised = raw;
  for (const rule of VOLATILE) {
    normalised = normalised.replace(rule.pattern, rule.replacement);
  }
  normalised = normalised.replace(/\s+/g, " ").trim().toLowerCase();

  const shape = classify(raw, errorCodes, exceptionTypes, frames);

  /*
    The fingerprint is built from structure, not from the whole text.

    Hashing the normalised message alone would make two reports of the same fault
    differ whenever their wording differed by a word. Composing it from the
    exception types and the frame sequence — the parts that come from the code
    rather than from the situation — is what makes it match across machines.
  */
  const fingerprintBasis =
    frames.length > 0 || exceptionTypes.length > 0
      ? [...exceptionTypes, ...errorCodes, ...frames.slice(0, 8)].join("|").toLowerCase()
      : errorCodes.length > 0
        ? errorCodes.join("|").toLowerCase()
        : null;

  return {
    raw,
    normalised,
    signatureHash: fingerprintBasis === null ? null : digest(fingerprintBasis),
    errorCodes,
    exceptionTypes,
    frames,
    versionHints,
    shape,
    ftsTerms: buildFtsTerms(normalised, errorCodes, exceptionTypes, frames),
  };
}

/**
 * The fingerprint of a *playbook's* signature, so a query fingerprint can match it.
 *
 * Same function as the query path, deliberately. Two different implementations that
 * are supposed to agree is a bug waiting for a quiet afternoon.
 */
export function fingerprintSignature(input: {
  errorCode: string | null;
  exceptionTypes?: readonly string[];
  frames?: readonly string[];
}): string | null {
  const parts = [
    ...(input.exceptionTypes ?? []),
    ...(input.errorCode ? [input.errorCode] : []),
    ...(input.frames ?? []).slice(0, 8),
  ];
  return parts.length === 0 ? null : digest(parts.join("|").toLowerCase());
}

/* ---------------------------------------------------------------------------
   Extraction
   --------------------------------------------------------------------------- */

function collect(text: string, patterns: readonly RegExp[]): string[] {
  const found: string[] = [];
  for (const pattern of patterns) {
    // Patterns are module-level and carry /g, so lastIndex has to be reset or a
    // second call silently starts mid-string.
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (match[0]) found.push(match[0].trim());
    }
  }
  return found;
}

const EXCEPTION_PATTERNS: readonly RegExp[] = [
  // java.lang.NullPointerException, com.example.MyException
  /\b(?:[a-z][\w]*\.){2,}[A-Z]\w*(?:Error|Exception|Throwable)\b/g,
  // TypeError, ReferenceError, ValidationError, panic:
  /\b[A-Z]\w*(?:Error|Exception|Warning|Fault)\b/g,
  /\bpanic:/g,
  /\bFATAL:/g,
  /\bSIGSEGV|SIGKILL|SIGTERM\b/g,
];

function collectExceptions(text: string): string[] {
  return collect(text, EXCEPTION_PATTERNS);
}

/**
 * Stack frames.
 *
 * Only the identifying part of a frame is kept — the module or file name and, where
 * present, the function. Line numbers are deliberately dropped: they change with
 * every release of the library the frame is in, so keeping them would make the
 * fingerprint version-specific in exactly the way that stops it matching.
 */
const FRAME_PATTERNS: readonly RegExp[] = [
  /at\s+([\w$.<>]+)\s*\(/g, // JS: "at Object.foo ("
  /\bat\s+([\w.$]+\.[\w$]+)\(/g, // Java: "at com.example.Foo.bar("
  /File\s+"[^"]*\/([\w.]+\.py)",\s+line\s+\d+,\s+in\s+(\w+)/g, // Python
  /\b((?:node_modules\/)?[@\w./-]+)\/([\w.-]+\.(?:js|mjs|cjs|ts|tsx|py|go|rb|rs|java|kt)):/g,
  /\bin\s+([\w.]+)\s+at\s+[\w./\\]+:\d+/g, // Go-ish
];

function collectFrames(text: string): string[] {
  const found: string[] = [];
  for (const pattern of FRAME_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const captured = match.slice(1).filter(Boolean).join(".");
      if (captured && captured.length < 120) found.push(captured);
    }
  }
  return found;
}

const VERSION_PATTERNS: readonly RegExp[] = [
  /\bv?\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?\b/g,
  /\b(?:node|python|ruby|go|java|php)[\s/@]v?\d+(?:\.\d+)*/gi,
];

function collectVersions(text: string): string[] {
  return collect(text, VERSION_PATTERNS).filter((version) => {
    // Reject things that are timestamps or IPs wearing a version's clothes.
    const digitsOnly = version.replace(/\D/g, "");
    return digitsOnly.length <= 8 && !/^\d{4}\./.test(version);
  });
}

/* ---------------------------------------------------------------------------
   Classification
   --------------------------------------------------------------------------- */

function classify(
  raw: string,
  errorCodes: readonly string[],
  exceptions: readonly string[],
  frames: readonly string[],
): QueryShape {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== "");
  const wordCount = raw.split(/\s+/).length;

  if (frames.length >= 2) return "stack_trace";

  /*
    A short query that is mostly an error code is `exact_error`, and that routing
    decision matters more than the label: it is the case that must be answered by
    signature lookup rather than by relevance ranking, because a well-written
    summary elsewhere in the corpus can outrank an exact match on a short string.
  */
  if (errorCodes.length > 0 && wordCount <= 12) return "exact_error";

  if (lines.length >= 4 && /^\s*(\[|\d{4}-|\w+\s+\d{1,2}\s)/.test(lines[0] ?? "")) return "log";

  if (errorCodes.length > 0 || exceptions.length > 0) return "mixed";

  return "natural_language";
}

/* ---------------------------------------------------------------------------
   FTS terms
   --------------------------------------------------------------------------- */

/** SQLite reserves these inside a MATCH expression. */
const FTS_RESERVED = /[\p{P}\p{S}]/gu;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be", "been",
  "to", "of", "in", "on", "at", "for", "with", "from", "by", "as", "it", "this",
  "that", "i", "my", "when", "why", "how", "get", "getting", "got", "keep", "keeps",
]);

/**
 * Build the terms for an FTS5 MATCH.
 *
 * Error codes and exception types are quoted as phrases so FTS treats them as one
 * token — `"SQLITE_BUSY"` rather than `sqlite OR busy`, which would match every
 * playbook mentioning SQLite. That single quoting decision is worth more to result
 * quality than any ranking weight applied afterwards.
 */
function buildFtsTerms(
  normalised: string,
  errorCodes: readonly string[],
  exceptions: readonly string[],
  frames: readonly string[],
): string[] {
  const phrases = [...errorCodes, ...exceptions, ...frames.slice(0, 5)].map(
    (term) => `"${term.replace(/"/g, "")}"`,
  );

  const words = normalised
    .replace(FTS_RESERVED, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && word.length <= 40 && !STOPWORDS.has(word))
    .slice(0, 24);

  return unique([...phrases, ...words]);
}

/* ---------------------------------------------------------------------------
   Digest
   --------------------------------------------------------------------------- */

/**
 * A stable 64-bit-ish digest.
 *
 * Two FNV-1a passes with different offset bases, concatenated. This is a bucketing
 * key for matching identical error shapes, not a security primitive — a collision
 * surfaces an unrelated playbook, which is a relevance bug, not a vulnerability.
 *
 * `crypto.subtle` would be stronger and is asynchronous, which would make every
 * caller in the search path async for no gain that matters here.
 */
function digest(input: string): string {
  return `${fnv1a(input, 0x811c9dc5)}${fnv1a(input, 0x01000193)}`;
}

function fnv1a(input: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

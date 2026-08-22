/**
 * Identifiers.
 *
 * Prefixed ULID-shaped ids rather than bare UUIDs. Two reasons that both matter
 * operationally: a prefixed id in a log line or a support ticket says what it
 * refers to without a lookup, and a monotonic prefix keeps insert order roughly
 * aligned with primary-key order in SQLite, which matters for append-only tables
 * that are only ever read in time order.
 */

export const ID_PREFIXES = {
  user: "usr",
  profile: "prf",
  technology: "tec",
  version: "ver",
  problem: "prb",
  signature: "sig",
  symptom: "sym",
  playbook: "pbk",
  revision: "rev",
  node: "nod",
  edge: "edg",
  constraint: "cst",
  sourceReference: "src",
  evidence: "evd",
  environmentSnapshot: "env",
  environmentPreset: "prs",
  reproduction: "rep",
  draft: "drf",
  proposal: "prp",
  moderationCase: "mod",
  identityClaim: "clm",
  auditEvent: "aud",
  searchEvent: "sev",
  session: "ses",
  aiTask: "aij",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32: no I, L, O, U

/**
 * A sortable, prefixed identifier.
 *
 * `crypto.getRandomValues`, never `Math.random` — these appear in URLs and an
 * id that can be guessed is an id that can be enumerated. The lint config blocks
 * `Math.random` outright so this cannot regress quietly.
 */
export function newId(kind: IdKind, now: number = Date.now()): string {
  const time = encodeTime(now, 10);
  const random = encodeRandom(16);
  return `${ID_PREFIXES[kind]}_${time}${random}`;
}

function encodeTime(now: number, length: number): string {
  let out = "";
  let remaining = now;
  for (let i = length - 1; i >= 0; i--) {
    const mod = remaining % 32;
    out = ALPHABET[mod] + out;
    remaining = (remaining - mod) / 32;
  }
  return out;
}

function encodeRandom(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % 32];
  return out;
}

export function isId(kind: IdKind, value: string): boolean {
  return value.startsWith(`${ID_PREFIXES[kind]}_`) && value.length === ID_PREFIXES[kind].length + 27;
}

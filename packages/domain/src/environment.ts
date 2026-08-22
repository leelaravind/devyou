/**
 * Version normalisation and environment matching.
 *
 * The core problem this file solves: SQLite (and D1, which is SQLite) has no semver
 * type, no `CAST` that understands version strings, and no user-defined functions to
 * lean on. The only comparison operator the database can run over a version column is
 * plain string `<`/`<=`/`>`/`>=`. So every version that enters the system — a
 * reader's declared "Node 22.3.1", a playbook's "linux, node >=20.0.0 <22.0.0" — is
 * turned into a fixed-width, zero-padded string (`semverNormalized`) *once*, at write
 * time, such that ordinary string comparison on that string agrees with numeric
 * version ordering. Everything downstream, including the SQL that filters
 * `revision_environment_constraints`, can then use `<` directly.
 *
 * `compareVersions` in this file is written to match that contract exactly — it does
 * a plain string comparison of already-normalised forms, on purpose, rather than
 * re-parsing and comparing numerically. If the JS comparison and the SQL comparison
 * ever disagreed, a range check could pass in the app and fail (or vice versa) in a
 * query, which is a much worse bug than either being "slightly wrong" on its own.
 *
 * What this file does not do: resolve a raw label to a `technologyId`, look up a
 * `versions` row, or touch the database. That resolution happens in the layer that
 * has DB access; this module is pure so it can be unit-tested exhaustively and
 * reused unchanged from both the ingest path and the read path.
 */

/* ---------------------------------------------------------------------------
   Normalisation
   --------------------------------------------------------------------------- */

/** Width of each zero-padded component. 99999 is an absurd version component in
 *  practice (nobody ships a "major version 100000"), so it is used as a hard ceiling
 *  rather than growing the field — a real version that exceeds it is clamped, not
 *  rejected, because refusing to store *any* normalised form for it would be worse
 *  than an imprecise one. */
const COMPONENT_DIGITS = 5;
const MAX_COMPONENT = 99_999;

const LEADING_V_RE = /^[vV](?=\d)/;
/** A bare ISO-style date such as "2024-11-01". Deliberately strict — it only matches
 *  a full `YYYY-M(M)-D(D)` string with nothing else attached. Anything looser (a
 *  two-digit year, a slash-separated date, a date with a trailing suffix) is
 *  genuinely ambiguous with a dash-separated pre-release tag, and guessing wrong
 *  there is worse than declining to normalise it. */
const ISO_DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
/** Up to three dot-separated numeric components, optionally followed by a
 *  pre-release/build suffix introduced by `-` or `+` (e.g. `-rc.1`, `-alpine`,
 *  `+build.5`). Anything that doesn't fit this shape — no leading digit at all,
 *  four or more dotted components, a suffix with characters outside
 *  `[0-9A-Za-z._-]` — is not a version this function can place on a number line, and
 *  it returns `null` rather than guessing. */
const NUMERIC_VERSION_RE = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?([-+][0-9A-Za-z._-]+)?$/;

function clampComponent(n: number): number {
  return Math.min(Math.max(n, 0), MAX_COMPONENT);
}

function formatTriple(major: number, minor: number, patch: number): string {
  const pad = (n: number) => String(n).padStart(COMPONENT_DIGITS, "0");
  return `${pad(major)}.${pad(minor)}.${pad(patch)}`;
}

/**
 * The value that sorts immediately below `major.minor.patch` in this encoding.
 *
 * This is how pre-release ordering is implemented, and it is worth spelling out
 * because it is the least obvious part of this file. Plain string comparison can
 * only ever make a string sort *before* another by differing from it somewhere
 * inside a shared-length prefix — appending characters to a string always makes it
 * sort *after* the original, never before. That rules out the obvious approach of
 * writing `1.0.0-rc.1` as `"00001.00000.00000-rc.1"`: as a string, that is *greater*
 * than `"00001.00000.00000"`, which is the opposite of what semver requires.
 *
 * So instead, a version with a pre-release/build suffix is normalised to one tick
 * *below* its release triple, by decrementing patch (borrowing from minor, then
 * major, on underflow) — the same trick used by Debian/OSGi-style "epsilon before
 * version X" comparisons, just spelled with digits instead of a dedicated sentinel
 * character, because a dedicated sentinel is exactly what plain SQL string
 * comparison does not let us have.
 *
 * Two limitations follow directly from that, and both are acceptable for what this
 * column is used for (deciding whether a playbook's declared range covers a reader's
 * version — not sorting a changelog):
 *
 * 1. Every pre-release of the same `major.minor.patch` collapses to the *same*
 *    normalised value. `1.0.0-alpha` and `1.0.0-rc.1` are indistinguishable here;
 *    both merely sort below `1.0.0` and above `0.<max>.<max>` (the previous patch).
 *    Ordering *between* pre-releases of the same release is not preserved.
 * 2. The decremented value is indistinguishable from a real release that happens to
 *    land exactly on it (e.g. an actual `1.2.99999` release vs. `1.3.0-rc.1`, which
 *    also decrements to `1.2.99999`). In practice nobody publishes patch/minor
 *    numbers anywhere near 99999, so this is a theoretical collision, not an
 *    observed one.
 * 3. `0.0.0-anything` cannot decrement further (there is no version before it) and
 *    is left at `0.0.0` — it ties with, rather than sorts before, an actual `0.0.0`
 *    release. Nothing in this product's technology catalogue is versioned `0.0.0`.
 *
 * Build metadata (`+build.5`) is treated identically to a pre-release tag (pushed
 * below the release) even though strict semver says build metadata must not affect
 * precedence at all. Distinguishing the two would need a second bit of state this
 * fixed-width string has no room for, and conflating them only matters if two
 * constraint rows differ *solely* by build metadata on an otherwise-identical
 * version, which does not happen in this product's data.
 */
function decrementForPrerelease(major: number, minor: number, patch: number): [number, number, number] {
  if (patch > 0) return [major, minor, patch - 1];
  if (minor > 0) return [major, minor - 1, MAX_COMPONENT];
  if (major > 0) return [major - 1, MAX_COMPONENT, MAX_COMPONENT];
  return [0, 0, 0];
}

/**
 * Normalise a raw version label into a zero-padded, sortable string, or `null` when
 * the label carries no numeric version at all (`"latest"`, `"main"`, `"stable"`).
 *
 * `null` is a real, meaningful outcome, not a failure to be defaulted away: it is
 * how `matchEnvironment` below knows to report a component as `unknown` rather than
 * silently treating "latest" as version zero or as "always in range".
 */
export function normaliseVersion(label: string): string | null {
  const stripped = label.trim().replace(LEADING_V_RE, "");
  if (stripped.length === 0) return null;

  const dateMatch = ISO_DATE_RE.exec(stripped);
  if (dateMatch !== null) {
    const year = clampComponent(Number(dateMatch[1] ?? "0"));
    const month = clampComponent(Number(dateMatch[2] ?? "0"));
    const day = clampComponent(Number(dateMatch[3] ?? "0"));
    return formatTriple(year, month, day);
  }

  const match = NUMERIC_VERSION_RE.exec(stripped);
  if (match === null) return null;

  const major = clampComponent(Number(match[1] ?? "0"));
  const minor = clampComponent(Number(match[2] ?? "0"));
  const patch = clampComponent(Number(match[3] ?? "0"));
  const hasSuffix = match[4] !== undefined;

  const [m1, m2, m3] = hasSuffix ? decrementForPrerelease(major, minor, patch) : [major, minor, patch];
  return formatTriple(m1, m2, m3);
}

/**
 * Compare two already-normalised version strings, nulls sorting last.
 *
 * Deliberately just a string comparison — see the file header. Doing anything
 * numerically "smarter" here would risk disagreeing with the SQL that compares the
 * same `semverNormalized` column with `<`/`>`, which is the one disagreement this
 * whole design exists to prevent.
 */
export function compareVersions(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/* ---------------------------------------------------------------------------
   Range matching
   --------------------------------------------------------------------------- */

/** Mirrors the `minSemver` / `maxSemver` / `maxInclusive` columns on
 *  `revision_environment_constraints` exactly, so a row can be passed in without
 *  reshaping it. `null` on either bound means unbounded in that direction. */
export type VersionRange = {
  minSemver: string | null;
  maxSemver: string | null;
  maxInclusive: boolean;
};

/**
 * Whether a normalised version falls inside a range.
 *
 * A `null` version — a reader's raw label that did not parse, or a component that
 * was never declared — always returns `false`, regardless of the range, including an
 * unbounded one. That looks surprising for an unbounded range ("surely *anything*
 * satisfies >=null <=null"), but the question this function answers is narrower than
 * that: "is this *specific, known* version inside the bound", and an unknown version
 * is not a known one. Silently treating "we don't know" as "yes, it matches" is
 * exactly the failure mode `matchEnvironment` is built to avoid — that function is
 * what turns this `false` into the correct `unknown` verdict rather than a `mismatch`
 * one; this function only ever needs to answer the yes/no question for a version it
 * actually has.
 */
export function versionInRange(normalised: string | null, range: VersionRange): boolean {
  if (normalised === null) return false;
  if (range.minSemver !== null && normalised < range.minSemver) return false;
  if (range.maxSemver !== null) {
    if (range.maxInclusive ? normalised > range.maxSemver : normalised >= range.maxSemver) return false;
  }
  return true;
}

/* ---------------------------------------------------------------------------
   Environments
   --------------------------------------------------------------------------- */

/** One declared piece of a reader's (or a reproduction's) environment — "Node
 *  22.3.1", "Docker 27.1". `technologyId` is `null` until resolved against the
 *  `technologies` table; `rawLabel` is kept regardless, because it is what the
 *  person actually typed and is the only thing worth showing back to them. */
export type EnvironmentComponent = {
  technologyId: string | null;
  rawLabel: string;
  semverNormalized: string | null;
};

export type EnvironmentSnapshot = {
  osFamily: string | null;
  osVersion: string | null;
  architecture: string | null;
  components: readonly EnvironmentComponent[];
};

/** One row of `revision_environment_constraints`, with the technology's display
 *  name joined in (this module has no DB access, so the caller must supply it). */
export type EnvironmentConstraint = {
  technologyId: string;
  technologyName: string;
  minSemver: string | null;
  maxSemver: string | null;
  maxInclusive: boolean;
  architecture: string | null;
  constraintKind: "required" | "known_affected" | "known_unaffected";
};

export type MatchVerdict = "matches" | "mismatch" | "unknown";

export type EnvironmentMatch = {
  verdict: MatchVerdict;
  /** Human-readable, one entry per constraint that clearly held. */
  satisfied: string[];
  /** Human-readable, one entry per constraint that is definitely violated — the
   *  only thing that can push `verdict` to `mismatch`. */
  violated: string[];
  /** Human-readable, one entry per constraint that could not be checked. */
  unknown: string[];
  /** A single sentence for the UI: the first thing a reader should see. */
  explanation: string;
};

/** Three-valued outcome of checking one constraint's one dimension (version, or
 *  architecture) against the reader's environment. Not exported: it is an internal
 *  bookkeeping detail of `matchEnvironment`, not part of the module's contract. */
type TriState = "matches" | "violated" | "unknown";

/** Combine two dimensions of the same constraint (version AND architecture) with
 *  three-valued (Kleene) AND: a definite violation on either dimension makes the
 *  whole constraint violated regardless of what the other dimension says, because a
 *  definite "no" cannot be rescued by an "I don't know" on some other axis. Only
 *  when neither dimension is violated does an "I don't know" propagate up. */
function kleeneAnd(a: TriState, b: TriState): TriState {
  if (a === "violated" || b === "violated") return "violated";
  if (a === "unknown" || b === "unknown") return "unknown";
  return "matches";
}

/** Turn a normalised bound back into a human number ("00022.00003.00001" ->
 *  "22.3.1"), for building explanation text. Constraint bounds are written by
 *  playbook authors as plain releases, so the pre-release decrement trick in
 *  `normaliseVersion` essentially never applies to them — this is a display
 *  convenience, not a full inverse of that encoding. */
function humaniseBound(normalised: string): string {
  return normalised
    .split(".")
    .map((segment) => String(Number(segment)))
    .join(".");
}

/** Render the version half of a constraint as ">=20.0.0 <22.0.0", or `null` when the
 *  constraint carries no version bound at all (e.g. an architecture-only row). */
function describeVersionRequirement(min: string | null, max: string | null, maxInclusive: boolean): string | null {
  const parts: string[] = [];
  if (min !== null) parts.push(`>=${humaniseBound(min)}`);
  if (max !== null) parts.push(`${maxInclusive ? "<=" : "<"}${humaniseBound(max)}`);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Match a reader's environment against a revision's declared constraints.
 *
 * Four rules govern this function and none of them is negotiable — each is argued
 * for at the point it is enforced below, but stated together here because they are
 * easy to lose sight of individually:
 *
 * 1. A `known_unaffected` constraint that the reader's environment *matches* means
 *    the playbook does not apply to them, which is a `mismatch` — the opposite of
 *    what "matches" sounds like it should mean, which is exactly why it needs
 *    saying up front.
 * 2. A component the reader never declared is `unknown`, never `mismatch`. Absence
 *    of information is not evidence of incompatibility, and a reader who filled in
 *    nothing must not be told a playbook definitely does not apply to them.
 * 3. `mismatch` requires at least one *definite* violation. Zero violations plus at
 *    least one unknown is `unknown`, never `mismatch` and never `matches` — an
 *    unresolved question is not the same as a clean bill of health.
 * 4. Only when every constraint is definitely satisfied is the verdict `matches`.
 */
export function matchEnvironment(
  snapshot: EnvironmentSnapshot,
  constraints: readonly EnvironmentConstraint[],
): EnvironmentMatch {
  const satisfied: string[] = [];
  const violated: string[] = [];
  const unknown: string[] = [];

  for (const constraint of constraints) {
    const component = snapshot.components.find((c) => c.technologyId === constraint.technologyId);
    const requirement = describeVersionRequirement(
      constraint.minSemver,
      constraint.maxSemver,
      constraint.maxInclusive,
    );

    let versionStatus: TriState;
    let haveText: string;
    if (component === undefined) {
      versionStatus = "unknown";
      haveText = `no ${constraint.technologyName} version declared`;
    } else if (component.semverNormalized === null) {
      versionStatus = "unknown";
      haveText = `${constraint.technologyName} "${component.rawLabel}" (version not recognised)`;
    } else if (requirement === null) {
      // No version bound on this row at all (e.g. an architecture-only constraint):
      // any known version of the technology trivially satisfies it.
      versionStatus = "matches";
      haveText = `${constraint.technologyName} ${component.rawLabel}`;
    } else {
      const inRange = versionInRange(component.semverNormalized, {
        minSemver: constraint.minSemver,
        maxSemver: constraint.maxSemver,
        maxInclusive: constraint.maxInclusive,
      });
      versionStatus = inRange ? "matches" : "violated";
      haveText = `${constraint.technologyName} ${component.rawLabel}`;
    }

    let archStatus: TriState;
    if (constraint.architecture === null) {
      archStatus = "matches";
    } else if (snapshot.architecture === null) {
      archStatus = "unknown";
    } else {
      archStatus = snapshot.architecture === constraint.architecture ? "matches" : "violated";
    }

    const status = kleeneAnd(versionStatus, archStatus);

    const needParts: string[] = [];
    if (requirement !== null) needParts.push(`${constraint.technologyName} ${requirement}`);
    if (constraint.architecture !== null) needParts.push(`${constraint.architecture} architecture`);
    const needClause = needParts.length > 0 ? needParts.join(" and ") : constraint.technologyName;

    switch (constraint.constraintKind) {
      case "required": {
        if (status === "matches") {
          satisfied.push(`Needs ${needClause}; you have ${haveText}.`);
        } else if (status === "violated") {
          violated.push(`Needs ${needClause}; you have ${haveText}.`);
        } else {
          unknown.push(`Needs ${needClause}, but ${haveText}.`);
        }
        break;
      }
      case "known_unaffected": {
        /*
          The non-negotiable rule: matching a `known_unaffected` row is what mismatch
          looks like here, not what matches looks like. Recorded in `violated` (not
          a separate bucket) so the single `verdict` rule below — "mismatch iff
          `violated` is non-empty" — stays true without a second special case.
        */
        if (status === "matches") {
          violated.push(`Known not to apply to ${needClause}; you have ${haveText}.`);
        } else if (status === "unknown") {
          unknown.push(`May not apply to ${needClause}; can't confirm against ${haveText}.`);
        }
        // status === "violated" here means the reader's environment falls *outside*
        // the known-unaffected band, i.e. this row simply has nothing to say about
        // them — no entry needed in any bucket.
        break;
      }
      case "known_affected": {
        // Purely informational — "also confirmed working here" — never a gate, so it
        // can only ever add supporting evidence, never a violation or an unknown.
        if (status === "matches") {
          satisfied.push(`Also confirmed with ${needClause} (you have ${haveText}).`);
        }
        break;
      }
    }
  }

  let verdict: MatchVerdict;
  if (violated.length > 0) verdict = "mismatch";
  else if (unknown.length > 0) verdict = "unknown";
  else verdict = "matches";

  let explanation: string;
  if (verdict === "mismatch") {
    explanation = violated.join(" ");
  } else if (verdict === "unknown") {
    explanation = unknown.join(" ");
  } else if (satisfied.length > 0) {
    explanation = "Matches your declared environment.";
  } else {
    explanation = "No environment constraints declared for this playbook.";
  }

  return { verdict, satisfied, violated, unknown, explanation };
}

/* ---------------------------------------------------------------------------
   Fingerprinting and display
   --------------------------------------------------------------------------- */

const FNV_PRIME = 0x01000193;
const FNV_SEED_LANE_1 = 0x811c9dc5;
/** An arbitrary second seed, distinct from the first, so the two lanes below don't
 *  just recompute the same 32 bits twice. */
const FNV_SEED_LANE_2 = 0x9e3779b9;

/** One 32-bit FNV-1a pass. `Math.imul` keeps the multiply inside 32 bits without the
 *  precision loss `*` would introduce past 2^53, and there is no `Math.random`
 *  anywhere in this — the function is a pure, deterministic digest of its input. */
function fnv1a32(input: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * A stable, order-independent digest of an environment, for counting distinct
 * environments across reproductions without joining every component row.
 *
 * This is a bucketing key, not a security primitive, and it is worth being explicit
 * about the tradeoff that follows from that. `crypto.subtle` is asynchronous and
 * this module is intentionally pure and synchronous, so a real cryptographic hash is
 * not on the table here; a single 32-bit FNV-1a pass would start colliding at a
 * scale this product will plausibly reach (the birthday bound on 32 bits is only
 * ~77,000 environments). Running FNV-1a twice with different seeds and concatenating
 * the results widens that to ~64 bits, which is enough for an approximate uniqueness
 * count — an occasional collision just slightly *undercounts* unique environments,
 * which is a safe direction to be wrong in for a number that only ever supports a
 * confidence band, never gates anything on its own.
 *
 * Order-independence: components are sorted by their canonical key before hashing,
 * so declaring "Node then Docker" and "Docker then Node" fingerprint identically.
 * Components are keyed by their normalised version when one exists, so "22.3.1" and
 * "v22.3.1" collapse to the same key; a component that failed to parse falls back to
 * its raw label so distinct-but-unparsable labels ("latest" vs. "main") do not
 * collide with each other.
 */
export function fingerprintEnvironment(snapshot: EnvironmentSnapshot): string {
  const componentKeys = snapshot.components
    .map((c) => `${c.technologyId ?? "?"}=${c.semverNormalized ?? `raw:${c.rawLabel}`}`)
    .sort();

  const canonical = [
    `os=${snapshot.osFamily ?? ""}`,
    `osv=${snapshot.osVersion ?? ""}`,
    `arch=${snapshot.architecture ?? ""}`,
    ...componentKeys,
  ].join("|");

  const lane1 = fnv1a32(canonical, FNV_SEED_LANE_1);
  const lane2 = fnv1a32(canonical, FNV_SEED_LANE_2);
  return lane1.toString(16).padStart(8, "0") + lane2.toString(16).padStart(8, "0");
}

/**
 * The short human label for an environment — "Ubuntu 24.04 · Node 22.3.1".
 *
 * This module has no database access, so it has no way to turn a component's
 * `technologyId` into a display name ("Node") on its own — that join lives in
 * `technologies`, outside this pure layer. What it renders is each component's
 * `rawLabel` as stored, alongside the OS. In practice `rawLabel` is usually already
 * name-qualified enough to read well ("Node 22.3.1"); a caller that needs a strict
 * guarantee of "name + version" for every component should resolve names first and
 * format accordingly rather than relying on this function to do a join it cannot do.
 */
export function describeEnvironment(snapshot: EnvironmentSnapshot): string {
  const parts: string[] = [];

  const os = [snapshot.osFamily, snapshot.osVersion].filter((p): p is string => p !== null).join(" ");
  if (os.length > 0) parts.push(os);

  for (const component of snapshot.components) {
    if (component.rawLabel.length > 0) parts.push(component.rawLabel);
  }

  return parts.length > 0 ? parts.join(" · ") : "Environment not declared";
}

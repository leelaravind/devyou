/**
 * Display helpers.
 *
 * Every timestamp in this schema is Unix **seconds**, not milliseconds — the D1 columns
 * are `integer` and the writers all use `Math.floor(Date.now() / 1000)`. Passing one to
 * `new Date()` unmultiplied yields January 1970, which is a wrong answer that looks like
 * a rendering bug rather than a units bug and costs an hour every time. So the
 * conversion lives here and nowhere else.
 */

/**
 * ISO 8601 in UTC, always, and never a localised format.
 *
 * An admin console is read by people in different places, often while comparing what
 * they see to a Cloudflare log or a D1 query — both of which are UTC. A friendly "2
 * hours ago" is easier to read and impossible to correlate, and the correlation is the
 * whole reason somebody is looking at a timestamp on this surface.
 */
export function formatInstant(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  return new Date(seconds * 1000).toISOString().replace("T", " ").replace(".000Z", "Z");
}

/** How long ago, coarsely — for scanning a queue, beside the exact timestamp. */
export function formatAge(seconds: number | null | undefined, now = Date.now()): string {
  if (seconds === null || seconds === undefined) return "—";
  const elapsed = Math.max(0, Math.floor(now / 1000) - seconds);
  if (elapsed < 90) return "just now";
  if (elapsed < 5400) return `${Math.round(elapsed / 60)}m`;
  if (elapsed < 172_800) return `${Math.round(elapsed / 3600)}h`;
  return `${Math.round(elapsed / 86_400)}d`;
}

/**
 * Cost, from the integer micro-USD the ledger stores.
 *
 * Stored as an integer because floating-point money accumulates error precisely where it
 * matters — summing thousands of rows to compare against a daily ceiling. Four decimal
 * places, because a single classification call rounds to £0.00 at two and a budget page
 * showing a column of zeroes is a budget page nobody trusts.
 */
export function formatCost(microUsd: number | null | undefined): string {
  if (microUsd === null || microUsd === undefined) return "—";
  return `$${(microUsd / 1_000_000).toFixed(4)}`;
}

/**
 * Shorten an identifier for display, keeping the prefix.
 *
 * The prefix is the informative part — `pbk_`, `evd_`, `rev_` says what the thing is
 * without a lookup, which is why ids are prefixed at all. The random tail is only ever
 * copied, never read, so the middle is what gets elided.
 */
export function shortId(id: string): string {
  return id.length <= 16 ? id : `${id.slice(0, 12)}…${id.slice(-4)}`;
}

/** A percentage, or a dash when the sample is too small to express as one. R-4 applies
 *  to internal surfaces too: "100% zero-result" over two searches is a lie told with
 *  arithmetic whether or not a contributor is reading it. */
export function rateOrDash(numerator: number, denominator: number, minimumSample = 5): string {
  if (denominator < minimumSample) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

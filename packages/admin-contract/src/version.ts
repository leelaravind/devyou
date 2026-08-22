/**
 * The contract version.
 *
 * Separate from the package version because the two answer different questions. The
 * package version moves when anything in this directory changes, including a comment.
 * This moves only when the *shape* a consumer parses changes, which is the only thing
 * a future console can meaningfully pin against.
 *
 * Every payload carries it. A console that receives a `contractVersion` it does not
 * recognise should refuse to render rather than guess, which is only possible if the
 * version travels with the data rather than living in a README.
 */
export const CONTRACT_VERSION = "1" as const;
export type ContractVersion = typeof CONTRACT_VERSION;

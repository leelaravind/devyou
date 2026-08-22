/**
 * The contracts that cross a process boundary.
 *
 * `draft.ts` is the shape of a contribution between capture and publication — the
 * one thing the public Worker, the jobs Worker and the database column all have to
 * agree about. `queue.ts` is what one Worker may say to the other.
 *
 * Nothing here performs I/O, and nothing here imports a provider. A contract that
 * can only be validated by the thing it constrains is not a contract.
 */
export * from "./draft.js";
export * from "./queue.js";

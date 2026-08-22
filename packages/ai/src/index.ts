/**
 * AI, behind one boundary.
 *
 * `provider.ts` is the authority gate — the allowed-task list, the forbidden-task
 * list with its reasons, and the schema-validated runner. `boundary.ts` wraps
 * hostile submission text. `tasks.ts` holds the versioned prompts and schemas.
 * `anthropic.ts` is the only implementation.
 *
 * Nothing here imports a database client, and nothing here can publish, delete,
 * verify or suspend. That is the enforcement; the prompts are the manners.
 */
export * from "./provider.js";
export * from "./boundary.js";
export * from "./tasks.js";
export * from "./anthropic.js";

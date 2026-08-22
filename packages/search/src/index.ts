/**
 * Search.
 *
 * Query normalisation and error fingerprinting in `normalise.ts`; retrieval, ranking
 * and zero-result handling in `query.ts`; document assembly in `index-documents.ts`.
 *
 * Nothing here calls a model. Plan §11 forbids an AI call on an exact error search,
 * and the deterministic path is why one is not needed.
 */
export * from "./normalise.js";
export * from "./query.js";
export * from "./index-documents.js";

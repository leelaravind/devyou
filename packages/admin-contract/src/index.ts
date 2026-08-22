/**
 * `@devyou/admin-contract` — the outward integration contract.
 *
 * There is no shared ITISYOU Admin Console. The Phase 0 audit established that
 * `ats-admin.itisyou.app` is one product's admin, bound to that product's database,
 * with no product switcher and no extension point, and ADR-0001 accepted the
 * consequence: DevYou ships its own admin Worker and publishes the surface a future
 * network console would consume.
 *
 * That is what this package is. Zod schemas and nothing else — no client, no fetcher,
 * no adapter to something imaginary. Four documents:
 *
 *   `product`      — what DevYou is, enough to render one row in a product list
 *   `health`       — content-bearing health, because a bare 200 lies on the day it matters
 *   `events`       — a summary stream, never a copy of the audit log
 *   `capabilities` — the authorisation model, described so a console can display it
 *
 * Nothing here imports a database client, a Worker binding or `@devyou/auth`. The
 * package that *describes* the capability model must not be able to evaluate it, or
 * "the console checks the capability" becomes a sentence somebody can say.
 */
export { CONTRACT_VERSION, type ContractVersion } from "./version.js";
export { productDescriptorSchema, type ProductDescriptor } from "./product.js";
export {
  healthCheckSchema,
  healthReportSchema,
  type HealthCheck,
  type HealthReport,
} from "./health.js";
export { mirroredEventSchema, type MirroredEvent } from "./events.js";
export {
  capabilityRowSchema,
  capabilityDeclarationSchema,
  type CapabilityRow,
  type CapabilityDeclaration,
} from "./capabilities.js";

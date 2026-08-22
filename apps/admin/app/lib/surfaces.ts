import type { IconName } from "@devyou/ui";
import type { Capability } from "@devyou/auth";

/**
 * The admin surfaces, declared once.
 *
 * This list is read by three things that would otherwise drift: the sidebar, which
 * hides what the viewer cannot open; the overview, which links to what is actionable;
 * and the guard test, which asserts every entry here has a route file that gates on the
 * capability declared here. A surface added to the nav without a capability, or with a
 * capability its route does not check, fails that test rather than shipping.
 *
 * `capability` is the *minimum to look*. Every action inside a surface re-checks its own
 * — reading the moderation queue is `moderation:view`, resolving a case is
 * `moderation:resolve`, and a reviewer holds both while a support_admin's extra powers
 * are elsewhere entirely. Gating the nav on the read capability and the buttons on the
 * write ones is what stops the console from showing an operator a page of controls they
 * will be refused.
 */
export interface Surface {
  path: string;
  label: string;
  icon: IconName;
  capability: Capability;
  /** One line, shown on the overview. What the surface is *for*, not what it contains. */
  description: string;
}

export const SURFACES: readonly Surface[] = [
  {
    path: "/moderation",
    label: "Moderation",
    icon: "shield",
    capability: "moderation:view",
    description: "Reports and automated findings awaiting a human decision.",
  },
  {
    path: "/evidence",
    label: "Evidence",
    icon: "science",
    capability: "evidence:view_suppressed",
    description:
      "Every evidence record including suppressed ones, which stay visible because the proof that justified suppressing them is the record.",
  },
  {
    path: "/playbooks",
    label: "Playbooks",
    icon: "description",
    capability: "playbooks:view_unpublished",
    description: "Quarantine, deprecation, relationships and unpublished drafts.",
  },
  {
    path: "/proposals",
    label: "Proposals",
    icon: "lightbulb",
    capability: "proposals:view",
    description: "Corrections, missing tests and branches proposed against a revision.",
  },
  {
    path: "/contributors",
    label: "Contributors",
    icon: "account_circle",
    capability: "contributors:list",
    description: "Account lookup, suspension, roles and session revocation.",
  },
  {
    path: "/claims",
    label: "Identity claims",
    icon: "fingerprint",
    capability: "identity_claims:view",
    description: "Maintainer and vendor claims awaiting proof.",
  },
  {
    path: "/taxonomy",
    label: "Taxonomy",
    icon: "account_tree",
    capability: "taxonomy:view",
    description: "Technologies, aliases and versions — what makes version-awareness real.",
  },
  {
    path: "/search-quality",
    label: "Search quality",
    icon: "search",
    capability: "search_quality:view",
    description: "Zero-result and reformulation rates, derived without storing queries.",
  },
  {
    path: "/ai",
    label: "AI operations",
    icon: "build",
    capability: "ai_operations:view",
    description: "The task ledger: cost, latency, schema failures and the daily ceiling.",
  },
  {
    path: "/flags",
    label: "Feature flags",
    icon: "terminal",
    capability: "flags:view",
    description: "Runtime configuration, each change audited with a reason.",
  },
  {
    path: "/audit",
    label: "Audit log",
    icon: "history",
    capability: "audit:view",
    description: "Append-only record of every privileged action taken here.",
  },
  {
    path: "/health",
    label: "Health",
    icon: "network_check",
    capability: "health:view",
    description: "D1, KV, R2 and the Access configuration, checked rather than assumed.",
  },
];

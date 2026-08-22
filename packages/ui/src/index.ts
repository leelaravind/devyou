/**
 * The DevYou design system.
 *
 * Rebuilt from the Stitch package as typed components — plan §0.10 forbids pasting
 * the generated HTML into production, and the reason is visible in these files: the
 * generated markup has no notion of a safety class that must be read before a copy
 * button, or of a confidence band that cannot be rendered without its counts.
 */

export { Icon, type IconName, type IconProps } from "./icon.js";
export { Button, type ButtonProps } from "./button.js";
export { Input, Textarea, Field, type InputProps, type TextareaProps, type FieldProps } from "./input.js";
export { Tag, type TagProps } from "./tag.js";
export { Card, type CardProps } from "./card.js";
export { Spinner } from "./spinner.js";
export { CodeBlock, type CodeBlockProps } from "./code-block.js";
export {
  ConfidenceBadge,
  ConfidenceBandChip,
  EvidenceRate,
  EvidenceChip,
  OutcomeChip,
  type ConfidenceBadgeProps,
  type EvidenceCounts,
  type EvidenceRateProps,
  type EvidenceChipProps,
  type OutcomeChipProps,
} from "./evidence.js";
export {
  DiagnosticNode,
  DiagnosticTree,
  type DiagnosticNodeProps,
  type DiagnosticTreeProps,
  type NodeStatus,
} from "./diagnostic-node.js";
export {
  TopNav,
  Sidebar,
  SplitView,
  Page,
  SkipLink,
  type NavLink,
  type TopNavProps,
  type SidebarItem,
  type SidebarProps,
  type SplitViewProps,
  type PageProps,
} from "./shell.js";
export { Omnibox, CompactSearch, type OmniboxProps, type CompactSearchProps } from "./omnibox.js";

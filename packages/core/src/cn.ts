/**
 * Class-name join.
 *
 * Deliberately not `clsx` + `tailwind-merge`. The components in this package never
 * accept an arbitrary overriding className for a token-bearing property, so there is
 * no conflict to resolve, and pulling in a merge implementation would invite exactly
 * the pattern the design system is meant to prevent.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

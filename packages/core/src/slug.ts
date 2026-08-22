/**
 * URL slugs.
 *
 * Playbook slugs are public, permanent and indexed, so they are generated once and
 * never regenerated from a changed title — plan §9 requires historical URLs to keep
 * working, and a slug that tracks the title is a slug that breaks every inbound link
 * on the first edit.
 */

const MAX_SLUG_LENGTH = 80;

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    // Strip combining marks so "café" and "cafe" do not produce two different URLs.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // Keep dots out: they read as file extensions in a path segment.
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
}

/**
 * A slug that is unique within its collection.
 *
 * The suffix is a short random tail rather than an incrementing counter: a counter
 * leaks how many similar playbooks exist, and requires a read-then-write that races.
 */
export function uniqueSlug(input: string, existing: ReadonlySet<string>): string {
  const base = slugify(input) || "playbook";
  if (!existing.has(base)) return base;
  for (let attempt = 0; attempt < 8; attempt++) {
    const bytes = new Uint8Array(3);
    crypto.getRandomValues(bytes);
    const suffix = Array.from(bytes, (b) => b.toString(36))
      .join("")
      .slice(0, 5);
    const candidate = `${base}-${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error("could not allocate a unique slug");
}

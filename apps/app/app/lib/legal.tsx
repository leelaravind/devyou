import { Link } from "react-router";

/**
 * The shared pieces of the legal document set.
 *
 * The postal address and the effective date live here exactly once, so that a
 * correction to either is one edit rather than a hunt across six documents — and so
 * a test can assert that every legal page renders the approved address by asserting
 * that every legal page uses this module.
 *
 * ADR-0013 is the decision behind these documents. Two rules from it apply to any
 * edit made here: no legal fact may be invented (there is no company number, no VAT
 * number, no ICO reference, no telephone number — their absence is deliberate, not
 * an omission), and every claim a document makes must describe what the
 * implementation actually does.
 */

export const LEGAL_EFFECTIVE = "23 August 2026";

export const ADDRESS_LINES = [
  "itisyou.app",
  "13 Freeland Park",
  "Wareham Road",
  "Poole",
  "Dorset",
  "BH16 6FA",
  "United Kingdom",
] as const;

export const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms of use" },
  { href: "/contribution-terms", label: "Contribution terms" },
  { href: "/content-policy", label: "Content & copyright" },
  { href: "/acceptable-use", label: "Acceptable use" },
  { href: "/ai", label: "How AI is used" },
] as const;

export function PostalAddress() {
  return (
    <address className="not-italic">
      <ul className="flex list-none flex-col font-mono text-code-block text-on-surface">
        {ADDRESS_LINES.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </address>
  );
}

/**
 * The layout every legal document shares: title, one-line summary, the effective
 * date stated up front rather than buried, the document body, then contact details
 * and the rest of the set.
 */
export function LegalDoc({
  title,
  lede,
  path,
  children,
}: {
  title: string;
  lede: string;
  path: string;
  children: React.ReactNode;
}) {
  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-[720px] flex-col gap-margin px-margin py-12"
    >
      <header className="flex flex-col gap-3">
        <h1 className="font-headline text-headline-lg text-on-surface">{title}</h1>
        <p className="text-body-md text-on-surface-variant">{lede}</p>
        <p className="font-mono text-env-tag uppercase text-on-surface-variant">
          Effective and last updated: {LEGAL_EFFECTIVE}
        </p>
      </header>

      {children}

      <LegalSection id="contact" title="Contact">
        <P>
          Questions about this document, requests under it and formal notices can be sent by
          post to:
        </P>
        <PostalAddress />
      </LegalSection>

      <nav aria-label="Legal documents" className="border-t border-outline-variant pt-4">
        <p className="mb-2 font-mono text-env-tag uppercase text-on-surface-variant">
          The rest of the legal set
        </p>
        <ul className="flex list-none flex-wrap gap-gutter text-body-sm">
          {LEGAL_LINKS.filter((link) => link.href !== path).map((link) => (
            <li key={link.href}>
              <Link to={link.href} className="text-evidence-blue underline">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}

export function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="font-headline text-headline-md text-on-surface">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Body paragraph in the document register every other page uses. */
export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-body-md text-on-surface-variant">{children}</p>;
}

/** A bulleted list in the same register. */
export function LegalList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 text-body-md text-on-surface-variant">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

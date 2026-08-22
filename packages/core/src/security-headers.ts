/**
 * The security headers every response carries.
 *
 * Set at the Worker boundary, not per route. A route can forget a `headers()`
 * export, and the route that forgets will be the one added in a hurry.
 *
 * DevYou renders text that strangers wrote — stack traces, shell commands, Markdown
 * — on a public page with no login. That makes the Content-Security-Policy the
 * single most load-bearing control in the product, and a policy that looks strict
 * without being strict is worse than none, because it produces a confident line in a
 * report and stops anybody asking.
 */

export interface CspOptions {
  /** Per-response, unguessable. The only thing that may execute a script. */
  nonce: string;
  /** `report-only` while a policy change is being proved. */
  reportOnly?: boolean;
}

/**
 * Build the Content-Security-Policy.
 *
 * `script-src 'self' 'nonce-…' 'strict-dynamic'` with **no `'unsafe-inline'`**.
 * That is the entire point of the nonce: injected script has no nonce and does not
 * run. A CSP3 browser ignores `'unsafe-inline'` outright when a nonce is present, so
 * there is no fallback that quietly re-opens the hole.
 *
 * `style-src` does carry `'unsafe-inline'`, deliberately and with a bounded cost.
 * React sets `style` attributes for computed values — a progress width, a tree
 * connector height — and a style attribute cannot carry a nonce. Hashing is
 * impossible for a computed value. What the concession buys an attacker is
 * restyling; script, where the real damage is, keeps its hole closed.
 *
 * `object-src 'none'` and `base-uri 'self'` close the two bypasses that survive an
 * otherwise strict script policy: a plugin object, and a `<base>` tag that repoints
 * every relative script URL.
 *
 * Note what is **absent**: no remote `img-src`, no remote `connect-src`. A playbook
 * that could reference an external image would have an exfiltration channel — the
 * URL is fetched by the reader's browser, so a unique path per reader is a tracker,
 * and a reader on a corporate network leaks that they were reading about a specific
 * vulnerability. Playbook images are uploaded to R2 and served same-origin.
 */
export function contentSecurityPolicy(options: CspOptions): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${options.nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    // No remote image host. See above — every permitted origin is a tracking and
    // exfiltration channel on a page rendering somebody else's content.
    "img-src 'self' data:",
    "connect-src 'self'",
    // Turnstile, for abuse-sensitive anonymous actions (plan §14).
    "frame-src https://challenges.cloudflare.com",
    "child-src https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    // A form that posts elsewhere is a phishing page wearing our styling.
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * Headers that do not depend on the response.
 *
 * `Permissions-Policy` is a list of denials rather than grants, because the default
 * for an unlisted feature is to allow it. A troubleshooting reference has no use for
 * a camera, a microphone or a location, and saying so means a future dependency
 * cannot quietly ask for one.
 */
export function staticSecurityHeaders(): Record<string, string> {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": [
      "accelerometer=()",
      "camera=()",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=()",
      "payment=()",
      "usb=()",
      "interest-cohort=()",
      "browsing-topics=()",
    ].join(", "),
  };
}

/**
 * Caching policy by kind of response.
 *
 * DevYou differs from an account-bearing product here, and the difference matters
 * for both cost and crawlability: a published playbook is public, identical for
 * every reader, and is exactly the thing an edge cache should hold. Defaulting the
 * whole site to `no-store` — correct for a CV product — would throw that away.
 *
 * So the default is still `no-store`, and public knowledge routes opt in.
 */
export const CACHE = {
  /** Anything that read or could read a session. */
  private: "no-store",
  /** Published playbook, search and technology pages. Short edge TTL, longer
   *  stale-while-revalidate so a D1 blip serves slightly old knowledge rather than
   *  an error page. */
  publicKnowledge: "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
  /** Content-hashed build assets. */
  immutable: "public, max-age=31536000, immutable",
  /** robots.txt, sitemaps. */
  metadata: "public, max-age=3600",
} as const;

export function withSecurityHeaders(
  response: Response,
  options: CspOptions & { cache?: string },
): Response {
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(staticSecurityHeaders())) {
    headers.set(name, value);
  }

  headers.set(
    options.reportOnly ? "content-security-policy-report-only" : "content-security-policy",
    contentSecurityPolicy(options),
  );

  headers.set("cache-control", options.cache ?? CACHE.private);

  // Rebuilt rather than mutated: a framework `Response` may carry immutable
  // headers, and a silently failed `set` on a security header is the worst
  // possible outcome — it looks configured and is not.
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * A fresh nonce. 128 bits from the platform CSRNG.
 *
 * `Math.random` would be catastrophic here and is banned by the lint config; a
 * predictable nonce is the same as no nonce.
 */
export function newCspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function isImmutableAsset(pathname: string): boolean {
  return pathname.startsWith("/assets/") || pathname === "/favicon.ico";
}

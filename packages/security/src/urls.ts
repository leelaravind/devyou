/**
 * URL safety for links inside user-submitted content.
 *
 * Every link a stranger writes into a playbook is rendered on a public page with
 * no login. `checkUrl` is the single gate between what they typed and an `<a>`
 * tag: nothing downstream should construct a link from a raw string that has not
 * passed through it.
 */

export interface UrlVerdict {
  safe: boolean;
  /** The normalised form (lower-cased host, default port and fragment stripped),
   *  or `null` when the URL is unsafe or could not be parsed at all. */
  normalised: string | null;
  flags: string[];
  reason?: string;
}

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
const DEFAULT_PORT: Record<string, string> = { "http:": "80", "https:": "443" };

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

function isIpLiteral(hostname: string): boolean {
  // WHATWG URL serialises an IPv6 host with brackets, e.g. "[::1]".
  return hostname.startsWith("[") || IPV4_RE.test(hostname);
}

const PRIVATE_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".test", ".invalid", ".home.arpa"];

function isPrivateOrLocalHost(hostname: string): boolean {
  if (hostname === "localhost") return true;
  return PRIVATE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function hasPunycodeLabel(hostname: string): boolean {
  return hostname.split(".").some((label) => label.startsWith("xn--"));
}

const FLAG_REASONS: Record<string, string> = {
  unparsable: "Not a valid absolute URL.",
  non_http_scheme: "Only http and https links are ever rendered as links.",
  userinfo: "The link embeds a username or password in the authority — a classic spoofing technique.",
  ip_literal: "The link points at a raw IP address rather than a named host.",
  private_host: "The link points at a local or private-use hostname.",
  idn_homograph:
    "The host is an internationalised (punycode) domain, which can be crafted to look like a " +
    "different, trusted domain.",
  trailing_dot: "The host has a trailing dot, which some tooling treats differently from the same name without one.",
};

function describeFlags(flags: readonly string[]): string {
  return flags.map((flag) => FLAG_REASONS[flag] ?? flag).join(" ");
}

/**
 * Validate and normalise a URL for safe rendering as a link.
 *
 * The userinfo check deserves a paragraph of its own, because it is the single
 * most effective link-spoof available and the one readers are least equipped to
 * catch. `https://github.com@evil.tld/…` is a completely valid URL whose
 * authority component is `evil.tld` — everything before the `@` is credentials,
 * not a host, and the browser navigates to `evil.tld` alone. A reader skimming
 * link text or even the raw URL sees "github.com" sitting right where a host
 * normally goes and reasonably trusts it, because nothing in ordinary reading
 * habits treats an `@` in a URL as "ignore everything to my left". Browsers do
 * not surface the authority separately either, so this is invisible in the one
 * place a cautious reader would actually look. Any userinfo at all is treated as
 * unsafe here — a UGC link has no legitimate reason to carry credentials.
 *
 * IDN/punycode hosts are rejected outright rather than merely flagged. That
 * blocks some legitimate internationalised domains along with the homograph
 * attacks that misuse the same mechanism, which is a real cost — but this
 * package has no reliable way to tell "café.example" (genuine) from "аpple.com"
 * (Cyrillic а, spoofing Apple) without a maintained confusable-skeleton table,
 * and a public UGC surface with no login is not the place to guess wrong.
 */
export function checkUrl(raw: string): UrlVerdict {
  const trimmed = raw.trim();

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { safe: false, normalised: null, flags: ["unparsable"], reason: FLAG_REASONS["unparsable"] };
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    const flags = ["non_http_scheme"];
    return {
      safe: false,
      normalised: null,
      flags,
      reason: `Scheme "${url.protocol}" is not http or https. ${describeFlags(flags)}`,
    };
  }

  const flags: string[] = [];

  if (url.username !== "" || url.password !== "") flags.push("userinfo");

  const hostname = url.hostname.toLowerCase();

  if (isIpLiteral(hostname)) flags.push("ip_literal");
  if (isPrivateOrLocalHost(hostname)) flags.push("private_host");
  if (hasPunycodeLabel(hostname)) flags.push("idn_homograph");
  if (hostname.endsWith(".")) flags.push("trailing_dot");

  if (flags.length > 0) {
    return { safe: false, normalised: null, flags, reason: describeFlags(flags) };
  }

  // Everything below this point is guaranteed http(s), no userinfo, a named
  // (non-IP-literal, non-private) host, no punycode label and no trailing dot.
  url.hash = "";
  if (DEFAULT_PORT[url.protocol] === url.port) url.port = "";

  return { safe: true, normalised: url.toString(), flags: [] };
}

/**
 * The `rel` attribute for a link built from user-generated content.
 *
 * `nofollow` tells search engines not to pass ranking credit through a link
 * nobody vetted; `noopener noreferrer` stops the opened page from reaching back
 * into `window.opener` and stops the referrer header leaking this page's URL.
 * `ugc` marks the link as user-generated content per the rel-attribute spec.
 *
 * `markdown.ts` already downgrades unsafe links to plain text before a `link`
 * node is ever produced, so in the normal path this only ever runs on a safe
 * verdict. It stays defensive anyway: for a flagged or unsafe verdict it returns
 * the empty string rather than a `rel` value, so a caller that (incorrectly)
 * tries to build an `<a>` tag straight from a `UrlVerdict` without checking
 * `safe` first cannot come away with something that looks like a usable
 * attribute. There is no href here that should ever exist as a link.
 */
export function linkRelFor(verdict: UrlVerdict): string {
  if (!verdict.safe) return "";
  return "ugc nofollow noopener noreferrer";
}

const URL_CANDIDATE_RE = /\bhttps?:\/\/[^\s<>"')]+/gi;
const TRAILING_PUNCTUATION_RE = /[.,;:!?)\]}'"]+$/;

/** Find http(s) URL-shaped substrings in free text. Trailing punctuation that is
 *  almost always sentence structure rather than part of the URL (a closing
 *  bracket, a full stop) is trimmed off each match. This is a text scanner, not a
 *  validator — pass each result through `checkUrl` before treating it as safe. */
export function extractUrls(text: string): string[] {
  const matches = text.match(URL_CANDIDATE_RE) ?? [];
  return matches.map((match) => match.replace(TRAILING_PUNCTUATION_RE, ""));
}

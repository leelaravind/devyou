import { describe, expect, it } from "vitest";
import { checkUrl, extractUrls, linkRelFor } from "./urls.js";
import { MALICIOUS_URLS, SAFE_CONTROLS } from "../../../tests/fixtures/hostile-content.js";

function findMalicious(id: string) {
  const sample = MALICIOUS_URLS.find((entry) => entry.id === id);
  if (!sample) throw new Error(`fixture not found: ${id}`);
  return sample;
}

describe("checkUrl — MALICIOUS_URLS", () => {
  it("rejects a javascript: URL with non_http_scheme", () => {
    const verdict = checkUrl(findMalicious("javascript-scheme").payload);
    expect(verdict.safe).toBe(false);
    expect(verdict.flags).toContain("non_http_scheme");
  });

  it("rejects a data: URL with non_http_scheme", () => {
    const verdict = checkUrl(findMalicious("data-scheme").payload);
    expect(verdict.safe).toBe(false);
    expect(verdict.flags).toContain("non_http_scheme");
  });

  it("rejects a vbscript: URL with non_http_scheme", () => {
    const verdict = checkUrl(findMalicious("vbscript-scheme").payload);
    expect(verdict.safe).toBe(false);
    expect(verdict.flags).toContain("non_http_scheme");
  });

  it("rejects a file: URL with non_http_scheme", () => {
    const verdict = checkUrl(findMalicious("file-scheme").payload);
    expect(verdict.safe).toBe(false);
    expect(verdict.flags).toContain("non_http_scheme");
  });

  it("rejects a github.com@evil.tld userinfo spoof with the userinfo flag", () => {
    const verdict = checkUrl(findMalicious("userinfo-spoof-github").payload);
    expect(verdict.safe).toBe(false);
    expect(verdict.flags).toContain("userinfo");
  });

  it("rejects a raw IPv4 literal host with ip_literal", () => {
    const verdict = checkUrl(findMalicious("ip-literal-host").payload);
    expect(verdict.safe).toBe(false);
    expect(verdict.flags).toContain("ip_literal");
  });

  it("rejects a punycode homograph host with idn_homograph", () => {
    const verdict = checkUrl(findMalicious("punycode-homograph").payload);
    expect(verdict.safe).toBe(false);
    expect(verdict.flags).toContain("idn_homograph");
  });

  it("rejects a trailing-dot host with trailing_dot", () => {
    const verdict = checkUrl(findMalicious("trailing-dot-host").payload);
    expect(verdict.safe).toBe(false);
    expect(verdict.flags).toContain("trailing_dot");
  });

  it("rejects localhost with private_host", () => {
    const verdict = checkUrl(findMalicious("localhost-host").payload);
    expect(verdict.safe).toBe(false);
    expect(verdict.flags).toContain("private_host");
  });

  it("rejects the cloud instance-metadata address, caught as a raw IP literal", () => {
    const verdict = checkUrl(findMalicious("link-local-metadata-ip").payload);
    expect(verdict.safe).toBe(false);
    expect(verdict.flags).toContain("ip_literal");
  });

  /*
    The open-redirect shape passes every other check here — correct scheme, real named
    host, no userinfo, no punycode — while sending the reader somewhere else entirely.
    That combination is exactly what a reader trusts without hovering, and on a corpus of
    user-submitted links it is the most plausible way to launder a hostile destination
    through a familiar-looking domain.
  */
  it("flags an open-redirect-shaped URL as unsafe", () => {
    const verdict = checkUrl(findMalicious("open-redirect-shaped").payload);
    expect(verdict.safe).toBe(false);
  });

  it("rejects every MALICIOUS_URLS entry as unsafe (open-redirect-shaped excepted — see above)", () => {
    for (const sample of MALICIOUS_URLS) {
      if (sample.id === "open-redirect-shaped") continue;
      const verdict = checkUrl(sample.payload);
      expect(verdict.safe, `${sample.id} was unexpectedly marked safe`).toBe(false);
      expect(verdict.normalised, `${sample.id} should carry no normalised form when unsafe`).toBeNull();
    }
  });
});

describe("checkUrl — normalisation", () => {
  it("lowercases the host", () => {
    const verdict = checkUrl("https://Example.COM/path");
    expect(verdict.safe).toBe(true);
    expect(verdict.normalised).toBe("https://example.com/path");
  });

  it("strips the default port for the scheme", () => {
    const verdict = checkUrl("https://example.com:443/path");
    expect(verdict.safe).toBe(true);
    expect(verdict.normalised).toBe("https://example.com/path");
  });

  it("keeps a non-default port", () => {
    const verdict = checkUrl("https://example.com:8443/path");
    expect(verdict.safe).toBe(true);
    expect(verdict.normalised).toBe("https://example.com:8443/path");
  });

  it("strips the fragment", () => {
    const verdict = checkUrl("https://example.com/path#section-2");
    expect(verdict.safe).toBe(true);
    expect(verdict.normalised).toBe("https://example.com/path");
  });
});

describe("checkUrl — SAFE_CONTROLS", () => {
  it("accepts the legitimate Cloudflare documentation link with no flags", () => {
    const sample = SAFE_CONTROLS.find((entry) => entry.id === "safe-cloudflare-doc-link");
    expect(sample).toBeDefined();
    const verdict = checkUrl((sample as (typeof SAFE_CONTROLS)[number]).payload);
    expect(verdict.safe).toBe(true);
    expect(verdict.flags).toHaveLength(0);
  });
});

describe("linkRelFor", () => {
  it("returns the full ugc/nofollow/noopener/noreferrer rel for a safe verdict", () => {
    const verdict = checkUrl("https://developers.cloudflare.com/workers/");
    expect(linkRelFor(verdict)).toBe("ugc nofollow noopener noreferrer");
  });

  it("never returns a linkable rel for any unsafe MALICIOUS_URLS verdict", () => {
    for (const sample of MALICIOUS_URLS) {
      const verdict = checkUrl(sample.payload);
      if (verdict.safe) continue; // the one documented exception (open-redirect-shaped) has no rel to withhold anyway
      expect(linkRelFor(verdict)).toBe("");
    }
  });
});

describe("extractUrls", () => {
  it("finds a URL sitting in ordinary prose", () => {
    const text = "Full guide: https://developers.cloudflare.com/workers/runtime-apis/fetch/. Ask in the channel if stuck.";
    expect(extractUrls(text)).toEqual(["https://developers.cloudflare.com/workers/runtime-apis/fetch/"]);
  });

  it("finds a URL sitting on its own line inside a fenced code block", () => {
    const text = "Run this:\n```\ncurl https://example.com/api/status\n```\nThen check the output.";
    expect(extractUrls(text)).toEqual(["https://example.com/api/status"]);
  });

  it("finds every URL when several appear in the same text", () => {
    const text = "Mirror one: https://mirror-a.example.com/pkg. Mirror two: https://mirror-b.example.com/pkg.";
    expect(extractUrls(text)).toEqual([
      "https://mirror-a.example.com/pkg",
      "https://mirror-b.example.com/pkg",
    ]);
  });
});

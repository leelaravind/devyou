import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@devyou/core";
import { verifyAccessJwt } from "../app/lib/access.server";

/**
 * The Access gate.
 *
 * These tests generate a real RSA key pair, sign real tokens and present them to the real
 * verification path. Nothing is stubbed, because the thing under test *is* the
 * cryptography: a mocked verifier that returns what the test asked for would assert only
 * that the test agrees with itself, and every interesting failure here — algorithm
 * confusion, a wrong audience, a tampered signature — lives precisely in the part a mock
 * removes.
 *
 * The key set is seeded into KV under the same cache key the module reads, so no outbound
 * fetch happens. That is not a convenience: `global_fetch_strictly_public` is set on this
 * Worker, and a test that reached the live Access certs endpoint would be a test that fails
 * when the network does.
 */

const TEAM_DOMAIN = "https://itisyou-network.cloudflareaccess.com";
const AUD = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KID = "test-signing-key";

/** The runtime's `JsonWebKey` models key material and carries no `kid`; a key *set* entry
 *  does. Same widening as `AccessJwk` in the module under test, restated here rather than
 *  exported from it — a test that imported the production type could not catch that type
 *  drifting away from what Access actually publishes. */
type KeySetEntry = JsonWebKey & { kid: string };

let keyPair: CryptoKeyPair;
let publicJwk: KeySetEntry;

beforeAll(async () => {
  keyPair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;

  publicJwk = {
    ...(await crypto.subtle.exportKey("jwk", keyPair.publicKey)),
    kid: KID,
    alg: "RS256",
    use: "sig",
  };
});

/** Storage is isolated per test, so the key set is seeded per test rather than once. */
async function seedKeySet(): Promise<void> {
  await env.CACHE.put(`access:jwks:${TEAM_DOMAIN}`, JSON.stringify({ keys: [publicJwk] }));
}

function configuredEnv(overrides: Partial<Env> = {}): Env {
  return { ...env, CF_ACCESS_POLICY_AUD: AUD, ...overrides } as Env;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function encodeSegment(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

const now = () => Math.floor(Date.now() / 1000);

function defaultClaims(): Record<string, unknown> {
  return {
    iss: TEAM_DOMAIN,
    aud: [AUD],
    sub: "access-subject-1",
    email: "Operator@Example.Com",
    iat: now() - 10,
    exp: now() + 600,
  };
}

async function signToken(
  claims: Record<string, unknown> = defaultClaims(),
  header: Record<string, unknown> = { alg: "RS256", kid: KID, typ: "JWT" },
): Promise<string> {
  const signingInput = `${encodeSegment(header)}.${encodeSegment(claims)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

function requestWith(token: string | null): Request {
  const headers = new Headers();
  if (token !== null) headers.set("cf-access-jwt-assertion", token);
  return new Request("https://dev-admin-staging.itisyou.app/moderation", { headers });
}

async function refusalCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (ApiError.is(error)) return error.code;
    throw error;
  }
  throw new Error("Expected the assertion to be refused, and it was accepted.");
}

describe("with no Access application configured", () => {
  /*
    The state the Worker will genuinely first be deployed in — owner action A0-1 has not
    been done. These two tests are the whole reason this module exists in its current shape.
  */
  it("refuses a request that carries no assertion", async () => {
    expect(await refusalCode(verifyAccessJwt(requestWith(null), env))).toBe("UNAVAILABLE");
  });

  it("refuses a request that carries a perfectly valid assertion", async () => {
    await seedKeySet();
    const token = await signToken();

    /*
      The important one. Without an AUD there is nothing to check the token *against*, so a
      valid signature from the right team domain must not be enough — otherwise every Access
      application on a team domain shared with live products would be an admin credential.
    */
    expect(await refusalCode(verifyAccessJwt(requestWith(token), env))).toBe("UNAVAILABLE");
  });

  it("names the blocking owner action rather than the missing variable", async () => {
    try {
      await verifyAccessJwt(requestWith(null), env);
    } catch (error) {
      expect(ApiError.is(error) && error.publicMessage).toContain("A0-1");
    }
  });
});

describe("with the Access application configured", () => {
  it("accepts a correctly signed assertion and lower-cases the subject", async () => {
    await seedKeySet();
    const identity = await verifyAccessJwt(requestWith(await signToken()), configuredEnv());

    expect(identity.subject).toBe("operator@example.com");
    expect(identity.kind).toBe("user");
    expect(identity.accessSub).toBe("access-subject-1");
  });

  it("accepts a service token, which presents common_name and no email", async () => {
    await seedKeySet();
    const claims = { ...defaultClaims(), email: undefined, common_name: "Console-Poller" };
    const identity = await verifyAccessJwt(requestWith(await signToken(claims)), configuredEnv());

    expect(identity.kind).toBe("service_token");
    expect(identity.subject).toBe("console-poller");
  });

  it("refuses an assertion minted for a different Access application", async () => {
    await seedKeySet();
    const claims = { ...defaultClaims(), aud: ["some-other-applications-aud-tag"] };

    expect(
      await refusalCode(verifyAccessJwt(requestWith(await signToken(claims)), configuredEnv())),
    ).toBe("UNAUTHENTICATED");
  });

  it("refuses an assertion from a different team domain", async () => {
    await seedKeySet();
    const claims = { ...defaultClaims(), iss: "https://someone-else.cloudflareaccess.com" };

    expect(
      await refusalCode(verifyAccessJwt(requestWith(await signToken(claims)), configuredEnv())),
    ).toBe("UNAUTHENTICATED");
  });

  it("refuses an expired assertion", async () => {
    await seedKeySet();
    const claims = { ...defaultClaims(), iat: now() - 7200, exp: now() - 3600 };

    expect(
      await refusalCode(verifyAccessJwt(requestWith(await signToken(claims)), configuredEnv())),
    ).toBe("UNAUTHENTICATED");
  });

  it("refuses an assertion whose payload was edited after signing", async () => {
    await seedKeySet();
    const token = await signToken();
    const [header, , signature] = token.split(".") as [string, string, string];
    const forged = `${header}.${encodeSegment({ ...defaultClaims(), email: "attacker@example.com" })}.${signature}`;

    expect(await refusalCode(verifyAccessJwt(requestWith(forged), configuredEnv()))).toBe(
      "UNAUTHENTICATED",
    );
  });

  it("refuses alg: none, the oldest JWT attack there is", async () => {
    await seedKeySet();
    const unsigned = `${encodeSegment({ alg: "none", kid: KID })}.${encodeSegment(defaultClaims())}.`;

    expect(await refusalCode(verifyAccessJwt(requestWith(unsigned), configuredEnv()))).toBe(
      "UNAUTHENTICATED",
    );
  });

  it("refuses an HMAC assertion signed with the published public key", async () => {
    /*
      Algorithm confusion. The public key is published at a public URL, so an attacker who
      can persuade the verifier to treat it as an HMAC secret can mint any token they like.
      The defence is that the algorithm is a constant and the key is imported as an RSA
      verify key — a `CryptoKey` for RSASSA-PKCS1-v1_5 simply cannot verify an HMAC.
    */
    await seedKeySet();
    const secret = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(JSON.stringify(publicJwk)),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signingInput = `${encodeSegment({ alg: "HS256", kid: KID })}.${encodeSegment(defaultClaims())}`;
    const mac = await crypto.subtle.sign("HMAC", secret, new TextEncoder().encode(signingInput));
    const token = `${signingInput}.${base64Url(new Uint8Array(mac))}`;

    expect(await refusalCode(verifyAccessJwt(requestWith(token), configuredEnv()))).toBe(
      "UNAUTHENTICATED",
    );
  });

  it("refuses an assertion signed by a key that is not in the key set", async () => {
    await seedKeySet();
    const otherPair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;

    const signingInput = `${encodeSegment({ alg: "RS256", kid: KID })}.${encodeSegment(defaultClaims())}`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      otherPair.privateKey,
      new TextEncoder().encode(signingInput),
    );
    const token = `${signingInput}.${base64Url(new Uint8Array(signature))}`;

    expect(await refusalCode(verifyAccessJwt(requestWith(token), configuredEnv()))).toBe(
      "UNAUTHENTICATED",
    );
  });

  it("refuses an assertion carrying neither an email nor a common name", async () => {
    await seedKeySet();
    const claims = { ...defaultClaims(), email: undefined };

    expect(
      await refusalCode(verifyAccessJwt(requestWith(await signToken(claims)), configuredEnv())),
    ).toBe("UNAUTHENTICATED");
  });

  it("refuses something that is not a JWT at all", async () => {
    await seedKeySet();
    expect(await refusalCode(verifyAccessJwt(requestWith("not-a-token"), configuredEnv()))).toBe(
      "UNAUTHENTICATED",
    );
  });
});

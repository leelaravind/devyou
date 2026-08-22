import { ApiError } from "@devyou/core";

/**
 * Cloudflare Access — the outer gate.
 *
 * Access authenticates at Cloudflare's edge and forwards a signed assertion in
 * `Cf-Access-Jwt-Assertion`. Verifying that assertion in the Worker is not belt and
 * braces; without it the perimeter is a DNS record. A request that reaches the Worker
 * origin by any route Access does not sit in front of — a stray `workers.dev` origin, a
 * preview URL, a Worker route added to a second hostname — arrives with no assertion at
 * all, and an origin that trusts "Access must have run" admits it. `wrangler.jsonc`
 * closes each of those individually; this closes all of them at once, and keeps closing
 * them when somebody adds a route in a hurry.
 *
 * **This module fails closed, unconditionally.**
 *
 * The Access application for the DevYou admin hostnames does not exist yet — it is
 * owner action A0-1, recorded in the Phase 0 audit and in ADR-0001, and it is outside
 * wrangler's reach. So the interesting state is not "misconfigured", it is "not yet
 * configured", and it is the state this Worker will genuinely first be deployed in.
 *
 * With no `CF_ACCESS_POLICY_AUD`, every request is refused with a message naming A0-1.
 * There is no environment in which that check is skipped, no `ENVIRONMENT === "staging"`
 * branch, and no development bypass. Each of those would be a runtime value, and a
 * runtime value that disables an authentication gate is a runtime value somebody will
 * eventually set wrong — usually by copying a staging secret bundle into production.
 * Deploying before A0-1 therefore yields a Worker that serves nothing, which is the
 * only safe thing an unauthenticated admin console can do.
 *
 * Local development consequently needs a real assertion. `cloudflared access login`
 * followed by `cloudflared access token -app=<admin-host>` produces one; put the team
 * domain and AUD in `.dev.vars` (gitignored) and send the token as the header. That is
 * more friction than a bypass flag and it is the correct amount: the thing being
 * bypassed is the only thing between the internet and the moderation queue.
 */

/** The header Access sets on every authenticated request it forwards. */
const ASSERTION_HEADER = "cf-access-jwt-assertion";

/**
 * Access signs with RS256 and only RS256.
 *
 * Pinned rather than read from the token, which is the whole of the classic algorithm
 * confusion attack: a token declaring `alg: "none"` verifies trivially, and one
 * declaring `HS256` verifies against the *public* key used as an HMAC secret — and the
 * public key is published at a public URL. Both are impossible below, because the
 * algorithm passed to WebCrypto is this constant and the key is imported as an RSA
 * verify key.
 */
const REQUIRED_ALG = "RS256";

/** How long a fetched key set may be reused. Access rotates with overlap, so an hour is
 *  comfortably inside the window and removes a cross-network fetch from every page load
 *  on a surface whose pages are already several D1 queries deep. */
const JWKS_TTL_SECONDS = 3600;

/**
 * Tolerance on `exp`, `nbf` and `iat`.
 *
 * Thirty seconds. Cloudflare's edge and this Worker run on Cloudflare's clocks, so
 * meaningful skew is not expected; the allowance exists so a token minted in the same
 * second it is presented cannot fail on a rounding boundary. Larger values start to
 * extend the life of a revoked session, which is what `exp` is for.
 */
const CLOCK_SKEW_SECONDS = 30;

export interface AccessConfig {
  teamDomain: string;
  policyAud: string;
}

/**
 * Who Access says this is.
 *
 * Deliberately thin. Access knows an email address and a directory group; DevYou knows
 * a role and an account status. Mixing them here would let a group membership in
 * somebody else's identity provider imply a DevYou capability, and the point of the
 * two-key arrangement is that it cannot.
 */
export interface AccessIdentity {
  /** `email` for a human, `common_name` for a service token. Lower-cased. */
  subject: string;
  kind: "user" | "service_token";
  /** Access's own stable subject id, for correlating with the Access audit log. Empty
   *  for a service token, which has no user behind it. */
  accessSub: string;
  /** Unix seconds. Surfaced so the UI can warn before a session lapses mid-action. */
  expiresAt: number;
}

/** Read the Access configuration, or report that there is none. */
export function accessConfig(env: Env): AccessConfig | null {
  const teamDomain = trimTrailingSlash(nonEmpty(env.CF_ACCESS_TEAM_DOMAIN));
  const policyAud = nonEmpty(env.CF_ACCESS_POLICY_AUD);
  if (!teamDomain || !policyAud) return null;
  return { teamDomain, policyAud };
}

/**
 * Verify the assertion, or throw.
 *
 * Throws `ApiError` on every failure path, including the unconfigured one. The caller
 * decides what the reader sees; a verification function that can return a
 * success-shaped value on failure is one refactor away from being used as a boolean.
 */
export async function verifyAccessJwt(request: Request, env: Env): Promise<AccessIdentity> {
  const config = accessConfig(env);
  if (!config) {
    /*
      The fail-closed branch, and the reason `CF_ACCESS_POLICY_AUD` is typed optional.

      `internalDetail` names the blocking action rather than the missing variable. An
      operator reading this in a log needs to know an Access application has to be
      created, not that a string is empty — the second sends them to `wrangler secret
      put` with nothing to put.
    */
    throw new ApiError("UNAVAILABLE", {
      publicMessage:
        "This admin surface is not yet protected by Cloudflare Access and will not serve any request. Complete owner action A0-1: create the Access application for the admin hostnames and set CF_ACCESS_POLICY_AUD.",
      internalDetail: "access_not_configured: A0-1 outstanding",
    });
  }

  const token = request.headers.get(ASSERTION_HEADER);
  if (!token) {
    throw new ApiError("UNAUTHENTICATED", {
      publicMessage: "No Cloudflare Access assertion on this request.",
      internalDetail: "missing Cf-Access-Jwt-Assertion header",
    });
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new ApiError("UNAUTHENTICATED", { internalDetail: "assertion is not a compact JWS" });
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

  const header = decodeJson(encodedHeader, "header");
  if (header.alg !== REQUIRED_ALG) {
    throw new ApiError("UNAUTHENTICATED", {
      internalDetail: `assertion alg ${String(header.alg)} is not ${REQUIRED_ALG}`,
    });
  }
  const kid = typeof header.kid === "string" ? header.kid : null;
  if (!kid) {
    throw new ApiError("UNAUTHENTICATED", { internalDetail: "assertion header has no kid" });
  }

  /*
    Two attempts, and only for an unknown `kid`.

    Access rotates signing keys, and for the minutes around a rotation a valid token can
    be signed by a key absent from the cached set. Refetching once turns a rotation from
    an outage into a single extra request. It is scoped to this one failure on purpose:
    refetching on a signature mismatch would let anybody force an unbounded stream of
    outbound requests by presenting rubbish.
  */
  let key = await findKey(env, config, kid, false);
  if (!key) key = await findKey(env, config, kid, true);
  if (!key) {
    throw new ApiError("UNAUTHENTICATED", { internalDetail: "no Access signing key for kid" });
  }

  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!verified) {
    throw new ApiError("UNAUTHENTICATED", { internalDetail: "assertion signature is invalid" });
  }

  return claimsToIdentity(decodeJson(encodedPayload, "payload"), config);
}

/**
 * Claim validation, after the signature and never before it.
 *
 * Order matters. Reading a claim from an unverified token and acting on it — even only
 * to decide whether verifying is worthwhile — is how "we check the audience" becomes
 * "we check the audience the attacker supplied".
 */
function claimsToIdentity(claims: Record<string, unknown>, config: AccessConfig): AccessIdentity {
  const now = Math.floor(Date.now() / 1000);

  if (trimTrailingSlash(asString(claims.iss)) !== config.teamDomain) {
    throw new ApiError("UNAUTHENTICATED", { internalDetail: "assertion issuer mismatch" });
  }

  /*
    `aud` is an array, and this is the check that makes the AUD mean anything.

    Every Access application in the team domain is signed by the same keys, so a token
    minted for an unrelated internal tool passes the signature check and the issuer
    check and differs only here. Without it, "holds any Access application" would be the
    admin credential — and the team domain is shared with live products.
  */
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.some((entry) => entry === config.policyAud)) {
    throw new ApiError("UNAUTHENTICATED", { internalDetail: "assertion audience mismatch" });
  }

  const exp = asNumber(claims.exp);
  if (exp === null || exp + CLOCK_SKEW_SECONDS < now) {
    throw new ApiError("UNAUTHENTICATED", { internalDetail: "assertion expired or has no exp" });
  }
  const nbf = asNumber(claims.nbf);
  if (nbf !== null && nbf - CLOCK_SKEW_SECONDS > now) {
    throw new ApiError("UNAUTHENTICATED", { internalDetail: "assertion not yet valid" });
  }
  const iat = asNumber(claims.iat);
  if (iat !== null && iat - CLOCK_SKEW_SECONDS > now) {
    throw new ApiError("UNAUTHENTICATED", { internalDetail: "assertion issued in the future" });
  }

  /*
    A human presents `email`; an Access service token presents `common_name` and no
    email. Both are accepted as an *identity*, and neither is accepted as authorisation
    — the DevYou user lookup in `perimeter.server.ts` decides that, and a service token
    with no user row gets exactly as far as a stranger does.
  */
  const email = asString(claims.email).toLowerCase();
  if (email) {
    return { subject: email, kind: "user", accessSub: asString(claims.sub), expiresAt: exp };
  }

  const commonName = asString(claims.common_name).toLowerCase();
  if (commonName) {
    return { subject: commonName, kind: "service_token", accessSub: "", expiresAt: exp };
  }

  throw new ApiError("UNAUTHENTICATED", {
    internalDetail: "assertion carries neither email nor common_name",
  });
}

/* ---------------------------------------------------------------------------
   The key set
   --------------------------------------------------------------------------- */

/**
 * `kid` is absent from the runtime's `JsonWebKey`, which models the JWK *key material*
 * rather than a key set entry. Cloudflare ships a `JsonWebKeyWithKid` with a `readonly
 * kid`, which cannot be used to *build* one in a test, so the optional widening lives
 * here — a key set entry without a `kid` is a real possibility from a badly behaved
 * issuer, and it should be skipped rather than crash the lookup.
 */
type AccessJwk = JsonWebKey & { kid?: string };

interface JsonWebKeySet {
  keys?: AccessJwk[];
}

/**
 * Find one signing key, from KV or from the team domain.
 *
 * KV rather than a module-level variable. A module global is per-isolate, and isolates
 * come and go per colo and per deploy, so the hit rate is unpredictable and impossible
 * to reason about during an incident. KV is shared, carries an explicit TTL, and holds
 * nothing secret: these are public keys, published at a public URL.
 */
async function findKey(
  env: Env,
  config: AccessConfig,
  kid: string,
  forceRefresh: boolean,
): Promise<CryptoKey | null> {
  const cacheKey = `access:jwks:${config.teamDomain}`;

  let jwks: JsonWebKeySet | null = forceRefresh
    ? null
    : await env.CACHE.get<JsonWebKeySet>(cacheKey, "json");

  if (!jwks) {
    const response = await fetch(`${config.teamDomain}/cdn-cgi/access/certs`);
    if (!response.ok) {
      /*
        No serve-stale here, deliberately.

        Falling back to an expired key set when the certs endpoint is unreachable is the
        availability-friendly choice and the wrong one: it extends the life of a key that
        may have been rotated precisely because it was compromised. An admin console
        unavailable for the duration of a Cloudflare incident is acceptable; one that
        keeps honouring retired keys is not.
      */
      throw new ApiError("UNAVAILABLE", {
        publicMessage: "Could not reach Cloudflare Access to verify this session.",
        internalDetail: `Access certs endpoint returned ${response.status}`,
      });
    }
    jwks = (await response.json()) as JsonWebKeySet;
    await env.CACHE.put(cacheKey, JSON.stringify(jwks), { expirationTtl: JWKS_TTL_SECONDS });
  }

  const jwk = (jwks.keys ?? []).find((candidate) => candidate.kid === kid);
  if (!jwk) return null;

  /*
    The algorithm is this constant, not `jwk.alg`. Importing as an RSA verify key means
    the key material cannot be used as an HMAC secret whatever any header claims —
    algorithm confusion is closed by the type of the key object, not by a comparison
    somebody could reorder.
  */
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

/* ---------------------------------------------------------------------------
   Encoding
   --------------------------------------------------------------------------- */

function decodeJson(segment: string, what: string): Record<string, unknown> {
  try {
    const decoded = new TextDecoder().decode(base64UrlToBytes(segment));
    const parsed: unknown = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError("UNAUTHENTICATED", {
      internalDetail: `assertion ${what} is not valid JSON`,
    });
  }
}

/** Typed as `Uint8Array<ArrayBuffer>` rather than the default `ArrayBufferLike`, because
 *  WebCrypto's `BufferSource` will not accept a view that might sit on a
 *  `SharedArrayBuffer`. Nothing here ever produces one. */
function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonEmpty(value: string | undefined): string | null {
  return value !== undefined && value.length > 0 ? value : null;
}

function trimTrailingSlash(value: string | null): string {
  return (value ?? "").replace(/\/+$/, "");
}

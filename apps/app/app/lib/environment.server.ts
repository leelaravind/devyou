import {
  describeEnvironment,
  fingerprintEnvironment,
  normaliseVersion,
  type EnvironmentComponent,
  type EnvironmentSnapshot,
} from "@devyou/domain";

/**
 * The reader's declared environment.
 *
 * Held in a cookie, not in the database, and not behind a login. Plan §0.7 makes
 * public reading frictionless, and asking somebody to create an account before their
 * search can be filtered by their Node version would defeat the point of having
 * version-aware search at all.
 *
 * The cookie is deliberately dull: a short JSON structure, no identifier, nothing
 * that could correlate one reader with another. It is a *preference*, in the same
 * category as a theme choice, so it carries no consent obligation and nothing is
 * lost by clearing it.
 *
 * It is never the source of an evidence record. A reproduction takes an immutable
 * `environment_snapshot`, created at submission time from this — plan §5 is explicit
 * that evidence must not reference a mutable preset, because upgrading Node would
 * otherwise silently rewrite the environment of every reproduction you had ever
 * filed.
 */

export const ENVIRONMENT_COOKIE = "dv_env";

/** A year. It is a preference, and re-declaring it every week would be worse UX than
 *  a stale value the reader can see and change on every search page. */
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** Anything larger is not an environment, it is somebody probing the parser. */
const MAX_COOKIE_BYTES = 2048;
const MAX_COMPONENTS = 12;

export interface DeclaredEnvironment extends EnvironmentSnapshot {
  label: string;
  fingerprint: string;
}

interface StoredShape {
  os?: string;
  osv?: string;
  arch?: string;
  c?: Array<{ t?: string; l?: string }>;
}

export function readEnvironmentCookie(request: Request): DeclaredEnvironment | null {
  const raw = cookieValue(request.headers.get("cookie"), ENVIRONMENT_COOKIE);
  if (!raw || raw.length > MAX_COOKIE_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    /*
      A malformed cookie is discarded silently rather than erroring.

      Every value here came from a client and can be anything. The correct response
      to nonsense is to behave as though no environment was declared — which is a
      fully supported state, since most readers will never declare one.
    */
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const stored = parsed as StoredShape;

  const components: EnvironmentComponent[] = (Array.isArray(stored.c) ? stored.c : [])
    .slice(0, MAX_COMPONENTS)
    .flatMap((entry) => {
      const label = typeof entry?.l === "string" ? entry.l.slice(0, 64) : "";
      if (label === "") return [];
      return [
        {
          technologyId: typeof entry?.t === "string" ? entry.t.slice(0, 64) : null,
          rawLabel: label,
          semverNormalized: normaliseVersion(label),
        },
      ];
    });

  const snapshot: EnvironmentSnapshot = {
    osFamily: str(stored.os),
    osVersion: str(stored.osv),
    architecture: str(stored.arch),
    components,
  };

  if (!snapshot.osFamily && components.length === 0) return null;

  return {
    ...snapshot,
    label: describeEnvironment(snapshot),
    fingerprint: fingerprintEnvironment(snapshot),
  };
}

export function serialiseEnvironmentCookie(snapshot: EnvironmentSnapshot, secure: boolean): string {
  const payload: StoredShape = {
    ...(snapshot.osFamily ? { os: snapshot.osFamily } : {}),
    ...(snapshot.osVersion ? { osv: snapshot.osVersion } : {}),
    ...(snapshot.architecture ? { arch: snapshot.architecture } : {}),
    c: snapshot.components.slice(0, MAX_COMPONENTS).map((component) => ({
      ...(component.technologyId ? { t: component.technologyId } : {}),
      l: component.rawLabel,
    })),
  };

  const value = encodeURIComponent(JSON.stringify(payload));

  /*
    `SameSite=Lax`, not `Strict`.

    A playbook link shared in Slack or a GitHub issue is the commonest way anybody
    arrives here, and under `Strict` that reader's declared environment would be
    ignored on exactly the page where it matters most. There is nothing to protect
    with `Strict` — this cookie authorises nothing and identifies nobody.

    `HttpOnly` is deliberately absent: the environment editor reads it client-side to
    prefill the form, and a value the client supplied in the first place gains
    nothing from being hidden from the client.
  */
  return [
    `${ENVIRONMENT_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${MAX_AGE_SECONDS}`,
    "SameSite=Lax",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearEnvironmentCookie(): string {
  return `${ENVIRONMENT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, 64) : null;
}

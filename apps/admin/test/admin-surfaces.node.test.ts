import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SURFACES } from "../app/lib/surfaces";

/**
 * Source-level guards.
 *
 * These exist because of a failure mode the runtime tests structurally cannot catch: a
 * route that *stops* doing something. Delete the `requireAdmin` call from
 * `taxonomy.tsx` during a refactor and every test in this repository still passes, because
 * none of them exercises taxonomy — the surface simply becomes readable by anybody who got
 * through Access. Reading the sources is the only way to assert something about every
 * route, including the ones nobody remembered to write a test for.
 *
 * They are crude on purpose. A guard that needed a TypeScript AST to express would be a
 * guard somebody rewrites rather than fixes, and the properties being checked are properties
 * of *text*: a call is present, or a call is absent.
 */

const ROUTES_DIR = path.resolve(import.meta.dirname, "../app/routes");
const APP_DIR = path.resolve(import.meta.dirname, "../app");
const WORKER = path.resolve(import.meta.dirname, "../workers/app.ts");

const routeFiles = readdirSync(ROUTES_DIR).filter((name) => /\.tsx?$/.test(name));
const read = (file: string) => readFileSync(path.join(ROUTES_DIR, file), "utf8");

/** Strip comments before searching for a call, so a call *described* in prose is not
 *  mistaken for a call that happens. Every file here has long comment blocks that name the
 *  functions they are about. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("every route is behind the perimeter", () => {
  it.each(routeFiles)("%s gates its loader", (file) => {
    const source = code(read(file));
    if (!/export async function loader|export function loader/.test(source)) return;
    expect(
      source,
      `${file}: a loader must obtain env through requireAdmin(context, capability)`,
    ).toMatch(/requireAdmin\(\s*context\s*,/);
  });

  it.each(routeFiles)("%s gates its action", (file) => {
    const source = code(read(file));
    if (!/export async function action|export function action/.test(source)) return;
    expect(
      source,
      `${file}: an action must go through beginAdminAction, which asserts same-origin and resolves the operator`,
    ).toMatch(/beginAdminAction\(/);
  });

  it.each(routeFiles)("%s does not write to the database directly", (file) => {
    /*
      The chokepoint check.

      `performAdminAction` is the only thing in this Worker that executes a write, and it
      takes the capability as a required argument and refuses before it builds a statement.
      A route calling `.run()` or `.batch()` itself would be a write that skipped both the
      capability check and the audit row — the two things this whole module is for.

      Reads (`.all()`, `.first()`) are unaffected and are used freely above.
    */
    const source = code(read(file));
    expect(source, `${file}: writes must go through performAdminAction`).not.toMatch(/\.run\(\)/);
    expect(source, `${file}: batching is performAdminAction's job`).not.toMatch(/\.batch\(/);
  });
});

describe("every declared surface exists and gates on the capability it declares", () => {
  it.each(SURFACES.map((surface) => [surface.path, surface.capability] as const))(
    "%s is backed by a route requiring %s",
    (surfacePath, capability) => {
      const base = surfacePath.replace(/^\//, "");
      const file = routeFiles.find((name) => name.replace(/\.tsx?$/, "") === base);

      expect(file, `no route file for the ${surfacePath} surface`).toBeDefined();
      expect(
        code(read(file as string)),
        `${file}: the sidebar offers ${surfacePath} to anybody holding ${capability}, so the route must require it`,
      ).toContain(`"${capability}"`);
    },
  );
});

describe("the Worker boundary", () => {
  const worker = code(readFileSync(WORKER, "utf8"));

  it("verifies the Access assertion before the router runs", () => {
    const verifyAt = worker.indexOf("verifyAccessJwt(");
    const handlerAt = worker.indexOf("requestHandler(");
    const assetsAt = worker.indexOf("env.ASSETS.fetch(");

    expect(verifyAt).toBeGreaterThan(-1);
    /* Both the router and the asset fetch must come after verification. The asset case is
       the easy one to get wrong: a bundle served by the asset router is a bundle served by
       code that never checked the assertion. */
    expect(verifyAt).toBeLessThan(handlerAt);
    expect(verifyAt).toBeLessThan(assetsAt);
  });

  it("sets no-store and noindex on every response", () => {
    expect(worker).toContain('cache: "no-store"');
    expect(worker).toContain("x-robots-tag");
  });

  it("has no environment-conditional bypass of the Access gate", () => {
    /*
      The thing this module must never grow.

      A `if (env.ENVIRONMENT !== "production")` around the gate, or an `import.meta.env.DEV`
      escape, is a runtime value that disables authentication — and a runtime value that
      disables authentication is one somebody eventually sets wrong, usually by copying a
      staging secret bundle into production.
    */
    const perimeter = readFileSync(path.join(APP_DIR, "lib/access.server.ts"), "utf8");
    for (const source of [worker, code(perimeter)]) {
      expect(source).not.toMatch(/ENVIRONMENT\s*[!=]==?\s*["']production["']/);
      expect(source).not.toMatch(/import\.meta\.env\.DEV/);
      expect(source).not.toMatch(/SKIP_ACCESS|BYPASS|DISABLE_AUTH/i);
    }
  });
});

describe("the capability matrix is never re-implemented", () => {
  it.each(routeFiles)("%s does not define its own role list", (file) => {
    /*
      Re-stating the matrix locally is the failure the phase brief names explicitly. A
      route deciding `role === "dev_admin"` for itself is a second copy of an authorisation
      rule, and the copy is always the one that is out of date.
    */
    const source = code(read(file));
    expect(source, `${file}: use can(role, capability) from @devyou/auth`).not.toMatch(
      /role\s*===\s*["'](dev_admin|support_admin|reviewer)["']/,
    );
  });
});

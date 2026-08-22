import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteLoaderData,
} from "react-router";
import type { LinksFunction } from "react-router";
import { SkipLink, TopNav, CompactSearch, Icon } from "@devyou/ui";

import type { Route } from "./+types/root";
import { cloudflareContext } from "./context/cloudflare";
import { nonceContext } from "./context/nonce";
import { loadAuthState } from "./lib/auth.server";
import "./app.css";

/**
 * The fonts are self-hosted, so there is no stylesheet link here at all — see
 * `packages/ui/src/styles/fonts.css` for why. What remains is a preload of the two
 * faces above the fold on every page: the headline face and the mono face that every
 * error string, command and version tag is set in.
 *
 * Preloading only the latin subsets, and only those two: a preload that the page does
 * not use immediately competes with the ones it does, which makes the fold slower
 * rather than faster.
 */
export const links: LinksFunction = () => [
  {
    rel: "preload",
    href: "/fonts/geist-latin.19f9c925.woff2",
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous",
  },
  {
    rel: "preload",
    href: "/fonts/jetbrains-mono-latin.83c005d4.woff2",
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous",
  },
];

/**
 * The root loader resolves the principal for every route.
 *
 * It costs one indexed lookup, and only for a request that actually presented a
 * session cookie — `resolvePrincipal` returns immediately when there is none, which
 * is the anonymous read path the whole product is tuned for. The alternative, each
 * route resolving its own, produces the class of bug where a page renders as signed
 * out because somebody forgot.
 *
 * A request that authenticates is taken out of the shared cache at the Worker
 * boundary; see `cachePolicyFor`.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const auth = await loadAuthState(request, env);

  return {
    nonce: context.get(nonceContext),
    /* Only what the nav renders. The role and user id stay server-side: neither is
       needed to draw a link, and a role in the HTML invites client-side gating,
       which is not a control. */
    viewer: auth.principal
      ? {
          handle: auth.principal.handle,
          displayName: auth.principal.displayName ?? auth.principal.handle,
        }
      : null,
    signInAvailable: auth.signInAvailable,
  };
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const nonce = data?.nonce ?? "";

  return (
    /*
      No `class="dark"`, and no inline theme script.

      The Stitch reference sets a class on <html>. Doing the same would mean either
      an inline script to read the stored preference before paint — which needs a
      nonce and adds a render-blocking script to every page — or a flash of the
      wrong theme.

      Instead the palette is dark by default in CSS and follows
      `prefers-color-scheme` when the reader has expressed no choice. An explicit
      choice sets `data-theme` from the client after hydration, which can flash only
      for a reader who has actively overridden their own OS setting. That is the
      cheapest correct trade, and it keeps the document script-free.
    */
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="flex min-h-screen flex-col">
        <SkipLink />
        {children}
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  const { viewer, signInAvailable } = loaderData;

  return (
    <>
      <TopNav
        links={[
          { label: "Playbooks", href: "/playbooks" },
          { label: "Contribute", href: "/contribute" },
        ]}
        search={<CompactSearch />}
        actions={
          <>
            <a
              href="/environment"
              className="rounded p-2 text-on-surface-variant transition-colors hover:bg-surface-container-highest"
              title="Your environment"
            >
              <Icon name="hub" label="Your environment" />
            </a>
            <AccountSlot viewer={viewer} signInAvailable={signInAvailable} />
          </>
        }
      />
      <Outlet />
      <SiteFooter />
    </>
  );
}

/**
 * The account corner.
 *
 * Absent entirely when sign-in is unconfigured — an affordance that leads to "not
 * available" is worse than no affordance. Signing out is a form, not a link:
 * `GET /sign-out` would let any image tag on any page sign a reader out, and a
 * prefetching browser would do it unprompted.
 */
function AccountSlot({
  viewer,
  signInAvailable,
}: {
  viewer: { handle: string | null; displayName: string | null } | null;
  signInAvailable: boolean;
}) {
  if (viewer) {
    return (
      <div className="flex items-center gap-1">
        {viewer.handle && (
          <a
            href={`/profile/${viewer.handle}`}
            className="hidden rounded px-2 py-2 font-mono text-label-caps uppercase text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface sm:block"
          >
            {viewer.displayName ?? viewer.handle}
          </a>
        )}
        <form method="post" action="/sign-out">
          <button
            type="submit"
            className="rounded p-2 text-on-surface-variant transition-colors hover:bg-surface-container-highest"
            title="Sign out"
          >
            <Icon name="logout" label="Sign out" />
          </button>
        </form>
      </div>
    );
  }

  if (!signInAvailable) return null;

  return (
    <a
      href="/sign-in"
      className="rounded px-3 py-2 font-mono text-label-caps uppercase text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
    >
      Sign in
    </a>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-outline-variant bg-surface-container-low">
      <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-gutter px-margin py-6 text-body-sm text-on-surface-variant">
        <p className="font-mono text-env-tag uppercase">DEV.ITISYOU — evidence, not opinions</p>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-gutter">
          <a href="/about" className="hover:text-on-surface">
            About
          </a>
          <a href="/how-verification-works" className="hover:text-on-surface">
            How verification works
          </a>
          <a href="/sitemap.xml" className="hover:text-on-surface">
            Sitemap
          </a>
          <a href="https://itisyou.app" className="hover:text-on-surface">
            ITISYOU Network
          </a>
        </nav>
      </div>
    </footer>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let detail = "This one is at our end. Nothing you did caused it.";

  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? "No such page" : `Error ${error.status}`;
    detail =
      error.status === 404
        ? "That address does not match a playbook, a technology or a page."
        : error.statusText || detail;
  }

  return (
    <main id="main" className="mx-auto w-full max-w-[720px] px-margin py-24">
      <h1 className="mb-2 font-headline text-headline-lg text-on-surface">{title}</h1>
      <p className="mb-6 text-body-md text-on-surface-variant">{detail}</p>
      <a
        href="/"
        className="inline-flex items-center gap-1 rounded bg-primary px-4 py-2 font-mono text-label-caps uppercase text-on-primary"
      >
        <Icon name="arrow_back" size={14} />
        Start a new diagnosis
      </a>
      {/*
        No stack trace, in any environment.

        A stack trace on a public page tells an attacker the framework version, the
        file layout and often a query shape. It belongs in the Worker's log, which
        is where the boundary handler puts it.
      */}
    </main>
  );
}

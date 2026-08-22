import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLocation,
  useRouteLoaderData,
} from "react-router";
import type { LinksFunction } from "react-router";
import { Icon, Sidebar, SkipLink, Tag, TopNav } from "@devyou/ui";
import { ApiError } from "@devyou/core";
import { can } from "@devyou/auth";

import type { Route } from "./+types/root";
import { accessContext } from "./context/access";
import { cloudflareContext } from "./context/cloudflare";
import { nonceContext } from "./context/nonce";
import { httpError } from "./lib/http.server";
import { requireActor } from "./lib/perimeter.server";
import { SURFACES } from "./lib/surfaces";
import "./app.css";

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap",
  },
];

export function meta() {
  return [
    { title: "DevYou admin" },
    /*
      A `robots` meta tag as well as the `x-robots-tag` header the Worker sets.

      Belt and braces, and cheap: the header covers everything including JSON, the meta
      tag covers the case where somebody proxies a rendered page somewhere the header did
      not survive. Neither is the real control — Cloudflare Access is — but an admin
      console that could be indexed is a list of an organisation's internal tooling.
    */
    { name: "robots", content: "noindex, nofollow, noarchive" },
  ];
}

/**
 * The root loader resolves the operator once, for the whole request.
 *
 * It does **not** require a capability. Root is the shell: it needs to know who is here
 * in order to draw their name and to decide which sidebar entries to show, and requiring
 * some particular capability to render a page frame would mean the frame disappears for
 * a role that is nonetheless entitled to a page inside it.
 *
 * What it does require is a DevYou user row. This is the enforcement point for "Access
 * proves who, `users.role` decides what": an identity that passed Access but holds no
 * active admin account never sees the shell at all, let alone a surface. Requirement
 * met once, here, rather than page by page.
 *
 * The visible surface list is computed server-side and shipped as a list of links. The
 * role itself is deliberately not sent to the browser: nothing in the UI needs it, and a
 * role in the HTML invites client-side gating, which is not a control.
 */
export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const identity = context.get(accessContext);

  if (!identity) {
    throw httpError(
      new ApiError("UNAUTHENTICATED", {
        internalDetail: "root loader reached with no verified Access identity in context",
      }),
    );
  }

  let actor;
  try {
    actor = await requireActor(env.DB, identity);
  } catch (error) {
    throw httpError(error);
  }

  return {
    nonce: context.get(nonceContext),
    environment: env.ENVIRONMENT,
    publicAppUrl: env.PUBLIC_APP_URL,
    operator: {
      displayName: actor.displayName,
      /* The Access subject, shown so an operator can tell at a glance which identity
         they are acting as — the common mistake on a shared machine is acting as
         somebody else's still-open session, and the name alone does not reveal it. */
      accessSubject: actor.accessSubject,
    },
    surfaces: SURFACES.filter((surface) => can(actor.role, surface.capability)).map((surface) => ({
      path: surface.path,
      label: surface.label,
      icon: surface.icon,
    })),
  };
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const nonce = data?.nonce ?? "";

  return (
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

export default function AdminApp({ loaderData }: Route.ComponentProps) {
  const { environment, operator, surfaces, publicAppUrl } = loaderData;
  const location = useLocation();

  return (
    <>
      <TopNav
        actions={
          <div className="gap-density-high flex items-center">
            {/*
              The environment banner is not decoration.

              Staging and production share a design, a hostname shape and a set of
              operators. The action that matters — suspending an account, quarantining a
              playbook — looks identical in both, and the only thing distinguishing them
              on screen is this tag. It is rendered before the operator's name because
              "which database am I about to change" is the more urgent question.
            */}
            <Tag tone={environment === "production" ? "os" : "runtime"}>{environment}</Tag>
            <span className="text-env-tag text-on-surface-variant hidden font-mono sm:inline">
              {operator.displayName}
            </span>
            <a
              href={publicAppUrl}
              className="text-on-surface-variant hover:bg-surface-container-highest rounded p-2 transition-colors"
              title="Open the public site"
            >
              <Icon name="link" label="Open the public site" />
            </a>
          </div>
        }
      />

      <div className="split:flex-row flex min-h-0 flex-1 flex-col">
        <Sidebar
          label="Admin surfaces"
          items={surfaces.map((surface) => ({
            label: surface.label,
            href: surface.path,
            icon: surface.icon,
            current: location.pathname === surface.path,
          }))}
          header={
            <a
              href="/"
              className="gap-density-high text-body-sm text-on-surface-variant hover:text-on-surface flex items-center rounded px-3 py-2 font-mono"
            >
              <Icon name="hub" size={18} />
              Overview
            </a>
          }
          footer={
            <p
              className="text-env-tag text-on-surface-variant font-mono"
              title={operator.accessSubject}
            >
              {operator.accessSubject}
            </p>
          }
        />
        <Outlet />
      </div>
    </>
  );
}

/**
 * The error boundary.
 *
 * `statusText` carries `publicMessage` from the refusal — see `http.server.ts` — so a
 * capability denial reads as "your role does not include taxonomy:merge" rather than as
 * a generic 403. On a public page that specificity would be an information leak; here
 * every reader has already passed Access and holds an admin role, and vagueness only
 * costs support time.
 *
 * No stack trace, in any environment. Same rule as the public site.
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let detail = "This one is at our end. Nothing you did caused it.";

  if (isRouteErrorResponse(error)) {
    title =
      error.status === 403
        ? "Not permitted"
        : error.status === 404
          ? "No such page"
          : `Error ${error.status}`;
    detail = error.statusText || detail;
  }

  return (
    <main id="main" className="px-margin mx-auto w-full max-w-[640px] py-24">
      <Icon name="block" size={24} className="text-destructive-red mb-3" />
      <h1 className="font-headline text-headline-lg text-on-surface mb-2">{title}</h1>
      <p className="text-body-md text-on-surface-variant">{detail}</p>
    </main>
  );
}

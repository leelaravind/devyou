import { Form, Link, redirect } from "react-router";
import { Card, Icon } from "@devyou/ui";
import { buildAuthorisationUrl, isConfigured } from "@devyou/auth";
import type { Route } from "./+types/sign-in";
import { cloudflareContext } from "../context/cloudflare";
import {
  githubConfig,
  guardOrigin,
  loadAuthState,
  serialiseStateCookie,
} from "../lib/auth.server";

/**
 * Sign in.
 *
 * The page is deliberately unpersuasive. Reading, searching and reporting a
 * reproduction all work without an account, so this page's job is to say accurately
 * what signing in changes — not to convert. Overstating the benefit here is how a
 * product ends up with accounts that never come back.
 */

export function meta() {
  return [
    { title: "Sign in — DEV.ITISYOU" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

const ERRORS: Record<string, string> = {
  unavailable: "Sign-in is not configured on this deployment yet.",
  state: "That sign-in attempt could not be verified. Please start again.",
  no_code: "GitHub did not send anything back. Please try again.",
  exchange: "GitHub could not confirm the sign-in. Please try again.",
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const auth = await loadAuthState(request, env);

  if (auth.principal) throw redirect("/");

  const url = new URL(request.url);
  const errorCode = url.searchParams.get("error");

  return {
    signInAvailable: auth.signInAvailable,
    error: errorCode ? (ERRORS[errorCode] ?? ERRORS.exchange) : null,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  guardOrigin(request, env);

  const config = githubConfig(env);
  if (!isConfigured(config)) throw redirect("/sign-in?error=unavailable");

  const { url, state } = buildAuthorisationUrl(config);
  const secure = new URL(request.url).protocol === "https:";

  return redirect(url, { headers: { "Set-Cookie": serialiseStateCookie(state, secure) } });
}

export default function SignIn({ loaderData }: Route.ComponentProps) {
  const { signInAvailable, error } = loaderData;

  return (
    <main id="main" className="mx-auto flex w-full max-w-[560px] flex-col gap-margin px-margin py-16">
      <h1 className="font-headline text-headline-lg text-on-surface">Sign in</h1>

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded border border-destructive-red bg-surface-container-low p-3 text-body-sm text-destructive-red"
        >
          <Icon name="error" size={15} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <Card>
        <h2 className="mb-2 font-headline text-body-md font-semibold text-on-surface">
          What signing in changes
        </h2>
        <ul className="flex list-none flex-col gap-2 text-body-sm text-on-surface-variant">
          <li className="flex items-start gap-2">
            <Icon name="check" size={14} className="mt-0.5 shrink-0 text-status-ci-verified" />
            Your reproduction reports count toward a playbook&rsquo;s confidence figure. Anonymous
            reports are shown but not counted — that is the only way the number stays hard to
            forge.
          </li>
          <li className="flex items-start gap-2">
            <Icon name="check" size={14} className="mt-0.5 shrink-0 text-status-ci-verified" />
            Your contributions are attributed to you, and stay attributed across revisions.
          </li>
          <li className="flex items-start gap-2">
            <Icon name="check" size={14} className="mt-0.5 shrink-0 text-status-ci-verified" />
            You can save a draft and come back to it.
          </li>
        </ul>

        <h2 className="mt-4 mb-2 font-headline text-body-md font-semibold text-on-surface">
          What it does not change
        </h2>
        <ul className="flex list-none flex-col gap-2 text-body-sm text-on-surface-variant">
          <li className="flex items-start gap-2">
            <Icon name="close" size={14} className="mt-0.5 shrink-0 text-on-surface-variant" />
            Reading and searching. Those never need an account and never will.
          </li>
          <li className="flex items-start gap-2">
            <Icon name="close" size={14} className="mt-0.5 shrink-0 text-on-surface-variant" />
            {/*
              Stated explicitly because plan §12 requires it and because readers
              reasonably assume otherwise: a GitHub account with ten years of history
              and a new one get identical standing here.
            */}
            How much your report is trusted. A GitHub account proves you control that
            account — nothing about whether you are right. Stars, followers and account age are
            not read.
          </li>
          <li className="flex items-start gap-2">
            <Icon name="close" size={14} className="mt-0.5 shrink-0 text-on-surface-variant" />
            Any ranking or reputation. There is no score here to climb.
          </li>
        </ul>
      </Card>

      {signInAvailable ? (
        <Form method="post">
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center gap-2 rounded bg-primary px-4 py-3 font-mono text-label-caps uppercase text-on-primary transition-opacity hover:opacity-90"
          >
            <Icon name="account_circle" size={16} />
            Continue with GitHub
          </button>
          <p className="mt-2 text-center text-body-sm text-on-surface-variant">
            We ask GitHub for no permissions beyond your public profile.
          </p>
        </Form>
      ) : (
        <Card>
          <p className="flex items-start gap-2 text-body-sm text-warning-amber">
            <Icon name="info" size={15} className="mt-0.5 shrink-0" />
            Sign-in is not configured on this deployment. Everything else works — you can read,
            search, run a diagnosis and file a reproduction report without an account; reports
            filed now are shown but not counted toward confidence.
          </p>
        </Card>
      )}

      <p className="text-center text-body-sm text-on-surface-variant">
        <Link to="/" className="underline">
          Back to search
        </Link>
      </p>
    </main>
  );
}

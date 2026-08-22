import { Form, data } from "react-router";
import { Button, Card, Field, Icon, Input, Page } from "@devyou/ui";
import { normaliseVersion, type EnvironmentComponent, type EnvironmentSnapshot } from "@devyou/domain";
import type { Route } from "./+types/environment";
import { cloudflareContext } from "../context/cloudflare";
import {
  clearEnvironmentCookie,
  readEnvironmentCookie,
  serialiseEnvironmentCookie,
} from "../lib/environment.server";

/**
 * Declare your environment.
 *
 * This is the one place the product asks a reader to describe themselves at all, and
 * the design constraints on it come directly from two named risks:
 *
 * - R-23 names forced dropdown selection as an abandonment trigger, so every field
 *   that isn't a small, genuinely closed vocabulary (OS family, architecture) is free
 *   text, backed by a `<datalist>` for suggestions rather than a picker that refuses
 *   anything not on the list.
 * - `environment.server.ts` is explicit that this cookie is a preference, not an
 *   identity, and never the thing an evidence record points at. The copy on this page
 *   says that in plain words, not as a buried privacy-policy clause, because the
 *   reader deciding whether to fill this in is the reader who most needs to know it.
 */

const MAX_COMPONENT_ROWS = 8;

const OS_FAMILIES = [
  { value: "", label: "Not set" },
  { value: "linux", label: "Linux" },
  { value: "macos", label: "macOS" },
  { value: "windows", label: "Windows" },
  { value: "other", label: "Other" },
] as const;

const ARCHITECTURES = [
  { value: "", label: "Not set" },
  { value: "x86_64", label: "x86_64 / amd64" },
  { value: "arm64", label: "arm64 / aarch64" },
  { value: "x86", label: "x86 (32-bit)" },
  { value: "arm", label: "arm (32-bit)" },
  { value: "other", label: "Other" },
] as const;

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Your environment — DEV.ITISYOU" },
    {
      name: "description",
      content:
        "Declare your operating system, architecture and tool versions so search results and playbook pages can tell you whether a fix applies to your setup.",
    },
    // A personal, cookie-scoped declaration is not a page worth a search engine
    // sending strangers to — it renders the same form for everyone regardless.
    { name: "robots", content: "noindex, follow" },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const environment = readEnvironmentCookie(request);

  const technologies = await env.DB.prepare(
    `SELECT name FROM technologies WHERE status = 'active' ORDER BY name`,
  ).all<{ name: string }>();

  return {
    environment,
    technologyNames: technologies.results.map((row) => row.name),
  };
}

interface ParsedComponent {
  rawLabel: string;
  semverNormalized: string | null;
}

interface ActionResult {
  intent: "save" | "clear";
  osFamily: string | null;
  osVersion: string | null;
  architecture: string | null;
  components: ParsedComponent[];
}

export async function action({ request }: Route.ActionArgs) {
  const url = new URL(request.url);
  const formData = await request.formData();
  const intent = formData.get("_intent") === "clear" ? "clear" : "save";

  if (intent === "clear") {
    return data<ActionResult>(
      { intent: "clear", osFamily: null, osVersion: null, architecture: null, components: [] },
      { headers: { "Set-Cookie": clearEnvironmentCookie() } },
    );
  }

  const osFamily = textValue(formData.get("osFamily"));
  const osVersion = textValue(formData.get("osVersion"));
  const architecture = textValue(formData.get("architecture"));

  const components: EnvironmentComponent[] = formData
    .getAll("component")
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((label) => label !== "")
    .slice(0, MAX_COMPONENT_ROWS)
    .map((label) => {
      const trimmed = label.slice(0, 64);
      return {
        technologyId: null,
        rawLabel: trimmed,
        // `null` here is a real, meaningful outcome (see the domain module's own
        // comment on this) — it means "not recognised as a version", and it must be
        // shown back to the reader as exactly that, not swallowed.
        semverNormalized: normaliseVersion(trimmed),
      };
    });

  const snapshot: EnvironmentSnapshot = { osFamily, osVersion, architecture, components };

  return data<ActionResult>(
    {
      intent: "save",
      osFamily,
      osVersion,
      architecture,
      components: components.map((component) => ({
        rawLabel: component.rawLabel,
        semverNormalized: component.semverNormalized,
      })),
    },
    { headers: { "Set-Cookie": serialiseEnvironmentCookie(snapshot, url.protocol === "https:") } },
  );
}

function textValue(entry: FormDataEntryValue | null): string | null {
  if (typeof entry !== "string") return null;
  const trimmed = entry.trim();
  return trimmed === "" ? null : trimmed.slice(0, 64);
}

export default function EnvironmentPage({ loaderData, actionData }: Route.ComponentProps) {
  const { environment, technologyNames } = loaderData;

  const existingComponents = environment?.components.map((component) => component.rawLabel) ?? [];
  const rows = Array.from(
    { length: MAX_COMPONENT_ROWS },
    (_, index) => existingComponents[index] ?? "",
  );

  return (
    <Page className="max-w-3xl gap-8">
      <header>
        <h1 className="mb-2 font-headline text-headline-lg text-on-surface">Your environment</h1>
        <p className="max-w-2xl text-body-sm text-on-surface-variant">
          Declare the operating system, architecture and tool versions you're working with, and
          search results and playbook pages can tell you whether a fix applies to your setup —
          before you try it, not after.
        </p>
      </header>

      <Card as="section">
        <h2 className="mb-2 flex items-center gap-2 font-mono text-label-caps uppercase text-on-surface">
          <Icon name="hub" size={14} />
          What this is, plainly
        </h2>
        <ul className="flex flex-col gap-1.5 text-body-sm text-on-surface-variant">
          <li>
            This is stored in a cookie in your browser, not an account. There is nothing to sign
            in for, and nothing saved anywhere else.
          </li>
          <li>
            The cookie holds no identifier — nothing that names you, nothing shared between your
            devices, and nothing this site uses to track you across visits.
          </li>
          <li>
            It is never what an evidence record points at. When you report that a fix worked, that
            report takes its own immutable snapshot of your environment at that moment — so
            upgrading Node next month can never silently rewrite what an old report says it
            tested.
          </li>
          <li>You can clear it at any time below, and nothing of yours is lost by doing so.</li>
        </ul>
      </Card>

      <Form method="post" className="flex flex-col gap-gutter">
        <Card as="section" className="grid gap-gutter sm:grid-cols-2">
          <Field label="Operating system">
            {({ inputId, describedBy }) => (
              <select
                id={inputId}
                name="osFamily"
                defaultValue={environment?.osFamily ?? ""}
                aria-describedby={describedBy}
                className="rounded border border-outline-variant bg-surface-container px-3 py-2 text-body-md text-on-surface focus:border-evidence-blue"
              >
                {OS_FAMILIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="OS version" description='Free text — e.g. "22.04" or "14.5".'>
            {({ inputId, describedBy }) => (
              <Input
                id={inputId}
                name="osVersion"
                defaultValue={environment?.osVersion ?? ""}
                aria-describedby={describedBy}
                maxLength={64}
              />
            )}
          </Field>

          <Field label="Architecture">
            {({ inputId, describedBy }) => (
              <select
                id={inputId}
                name="architecture"
                defaultValue={environment?.architecture ?? ""}
                aria-describedby={describedBy}
                className="rounded border border-outline-variant bg-surface-container px-3 py-2 text-body-md text-on-surface focus:border-evidence-blue"
              >
                {ARCHITECTURES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </Card>

        <Card as="section">
          <h2 className="mb-1 font-mono text-label-caps uppercase text-on-surface-variant">
            Runtimes, languages, frameworks
          </h2>
          <p className="mb-gutter text-body-sm text-on-surface-variant">
            Type each one as you'd write it — "node 22.3.1", "postgres 16.2", "docker 27.1". Free
            text, not a fixed list: type whatever you actually have, in whatever form you have it.
            The suggestions are just that — suggestions.
          </p>
          <datalist id="known-technologies">
            {technologyNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <div className="grid gap-2 sm:grid-cols-2">
            {rows.map((value, index) => (
              <Field key={index} label={`Component ${index + 1}`}>
                {({ inputId }) => (
                  <Input
                    id={inputId}
                    name="component"
                    list="known-technologies"
                    defaultValue={value}
                    placeholder="e.g. node 22.3.1"
                    maxLength={64}
                  />
                )}
              </Field>
            ))}
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-gutter">
          <Button type="submit" name="_intent" value="save" iconLeft="check">
            Save environment
          </Button>
          <Button type="submit" name="_intent" value="clear" variant="secondary" iconLeft="close">
            Clear current environment
          </Button>
        </div>
      </Form>

      {actionData && <ParsedResult result={actionData} />}
    </Page>
  );
}

function ParsedResult({ result }: { result: ActionResult }) {
  if (result.intent === "clear") {
    return (
      <Card as="section" aria-live="polite">
        <p className="flex items-center gap-2 text-body-sm text-on-surface">
          <Icon name="check_circle" size={16} className="text-status-ci-verified" />
          Environment cleared. Nothing is stored for you any more.
        </p>
      </Card>
    );
  }

  const os = [result.osFamily, result.osVersion].filter(Boolean).join(" ");

  return (
    <Card as="section" aria-live="polite">
      <h2 className="mb-3 flex items-center gap-2 font-mono text-label-caps uppercase text-on-surface">
        <Icon name="check_circle" size={14} className="text-status-ci-verified" />
        Saved — here's what was understood
      </h2>
      <dl className="mb-3 flex flex-col gap-1 text-body-sm">
        <div className="flex gap-2">
          <dt className="text-on-surface-variant">Operating system:</dt>
          <dd className="text-on-surface">{os || "not set"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-on-surface-variant">Architecture:</dt>
          <dd className="text-on-surface">{result.architecture ?? "not set"}</dd>
        </div>
      </dl>
      {result.components.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">No components declared.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {result.components.map((component, index) => (
            <li key={index} className="flex items-center gap-2 font-mono text-env-tag">
              {component.semverNormalized ? (
                <Icon name="check_circle" size={14} className="shrink-0 text-status-ci-verified" />
              ) : (
                <Icon name="help" size={14} className="shrink-0 text-warning-amber" />
              )}
              <span className="text-on-surface">{component.rawLabel}</span>
              <span className="text-on-surface-variant">
                {component.semverNormalized
                  ? "— version recognised"
                  : "— not recognised as a version"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

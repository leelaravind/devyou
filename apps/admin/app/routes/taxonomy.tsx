import { Form, Link, useSearchParams } from "react-router";
import { Card } from "@devyou/ui";
import { ApiError, TECHNOLOGY_TYPES, newId, slugify } from "@devyou/core";
import { checkUrl } from "@devyou/security";
import { can } from "@devyou/auth";
import type { Route } from "./+types/taxonomy";
import { beginAdminAction, requireAdmin, runAction } from "../lib/route.server";
import { performAdminAction, reasonFrom, requiredField, stringField } from "../lib/audit.server";
import {
  ActionForm,
  Detail,
  EmptyState,
  SelectField,
  StatusChip,
  SurfaceHeader,
  SurfaceLayout,
  TextField,
} from "../components/admin-forms";
import { formatInstant } from "../lib/format";

/**
 * The technology taxonomy.
 *
 * This is the surface that makes "version-aware" mean anything. A playbook that says it
 * applies to "Node" applies to nothing in particular; one that says `node >=20 <22` can be
 * matched against a reader's actual environment and can be flagged stale when 22 ships.
 * Every constraint on every revision resolves through the rows edited here, so a careless
 * merge silently rewrites what a hundred playbooks claim to apply to.
 *
 * Which is why merging sets `status = 'merged'` and `merged_into_id`, and deletes nothing.
 * Historical revisions keep resolving, and the survivor is discoverable from the row that
 * was folded into it.
 *
 * **Aliases are read-only here, and that is a gap rather than a decision.** They are the
 * highest-value rows on this page for search — nobody pastes "PostgreSQL", they paste
 * `SQLSTATE 40001` — but `ID_PREFIXES` in `@devyou/core` has no `alias` kind, and this
 * module does not modify another package to give itself one. Reported rather than worked
 * around with a hand-rolled identifier that would not match the convention.
 */

export function meta() {
  return [{ title: "Taxonomy — DevYou admin" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, actor } = await requireAdmin(context, "taxonomy:view");
  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim() ?? "";
  const focus = url.searchParams.get("focus");

  const technologies = await env.DB.prepare(
    search
      ? `SELECT t.id, t.slug, t.name, t.type, t.status, t.official_url, t.merged_into_id, t.created_at,
                (SELECT count(*) FROM technology_aliases a WHERE a.technology_id = t.id) AS alias_count,
                (SELECT count(*) FROM versions v WHERE v.technology_id = t.id) AS version_count,
                (SELECT count(*) FROM revision_technologies rt WHERE rt.technology_id = t.id) AS usage_count
           FROM technologies t
          WHERE t.slug LIKE ?1 OR t.name LIKE ?1
          ORDER BY t.name LIMIT 80`
      : `SELECT t.id, t.slug, t.name, t.type, t.status, t.official_url, t.merged_into_id, t.created_at,
                (SELECT count(*) FROM technology_aliases a WHERE a.technology_id = t.id) AS alias_count,
                (SELECT count(*) FROM versions v WHERE v.technology_id = t.id) AS version_count,
                (SELECT count(*) FROM revision_technologies rt WHERE rt.technology_id = t.id) AS usage_count
           FROM technologies t
          ORDER BY t.name LIMIT 80`,
  )
    .bind(...(search ? [`%${search}%`] : []))
    .all<TechnologyRow>();

  const [aliases, versions] = focus
    ? await Promise.all([
        env.DB.prepare(
          `SELECT id, alias, kind FROM technology_aliases WHERE technology_id = ?1 ORDER BY kind, alias`,
        )
          .bind(focus)
          .all<AliasRow>(),
        env.DB.prepare(
          `SELECT id, version_label, semver_normalized, status, released_at, eol_at, is_minor_or_major
             FROM versions WHERE technology_id = ?1
            ORDER BY semver_normalized DESC NULLS LAST, version_label DESC LIMIT 40`,
        )
          .bind(focus)
          .all<VersionRow>(),
      ])
    : [{ results: [] as AliasRow[] }, { results: [] as VersionRow[] }];

  return {
    technologies: technologies.results,
    aliases: aliases.results,
    versions: versions.results,
    search,
    permissions: {
      create: can(actor.role, "taxonomy:create"),
      update: can(actor.role, "taxonomy:update"),
      merge: can(actor.role, "taxonomy:merge"),
    },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  return runAction(async () => {
    const { env, actor, form, intent } = await beginAdminAction(request, context);
    const reason = reasonFrom(form);

    switch (intent) {
      case "create_technology": {
        const name = requiredField(form, "name");
        const type = requiredField(form, "type");
        if (!(TECHNOLOGY_TYPES as readonly string[]).includes(type)) {
          throw new ApiError("BAD_REQUEST", { internalDetail: `unknown technology type ${type}` });
        }
        const officialUrl = safeUrl(stringField(form, "officialUrl"));
        const id = newId("technology");
        const slug = slugify(name);

        await performAdminAction(
          env.DB,
          {
            actor,
            capability: "taxonomy:create",
            subjectType: "technology",
            subjectId: id,
            ...reason,
            change: { name: [null, name], slug: [null, slug] },
          },
          [
            env.DB.prepare(
              `INSERT INTO technologies (id, slug, name, type, official_url, status, created_at)
               VALUES (?1, ?2, ?3, ?4, ?5, 'active', unixepoch())`,
            ).bind(id, slug, name, type, officialUrl),
          ],
        );
        return { ok: true as const, message: `Created ${slug}.` };
      }

      case "update_technology": {
        const technologyId = requiredField(form, "technologyId");
        const name = requiredField(form, "name");
        const officialUrl = safeUrl(stringField(form, "officialUrl"));

        /*
          The slug is not editable, and the omission is the design.

          `/t/:slug` is a public URL and plan §16 requires canonical URLs to survive. A
          rename changes the display name and leaves every inbound link, every bookmark
          and every search result intact. A technology that genuinely needs a new address
          is a new row plus a merge, which leaves a trail.
        */
        await performAdminAction(
          env.DB,
          {
            actor,
            capability: "taxonomy:update",
            subjectType: "technology",
            subjectId: technologyId,
            ...reason,
            change: { name: ["", name] },
          },
          [
            env.DB.prepare(
              `UPDATE technologies SET name = ?1, official_url = ?2 WHERE id = ?3`,
            ).bind(name, officialUrl, technologyId),
          ],
        );
        return { ok: true as const, message: "Technology updated." };
      }

      case "merge_technology": {
        const technologyId = requiredField(form, "technologyId");
        const targetSlug = requiredField(form, "targetSlug");

        const target = await env.DB.prepare(
          `SELECT id FROM technologies WHERE slug = ?1 AND status = 'active'`,
        )
          .bind(targetSlug)
          .first<{ id: string }>();
        if (!target) {
          throw new ApiError("NOT_FOUND", {
            publicMessage: `No active technology with slug ${targetSlug}.`,
            internalDetail: "merge target not found",
          });
        }
        if (target.id === technologyId) {
          throw new ApiError("BAD_REQUEST", {
            publicMessage: "A technology cannot be merged into itself.",
            internalDetail: "self-merge refused",
          });
        }

        await performAdminAction(
          env.DB,
          {
            actor,
            capability: "taxonomy:merge",
            subjectType: "technology",
            subjectId: technologyId,
            ...reason,
            change: { status: ["active", "merged"], mergedInto: [null, target.id] },
          },
          [
            /*
              The row survives the merge, deliberately.

              Every historical revision constrained to this technology still resolves, and
              `merged_into_id` points at the survivor so a reader following an old
              constraint lands somewhere useful. Deleting it would silently break the
              version-awareness of every playbook that referenced it — which is the
              product, not a detail.
            */
            env.DB.prepare(
              `UPDATE technologies SET status = 'merged', merged_into_id = ?1
                WHERE id = ?2 AND status = 'active'`,
            ).bind(target.id, technologyId),
            /* Aliases follow the survivor. `OR IGNORE` because the unique index on
               (alias, technology_id) means an alias the target already holds is simply
               already correct — a collision here is a duplicate, not a conflict. */
            env.DB.prepare(
              `UPDATE OR IGNORE technology_aliases SET technology_id = ?1 WHERE technology_id = ?2`,
            ).bind(target.id, technologyId),
          ],
        );
        return { ok: true as const, message: `Merged into ${targetSlug}.` };
      }

      case "create_version": {
        const technologyId = requiredField(form, "technologyId");
        const label = requiredField(form, "versionLabel");
        const id = newId("version");

        await performAdminAction(
          env.DB,
          {
            actor,
            capability: "taxonomy:create",
            subjectType: "version",
            subjectId: id,
            ...reason,
            change: { versionLabel: [null, label] },
          },
          [
            env.DB.prepare(
              `INSERT INTO versions
                 (id, technology_id, version_label, semver_normalized, status, is_minor_or_major)
               VALUES (?1, ?2, ?3, ?4, 'active', 1)`,
            ).bind(id, technologyId, label, normaliseSemver(label)),
          ],
        );
        return { ok: true as const, message: `Added version ${label}.` };
      }

      default:
        throw new ApiError("BAD_REQUEST", { internalDetail: `unknown taxonomy intent ${intent}` });
    }
  });
}

/**
 * Zero-padded, sortable semver — the same shape `versions.semverNormalized` documents.
 *
 * SQLite on D1 has no semver support and no user-defined functions, so range comparison is
 * a plain string comparison and this is what makes it correct. A label that is not semver
 * (`24.04`, `2024-11-01`, `v1.2.3-alpine`) yields null rather than a wrong ordering:
 * sorting `24.04` as though it were a major version would place Ubuntu releases among Node
 * releases, and a null simply excludes it from range matching, which is the honest answer.
 */
function normaliseSemver(label: string): string | null {
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/.exec(label.trim());
  if (!match) return null;
  const [, major, minor, patch] = match;
  return [major, minor, patch ?? "0"].map((part) => String(part).padStart(5, "0")).join(".");
}

/**
 * Accept an official URL only if the URL safety checks pass.
 *
 * `official_url` is rendered on the public technology page, so a URL that reaches this
 * column reaches readers. `checkUrl` from `@devyou/security` is the same check the
 * contribution pipeline runs — an admin-entered URL is not more trustworthy than a
 * contributor-entered one, it is merely entered by somebody with more capabilities.
 */
function safeUrl(raw: string | null): string | null {
  if (!raw) return null;
  const verdict = checkUrl(raw);
  if (!verdict.safe) {
    throw new ApiError("UNPROCESSABLE", {
      publicMessage: `That URL was refused: ${verdict.reason ?? "unsafe"}.`,
      fieldErrors: { officialUrl: "Refused by the URL safety checks." },
      internalDetail: "official_url failed checkUrl",
    });
  }
  return verdict.normalised ?? raw;
}

export default function Taxonomy({ loaderData, actionData }: Route.ComponentProps) {
  const { technologies, aliases, versions, search, permissions } = loaderData;
  const [params] = useSearchParams();
  const focus = params.get("focus");
  const focused = technologies.find((technology) => technology.id === focus);

  return (
    <SurfaceLayout>
      <SurfaceHeader
        title="Taxonomy"
        description="Technologies, aliases and versions. Every environment constraint on every revision resolves through these rows, so a merge here changes what other playbooks claim to apply to — which is why merging keeps the row and points it at the survivor."
      >
        <Form method="get" className="gap-gutter flex items-end">
          <TextField label="Name or slug" name="q" defaultValue={search} placeholder="postgres" />
          <button
            type="submit"
            className="bg-primary text-label-caps text-on-primary rounded px-4 py-2 font-mono uppercase"
          >
            Search
          </button>
        </Form>
      </SurfaceHeader>

      {actionData?.ok && (
        <p className="border-status-confirmed/40 bg-surface-container text-body-sm text-status-confirmed mb-6 rounded border p-3">
          {actionData.message}
        </p>
      )}

      {permissions.create && (
        <Card as="section" className="mb-8">
          <h2 className="font-headline text-body-md text-on-surface mb-3">Add a technology</h2>
          <ActionForm
            intent="create_technology"
            capability="taxonomy:create"
            label="Create"
            variant="primary"
          >
            <div className="gap-gutter grid sm:grid-cols-3">
              <TextField label="Name" name="name" required placeholder="PostgreSQL" />
              <SelectField
                label="Type"
                name="type"
                required
                defaultValue="database"
                options={TECHNOLOGY_TYPES}
              />
              <TextField
                label="Official URL"
                description="Checked before it is stored."
                name="officialUrl"
                placeholder="https://www.postgresql.org"
              />
            </div>
          </ActionForm>
        </Card>
      )}

      {technologies.length === 0 ? (
        <EmptyState>No technology matches that search.</EmptyState>
      ) : (
        <ol className="gap-gutter flex list-none flex-col">
          {technologies.map((technology) => (
            <li key={technology.id}>
              <Card as="article">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <StatusChip value={technology.type} />
                  <StatusChip value={technology.status} alarming={technology.status !== "active"} />
                </div>
                <h2 className="font-headline text-body-md text-on-surface mb-1">
                  {technology.name}
                </h2>
                <p className="text-env-tag text-on-surface-variant mb-2 font-mono">
                  /t/{technology.slug} · {technology.alias_count} aliases ·{" "}
                  {technology.version_count} versions · used by {technology.usage_count} revisions
                </p>

                {technology.id === focus ? (
                  <FocusedTechnology
                    technology={technology}
                    aliases={aliases}
                    versions={versions}
                    permissions={permissions}
                  />
                ) : (
                  <Link
                    to={`?${new URLSearchParams({ q: search, focus: technology.id })}`}
                    className="text-body-sm text-evidence-blue underline"
                  >
                    Open
                  </Link>
                )}
              </Card>
            </li>
          ))}
        </ol>
      )}

      {focused && aliases.length === 0 && (
        <p className="text-body-sm text-on-surface-variant mt-6">
          {focused.name} has no aliases. Search will not narrow by technology on an error token for
          it — nobody types &ldquo;{focused.name}&rdquo; into a stack trace.
        </p>
      )}
    </SurfaceLayout>
  );
}

function FocusedTechnology({
  technology,
  aliases,
  versions,
  permissions,
}: {
  technology: TechnologyRow;
  aliases: AliasRow[];
  versions: VersionRow[];
  permissions: Record<string, boolean>;
}) {
  return (
    <div className="border-outline-variant mt-3 border-t pt-3">
      <Detail label="Id">{technology.id}</Detail>
      <Detail label="Official URL">
        <span className="font-mono break-all">{technology.official_url ?? "—"}</span>
      </Detail>
      <Detail label="Created">{formatInstant(technology.created_at)}</Detail>
      {technology.merged_into_id && (
        <Detail label="Merged into">{technology.merged_into_id}</Detail>
      )}

      <Detail label="Aliases">
        {aliases.length === 0 ? (
          "—"
        ) : (
          <span className="text-env-tag font-mono">
            {aliases.map((alias) => `${alias.alias} (${alias.kind})`).join(", ")}
          </span>
        )}
      </Detail>
      <Detail label="Versions">
        {versions.length === 0 ? (
          "—"
        ) : (
          <span className="text-env-tag font-mono">
            {versions.map((version) => version.version_label).join(", ")}
          </span>
        )}
      </Detail>

      <div className="gap-gutter mt-4 grid lg:grid-cols-2">
        {permissions.update && (
          <ActionForm
            intent="update_technology"
            capability="taxonomy:update"
            label="Save changes"
            fields={{ technologyId: technology.id }}
          >
            <TextField
              label="Name"
              description="The slug is fixed — /t/:slug is a public URL."
              name="name"
              required
              defaultValue={technology.name}
            />
            <TextField
              label="Official URL"
              name="officialUrl"
              defaultValue={technology.official_url ?? ""}
            />
          </ActionForm>
        )}

        {permissions.create && (
          <ActionForm
            intent="create_version"
            capability="taxonomy:create"
            label="Add version"
            fields={{ technologyId: technology.id }}
          >
            <TextField
              label="Version label"
              description="As people write it. Non-semver labels are stored and simply excluded from range matching."
              name="versionLabel"
              required
              placeholder="22.3.0"
            />
          </ActionForm>
        )}

        {permissions.merge && technology.status === "active" && (
          <ActionForm
            intent="merge_technology"
            capability="taxonomy:merge"
            label="Merge into another"
            variant="danger"
            fields={{ technologyId: technology.id }}
          >
            <TextField
              label="Survivor slug"
              description="This row is kept and points at the survivor. Aliases move; nothing is deleted."
              name="targetSlug"
              required
              placeholder="postgresql"
            />
          </ActionForm>
        )}
      </div>
    </div>
  );
}

interface TechnologyRow {
  id: string;
  slug: string;
  name: string;
  type: string;
  status: string;
  official_url: string | null;
  merged_into_id: string | null;
  created_at: number;
  alias_count: number;
  version_count: number;
  usage_count: number;
}

interface AliasRow {
  id: string;
  alias: string;
  kind: string;
}

interface VersionRow {
  id: string;
  version_label: string;
  semver_normalized: string | null;
  status: string;
  released_at: number | null;
  eol_at: number | null;
  is_minor_or_major: number;
}

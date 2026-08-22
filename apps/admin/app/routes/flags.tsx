import { Card } from "@devyou/ui";
import { ApiError } from "@devyou/core";
import { can } from "@devyou/auth";
import type { Route } from "./+types/flags";
import { beginAdminAction, requireAdmin, runAction } from "../lib/route.server";
import { performAdminAction, reasonFrom, requiredField, stringField } from "../lib/audit.server";
import {
  ActionForm,
  Detail,
  EmptyState,
  StatusChip,
  SurfaceHeader,
  SurfaceLayout,
  TextAreaField,
  TextField,
} from "../components/admin-forms";
import { formatInstant } from "../lib/format";

/**
 * Feature flags and runtime configuration.
 *
 * In D1 rather than KV, and the reason is on this page: a flag change is an audited
 * administrative action and needs a row somebody can point at. KV would be faster to read
 * and would have no `updated_by`, no history and nothing to join an audit event to. The
 * read path caches these in KV; this is the record.
 *
 * Every change requires a reason code — `flags:edit` is in `REQUIRES_REASON` — because a
 * flag is precisely the mechanism by which behaviour changes without a deploy, and a
 * behaviour change with no deploy and no reason is the hardest kind of incident to
 * reconstruct. The audit row is often the only artefact.
 *
 * There is no delete. A flag whose code has been removed is turned off and left in place:
 * deleting the row would remove the only evidence of what it once controlled, and a
 * re-created key would silently inherit that history's absence.
 */

export function meta() {
  return [{ title: "Feature flags — DevYou admin" }];
}

/** Keys must look like `area.thing`. Not to be tidy — a flat namespace on a table read by
 *  three Workers becomes twenty keys nobody can group, and the read path caches by prefix. */
const KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export async function loader({ context }: Route.LoaderArgs) {
  const { env, actor } = await requireAdmin(context, "flags:view");

  const flags = await env.DB.prepare(
    `SELECT f.key, f.enabled, f.description, f.value_json, f.updated_at,
            p.handle AS updated_by_handle
       FROM feature_flags f
       LEFT JOIN profiles p ON p.user_id = f.updated_by
      ORDER BY f.key`,
  ).all<FlagRow>();

  return { flags: flags.results, mayEdit: can(actor.role, "flags:edit") };
}

export async function action({ request, context }: Route.ActionArgs) {
  return runAction(async () => {
    const { env, actor, form, intent } = await beginAdminAction(request, context);
    const reason = reasonFrom(form);

    if (intent !== "upsert" && intent !== "toggle") {
      throw new ApiError("BAD_REQUEST", { internalDetail: `unknown flag intent ${intent}` });
    }

    const key = requiredField(form, "key");
    if (!KEY_PATTERN.test(key)) {
      throw new ApiError("BAD_REQUEST", {
        publicMessage: "A flag key looks like `area.thing` — lower case, dot separated.",
        fieldErrors: { key: "Bad key format." },
        internalDetail: "flag key rejected",
      });
    }

    const existing = await env.DB.prepare(
      `SELECT enabled, description, value_json FROM feature_flags WHERE key = ?1`,
    )
      .bind(key)
      .first<{ enabled: number; description: string; value_json: string | null }>();

    if (intent === "toggle") {
      if (!existing) {
        throw new ApiError("NOT_FOUND", { internalDetail: "toggle of unknown flag" });
      }
      const next = existing.enabled === 1 ? 0 : 1;

      await performAdminAction(
        env.DB,
        {
          actor,
          capability: "flags:edit",
          subjectType: "feature_flag",
          subjectId: key,
          ...reason,
          change: { enabled: [existing.enabled === 1, next === 1] },
        },
        [
          env.DB.prepare(
            `UPDATE feature_flags SET enabled = ?1, updated_by = ?2, updated_at = unixepoch()
              WHERE key = ?3`,
          ).bind(next, actor.userId, key),
        ],
      );
      return { ok: true as const, message: `${key} is now ${next === 1 ? "on" : "off"}.` };
    }

    const description = requiredField(form, "description");
    const enabled = stringField(form, "enabled") === "on" ? 1 : 0;
    const valueJson = validateJson(stringField(form, "valueJson"));

    await performAdminAction(
      env.DB,
      {
        actor,
        capability: "flags:edit",
        subjectType: "feature_flag",
        subjectId: key,
        ...reason,
        change: {
          enabled: [existing?.enabled === 1, enabled === 1],
          valueJson: [existing?.value_json ?? null, valueJson],
        },
      },
      [
        env.DB.prepare(
          `INSERT INTO feature_flags (key, enabled, description, value_json, updated_by, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())
           ON CONFLICT(key) DO UPDATE SET
             enabled = excluded.enabled,
             description = excluded.description,
             value_json = excluded.value_json,
             updated_by = excluded.updated_by,
             updated_at = unixepoch()`,
        ).bind(key, enabled, description, valueJson, actor.userId),
      ],
    );

    return { ok: true as const, message: `${key} saved.` };
  });
}

/**
 * Refuse a value that is not valid JSON.
 *
 * `value_json` is read and parsed by three Workers. A malformed blob does not fail here,
 * it fails at whatever read path next touches it — possibly on the public site, possibly
 * at three in the morning, and with an error that names a parse failure rather than the
 * flag that caused it. Validating at the write is a two-line check that moves the failure
 * to the person who can fix it, while they are looking at it.
 */
function validateJson(raw: string | null): string | null {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return null;
  try {
    JSON.parse(trimmed);
  } catch {
    throw new ApiError("UNPROCESSABLE", {
      publicMessage: "The value must be valid JSON, or empty.",
      fieldErrors: { valueJson: "Not valid JSON." },
      internalDetail: "flag value_json failed to parse",
    });
  }
  return trimmed;
}

export default function Flags({ loaderData, actionData }: Route.ComponentProps) {
  const { flags, mayEdit } = loaderData;

  return (
    <SurfaceLayout>
      <SurfaceHeader
        title="Feature flags"
        description="Runtime configuration, in D1 rather than KV so every change has an author and a reason. There is no delete: a flag whose code has gone is turned off and left, because the row is the only record of what it once controlled."
      />

      {actionData?.ok && (
        <p className="border-status-confirmed/40 bg-surface-container text-body-sm text-status-confirmed mb-6 rounded border p-3">
          {actionData.message}
        </p>
      )}

      {flags.length === 0 ? (
        <EmptyState>No flags defined.</EmptyState>
      ) : (
        <ol className="gap-gutter mb-8 flex list-none flex-col">
          {flags.map((flag) => (
            <li key={flag.key}>
              <Card as="article">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <StatusChip value={flag.enabled === 1 ? "on" : "off"} />
                </div>
                <h2 className="text-body-md text-on-surface mb-1 font-mono">{flag.key}</h2>
                <p className="text-body-sm text-on-surface-variant mb-2">{flag.description}</p>
                <Detail label="Value">
                  <span className="font-mono break-all">{flag.value_json ?? "—"}</span>
                </Detail>
                <Detail label="Last changed">
                  {formatInstant(flag.updated_at)}
                  {flag.updated_by_handle ? ` by @${flag.updated_by_handle}` : ""}
                </Detail>

                {mayEdit && (
                  <div className="gap-gutter border-outline-variant mt-4 grid border-t pt-4 lg:grid-cols-2">
                    <ActionForm
                      intent="toggle"
                      capability="flags:edit"
                      label={flag.enabled === 1 ? "Turn off" : "Turn on"}
                      variant={flag.enabled === 1 ? "danger" : "secondary"}
                      fields={{ key: flag.key }}
                    />
                    <ActionForm
                      intent="upsert"
                      capability="flags:edit"
                      label="Save"
                      fields={{ key: flag.key }}
                    >
                      <TextField
                        label="Description"
                        name="description"
                        required
                        defaultValue={flag.description}
                      />
                      <TextAreaField
                        label="Value (JSON)"
                        description="Validated before it is stored."
                        name="valueJson"
                        rows={2}
                        defaultValue={flag.value_json ?? ""}
                      />
                      <label className="text-body-sm text-on-surface flex items-center gap-2">
                        <input type="checkbox" name="enabled" defaultChecked={flag.enabled === 1} />
                        Enabled
                      </label>
                    </ActionForm>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ol>
      )}

      {mayEdit && (
        <Card as="section">
          <h2 className="font-headline text-body-md text-on-surface mb-3">Define a flag</h2>
          <ActionForm intent="upsert" capability="flags:edit" label="Create" variant="primary">
            <div className="gap-gutter grid sm:grid-cols-2">
              <TextField
                label="Key"
                description="area.thing — lower case, dot separated."
                name="key"
                required
                placeholder="search.semantic_recall"
              />
              <TextField
                label="Description"
                description="What it controls, in one line."
                name="description"
                required
              />
            </div>
            <TextAreaField label="Value (JSON)" name="valueJson" rows={2} />
            <label className="text-body-sm text-on-surface flex items-center gap-2">
              <input type="checkbox" name="enabled" />
              Enabled on creation
            </label>
          </ActionForm>
        </Card>
      )}
    </SurfaceLayout>
  );
}

interface FlagRow {
  key: string;
  enabled: number;
  description: string;
  value_json: string | null;
  updated_at: number;
  updated_by_handle: string | null;
}

import { Card } from "@devyou/ui";
import { ApiError } from "@devyou/core";
import { can } from "@devyou/auth";
import type { Route } from "./+types/ai";
import { beginAdminAction, requireAdmin, runAction } from "../lib/route.server";
import { performAdminAction, reasonFrom, requiredField } from "../lib/audit.server";
import {
  ActionForm,
  Detail,
  EmptyState,
  StatusChip,
  SurfaceHeader,
  SurfaceLayout,
  TextField,
} from "../components/admin-forms";
import { formatCost, formatInstant, shortId } from "../lib/format";

/**
 * AI operations.
 *
 * The ledger, the spend and the ceiling. `ai_tasks` records model, provider, prompt
 * version, cost, latency and outcome for every call, which is what makes AI expenditure a
 * thing somebody can be accountable for rather than a line on a bill.
 *
 * `schema_invalid` is separated from `failed` throughout this page, because they demand
 * opposite responses. `failed` means the provider did not answer — an outage, a rate
 * limit, something to wait out. `schema_invalid` means the model answered and the answer
 * did not validate against the Zod schema, which is a prompt regression: it will keep
 * happening, it costs money every time, and the fix is a prompt version, not patience.
 * Collapsing them into one "errors" figure hides the one that needs a human today.
 *
 * **`ai_operations:retry` has no control on this page, and that is honest rather than
 * lazy.** Retrying a task means re-dispatching it to `devyou-jobs` through
 * `devyou-events-*`. That consumer exists, but the `JobMessage` union it validates against
 * carries one message type — `structure_contribution` — and nothing that means "run this
 * ledger row again". Adding one would mean changing `@devyou/schemas` and the jobs Worker,
 * which is not this module's to change, and inventing a message shape to guess at would
 * produce a button that enqueues something no consumer accepts: the consumer acknowledges
 * a message it cannot parse rather than retrying it, so the retry would fail silently and
 * look like it worked.
 *
 * This Worker therefore holds no queue producer binding at all. A binding added "for later"
 * is a binding nobody re-reviews when later arrives. The capability stays in the matrix and
 * the control appears when there is a message type to send.
 */

export function meta() {
  return [{ title: "AI operations — DevYou admin" }];
}

/** The flag key holding the daily ceiling. In `feature_flags` rather than a var, because a
 *  budget change is an audited administrative act and needs a row somebody can point at. */
const BUDGET_FLAG = "ai.daily_budget_micro_usd";

export async function loader({ context }: Route.LoaderArgs) {
  const { env, actor } = await requireAdmin(context, "ai_operations:view");
  const dayAgo = Math.floor(Date.now() / 1000) - 86_400;

  const [today, byType, recentFailures, budget] = await Promise.all([
    env.DB.prepare(
      `SELECT count(*) AS tasks,
              COALESCE(sum(cost_micro_usd), 0) AS spend,
              sum(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
              sum(CASE WHEN status = 'schema_invalid' THEN 1 ELSE 0 END) AS schema_invalid,
              sum(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
              sum(CASE WHEN status = 'budget_exceeded' THEN 1 ELSE 0 END) AS budget_exceeded,
              sum(CASE WHEN repair_attempted THEN 1 ELSE 0 END) AS repaired,
              avg(latency_ms) AS avg_latency
         FROM ai_tasks WHERE created_at > ?1`,
    )
      .bind(dayAgo)
      .all<TotalsRow>(),

    env.DB.prepare(
      `SELECT task_type, model, prompt_version,
              count(*) AS tasks,
              COALESCE(sum(cost_micro_usd), 0) AS spend,
              sum(CASE WHEN status = 'schema_invalid' THEN 1 ELSE 0 END) AS schema_invalid
         FROM ai_tasks WHERE created_at > ?1
        GROUP BY task_type, model, prompt_version
        ORDER BY spend DESC`,
    )
      .bind(dayAgo)
      .all<TypeRow>(),

    env.DB.prepare(
      `SELECT id, task_type, model, prompt_version, status, error_detail, cost_micro_usd,
              latency_ms, created_at, repair_attempted
         FROM ai_tasks
        WHERE status IN ('failed', 'schema_invalid', 'refused', 'budget_exceeded')
        ORDER BY created_at DESC LIMIT 30`,
    ).all<TaskRow>(),

    env.DB.prepare(`SELECT key, enabled, value_json, updated_at FROM feature_flags WHERE key = ?1`)
      .bind(BUDGET_FLAG)
      .first<{ key: string; enabled: number; value_json: string | null; updated_at: number }>(),
  ]);

  const totals: TotalsRow = today.results[0] ?? {
    tasks: 0,
    spend: 0,
    succeeded: 0,
    schema_invalid: 0,
    failed: 0,
    budget_exceeded: 0,
    repaired: 0,
    avg_latency: null,
  };

  return {
    totals,
    byType: byType.results,
    recentFailures: recentFailures.results,
    budget: {
      microUsd: readBudget(budget?.value_json ?? null),
      enabled: budget?.enabled === 1,
      updatedAt: budget?.updated_at ?? null,
    },
    maySetBudget: can(actor.role, "ai_operations:set_budget"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  return runAction(async () => {
    const { env, actor, form, intent } = await beginAdminAction(request, context);
    if (intent !== "set_budget") {
      throw new ApiError("BAD_REQUEST", { internalDetail: `unknown ai intent ${intent}` });
    }

    const raw = requiredField(form, "dailyBudgetUsd");
    const dollars = Number(raw);
    if (!Number.isFinite(dollars) || dollars < 0) {
      throw new ApiError("BAD_REQUEST", {
        publicMessage: "The daily budget must be a number of dollars, zero or more.",
        fieldErrors: { dailyBudgetUsd: "Not a number." },
        internalDetail: "bad budget value",
      });
    }

    /*
      Stored as an integer of micro-dollars, matching `ai_tasks.cost_micro_usd`.

      The ceiling is enforced by summing that column and comparing, so the two have to be
      the same unit. Storing dollars here and converting at comparison time is one
      conversion away from a ceiling that is a million times too high, which is not a
      mistake anybody notices until the bill arrives.
    */
    const microUsd = Math.round(dollars * 1_000_000);

    await performAdminAction(
      env.DB,
      {
        actor,
        capability: "ai_operations:set_budget",
        subjectType: "feature_flag",
        subjectId: BUDGET_FLAG,
        ...reasonFrom(form),
        change: { dailyBudgetMicroUsd: [null, microUsd] },
      },
      [
        env.DB.prepare(
          `INSERT INTO feature_flags (key, enabled, description, value_json, updated_by, updated_at)
           VALUES (?1, 1, 'Daily AI spend ceiling, in micro-USD. Enforced by summing ai_tasks.cost_micro_usd.', ?2, ?3, unixepoch())
           ON CONFLICT(key) DO UPDATE SET
             enabled = 1,
             value_json = excluded.value_json,
             updated_by = excluded.updated_by,
             updated_at = unixepoch()`,
        ).bind(BUDGET_FLAG, JSON.stringify({ microUsd }), actor.userId),
      ],
    );

    return { ok: true as const, message: `Daily ceiling set to ${formatCost(microUsd)}.` };
  });
}

function readBudget(valueJson: string | null): number | null {
  if (!valueJson) return null;
  try {
    const parsed: unknown = JSON.parse(valueJson);
    if (parsed && typeof parsed === "object" && "microUsd" in parsed) {
      const value = (parsed as { microUsd: unknown }).microUsd;
      return typeof value === "number" ? value : null;
    }
  } catch {
    /* A malformed flag value reads as "no ceiling configured" rather than throwing.
       An unparseable JSON blob should not take down the page that is the only place to
       fix it. The display below says "not configured", which is the true statement. */
  }
  return null;
}

export default function AiOperations({ loaderData, actionData }: Route.ComponentProps) {
  const { totals, byType, recentFailures, budget, maySetBudget } = loaderData;
  const overBudget = budget.microUsd !== null && totals.spend > budget.microUsd;

  return (
    <SurfaceLayout>
      <SurfaceHeader
        title="AI operations"
        description="The last 24 hours of the task ledger. schema_invalid is kept apart from failed throughout: one is an outage to wait out, the other is a prompt regression that will keep costing money until somebody changes the prompt version."
      />

      {actionData?.ok && (
        <p className="border-status-confirmed/40 bg-surface-container text-body-sm text-status-confirmed mb-6 rounded border p-3">
          {actionData.message}
        </p>
      )}

      <Card as="section" className="mb-8">
        <Detail label="Tasks">{totals.tasks}</Detail>
        <Detail label="Spend">
          {formatCost(totals.spend)}
          {budget.microUsd !== null && ` of ${formatCost(budget.microUsd)} ceiling`}
          {overBudget && (
            <span className="text-destructive-red ml-2">over the configured ceiling</span>
          )}
        </Detail>
        <Detail label="Succeeded">{totals.succeeded}</Detail>
        <Detail label="Schema invalid">
          {totals.schema_invalid}
          {totals.schema_invalid > 0 && " — the model answered and the answer did not validate"}
        </Detail>
        <Detail label="Failed">{totals.failed}</Detail>
        <Detail label="Refused for budget">{totals.budget_exceeded}</Detail>
        <Detail label="Repair attempted">{totals.repaired}</Detail>
        <Detail label="Mean latency">
          {totals.avg_latency === null ? "—" : `${Math.round(totals.avg_latency)}ms`}
        </Detail>
      </Card>

      {maySetBudget && (
        <Card as="section" className="mb-8">
          <h2 className="font-headline text-body-md text-on-surface mb-1">Daily ceiling</h2>
          <p className="text-body-sm text-on-surface-variant mb-3">
            {budget.microUsd === null
              ? "Not configured. Without a ceiling there is nothing between a retry loop and a bill."
              : `Currently ${formatCost(budget.microUsd)}, set ${formatInstant(budget.updatedAt)}.`}
          </p>
          <ActionForm
            intent="set_budget"
            capability="ai_operations:set_budget"
            label="Set ceiling"
            variant="danger"
          >
            <TextField
              label="Daily budget (USD)"
              description="Stored as micro-USD to match the ledger."
              name="dailyBudgetUsd"
              required
              inputMode="decimal"
              defaultValue={budget.microUsd === null ? "" : String(budget.microUsd / 1_000_000)}
            />
          </ActionForm>
        </Card>
      )}

      <section className="mb-8">
        <h2 className="font-headline text-headline-md text-on-surface mb-3">
          By task, model and prompt version
        </h2>
        {byType.length === 0 ? (
          <EmptyState>No AI tasks in the last 24 hours.</EmptyState>
        ) : (
          <Card padded={false}>
            <div className="overflow-x-auto">
              <table className="text-body-sm w-full">
                <thead>
                  <tr className="border-outline-variant text-env-tag text-on-surface-variant border-b text-left font-mono uppercase">
                    <th className="p-3">Task</th>
                    <th className="p-3">Model</th>
                    <th className="p-3">Prompt</th>
                    <th className="p-3">Count</th>
                    <th className="p-3">Spend</th>
                    <th className="p-3">Schema invalid</th>
                  </tr>
                </thead>
                <tbody>
                  {byType.map((row) => (
                    <tr
                      key={`${row.task_type}:${row.model}:${row.prompt_version}`}
                      className="border-outline-variant border-b last:border-0"
                    >
                      <td className="text-on-surface p-3 font-mono">{row.task_type}</td>
                      <td className="text-on-surface-variant p-3 font-mono">{row.model}</td>
                      <td className="text-on-surface-variant p-3 font-mono">
                        {row.prompt_version}
                      </td>
                      <td className="text-on-surface-variant p-3">{row.tasks}</td>
                      <td className="text-on-surface p-3">{formatCost(row.spend)}</td>
                      <td
                        className={`p-3 ${row.schema_invalid > 0 ? "text-destructive-red" : "text-on-surface-variant"}`}
                      >
                        {row.schema_invalid}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>

      <section>
        <h2 className="font-headline text-headline-md text-on-surface mb-1">Recent failures</h2>
        <p className="text-body-sm text-on-surface-variant mb-3 max-w-3xl">
          Re-dispatch is not offered here. The jobs consumer validates every message against the
          `JobMessage` contract and acknowledges anything it cannot parse rather than retrying it —
          so a button that enqueued a message type that does not yet exist would fail silently and
          look like it had worked.
        </p>
        {recentFailures.length === 0 ? (
          <EmptyState>No failed, refused or budget-blocked tasks on record.</EmptyState>
        ) : (
          <ol className="gap-gutter flex list-none flex-col">
            {recentFailures.map((task) => (
              <li key={task.id}>
                <Card as="article">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <StatusChip value={task.status} alarming={task.status !== "refused"} />
                    <StatusChip value={task.task_type} />
                    {task.repair_attempted === 1 && <StatusChip value="repair attempted" />}
                  </div>
                  <Detail label="Task">{shortId(task.id)}</Detail>
                  <Detail label="Model">
                    {task.model} · prompt {task.prompt_version}
                  </Detail>
                  <Detail label="When">{formatInstant(task.created_at)}</Detail>
                  <Detail label="Cost">{formatCost(task.cost_micro_usd)}</Detail>
                  {/*
                    The provider's error text, shown as plain text.

                    It is bytes from an external service and is treated as untrusted like
                    anything else — React escapes it, and nothing here interprets it.
                  */}
                  <Detail label="Error">
                    <span className="font-mono break-all">{task.error_detail ?? "—"}</span>
                  </Detail>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </section>
    </SurfaceLayout>
  );
}

interface TotalsRow {
  tasks: number;
  spend: number;
  succeeded: number;
  schema_invalid: number;
  failed: number;
  budget_exceeded: number;
  repaired: number;
  avg_latency: number | null;
}

interface TypeRow {
  task_type: string;
  model: string;
  prompt_version: string;
  tasks: number;
  spend: number;
  schema_invalid: number;
}

interface TaskRow {
  id: string;
  task_type: string;
  model: string;
  prompt_version: string;
  status: string;
  error_detail: string | null;
  cost_micro_usd: number | null;
  latency_ms: number | null;
  created_at: number;
  repair_attempted: number;
}

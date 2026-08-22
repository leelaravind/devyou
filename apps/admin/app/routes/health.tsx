import { Card } from "@devyou/ui";
import type { Route } from "./+types/health";
import { requireAdmin } from "../lib/route.server";
import { Detail, StatusChip, SurfaceHeader, SurfaceLayout } from "../components/admin-forms";
import { buildHealthReport } from "../lib/health.server";

/**
 * Health, for a person.
 *
 * The same `buildHealthReport` that backs `/api/v1/health`, rendered rather than serialised.
 * One function, two presentations: a status page whose HTML and whose JSON can disagree is
 * a status page that will, on the day somebody is comparing the two.
 */

export function meta() {
  return [{ title: "Health — DevYou admin" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = await requireAdmin(context, "health:view");
  return { report: await buildHealthReport(env) };
}

export default function Health({ loaderData }: Route.ComponentProps) {
  const { report } = loaderData;

  return (
    <SurfaceLayout>
      <SurfaceHeader
        title="Health"
        description="Every check below actually exercises its dependency. A status page that only proves the Worker is running is green on the morning D1 stops accepting writes."
      />

      <Card as="section" className="mb-6">
        <Detail label="Overall">
          <StatusChip value={report.ok ? "ok" : "degraded"} alarming={!report.ok} />
        </Detail>
        <Detail label="Environment">{report.environment}</Detail>
        <Detail label="Checked">{report.checkedAt}</Detail>
        <Detail label="Contract version">{report.contractVersion}</Detail>
      </Card>

      <ul className="flex list-none flex-col gap-2">
        {report.checks.map((check) => (
          <li key={check.name}>
            <Card as="article">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <StatusChip value={check.name} />
                <StatusChip value={check.status} alarming={check.status === "fail"} />
                {check.latencyMs !== undefined && (
                  <span className="text-env-tag text-on-surface-variant font-mono">
                    {check.latencyMs}ms
                  </span>
                )}
              </div>
              <p className="text-body-sm text-on-surface-variant">{check.detail ?? "—"}</p>
            </Card>
          </li>
        ))}
      </ul>
    </SurfaceLayout>
  );
}

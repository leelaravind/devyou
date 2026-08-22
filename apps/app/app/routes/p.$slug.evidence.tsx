import { Link } from "react-router";
import { Card, ConfidenceBadge, EvidenceChip, EvidenceRate, Icon, OutcomeChip, type IconName } from "@devyou/ui";
import type { EvidenceResult, EvidenceType, ReproductionOutcome } from "@devyou/core";
import type { Route } from "./+types/p.$slug.evidence";
import { cloudflareContext } from "../context/cloudflare";
import { confidenceFor, loadRevisionBySlug } from "../lib/playbook.server";

/**
 * Evidence and compatibility.
 *
 * This is where "verification is evidence, not a badge" either holds up or turns out
 * to be a slogan. Every section below shows the underlying facts a reader would need
 * to disagree with the confidence band above it — including, deliberately, every
 * report that says the playbook did not work.
 *
 * Nothing here is averaged. R-6 requires conflicting reproductions to be shown as a
 * distribution segmented by environment, and R-30 requires the compatibility matrix
 * to treat an untested cell as a call to action, not a blank.
 */

export function meta({ loaderData: data }: Route.MetaArgs) {
  if (!data) return [{ title: "Not found — DEV.ITISYOU" }];
  return [
    { title: `Evidence — ${data.revision.title} — DEV.ITISYOU` },
    {
      name: "description",
      content: `Every reproduction, failure and reference behind ${data.revision.title}, shown by environment rather than averaged into a single score.`,
    },
  ];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const revision = await loadRevisionBySlug(env.DB, params.slug);
  if (!revision) throw new Response(null, { status: 404 });

  const { band, explanation } = confidenceFor(revision);

  const [evidenceRows, reproductionRows, segmentRows] = await Promise.all([
    env.DB.prepare(
      `SELECT e.id, e.evidence_type, e.result, e.created_at,
              es.label AS environment_label,
              prof.handle AS actor_handle, prof.display_name AS actor_display_name,
              sr.title AS source_title, sr.url AS source_url, sr.publisher AS source_publisher
       FROM evidence_records e
       LEFT JOIN environment_snapshots es ON es.id = e.environment_snapshot_id
       LEFT JOIN profiles prof ON prof.user_id = e.actor_id
       LEFT JOIN source_references sr ON sr.id = e.source_reference_id
       WHERE e.revision_id = ?1 AND e.suppressed_at IS NULL
       ORDER BY e.created_at DESC`,
    )
      .bind(revision.revisionId)
      .all<EvidenceRow>(),
    env.DB.prepare(
      `SELECT rr.id, rr.outcome, rr.notes, rr.created_at, es.label AS environment_label
       FROM reproduction_reports rr
       JOIN environment_snapshots es ON es.id = rr.environment_snapshot_id
       WHERE rr.revision_id = ?1
       ORDER BY rr.created_at DESC`,
    )
      .bind(revision.revisionId)
      .all<ReproductionRow>(),
    env.DB.prepare(
      `SELECT s.technology_id, t.name AS technology_name, s.version_bucket, s.os_family,
              s.passed, s.partial, s.failed, s.last_report_at
       FROM revision_confidence_segments s
       LEFT JOIN technologies t ON t.id = s.technology_id
       WHERE s.revision_id = ?1`,
    )
      .bind(revision.revisionId)
      .all<SegmentRow>(),
  ]);

  return {
    revision,
    band,
    explanation,
    evidence: evidenceRows.results.map(
      (row): EvidenceItem => ({
        id: row.id,
        evidenceType: row.evidence_type as EvidenceType,
        result: row.result as EvidenceResult,
        createdAt: row.created_at,
        environmentLabel: row.environment_label,
        actorHandle: row.actor_handle,
        actorDisplayName: row.actor_display_name,
        sourceTitle: row.source_title,
        sourceUrl: row.source_url,
        sourcePublisher: row.source_publisher,
      }),
    ),
    reproductions: reproductionRows.results.map(
      (row): ReproductionItem => ({
        id: row.id,
        outcome: row.outcome as ReproductionOutcome,
        notes: row.notes,
        createdAt: row.created_at,
        environmentLabel: row.environment_label,
      }),
    ),
    segments: segmentRows.results.map(
      (row): SegmentItem => ({
        technologyName: row.technology_name,
        versionBucket: row.version_bucket,
        osFamily: row.os_family,
        passed: row.passed,
        partial: row.partial,
        failed: row.failed,
        lastReportAt: row.last_report_at,
      }),
    ),
  };
}

export default function Evidence({ loaderData }: Route.ComponentProps) {
  const { revision, band, explanation, evidence, reproductions, segments } = loaderData;

  const otherEvidence = evidence.filter((item) => OTHER_EVIDENCE_TYPES.has(item.evidenceType));

  return (
    <main id="main" className="mx-auto flex w-full max-w-[900px] flex-col gap-margin px-margin py-8">
      <nav aria-label="Breadcrumb" className="font-mono text-env-tag text-on-surface-variant">
        <Link to={`/p/${revision.playbookSlug}`} className="hover:underline">
          {truncate(revision.title, 60)}
        </Link>{" "}
        / <span className="text-on-surface">Evidence</span>
      </nav>

      <header className="flex flex-col gap-3">
        <h1 className="font-headline text-headline-lg text-on-surface">Evidence and compatibility</h1>
        <p className="text-body-md text-on-surface-variant">
          Everything recorded against this exact revision — including what did not work.
        </p>

        <ConfidenceBadge
          band={band}
          counts={{
            reproducedPassed: revision.tally.reproducedPassed,
            reproducedFailed: revision.tally.reproducedFailed,
            reproducedPartial: revision.tally.reproducedPartial,
            uniqueEnvironments: revision.tally.uniqueEnvironments,
          }}
          explainHref="#why-this-confidence"
        />
      </header>

      <Card as="section" id="why-this-confidence">
        <h2 className="mb-2 font-headline text-body-md font-semibold text-on-surface">
          Why this confidence?
        </h2>
        <ul className="mb-3 flex list-none flex-col gap-1 text-body-sm text-on-surface-variant">
          {explanation.reasons.map((reason) => (
            <li key={reason} className="flex items-start gap-2">
              <Icon name="chevron_right" size={13} className="mt-0.5 shrink-0" />
              {reason}
            </li>
          ))}
        </ul>
        {explanation.whatWouldStrengthenIt.length > 0 && (
          <p className="text-body-sm text-on-surface-variant">
            <strong className="text-on-surface">What would strengthen it:</strong>{" "}
            {explanation.whatWouldStrengthenIt.join(" ")}
          </p>
        )}
      </Card>

      <CompatibilityMatrix slug={revision.playbookSlug} segments={segments} />

      <ReproductionReports reproductions={reproductions} />

      <Distribution segments={segments} />

      <OtherEvidence items={otherEvidence} />
    </main>
  );
}

/* ------------------------------------------------------------------------- */

/**
 * The compatibility matrix. Modelled on MDN's browser-compat-data (R-30): rows are a
 * technology and version bucket, columns are an OS family, and every cell states an
 * explicit outcome. There is no blank cell — a combination nobody has tried yet is
 * "untested", rendered as an invitation to be the one who does, not as silence.
 */
function CompatibilityMatrix({ slug, segments }: { slug: string; segments: readonly SegmentItem[] }) {
  const matrix = buildMatrix(segments);

  return (
    <section aria-labelledby="compatibility">
      <h2 id="compatibility" className="mb-1 font-headline text-headline-md text-on-surface">
        Compatibility matrix
      </h2>
      <p className="mb-gutter text-body-sm text-on-surface-variant">
        Every cell is a claim about one technology version on one operating system. Evidence on one
        combination says nothing certain about another (R-5) — that is why this is a grid and not a
        single number.
      </p>

      {matrix.rows.length === 0 || matrix.columns.length === 0 ? (
        <Card>
          <p className="flex items-start gap-2 text-body-sm text-on-surface-variant">
            <Icon name="add" size={14} className="mt-0.5 shrink-0" />
            No environment-segmented reports yet.{" "}
            <Link to={`/p/${slug}/report`} className="text-evidence-blue underline">
              Report yours
            </Link>{" "}
            and this grid starts here.
          </p>
        </Card>
      ) : (
        <div className="dv-scroll-thin overflow-x-auto rounded border border-outline-variant">
          <table className="w-full min-w-[560px] border-collapse text-body-sm">
            <caption className="sr-only">
              Compatibility of {truncate(matrix.rows[0]?.label ?? "this playbook", 40)} and related
              technology versions, by operating system. Untested combinations are marked and linked
              to the report form.
            </caption>
            <thead>
              <tr className="bg-surface-container-low">
                <th scope="col" className="border-b border-outline-variant p-2 text-left font-mono text-label-caps uppercase text-on-surface-variant">
                  Technology
                </th>
                {matrix.columns.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className="border-b border-outline-variant p-2 text-left font-mono text-label-caps uppercase text-on-surface-variant"
                  >
                    {formatOsFamily(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => (
                <tr key={row.key} className="border-b border-outline-variant last:border-b-0">
                  <th
                    scope="row"
                    className="whitespace-nowrap p-2 text-left font-mono text-env-tag font-normal text-on-surface"
                  >
                    {row.label}
                  </th>
                  {matrix.columns.map((column) => (
                    <td key={column} className="p-2 align-top">
                      <MatrixCellView slug={slug} segment={row.cells.get(column)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const CELL_META: Record<
  "verified_working" | "verified_failing" | "mixed",
  { label: string; icon: IconName; className: string }
> = {
  verified_working: { label: "Verified working", icon: "check_circle", className: "text-status-ci-verified" },
  verified_failing: { label: "Verified failing", icon: "error", className: "text-destructive-red" },
  mixed: { label: "Mixed", icon: "warning", className: "text-warning-amber" },
};

function MatrixCellView({ slug, segment }: { slug: string; segment: SegmentItem | undefined }) {
  const state = cellState(segment);

  if (state === "untested") {
    return (
      <Link
        to={`/p/${slug}/report`}
        className="flex items-center gap-1 font-mono text-env-tag text-evidence-blue underline decoration-dotted underline-offset-2 hover:no-underline"
      >
        <Icon name="add" size={13} />
        Untested — report yours
      </Link>
    );
  }

  const meta = CELL_META[state];
  const total = (segment?.passed ?? 0) + (segment?.partial ?? 0) + (segment?.failed ?? 0);

  return (
    <span className="flex flex-col items-start gap-0.5">
      <span className={`flex items-center gap-1 font-mono text-env-tag ${meta.className}`}>
        <Icon name={meta.icon} size={13} />
        {meta.label}
      </span>
      <EvidenceRate passed={segment?.passed ?? 0} total={total} />
    </span>
  );
}

/**
 * Reproduction reports, in full.
 *
 * Plan §0.3 requires failed reproductions to be retained and surfaced exactly like
 * successful ones — stored, shown, never quietly filtered to make the number above
 * look better. If this section hid its failures, the confidence band and the matrix
 * above it would both be lies told by omission: every count on this page is only as
 * honest as the list it was drawn from.
 */
function ReproductionReports({ reproductions }: { reproductions: readonly ReproductionItem[] }) {
  return (
    <section aria-labelledby="reproductions">
      <h2 id="reproductions" className="mb-1 font-headline text-headline-md text-on-surface">
        Reproduction reports
      </h2>
      <p className="mb-gutter text-body-sm text-on-surface-variant">
        Every report on record, worked and failed alike, newest first.
      </p>

      {reproductions.length === 0 ? (
        <Card>
          <p className="text-body-sm text-on-surface-variant">Nobody has reported trying this yet.</p>
        </Card>
      ) : (
        <ul className="flex list-none flex-col gap-2">
          {reproductions.map((report) => (
            <li key={report.id}>
              <Card as="article">
                <div className="flex flex-wrap items-center gap-2">
                  <OutcomeChip outcome={report.outcome} />
                  <span className="font-mono text-env-tag text-on-surface-variant">
                    {report.environmentLabel}
                  </span>
                  <time
                    dateTime={new Date(report.createdAt * 1000).toISOString()}
                    className="font-mono text-env-tag text-on-surface-variant"
                  >
                    {formatDate(report.createdAt)}
                  </time>
                </div>
                {report.notes && (
                  <p className="mt-2 whitespace-pre-wrap text-body-sm text-on-surface-variant">
                    {report.notes}
                  </p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The distribution behind the matrix, in prose.
 *
 * R-6: conflicting reproductions are never averaged into "mostly works". Where the
 * segments disagree — one environment passing, another failing on the same
 * technology and version — that disagreement is the actual finding, so it is stated
 * as a sentence rather than left for a reader to infer from a table.
 */
function Distribution({ segments }: { segments: readonly SegmentItem[] }) {
  const sentences = conflictSentences(segments);
  const withReports = segments.filter((segment) => segment.passed + segment.partial + segment.failed > 0);

  if (withReports.length === 0) return null;

  return (
    <section aria-labelledby="distribution">
      <h2 id="distribution" className="mb-1 font-headline text-headline-md text-on-surface">
        Distribution by environment
      </h2>
      <p className="mb-gutter text-body-sm text-on-surface-variant">
        Counts per environment segment, never averaged into one figure.
      </p>

      {sentences.length > 0 && (
        <Card className="mb-gutter">
          <ul className="flex list-none flex-col gap-1 text-body-sm text-on-surface">
            {sentences.map((sentence) => (
              <li key={sentence} className="flex items-start gap-2">
                <Icon name="warning" size={14} className="mt-0.5 shrink-0 text-warning-amber" />
                {sentence}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ul className="flex list-none flex-col gap-1">
        {withReports.map((segment) => {
          const total = segment.passed + segment.partial + segment.failed;
          return (
            <li
              key={`${segment.technologyName ?? ""}-${segment.versionBucket ?? ""}-${segment.osFamily ?? ""}`}
              className="flex flex-wrap items-center gap-2 border-b border-outline-variant py-2 text-body-sm last:border-b-0"
            >
              <span className="font-mono text-env-tag text-on-surface">
                {segment.technologyName ?? "Unspecified"}
                {segment.versionBucket ? ` ${segment.versionBucket}` : ""} ·{" "}
                {formatOsFamily(segment.osFamily ?? "unspecified")}
              </span>
              <EvidenceRate passed={segment.passed} total={total} />
              {segment.failed > 0 && (
                <span className="font-mono text-env-tag text-destructive-red">
                  {segment.failed} failed
                </span>
              )}
              {segment.lastReportAt && (
                <span className="font-mono text-env-tag text-on-surface-variant">
                  last {formatDate(segment.lastReportAt)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Everything else: official references, maintainer attestations and CI runs.
 *
 * These support the *cause* the playbook names, not a reproduction of the written
 * procedure — `deriveConfidenceBand` treats them the same way, which is why they are
 * kept in their own section rather than mixed into the reproduction list above.
 */
function OtherEvidence({ items }: { items: readonly EvidenceItem[] }) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="other-evidence">
      <h2 id="other-evidence" className="mb-1 font-headline text-headline-md text-on-surface">
        Supporting evidence
      </h2>
      <p className="mb-gutter text-body-sm text-on-surface-variant">
        References, attestations and automated runs. These say something true about why the fix
        works — they are not a report that the written steps run on a fresh machine, and are not
        counted as one.
      </p>

      <ul className="flex list-none flex-col gap-2">
        {items.map((item) => (
          <li key={item.id}>
            <Card as="article" className="flex flex-wrap items-center gap-2">
              <EvidenceChip type={item.evidenceType} result={item.result} />
              {item.sourceUrl ? (
                <a
                  href={item.sourceUrl}
                  rel="ugc nofollow noopener noreferrer"
                  className="text-body-sm text-evidence-blue underline"
                >
                  {item.sourceTitle ?? item.sourceUrl}
                </a>
              ) : (
                item.sourceTitle && <span className="text-body-sm text-on-surface">{item.sourceTitle}</span>
              )}
              {item.sourcePublisher && (
                <span className="text-body-sm text-on-surface-variant">— {item.sourcePublisher}</span>
              )}
              {item.actorHandle && (
                <span className="font-mono text-env-tag text-on-surface-variant">
                  {item.actorDisplayName ?? item.actorHandle}
                </span>
              )}
              <time
                dateTime={new Date(item.createdAt * 1000).toISOString()}
                className="font-mono text-env-tag text-on-surface-variant"
              >
                {formatDate(item.createdAt)}
              </time>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------------- */

const OTHER_EVIDENCE_TYPES: ReadonlySet<EvidenceType> = new Set([
  "official_reference",
  "maintainer_attestation",
  "ci_execution",
  "matrix_execution",
]);

interface EvidenceItem {
  id: string;
  evidenceType: EvidenceType;
  result: EvidenceResult;
  createdAt: number;
  environmentLabel: string | null;
  actorHandle: string | null;
  actorDisplayName: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourcePublisher: string | null;
}

interface ReproductionItem {
  id: string;
  outcome: ReproductionOutcome;
  notes: string | null;
  createdAt: number;
  environmentLabel: string;
}

interface SegmentItem {
  technologyName: string | null;
  versionBucket: string | null;
  osFamily: string | null;
  passed: number;
  partial: number;
  failed: number;
  lastReportAt: number | null;
}

interface EvidenceRow {
  id: string;
  evidence_type: string;
  result: string;
  created_at: number;
  environment_label: string | null;
  actor_handle: string | null;
  actor_display_name: string | null;
  source_title: string | null;
  source_url: string | null;
  source_publisher: string | null;
}

interface ReproductionRow {
  id: string;
  outcome: string;
  notes: string | null;
  created_at: number;
  environment_label: string;
}

interface SegmentRow {
  technology_id: string | null;
  technology_name: string | null;
  version_bucket: string | null;
  os_family: string | null;
  passed: number;
  partial: number;
  failed: number;
  last_report_at: number | null;
}

type CellState = "verified_working" | "verified_failing" | "mixed" | "untested";

interface MatrixRow {
  key: string;
  label: string;
  cells: Map<string, SegmentItem>;
}

interface Matrix {
  rows: MatrixRow[];
  columns: string[];
}

function buildMatrix(segments: readonly SegmentItem[]): Matrix {
  const rowsByKey = new Map<string, MatrixRow>();
  const columns = new Set<string>();

  for (const segment of segments) {
    if (!segment.technologyName) continue;

    const rowKey = `${segment.technologyName} ${segment.versionBucket ?? ""}`;
    const columnKey = segment.osFamily ?? "unspecified";
    columns.add(columnKey);

    let row = rowsByKey.get(rowKey);
    if (!row) {
      row = {
        key: rowKey,
        label: segment.versionBucket
          ? `${segment.technologyName} ${segment.versionBucket}`
          : `${segment.technologyName} (any version)`,
        cells: new Map(),
      };
      rowsByKey.set(rowKey, row);
    }
    row.cells.set(columnKey, segment);
  }

  const rows = [...rowsByKey.values()].sort((a, b) => a.label.localeCompare(b.label));
  const sortedColumns = [...columns].sort((a, b) => formatOsFamily(a).localeCompare(formatOsFamily(b)));

  return { rows, columns: sortedColumns };
}

function cellState(segment: SegmentItem | undefined): CellState {
  if (!segment) return "untested";
  const total = segment.passed + segment.partial + segment.failed;
  if (total === 0) return "untested";
  if (segment.failed > 0 && segment.passed === 0 && segment.partial === 0) return "verified_failing";
  if (segment.failed === 0 && segment.partial === 0 && segment.passed > 0) return "verified_working";
  return "mixed";
}

/**
 * Sentences for the segments that genuinely disagree — one environment passing, a
 * sibling environment of the same technology and version failing. Only the pairs
 * that actually conflict are named; a technology with uniform results anywhere
 * produces no sentence, because there is nothing to say.
 */
function conflictSentences(segments: readonly SegmentItem[]): string[] {
  const byRow = new Map<string, SegmentItem[]>();
  for (const segment of segments) {
    if (!segment.technologyName) continue;
    const key = `${segment.technologyName} ${segment.versionBucket ?? ""}`;
    const list = byRow.get(key);
    if (list) list.push(segment);
    else byRow.set(key, [segment]);
  }

  const sentences: string[] = [];
  for (const list of byRow.values()) {
    const passing = list.filter((s) => s.failed === 0 && s.passed > 0);
    const failing = list.filter((s) => s.failed > 0 && s.passed === 0 && s.partial === 0);
    const first = list[0];
    if (!first || passing.length === 0 || failing.length === 0) continue;

    const label = first.versionBucket ? `${first.technologyName} ${first.versionBucket}` : (first.technologyName ?? "");
    const passLabels = passing.map((s) => formatOsFamily(s.osFamily ?? "unspecified")).join(", ");
    const failLabels = failing.map((s) => formatOsFamily(s.osFamily ?? "unspecified")).join(", ");
    sentences.push(`${label} works on ${passLabels}, fails on ${failLabels}.`);
  }
  return sentences;
}

function formatOsFamily(osFamily: string): string {
  switch (osFamily.toLowerCase()) {
    case "linux":
      return "Linux";
    case "macos":
    case "darwin":
      return "macOS";
    case "windows":
    case "win32":
      return "Windows";
    case "unspecified":
      return "Unspecified OS";
    default:
      return osFamily;
  }
}

function formatDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function truncate(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

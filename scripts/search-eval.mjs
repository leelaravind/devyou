#!/usr/bin/env node
/**
 * Run the search relevance benchmark.
 *
 * `IMPLEMENTATION.md` §7: "No search architecture is considered accepted without
 * this benchmark."
 *
 * It runs against a **deployed** environment over HTTP rather than against the
 * retrieval functions in process, and that is the point. The thing being measured
 * is what a developer actually gets when they paste an error into the box — which
 * includes the query normaliser, the stage ordering, the D1 indexes, the FTS
 * tokeniser and the ranking boosts all behaving together. An in-process harness
 * would measure the ranker and quietly assume the rest.
 *
 *   node scripts/search-eval.mjs --base https://dev-staging.itisyou.app
 */

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const base = valueOf("--base") ?? "https://dev-staging.itisyou.app";
const verbose = args.includes("--verbose");

/**
 * The acceptance targets.
 *
 * Provisional experiment thresholds, not industry benchmarks — the market research
 * says so explicitly and that framing has to survive into the launch gate. `hitAt3`
 * at 0.70 is the one number the research actually states.
 */
const TARGETS = {
  hitAt3: 0.7,
  mrr: 0.6,
  zeroResultRate: 0.15,
  falsePositiveRate: 0.34,
};

const { queries } = JSON.parse(readFileSync("tests/search-eval/queries.json", "utf8"));

console.log(`\nSearch benchmark → ${base}\n${queries.length} queries\n`);

const results = [];
const transportFailures = [];

for (const query of queries) {
  const url = `${base}/search?q=${encodeURIComponent(query.text)}`;
  let returnedSlugs = [];
  let failed = false;

  try {
    const response = await fetch(url, {
      headers: {
        // Identify the benchmark so its traffic is separable in the search-event
        // telemetry — otherwise a benchmark run looks like 57 real zero-result
        // searches and skews the very metric it is measuring.
        "user-agent": "devyou-search-benchmark/1.0",
      },
    });
    /*
      A non-200 is an outage, not a zero-result, and the two must never be summed.

      An error page contains no result links, so treating it as "found nothing"
      reports a broken search as a relevance problem — which is exactly what
      happened the first time this ran against a 500. A benchmark that can report an
      outage as a metric is a benchmark that will one day hide one.
    */
    if (!response.ok) {
      failed = true;
      transportFailures.push({ queryId: query.id, status: response.status });
    } else {
      returnedSlugs = extractSlugs(await response.text());
    }
  } catch (error) {
    failed = true;
    transportFailures.push({
      queryId: query.id,
      status: error instanceof Error ? error.message : "network error",
    });
  }

  if (!failed) results.push({ queryId: query.id, returnedSlugs });
  process.stdout.write(failed ? "E" : scoreMark(query, returnedSlugs));
}

console.log("\n");

if (transportFailures.length > 0) {
  console.log(
    `\n  ${transportFailures.length} request(s) failed outright — the search is broken,`,
  );
  console.log("  not merely imprecise. Relevance metrics mean nothing until these are fixed.\n");
  for (const failure of transportFailures.slice(0, 10)) {
    console.log(`    ${failure.queryId}: ${failure.status}`);
  }
  console.log("");
  process.exit(2);
}

const report = evaluate(queries, results);
printReport(report, queries);

const verdict = meetsTargets(report);
console.log(verdict.ok ? "\nBenchmark PASSES the agreed targets.\n" : "\nBenchmark FAILS:");
for (const failure of verdict.failures) console.log(`  - ${failure}`);
console.log("");

process.exit(verdict.ok ? 0 : 1);

/* ------------------------------------------------------------------------- */

/**
 * Pull playbook slugs out of the results page, in rank order.
 *
 * The results are `<a href="/p/:slug">` links inside an ordered list, so document
 * order is rank order. Deduplicated because a card links to the same playbook from
 * both its title and its technology tags.
 */
function extractSlugs(html) {
  const seen = new Set();
  const slugs = [];
  for (const match of html.matchAll(/href="\/p\/([a-z0-9-]+)"/g)) {
    const slug = match[1];
    if (!seen.has(slug)) {
      seen.add(slug);
      slugs.push(slug);
    }
  }
  return slugs;
}

function scoreMark(query, returned) {
  const relevant = query.relevantProblemSlugs;
  if (relevant.length === 0) return returned.length === 0 ? "." : "x";
  const rank = returned.findIndex((slug) => relevant.includes(slug));
  if (rank === 0) return "!";
  if (rank > 0 && rank < 3) return "+";
  if (rank >= 3) return "-";
  return "x";
}

/* --- metrics ------------------------------------------------------------- */

function reciprocalRank(returned, relevant) {
  const index = returned.findIndex((slug) => relevant.includes(slug));
  return index === -1 ? 0 : 1 / (index + 1);
}

function evaluate(queries, results) {
  const byId = new Map(results.map((result) => [result.queryId, result.returnedSlugs]));
  const positives = queries.filter((query) => query.relevantProblemSlugs.length > 0);
  const negatives = queries.filter((query) => query.relevantProblemSlugs.length === 0);

  const rr = positives.map((query) =>
    reciprocalRank(byId.get(query.id) ?? [], query.relevantProblemSlugs),
  );

  const hitAt = (k) =>
    positives.filter((query) =>
      (byId.get(query.id) ?? [])
        .slice(0, k)
        .some((slug) => query.relevantProblemSlugs.includes(slug)),
    ).length / (positives.length || 1);

  const byShape = {};
  for (const query of positives) {
    const bucket = (byShape[query.shape] ??= { count: 0, rrSum: 0, hits: 0 });
    bucket.count += 1;
    bucket.rrSum += reciprocalRank(byId.get(query.id) ?? [], query.relevantProblemSlugs);
    if (
      (byId.get(query.id) ?? [])
        .slice(0, 3)
        .some((slug) => query.relevantProblemSlugs.includes(slug))
    ) {
      bucket.hits += 1;
    }
  }

  return {
    total: queries.length,
    positives: positives.length,
    mrr: rr.reduce((a, b) => a + b, 0) / (rr.length || 1),
    hitAt1: hitAt(1),
    hitAt3: hitAt(3),
    hitAt5: hitAt(5),
    zeroResultRate:
      positives.filter((query) => (byId.get(query.id) ?? []).length === 0).length /
      (positives.length || 1),
    falsePositiveRate:
      negatives.length === 0
        ? 0
        : negatives.filter((query) => (byId.get(query.id) ?? []).length > 0).length /
          negatives.length,
    byShape,
    failures: positives
      .filter((query) => reciprocalRank(byId.get(query.id) ?? [], query.relevantProblemSlugs) === 0)
      .map((query) => ({
        queryId: query.id,
        shape: query.shape,
        text: query.text.split("\n")[0].slice(0, 70),
        expected: query.relevantProblemSlugs,
        got: (byId.get(query.id) ?? []).slice(0, 3),
      })),
  };
}

function meetsTargets(report) {
  const failures = [];
  if (report.hitAt3 < TARGETS.hitAt3) {
    failures.push(`hit@3 ${pct(report.hitAt3)} is below the ${pct(TARGETS.hitAt3)} target`);
  }
  if (report.mrr < TARGETS.mrr) {
    failures.push(`MRR ${report.mrr.toFixed(2)} is below the ${TARGETS.mrr} target`);
  }
  if (report.zeroResultRate > TARGETS.zeroResultRate) {
    failures.push(
      `zero-result rate ${pct(report.zeroResultRate)} exceeds the ${pct(TARGETS.zeroResultRate)} ceiling`,
    );
  }
  if (report.falsePositiveRate > TARGETS.falsePositiveRate) {
    failures.push(
      `false-positive rate ${pct(report.falsePositiveRate)} exceeds the ${pct(TARGETS.falsePositiveRate)} ceiling`,
    );
  }
  return { ok: failures.length === 0, failures };
}

function printReport(report, queries) {
  console.log(`  MRR                 ${report.mrr.toFixed(3)}`);
  console.log(`  hit@1               ${pct(report.hitAt1)}`);
  console.log(`  hit@3               ${pct(report.hitAt3)}   (target ${pct(TARGETS.hitAt3)})`);
  console.log(`  hit@5               ${pct(report.hitAt5)}`);
  console.log(`  zero-result rate    ${pct(report.zeroResultRate)}   (ceiling ${pct(TARGETS.zeroResultRate)})`);
  console.log(`  false-positive rate ${pct(report.falsePositiveRate)}   (ceiling ${pct(TARGETS.falsePositiveRate)})`);

  /*
    Per-shape, always.

    An aggregate that hides a total failure on stack traces behind good
    natural-language numbers is worse than no benchmark, because it reports a pass
    on the query shape the product exists to answer.
  */
  console.log("\n  by query shape:");
  for (const [shape, bucket] of Object.entries(report.byShape)) {
    console.log(
      `    ${shape.padEnd(18)} n=${String(bucket.count).padStart(2)}  ` +
        `MRR ${(bucket.rrSum / bucket.count).toFixed(2)}  hit@3 ${pct(bucket.hits / bucket.count)}`,
    );
  }

  if (report.failures.length > 0) {
    console.log(`\n  ${report.failures.length} query(ies) found nothing relevant:`);
    for (const failure of report.failures.slice(0, verbose ? 100 : 12)) {
      console.log(`    ${failure.queryId} [${failure.shape}] ${failure.text}`);
      console.log(`      wanted: ${failure.expected.join(", ")}`);
      console.log(`      got:    ${failure.got.join(", ") || "(nothing)"}`);
    }
    if (!verbose && report.failures.length > 12) {
      console.log(`    … ${report.failures.length - 12} more (pass --verbose)`);
    }
  }

  void queries;
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

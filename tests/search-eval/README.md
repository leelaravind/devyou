# Search relevance benchmark

A fixed, hand-labelled set of realistic queries against DevYou's search, and the
metrics used to judge a retrieval stack against it.

`IMPLEMENTATION.md` §7 is explicit: **"No search architecture is considered accepted
without this benchmark."** `RESEARCH-CONSTRAINTS.md` R-22 requires this to exist and
be measured — lexical, vector and hybrid, separately — *before* committing to a
stack, and requires it to include queries where a semantic-similarity match is
actively the wrong answer. This directory is that gate.

## What is here, and what is not

| File | Status |
|---|---|
| `queries.json` | The labelled query set. Complete. |
| `packages/search/src/evaluate.ts` | Pure scoring functions (MRR, hit@k, zero-result rate, false-positive rate, the acceptance targets). Complete. |
| A runner | **Does not exist yet.** It will execute every query in `queries.json` against a real (or seeded-test) index, produce an `EvalResult[]`, and call `evaluate()` from `evaluate.ts`. |

Nothing in this directory calls a database or a model. `queries.json` is data;
`evaluate.ts` is arithmetic over that data plus whatever a stack returned. That
split is deliberate — a metric function that can be unit-tested with three lines of
literal input is a metric function whose numbers can be trusted, and the query set
can be reviewed and argued with independently of any particular search
implementation.

## How to run it

There is no runner in this repository yet — building one, and the seed playbook
corpus it depends on, is separate follow-on work. When it exists, running the
benchmark will look like:

```ts
import { evaluate, meetsTargets, type EvalQuery, type EvalResult } from "@devyou/search/evaluate";
import queriesFile from "../../tests/search-eval/queries.json" with { type: "json" };

const queries: EvalQuery[] = queriesFile.queries;

// However the runner gets there — call the real search path once per query.
const results: EvalResult[] = await Promise.all(
  queries.map(async (query) => ({
    queryId: query.id,
    returnedSlugs: await runSearch(query.text /* , query.shape if useful as a hint */),
  })),
);

const report = evaluate(queries, results);
const { ok, failures } = meetsTargets(report);

console.log(JSON.stringify(report, null, 2));
if (!ok) {
  console.error("Benchmark failed:", failures);
  process.exitCode = 1;
}
```

`returnedSlugs` must be **problem slugs**, in ranked order, not playbook or
revision IDs — that is what `relevantProblemSlugs` in `queries.json` is expressed
in, and what every metric in `evaluate.ts` compares against.

Before the runner can produce a meaningful `report`, the seed corpus needs a
playbook for every slug in [Slugs the corpus must cover](#slugs-the-corpus-must-cover)
below. Running the benchmark against a corpus missing most of those slugs will
correctly report near-total failure — that is the benchmark working, not a bug.

Read `report.byShape` before trusting the aggregate `hitAt3`/`mrr`. A query set
weighted towards natural-language queries (the easiest shape, and the one lexical
search is weakest on per R-19) can post a passing overall `hitAt3` while
`stack_trace` retrieval — the shape R-18's fingerprinting exists specifically to
serve — is quietly broken underneath it. `evaluate.ts` comments this at the
`byShape` field itself; it is worth reading there too.

## How to add a query

1. Pick or invent a `relevantProblemSlugs` slug. If the query is about a problem
   already in the corpus (or already targeted by another query here), **reuse its
   slug** — do not invent a near-duplicate. Several queries deliberately share a
   slug across different shapes (a bare error code, a full stack trace, a log
   extract, a prose description all pointing at the same underlying problem) to
   test that retrieval finds the one playbook regardless of how the reader pasted
   it. That is the single most valuable pattern in this file; keep using it.
2. Write realistic text. Copy the actual shape of real error output — a Node stack
   trace has `at Foo (path:line:col)` frames, a Postgres log line has a timestamp
   and a PID, a `kubectl describe` extract has an `Events:` block. A query no real
   developer would paste measures nothing. If you are adding a stack trace, give it
   an absolute path shape (Linux home dir, macOS `/Users/...`, a CI runner path, or
   a Windows `C:\`/`D:\` path) that no other stack-trace query already uses — the
   point of several different paths across the set is to prove that path
   normalisation, not lucky string matching, is what makes them fingerprint alike.
3. The query must be about a technology in
   `packages/config/taxonomy/technologies.json`. A benchmark over technologies the
   corpus does not cover measures nothing (see IMPLEMENTATION.md §20 and R-45 — the
   corpus is one narrow ecosystem, deliberately).
4. Work out the query's real `shape`. Do not guess — import `normaliseQuery` from
   `packages/search/src/normalise.ts` and check what it actually classifies your
   text as:

   ```sh
   node --experimental-strip-types -e "
     import('./packages/search/src/normalise.ts').then((m) => {
       console.log(m.normaliseQuery(\`your query text here\`).shape);
     });
   "
   ```

   Several queries in this set look, at a glance, like they should classify one way
   and actually classify another — a bare exception class name like
   `PrismaClientInitializationError` becomes `mixed`, not `exact_error`, because
   `classify()` only routes to `exact_error` on a recognised *error code*, not an
   exception name; a bare status word like `CrashLoopBackOff` or `OOMKilled`
   classifies as `natural_language` because it has no underscore-joined code and no
   `Error`/`Exception`-suffixed word for the extractor to catch. These are not bugs
   in this query set — they are real, checked behaviour of the classifier, and the
   benchmark should reflect it rather than an idealised guess.
5. If the query is one where a plausible embedding/semantic match would return the
   *wrong* playbook (R-22), mark it as such in `notes`, prefixed `ADVERSARIAL:`, and
   explain concretely what the tempting-but-wrong slug would be and why the
   correct one differs. See `q050`–`q054` for the pattern.
6. If the query is a deliberate negative — a plausible question the corpus should
   genuinely have nothing for — set `relevantProblemSlugs: []` and explain in
   `notes` why it is out of scope (usually: the technology is not in the
   taxonomy). See `q055`–`q057`.
7. Add the slug to the table below if it is new.
8. Re-run the shape check across the whole file (not just your new entry) before
   committing — it is cheap and catches transcription mistakes:

   ```sh
   node --experimental-strip-types -e "
     import('./packages/search/src/normalise.ts').then(async (m) => {
       const fs = await import('fs');
       const data = JSON.parse(fs.readFileSync('tests/search-eval/queries.json', 'utf8'));
       let bad = 0;
       for (const q of data.queries) {
         const actual = m.normaliseQuery(q.text).shape;
         if (actual !== q.shape) { console.log(q.id, 'declared', q.shape, 'actual', actual); bad++; }
       }
       console.log(bad === 0 ? 'all shapes correct' : bad + ' mismatches');
     });
   "
   ```
9. Keep the category proportions roughly where they are (see below) — the set is
   deliberately weighted so that `stack_trace` and `log` are not token
   contributions next to a pile of easy natural-language queries.

`queries.json` is plain JSON; validate it with `node -e "JSON.parse(require('fs').readFileSync('tests/search-eval/queries.json','utf8'))"` (or any JSON parser) after editing.

## Coverage

57 queries across the categories `IMPLEMENTATION.md` §7 names, in roughly these
proportions:

| Category | Count | Notes |
|---|---:|---|
| Exact exceptions / error codes | 10 | Bare codes and exception names — `SQLITE_BUSY`, `SQLSTATE 40001`, `PrismaClientInitializationError`. |
| Partial stack traces | 8 | Multi-line Node/Python/Java traces, each with a differently-shaped absolute path (Linux, macOS, Windows, CI runner, build server) so path normalisation is genuinely exercised, not string-matched by luck. |
| Logs | 8 | Multi-line timestamped output: `kubectl describe` extracts, Docker daemon JSON logs, Postgres logs with PIDs, PgBouncer, nginx-ingress, CoreDNS, wrangler dev, containerd/kubelet. |
| Code fragments | 5 | Real snippets (Drizzle, D1 bindings, a Worker anti-pattern, a leaking `pg` pool, Prisma) paired with the error they produce. |
| Version-rich queries | 8 | Explicit before/after versions — `Node 22 ... upgrade from 20`, `wrangler 4`, Kubernetes/kubectl skew, Helm 2→3, Postgres 15→17 behind PgBouncer. |
| Natural language | 10 | Prose symptom descriptions with no pasted error text at all. Several deliberately describe the same problem as an exact-error or stack-trace query elsewhere in the set. |
| Adversarial (R-22) | 5 | Queries where a plausible semantic-similarity match is the *wrong* answer. Each explained in `notes`, prefixed `ADVERSARIAL:`. |
| Expected-zero-result | 3 | Plausible developer questions the corpus should genuinely not answer (AWS Lambda, MongoDB, React — all outside the taxonomy). `relevantProblemSlugs: []`. |
| **Total** | **57** | |

`category` in each query object is a coverage label for humans (and for this
table) — it is not read by `evaluate.ts`. The field that scoring actually uses is
`shape`, which is the real `QueryShape` (`packages/search/src/query.ts`) that
`normaliseQuery` assigns the query's text; see step 4 above.

## Slugs the corpus must cover

`relevantProblemSlugs` are kebab-case slugs invented for this benchmark — they do
not exist in any database yet. When the seed corpus is written, every playbook it
targets against this benchmark should use one of the slugs below as its problem
slug. A query whose slug has no matching playbook will correctly register as a
failure; that is not a benchmark bug, it is the corpus not being ready yet.

Several slugs are intentionally targeted by more than one query, in different
shapes, to test that the same playbook is found regardless of how the reader
pasted their problem — a bare error code, a full stack trace, a log extract and a
prose description should all resolve to the same playbook slug. That reuse is
listed below (query IDs in parentheses).

- `bun-panic-main-thread-native-module`
- `containerd-task-creation-failed-context-deadline`
- `coredns-servfail-loop-detected` (bare token + log, 2 queries)
- `d1-migration-not-applied-no-such-table`
- `d1-sqlite-busy-concurrent-writes` (exact error + stack trace + adversarial natural language, 3 queries)
- `d1-sqlite-constraint-unique-violation`
- `d1-too-many-subrequests-single-invocation`
- `do-reset-code-update-websocket-drop`
- `do-storage-operation-timeout`
- `docker-cannot-connect-daemon`
- `docker-compose-v2-config-file-not-found`
- `docker-exec-format-error-arch-mismatch`
- `drizzle-error-invalid-schema-migration` (stack trace + code fragment, 2 queries)
- `helm-upgrade-failed-operation-in-progress`
- `k8s-crashloopbackoff-generic` (bare token + log, 2 queries)
- `k8s-failedscheduling-insufficient-cpu`
- `k8s-imagepullbackoff-private-registry` (bare token + adversarial, 2 queries)
- `k8s-oomkilled-memory-limit` (bare token + Java stack trace + natural language, 3 queries)
- `kubectl-unknown-resource-type-crd-not-installed`
- `neon-websocket-connection-failed-serverless`
- `nginx-ingress-504-gateway-timeout` (log + natural language, 2 queries)
- `node-cannot-find-module-missing-install`
- `node-eaddrinuse-port-in-use`
- `node-econnrefused-service-unavailable`
- `node-err-module-not-found-esm-upgrade`
- `node-heap-out-of-memory`
- `node-pg-connect-timeout-pool-exhausted`
- `node-pg-pool-exhausted-missing-release`
- `pgbouncer-max-client-conn-exceeded`
- `pgbouncer-prepared-statement-does-not-exist-transaction-pooling`
- `postgres-deadlock-detected-40p01`
- `postgres-sqlstate-40001-serialization-failure`
- `postgres-too-many-clients-connection-pool-exhausted` (stack trace + natural language, 2 queries)
- `postgresjs-prepared-statement-already-exists-pgbouncer`
- `prisma-client-initialization-error-connection-string` (bare exception + natural language, 2 queries)
- `prisma-p1001-cant-reach-database-server`
- `prisma-p2002-unique-constraint-violation`
- `r2-signaturedoesnotmatch-presigned-url`
- `supabase-rls-policy-violation-insert`
- `workers-cpu-time-limit-exceeded`
- `workers-error-1101-uncaught-exception`
- `workers-io-object-different-request`
- `wrangler-d1-execute-remote-hangs`

43 distinct slugs, targeted by 54 queries (the 3 expected-zero-result queries have
no slug by design).

## Targets

Exported as `TARGETS` in `packages/search/src/evaluate.ts`, each commented at its
definition with where the number comes from. Summarised here:

| Metric | Target | Source |
|---|---|---|
| Hit@3 | ≥ 0.70 | MARKET / R-22: *"search success on the deliberately difficult benchmark ≥ 70% before relying on internal search"*. |
| MRR | ≥ 0.60 | Set alongside Hit@3 for this benchmark, not independently cited — rewards the right answer landing near rank 1, not just somewhere in the top 3. |
| Zero-result rate | ≤ 0.15 | Set for this benchmark. Computed **excluding the deliberate negatives** — a negative correctly returning nothing is not a zero-result failure. |
| False-positive rate | ≤ 0.34 | Set for this benchmark, over the negative queries only — the 3 expected-zero-result queries (`relevantProblemSlugs: []`); the adversarial queries each have a real correct slug and are not negatives. Deliberately loose: with only 3 negatives, each wrong answer is worth roughly a third — a tight threshold would fail on one unlucky query rather than a real signal. |

**These are provisional experiment thresholds, not industry benchmarks.**
`RESEARCH-CONSTRAINTS.md` §2 states this explicitly about every numeric target in
the research — *"provisional success criteria for the experiment, not industry
benchmarks"* — and that framing is deliberately preserved in `evaluate.ts` rather
than left implicit. Clearing this gate means "good enough to build the rest of
search on top of, measured against a query set this project wrote itself, before
any real user traffic exists" — not "matches what a mature search product would be
judged against". `meetsTargets(report)` checks the four aggregate figures above;
`report.byShape` and `report.failures` are what a maintainer reads to find out
*why*, and are worth reading even when `meetsTargets` returns `ok: true` — see the
`byShape` comment in `evaluate.ts` for why an aggregate pass can still hide a
failure on one shape.

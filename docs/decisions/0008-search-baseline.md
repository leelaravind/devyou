# ADR-0008 — Search baseline: exact match and FTS5 first, semantic experimental

- **Status:** Accepted
- **Date:** 2026-08-22
- **Phase:** 3
- **Supersedes:** —

## Context

`IMPLEMENTATION.md` §0.7 makes search the product's entry point — search-first, no feed —
and §6 requires it to answer four different shapes of input from the same box: a bare error
code, a pasted stack trace, a pasted log line, and a sentence somebody typed.

The obvious modern answer is embeddings. It is also the answer that fails first here, for a
reason specific to this corpus: a semantic index will always return *something*, and a
launch corpus of 43 playbooks is mostly holes. A confident, plausible, wrong answer to
"why does my ingress time out" is worse than no answer, because the product's entire claim
is that what it shows is backed by evidence.

## Decision

**Three deterministic stages — exact signature, exact error code, FTS5 lexical — merged in
that order, with a scope gate in front of the lexical stage. No embeddings in V1.**

### 1. Stages, in priority order

1. **Signature lookup.** The normalised fingerprint of a pasted stack trace or log, matched
   against `signature_fts`. Volatile parts (timestamps, memory addresses, PIDs, container
   ids, absolute paths, ANSI escapes) are stripped first, so two occurrences of the same
   crash normalise to the same string.
2. **Error code lookup.** `E11000`, `ERR_MODULE_NOT_FOUND`, `1101`, `SQLITE_BUSY`. Quoted
   as an FTS phrase, because an error code split on its punctuation matches everything.
3. **Lexical FTS5.** `bm25` over the playbook index with per-column weights that put the
   error-signature and title columns far above body text.

`mergeStages` keeps an exact hit above every lexical hit regardless of score. A bm25 number
is not comparable across stages, and letting a high-scoring paragraph outrank a literal
error-code match is how "search finds my exact error" stops being true.

The tokenizer is `unicode61 remove_diacritics 2` with `tokenchars '_-.:/'` — without those
characters as token content, `ERR_MODULE_NOT_FOUND`, `node:internal/modules` and
`workers.dev/1101` all shatter.

### 2. The scope gate

**This is the non-obvious part, and it was arrived at by measurement rather than design.**

The first working implementation returned a lexical result for essentially every
natural-language query, including ones about technologies not in the corpus at all. The
instinct was to threshold on bm25. Measuring the score distributions showed that will not
work: on a corpus this small, a query of common English words scores about as well against
an unrelated playbook as a genuine match does. There is no cut point that separates them.

What *does* separate them is a property of the corpus rather than of the query: the corpus
is deliberately narrow. So the lexical stage runs only when the query mentions a technology
DevYou actually covers — resolved through the taxonomy's 171 aliases across 33 technologies.
A query about something outside that set returns nothing, and the UI says so, which is the
honest answer.

This is the decision most likely to look wrong later. It is correct *because* the corpus is
small; it becomes wrong as coverage grows, and the trigger to revisit it is the zero-result
rate climbing on queries the corpus can genuinely answer.

### 3. Semantic search is experimental, and off

No embedding index ships in V1. The stages above are deterministic, explainable, and cheap
enough to run inside a Worker's CPU budget against D1. When semantic retrieval is added it
goes in as a **fourth stage below the three above**, never as a replacement, so an exact
match can never be displaced by a similar one.

## Evidence

Measured against 57 labelled queries spanning all four input shapes
(`tests/search-eval/queries.json`, 43 distinct target slugs), run against the deployed
staging Worker rather than a local index — a search benchmark against a fixture is a
benchmark of the fixture.

Full run: [`docs/evidence/search-benchmark-2026-08-22.txt`](../evidence/search-benchmark-2026-08-22.txt).

| Metric | Result | Target |
|---|---|---|
| MRR | 0.809 | — |
| hit@1 | 74.1% | — |
| hit@3 | **88.9%** | ≥ 70% |
| zero-result rate | **9.3%** | ≤ 15% |
| false-positive rate | **0.0%** | ≤ 34% |

By shape: exact error 1.00 MRR, log 0.94, mixed 0.77, natural language 0.76, stack trace
0.75. All targets pass.

The benchmark itself was corrected during this phase and the correction matters: it
originally reported a transport failure as a 52% zero-result rate, which reads as a
relevance problem and is not one. It now separates transport failures from genuine
zero-results and **exits non-zero rather than reporting relevance metrics during an
outage** — a benchmark that reports plausible numbers while the system under test is down is
worse than one that reports nothing.

## Consequences

- **Six queries return nothing relevant**, five of them natural-language questions the scope
  gate declined (`durable object websocket keeps disconnecting…`, `why does my d1 database
  say the table doesn't exist…`). These are the price of the 0% false-positive rate. Saying
  nothing is the right failure for this product; saying something plausible is not.
- **One cross-language mismatch survives** (`java.lang.OutOfMemoryError` retrieving
  Node/Bun heap playbooks). The shared token `OutOfMemoryError` is genuinely informative;
  the corpus simply has no JVM playbook to win the comparison. Coverage fixes this, ranking
  changes do not.
- **Adding a technology means adding aliases.** The scope gate is only as good as
  `taxonomy/technologies.json`. A technology added to the corpus without its aliases is a
  technology search cannot reach — this is now the first thing to check when a query
  wrongly returns nothing.
- **A query is never rewritten by a model.** No AI touches retrieval. ADR-0010 keeps AI to
  structuring, classification, summarisation, dedupe and moderation assistance; ranking what
  a reader sees is not on that list.

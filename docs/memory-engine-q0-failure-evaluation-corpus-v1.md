# Q0 failure evaluation corpus v1

This is a bounded, deterministic evaluation corpus. It is not a sample of
production failure prevalence and must not be reported as a production failure
rate or distribution.

## Frozen composition

The corpus contains 40 opaque case records:

- 21 `TRIGGER_MISS` cases from the committed AutoRecall v2b5 holdout adapter;
- 19 `RANK_MISS` cases selected from the bounded LongMemEval R0 manifest.

The `21:19` composition is intentionally constructed for evaluation coverage.
It does not imply that trigger failures are more common than rank failures and
does not imply that `WRITE_MISS`, `CANDIDATE_MISS`, or `USE_MISS` do not occur.
The current production-observed classifiable failure count remains zero.

## Source authority

Trigger source:

- fixture: `auto-recall-policy-holdout.v2b5.jsonl`;
- adapter: `lib/benchmark/q0-trigger-failure-adapter-v1.js`;
- source contract: 48 rows, 24 expected-recall rows, 21 classified trigger
  failures;
- sorted trigger failure case-ID SHA-256:
  `22d053bb64aa1275a410730ad5bff91f8113efe33f09521e2d81797d3a5d235e`.

Retrieval source:

- dataset: `longmemeval_s_cleaned.json`;
- dataset SHA-256:
  `d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`;
- bounded source fixture:
  `test/fixtures/q0-longmemeval-rank-miss-source.v1.json`;
- source population: 248 rank misses;
- sorted source ID-set SHA-256:
  `f11c6034ab89f9b4796ec66144e9a130bb324977381d4c0f1e6cd49e6a45f8cf`.

The vendored retrieval source contains only opaque IDs, source references,
question-type labels, and positive integer evidence counts. It contains no
question, answer, session, memory, tool-result, retrieved-ID, or embedding
payload.

## Deterministic selection

The rank target is 19. Every non-empty family first receives one case. The
remaining 13 cases use largest-remainder proportional allocation over the full
248-case population. Equal fractional remainders are ordered by family name.

The frozen quotas are:

```text
knowledge-update             2
multi-session                6
single-session-assistant     1
single-session-preference    2
single-session-user          2
temporal-reasoning           6
```

Within each family, candidates are ordered by:

```text
SHA256("q0-e2c-selector-v1\\0" + case_id), then case_id ascending
```

The selector does not use manifest order. The selected rank ID-set SHA-256 is:

`003e0adbb1a0c6434fecb9b4366aed188826e222e25d764c64c1b16e39654bbf`.

The evidence-count distribution is observational only: six cases with one
evidence session, twelve with two, and one with three. It does not alter the
selection.

The combined ID-set hash is calculated over lexical case-ID order with one
terminal newline, matching the frozen corpus identity:

`b91990e6a60cec6f0a6cdebb3a80a999d79edfdf198c3b3ea57c6611c48d5bb5`.

## Evaluation semantics

Trigger entries remain `TARGETED_SYNTHETIC` and `TRIGGER_ONLY`. Retrieval
entries remain `BENCHMARK_DERIVED` and
`RETRIEVAL_FROM_MATERIALIZED_MEMORY`. All 40 entries have `loss_authority` set
to `SCOPED`; none are production end-to-end observations.

The corpus fixture is a metadata envelope with `evaluation_only=true` and
`prevalence_claim=false`. Each case contains bounded identity, provenance,
scope, failure, authority, source-reference, and case-reference fields. Rank
entries additionally carry `effective_top_k=3`, `evidence_count`, and the
selection hash.

The selector validates source count, uniqueness, family population, source
hashes, authorities, selected-ID hash, combined-ID hash, and payload boundaries.
Any drift fails closed rather than silently generating a new v1 corpus.

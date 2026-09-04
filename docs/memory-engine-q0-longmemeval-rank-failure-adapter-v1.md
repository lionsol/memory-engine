# Q0-E2b LongMemEval Scoped Rank Failure Adapter v1

This adapter evaluates LongMemEval retrieval evidence through the existing
isolated lexical production-hybrid runner and maps the result into the Q0-E1
contract. It is benchmark evidence only; it does not change hybridSearch,
ranking, top-k policy, telemetry, or LongMemEval gold data.

## Frozen runner calls

Each non-skipped source case is run twice with one identical
benchmarkNowSec:

| Run | topK | Authority |
| --- | ---: | --- |
| production depth | 3 | Q0 rank authority |
| breadth diagnostic | 50 | candidate coverage only |

Both calls use runLongMemEvalRetrievalCase(). The runner creates temporary
isolated Core/Engine fixtures and uses its existing lexical production-hybrid
path. No provider or live database is used.

Before combining evidence, the ordered top-three result must equal the first
three IDs of the breadth result. A mismatch is exposed only as the bounded
diagnostic top3_prefix_consistent=false; it does not choose one run over the
other.

## Gold and stage mapping

The normalized case's official evidence_session_ids are used only after the
two retrieval runs. They are never passed to materialization, search,
ranking, or prompt construction.

Every emitted Q0 case has:

~~~~
provenance       = BENCHMARK_DERIVED
evaluation_scope = RETRIEVAL_FROM_MATERIALIZED_MEMORY
effective_top_k = 3
~~~~

The write stage is BYPASSED_BY_FIXTURE. Trigger, disclosure, and answer-use
are OUT_OF_SCOPE.

Candidate PASS requires a non-empty gold set, prefix consistency, and every
gold session observed in the top-50 result. Absence from top-50 is not enough
to claim a candidate-generation miss:

| Evidence | Candidate | Rank |
| --- | --- | --- |
| all gold in top-50, all gold in top-3 | PASS | PASS |
| all gold in top-50, not all gold in top-3 | PASS | FAIL |
| any gold absent from top-50 | UNKNOWN | NOT_EVALUATED |
| prefix mismatch or empty gold | UNKNOWN | NOT_EVALUATED |

The first row is scoped Q0-E1 NO_LOSS. The second is scoped RANK_MISS. The
remaining rows are INSUFFICIENT_EVIDENCE and never CANDIDATE_MISS.

## Skips and report boundary

The existing official runner's abstention and no-user-target decisions are
reported as source skips and do not produce Q0 cases. Invalid source records
or retrieval execution failures fail closed.

The dataset report includes source/scored/skipped counts, skip reasons,
rank-miss/no-loss/insufficient counts, question-type aggregates, bounded Q0
cases and adjudications, and the Q0 aggregate. It does not include questions,
answers, session text, memory text, raw retrieval IDs, or a mixed production
failure rate. In particular, the Q0 aggregate's
production_observed_end_to_end_first_loss_distribution is zero for this
adapter because all cases are benchmark-derived and scoped.

## Later corpus selection

E2b returns all valid non-skipped cases, including insufficient evidence, for
review. It does not select or freeze a final 30–50-case Q0 corpus.

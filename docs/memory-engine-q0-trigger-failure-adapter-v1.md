# Q0-E2a Frozen Trigger Failure Adapter v1

This adapter converts the frozen AutoRecall v2b5 evaluation into bounded
Q0-E1 trigger evidence. It is an evaluation-only module: it does not access a
database, invoke runtime code, call a provider, add telemetry, or mutate the
source fixture.

## Source authority

The adapter consumes the in-memory contents of:

~~~~
test/fixtures/auto-recall-policy-holdout.v2b5.jsonl
~~~~

It always runs the existing
evaluateAutoRecallPolicyHoldoutV2B5Jsonl() or
evaluateAutoRecallPolicyHoldoutV2B5Rows() evaluator. It does not accept
caller-supplied policy decisions. A source contract failure is reported as
SOURCE_V2B5_CONTRACT_INVALID, and no Q0 cases are emitted.

The frozen source contract is:

| Measure | Required value |
| --- | ---: |
| total rows | 48 |
| expected recall yes | 24 |
| expected recall no | 24 |

Only the 24 rows with expected recall yes are adapted. Expected-no rows are
reserved for later unnecessary-recall/context-pollution evaluation and cannot
become a Q0 miss class.

## Q0 mapping

Every emitted case has:

~~~~
provenance       = TARGETED_SYNTHETIC
evaluation_scope = TRIGGER_ONLY
~~~~

The write, candidate, rank, disclosure, and answer-use stages are
OUT_OF_SCOPE with evidence_complete=null.

The trigger stage is derived only from the existing evaluator's
v2_runtime_candidate.should_recall value:

| Runtime decision | Trigger stage |
| --- | --- |
| false | FAIL, evidence_complete=true |
| true | PASS, evidence_complete=true |
| missing/non-boolean | UNKNOWN, evidence_complete=false |

Q0-E1 then classifies complete trigger failures as TRIGGER_MISS with
loss_authority=SCOPED. Complete trigger passes are NO_LOSS and have no loss
authority. No adapter case can produce END_TO_END authority.

## Frozen result

Against the committed v2b5 fixture and evaluator, the selected 24 cases are:

~~~~
trigger_fail = 21
trigger_pass = 3
trigger_unknown = 0
~~~~

The adapter report includes a bounded family breakdown, Q0 adjudications, and
the Q0 aggregate. The aggregate's
production_observed_end_to_end_first_loss_distribution remains all zero
because every adapted case is targeted synthetic and trigger-only.

## Privacy and output

Case objects contain only:

* bounded case identifiers;
* opaque source/case references;
* provenance and scope;
* stage states and evidence completeness.

They do not contain prompts, queries, transcript text, memory text, tool
results, or raw evaluator reports. Source fixture rows remain in memory and
are never rewritten or copied into a Q0 fixture.

# Map output protocol review and lossless compact implementation

Status: implemented and tested in an isolated worktree; not committed or deployed.

- Product base: `a036902076aea9023f199b28c862752ff03fbe0b`.
- Worktree: `/home/lionsol/.devspace/worktrees/memory-engine-411f08fb`.
- Only product change: `lib/checkpoint/long-session-summary.js`.
- Main workspace changes, installed candidate, executors, frozen cards and
  prior recovery/evidence directories are untouched.
- No live scheduler/service/index/checkpoint/DB/provider operation occurred.
  Tests use synthetic inputs, temporary directories and fake HTTPS/provider calls.
- CodeGraph tools were unavailable; direct source, literal search and targeted
  JS execution were used. No dependencies or lockfiles were modified.

## Evidence and limits of the diagnosis

The prior run
`manual:7b40cc54-3c66-4183-a0f7-453e3e9cec00:1792722032042:1`
reached a reliable terminal error. Its first map response was 665 UTF-16 units
against a 600-unit cap, finish_reason=stop, so the round stopped before reducer
validation. The full response body was not retained. We cannot distinguish
verbose JSON, extra fields, long evidence, whitespace or another cause inside
that body, nor claim a replay of it. That run did not exercise the reducer fix.

The current local UTF-16 guard correctly rejected oversize output. Its provider
max_tokens=600 setting uses a different unit; neither that setting nor a prompt
proves compliance with a 600-character bound. The offline review does not
measure provider tokens, tokenizer behavior, billing, real model quality or
remote cancellation.

## Review decision and budget arithmetic

Do not raise only the per-map cap to clear an observed response. With five
maps, a 4000-unit reducer output and primary plus fallback on every call:

| Per-map cap | Maximum map + reducer retained | All-attempt output reservation |
| --- | ---: | ---: |
| 600 | 7000 | 14000 |
| 665 | 7325 | 14650 |
| 700 | 7500 | 15000 |
| 800 | 8000 | 16000 |

Only the 600 row fits both existing outer envelopes at those maxima.
Inputs and times also have independent guards. Even the separate existing
component maxima sum to 6233 reducer request units including delimiters/array
punctuation, above its 6200 cap. Component ceilings are not a promise that all
maxima can be used simultaneously; the actual constructed request must fit.
No cap is raised and no late request is retried to fit.

Three serializations of the SAME ID, full hash, range and evidence were measured:

| Segment | Old object overhead | Hex tuple overhead | Implemented base64url tuple overhead |
| --- | ---: | ---: | ---: |
| 0: [0,6000) | 143 | 80 | 59 |
| 1: [5600,11600) | 147 | 84 | 63 |
| 2: [11200,17200) | 148 | 85 | 64 |
| 3: [16800,22800) | 148 | 85 | 64 |
| 4: [22400,22932) | 148 | 85 | 64 |

The tuple removes 63 units of field-name/container overhead; representing the
same 32 digest bytes in 43 base64url characters instead of 64 hex characters
saves another 21. Total structural saving is 84 units per map. A synthetic
665-unit old object becomes 602 with a hex tuple, which still fails; the
implemented lossless encoding makes that SAME synthetic evidence 581 units.
There is no text clipping or independent evidence-text sublimit.
These numbers use compact JSON; escaping and actual whitespace still count
against the raw response cap. They do not show that the unsaved real response
would fit or that future model output will comply.

## Implemented contract

`tuple-sha256-base64url-v1` requires exactly:

```text
[segment_id, source_hash_b64url, start, end, evidence_text]
```

- ID and offsets retain safe-integer types. Hash must be a 43-character
  canonical, unpadded base64url representation of all 32 SHA-256 bytes.
  The model copies it from request metadata; it is not asked to calculate it.
- Reject legacy object format, extra/missing tuple elements, wrong types,
  truncated/padded/noncanonical hashes and empty/ill-formed evidence.
- Decode to the existing internal full-hex object, then run the existing
  exact hash/ID/full-range validator. A changed final digest byte is rejected.
  Re-encoding checks reject alternate unused bits that Node's decoder permits.
- Keep the 600-unit guard BEFORE parsing. Valid 601/665-unit replies and
  a 665-unit reply that would canonicalize to 600 are still rejected without
  retry/fallback. The decoder also checks its direct-call input bound.
- Retain validated compact rows for EVIDENCE, not expanded verbose objects.
  The reducer instruction explains their field order and still requires every
  date/segment/entry/ref assertion. The instruction is 791 units (cap 800).
- Report the protocol version; source manifests continue to contain full hex
  hashes and unchanged ranges. Ledger units and counts are unchanged.

All source, segment, overlap, input, output, retained, call/attempt and time
budgets remain unchanged. The bounded adapter, HTTP decoder, provider routing,
fallback rules, eligibility gates, source reread and cooperative episode
publication protections are not modified. Mechanical association is not
semantic accuracy; `semantic_accuracy` remains `not_verified`.

## Verification

The focused four-file suite passed 106/106. The final eleven-file regression
passed **183/183**, zero failed/cancelled/skipped; stderr empty.
JS syntax checks and `git diff --check` passed.

The new review file contributes 23 tests on actual product paths:
- Full reader -> ordinary budget -> real JS summary adapter -> fake HTTPS ->
  episode publication, with a complete 22932-unit source and three other
  daily entries of 366/356/360 units.
- 581/600 accepted; 601/665 rejected before reducer, with the old episode kept.
  Formatted 665-unit JSON is rejected even when canonical JSON is 600.
- Full digest round-trip, final-byte mismatch, prefix/padding/noncanonical
  unused bits, wrong ID/type/range, legacy object, extra element, bad JSON,
  invalid Unicode and empty evidence. No response/source content is logged.
- Unicode/escaping accounting and the unchanged outer budget arithmetic.

Existing full-main, missing segment/entry/ref, reducer diagnostics, fallback,
attempt/input/output budgets, cancellation/deadlines, source/episode concurrent
change, lock, cleanup and publication-failure regressions are retained.
The map shape fixtures are updated for the strict tuple contract rather than
silently accepting old object responses.

```bash
cd /home/lionsol/.devspace/worktrees/memory-engine-411f08fb
MEMORY_ENGINE_TEST_DEPENDENCIES=/home/lionsol/.openclaw/extensions/memory-engine \
/home/lionsol/.local/node24/bin/node \
  --require ./test/checkpoint-dependency-loader.cjs --test \
  test/checkpoint-long-session-summary.test.js \
  test/checkpoint-reducer-contract.test.js \
  test/checkpoint-map-output-protocol-review.test.cjs \
  test/checkpoint-summary-transport.test.js \
  test/checkpoint-summary-output-budget.test.js \
  test/checkpoint-publication-failures.test.js \
  test/checkpoint-llm.test.js \
  test/checkpoint-episode-writer.test.js \
  test/checkpoint-runtime.test.js \
  test/checkpoint-markers.test.js \
  test/session-flush-reconciliation.test.js
```

Reproduce the arithmetic without any runtime/provider call:

```bash
cd /home/lionsol/.devspace/worktrees/memory-engine-411f08fb
/home/lionsol/.local/node24/bin/node \
  --require ./test/checkpoint-dependency-loader.cjs \
  test/checkpoint-map-output-protocol-review.test.cjs --measure
```

## Remaining limitations

This is a wire-protocol efficiency change with offline mechanical validation.
It cannot enforce model concision, factual correctness or complete semantic
retention. It may still fail closed on any real map/reducer response or input
budget. No real provider capability, historical summary quality or runtime
completion is claimed. There is no new retry, repair call, automatic budget
increase or execution allowance. A future real run needs a new independently
bound packet and explicit authorization; prior one-shot packets remain closed.

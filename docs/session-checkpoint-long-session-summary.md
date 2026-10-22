# Bounded long-session summary

Product base: `7bb5a7c356c95c7e96bbc28098f37c483328dfd3`.
This implementation does not import or change the deployment executor.

## Eligibility and input contract

The ordinary 8,000/session and 40,000/combined budgets remain unchanged.
A private, non-enumerable collector snapshot retains untruncated eligible input.
The additional path requires exactly one uncovered entry, truncated solely by
the default 8,000 session budget, with a unique session/entry ID and the existing
smart-add raw_log + session_flush + dialogue contract. Core target coverage
and Engine target input completeness must already have passed. Missing source
evidence, a DB read warning, missing event timestamps, or legacy reset parsing
block this path. Two oversized entries, another excluded/truncated entry, an
unsupported provenance or an oversized reducer context do not qualify.

The original source text (not its 8,000-character rendering) is divided into
UTF-16 half-open ranges. Boundaries never split surrogate pairs. Overlap is
400 code units, or 399 when required to preserve a surrogate pair. The complete
union must cover the source. Other eligible, deduplicated entries are included
untruncated in the reducer and individually identified. The reducer must name
every entry and segment and reference every other entry and a validated
evidence range from every segment. Existing collector eligibility/deduplication
rules define the input universe; this does not prove all conversations were
ingested upstream.

## Fixed budgets

| Limit | Value |
| --- | ---: |
| Unique long source | 26,000 UTF-16 code units |
| Segment / overlap / maximum segments | 6,000 / 400 / 5 |
| Map prompt metadata / total request / output | 800 / 6,800 / 600 |
| Other reducer context / metadata / prompt | 1,400 / 1,000 / 800 |
| Reducer total request / output | 6,200 / 4,000 |
| Logical calls / attempts | 6 / 12 |
| Request / logical stage / round | 30 / 60 / 450 seconds |
| All attempt inputs, including fallback | 80,000 |
| All attempt output reservations | 14,000 |
| Retained map + reducer output | 7,000 |

Full text must also fit the collector's other existing source budgets; the
26,000 ceiling does not override those gates. JSON escaping and prompt metadata
count against actual request character limits.

One request uses the primary provider, then at most one distinct configured
fallback. There is no same-provider retry, health probe or opaque retrying
adapter. Each attempt reserves its full output allowance even when it fails or
is cancelled, so unknown partial outputs do not free budget. Returned output
is size checked; oversize output aborts the round without fallback. Transport
bounds the decompressed response envelope and rejects oversized content.
Provider-side token limits accompany local output limits. A server ignoring
limits/cancellation may still incur remote generation or billing: local abort
cannot prove that remote work stopped, and unobserved remote text is not
reported as measured output.

All deadlines use monotonic time. Abort signals reach the HTTPS request and
response stream. UTF-8 response decoding is incremental, preserving characters
whose bytes arrive in separate network packets. Promise deadlines also bound a non-settling adapter; late
results cannot publish. Main supplies a 900-second parent envelope; the path
requires 450 seconds still available before starting. Scheduler timeouts may
remain stricter. Per-attempt metadata progress avoids a silent multi-minute
map phase. No provider response text is logged.

## Compact map output and budget diagnostics

Each map returns exactly one evidence object, with only the documented keys.
The evidence text is nonempty, well-formed Unicode and at most 160 UTF-16 units.
The segment ID/hash and complete segment start/end are copied from request
metadata; invented offsets, a narrower range, extra fields or a second evidence
item are rejected. The entire serialized response, including JSON escaping,
must still fit 600 units. This is a tighter, single-summary format within the
original budget, not an increase of the source/request/output/round limits.

The evidence range denotes the segment supplied to the extraction request.
Matching that range/hash proves mechanical input association, not that every
fact was retained or the summary is accurate. A short map can omit detail;
real semantic quality remains unverified. Prompt compliance is not guaranteed.

Provider max_tokens and the local UTF-16 cap are distinct units and are now
logged separately. Output failures retain a fixed category: content,
response_envelope, provider_tokens (finish_reason=length) or content_type.
Numeric observed content/decoded-envelope lengths are included only when
measured; unknown lengths remain absent. The envelope cap remains output*8+4096
decoded UTF-16 units (8,896 for a map). Counts are not raw provider text.
Arbitrary finish reasons/errors, response bodies and credentials are not copied
to diagnostics. Output exhaustion remains terminal without fallback/retry.

A bounded response with finish_reason=length cannot count as a complete map
even if the received content is short and syntactically valid. Ordinary
llmComplete callers without a response cap retain their existing behavior.
The failed segment is marked failed with failure_stage and reason; later,
unattempted segments remain pending. Old-episode protections remain unchanged.

## Completion and publication

Source-range coverage, call completion, output structure, references, daily
input coverage and publication are separate fields. They validate mechanical
coverage and provenance, **not semantic accuracy**. `semantic_accuracy` remains
`not_verified`. Original budget clipping remains in diagnostics; successful
segmentation separately resolves `summary_input_complete`. Vector backlog or
unverified vectors still prevent whole-checkpoint business completion.

This path produces an episode summary (and an optional missing-only legacy
daily mirror); it does not manufacture smart memories or configuration changes
from the map output. Those counts remain zero. Ordinary short-input extraction
continues through its existing path.

Before provider work, the episode snapshot records existence, hash, inode,
mode, size and change timestamps. Before publication all collected input is
read again and hashed, including the complete smart-add source file hash.
Read failure or changed source/episode preserves the old episode.

Publication takes an exclusive per-episode `.checkpoint.lock`, writes and fsyncs
a unique temporary file, saves and fsyncs a unique `.previous` backup of an
existing episode, then rechecks source and episode versions. Existing episodes
are replaced by atomic rename; absent episodes use a no-clobber hard link.
The ordinary episode writer uses the same publication lock. Stale locks fail
closed and are not automatically stolen. Backups are not automatically pruned.

The lock only coordinates writers that use it. There is no filesystem CAS for
an existing pathname: a non-cooperating writer can race the last check/rename.
Input checks across files/databases are not an atomic snapshot. External
writers must be quiescent for stronger guarantees. File contents are fsynced;
directory metadata durability across power failure is not claimed. Publication
and cleanup are distinct: once rename/link commits, cleanup errors are returned
as `cleanup_complete=false`, without pretending the old episode remains. An
optional mirror failure likewise preserves the episode publication result.
Either condition blocks segmented-checkpoint `publication_complete`, overall
business completion and the CLI success result. Cleanup failure before commit
does not mask the original source/version error. Marker
writers and third-party writers are outside the cooperative lock protocol.
No unobserved concurrent edit is claimed to have been prevented.

The episode embeds the validation manifest as
`publication_state=validated_for_atomic_publish`; the returned structured
report separately records actual publication and backup paths.

## Isolated verification

`test/checkpoint-long-session-summary.test.js` drives the actual JS collector,
budget, nightly handler, segmented provider adapter, writer and a fake-backed
main. It covers a 22,932-character source plus another daily entry, all-primary
fallback, segment/reducer failure, missing segments/entries, invalid references,
oversize output, source and episode changes, cancellation, Unicode, deadlines,
budget caps, and an existing publication lock. Inputs are synthetic, all paths
are temporary, and provider, flush, Core, Engine, Lance and conflict operations
in the main test are fake callbacks.

A fresh worktree can reuse installed dependencies without copying or changing
them via the optional test-only loader:

```sh
MEMORY_ENGINE_TEST_DEPENDENCIES=/absolute/existing/package-root \
node --require ./test/checkpoint-dependency-loader.cjs --test \
  test/checkpoint-long-session-summary.test.js \
  test/checkpoint-llm.test.js test/checkpoint-episode-writer.test.js \
  test/checkpoint-runtime.test.js test/checkpoint-markers.test.js \
  test/session-flush-reconciliation.test.js
```

Use a Node version compatible with the existing native modules. No real
checkpoint, indexing, scheduler, database repair or provider call is required.

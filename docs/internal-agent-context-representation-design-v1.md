# INTERNAL_AGENT_CONTEXT Representation Design v1

Status: `INTERNAL_AGENT_CONTEXT REPRESENTATION BOUNDARY DEFINED`

Scope: docs/OpenSpec-only architecture decision. No
`INTERNAL_AGENT_CONTEXT` projector, ProjectionArtifact source change,
capability/selector change, runtime wrapper, or runtime integration is created
by C.12.

## Decision

C.12 addresses the unresolved representation gap observed for `raw_log` and
`tool_output`. It does not reopen the redaction-evidence branch and is not a
redaction resolver stage.

The concepts remain separate:

- `INTERNAL_CONTEXT_PROJECTION` is a representation strategy.
- `INTERNAL_AGENT_CONTEXT` is a projection surface.
- `INTERNAL_CONTEXT` is a capability state.

A valid `INTERNAL_AGENT_CONTEXT` artifact would not grant `INTERNAL_CONTEXT`
capability, and `INTERNAL_CONTEXT` capability is not user disclosure.

## Evidence basis

C.3 frozen evidence recorded the following current-path facts:

| Family | Cases | Projection valid | Surface safe | Answer-bearing semantic preserved | Useful | Expected capability |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `raw_log` | 4 | 4/4 | 4/4 | 0/2 | 0 | `RETRIEVAL_ONLY` |
| `tool_output` | 4 | 4/4 | 4/4 | 0/2 | 0 | `RETRIEVAL_ONLY` |

This proves a tested semantic-preservation gap in the current
`DISCLOSURE_CARD` representation. It does not prove that an internal surface
should automatically be granted or that capability should change.

The current `auto-recall-memory-card.js` behavior intentionally uses bounded
generic withheld summaries for `raw_log_like` and `tool_output_like`. That is
a reasonable safety behavior for `DISCLOSURE_CARD`, not a mechanism to delete
or weaken. `INTERNAL_AGENT_CONTEXT` must be researched as a separate surface,
not implemented by changing the card projector.

## V1 representation direction

The first research direction is a bounded, deterministic, source-faithful
extractive representation. It selects or segments caller-supplied evidence
from a bound Canonical Memory representation without LLM rewriting or
abstractive summarization.

This isolates the question raised by C.3: can bounded operational evidence
preserve answer-bearing semantics? `SUMMARIZED_CARD` remains a separate
user-facing research candidate and is not merged into this design.

Internal does not mean full raw source or a prompt copy. A future artifact
must be bounded, explicitly truncated or segmented where necessary, and must
not imply full raw access, `RAW_DISCLOSABLE`, a get token, or tool execution
authority. `REFERENCE_ONLY` remains a separate projection strategy, while
`RAW_REFERENCE` remains a separate unimplemented projection surface; neither
is an alias for `INTERNAL_AGENT_CONTEXT`.

## Data-only consumer semantics

The payload is untrusted evidence/data only. Raw logs and tool output may
contain shell commands, stack traces, quoted prompts, hostile or malformed
text, and instruction-like strings. A future consumer must not interpret that
content as a system instruction, developer instruction, tool command, user
intent, or execution authorization.

Memory evidence and agent/system/tool instructions must remain separate
authority channels. Future runtime integration must not concatenate internal
context into an instruction body with peer instruction semantics. C.12 only
freezes this requirement; it does not implement a prompt wrapper or runtime
consumer.

## Representation requirements

The final schema is not frozen, but a future `INTERNAL_AGENT_CONTEXT`
candidate must provide:

- bounded context content;
- explicit data-only/untrusted-evidence semantics;
- inherited `memory_id`, `canonical_id`, and `source_content_hash` through the
  ProjectionArtifact contract;
- enough source/provenance information to explain the bounded evidence origin;
- explicit truncation, segmentation, or other bounding evidence;
- preserved category/kind authority where those fields are included;
- preserved risk flags, never silently cleared.

A fixed marker such as `content_role = "untrusted_evidence"` may be useful,
but C.12 does not freeze that field name or an exact payload schema.

Operational evidence may preserve meaningful line breaks, error codes,
exception names, command/output fragments, identifiers, status markers, and
bounded log structure. Future implementation must explicitly normalize,
escape, or reject non-printing/control characters; those characters must not
acquire delimiter or instruction semantics. C.12 does not choose that
algorithm or numeric limit.

## Source faithfulness and selection boundary

An initial extractive representation must remain derived from the bound
Canonical Memory representation. It may select, bound, segment, and escape
controls, but it must not invent facts, rewrite diagnostic conclusions,
convert tool output into inferred claims, or silently repair malformed output.

C.12 does not decide which source spans to select. Retrieval hits, risk flags,
LLM judgment, and regex matches are not assumed to have segment-selection
authority. A future prototype may use caller-supplied bounded synthetic spans
to test representation mechanics without implementing a detector or selector.

## Risk and capability boundary

The current expected capability for both primary evidence families remains
`RETRIEVAL_ONLY`. Even a valid and semantically useful internal artifact does
not change that expectation or automatically become `INTERNAL_CONTEXT`.

Projection must preserve `raw_log_like`, `tool_output_like`,
`sensitive_source`, `conflict_flag`, and other applicable risk flags. It must
not clear risk, change lifecycle or scope, set `safe_to_disclose`, grant
`CARD_DISCLOSABLE` or `INTERNAL_CONTEXT`, or choose a selector outcome.
Representation feasibility and authorization remain independent decisions.

The scope is limited to `raw_log` and `tool_output`. This decision does not
generalize to `sensitive_source`, `dreaming_artifact`, or cross-agent
material. Blocking risk does not become eligible for internal injection merely
because an internal surface is named.

## Future evaluation requirements

A separately authorized offline prototype evaluation must measure at least:

- structural validity;
- boundedness;
- source faithfulness;
- answer-bearing semantic preservation;
- instruction/data isolation;
- risk metadata preservation;
- provenance preservation;
- absence of capability authority.

Answer-bearing checks should use fresh deterministic required literals and
constraints, not subjective usefulness or LLM grading. C.3 anchors cannot be
used to tune a new prototype and then be presented as independent evidence;
formal evaluation would require a fresh holdout. No fixture or threshold is
created by C.12.

Per-artifact and, if segmented, per-segment/count bounds are required. Limits
must be constant and testable when implementation begins. The existing
1200-character AutoRecall long-text gate is a different surface constraint
and is not copied here.

## Architecture order

```text
Canonical Memory
      ↓
Projection Strategy
      ↓
INTERNAL_AGENT_CONTEXT candidate
      ↓
Projection Validation
      ↓
Capability Authorization
      ↓
Internal-context consumer
```

An internal context candidate must not pass through the user-facing card
selector to become disclosure. Existing selector behavior remains unchanged.

## Non-goals

C.12 does not implement:

- an `INTERNAL_AGENT_CONTEXT` projector or ProjectionArtifact payload schema;
- a segment selector, detector, summarizer, LLM rewrite, or runtime wrapper;
- capability or selector changes;
- `RAW_REFERENCE` or `RAW_DISCLOSABLE` authority;
- production integration, prompt construction, tool execution, or data access;
- a new capability state.

## Next bounded candidate

`D.3-C.13 INTERNAL_AGENT_CONTEXT Projection Contract Prototype` is
`CANDIDATE / NOT AUTHORIZED BY C.12`. A future pure offline source change may
define a new surface payload contract, caller-supplied bounded synthetic
evidence segments, and handcrafted tests. It must not start automatically or
create a runtime integration stage.

# INTERNAL_AGENT_CONTEXT Projection Contract v1

Status: `INTERNAL_AGENT_CONTEXT PROJECTION CONTRACT PROTOTYPE IMPLEMENTED / OFFLINE ONLY / NOT CAPABILITY AUTHORIZED`

Scope: pure offline ProjectionArtifact source and handcrafted mechanics tests.
No runtime consumer, production caller, capability/selector change, segment
detector, segment selector, summarizer, or holdout execution is included.

## Public adapter

`projectCanonicalMemoryToInternalAgentContextArtifact(canonicalMemory,
selection)` is a canonical-aware pure adapter in
`lib/canonical/projection-artifact.js`. It accepts no runtime candidate,
retrieval candidate, capability context, selector input, or caller-supplied
segment text.

The closed selection input is:

```json
{
  "ranges": [
    { "start": 0, "end": 24 }
  ],
  "risk_flags": ["raw_log_like"]
}
```

Ranges are JavaScript character/code-unit half-open ranges into
`canonicalMemory.source.text`. The adapter derives every segment with
`source.text.slice(start, end)`. It does not sort, merge, repair, or accept
caller text.

## Payload contract

The implemented surface uses projection kind
`canonical_internal_agent_context_v1` and a closed payload v1:

```json
{
  "schema_version": 1,
  "content_role": "untrusted_evidence",
  "category": "...",
  "kind": "...",
  "risk_flags": [],
  "source_text_length": 0,
  "selected_char_count": 0,
  "segment_count": 0,
  "source_fully_selected": false,
  "segments": [
    { "start": 0, "end": 0, "text": "..." }
  ]
}
```

The validator re-slices the canonical source and checks segment text,
identity, category/kind, counts, ordering, bounds, full-selection evidence,
and control characters. Newline, carriage return, and tab are allowed;
other Unicode control/format/other characters in selected text fail closed.

`content_role = "untrusted_evidence"` describes representation semantics,
not capability. Instruction-like source data remains data and does not become
system/developer/tool instruction, user intent, execution authorization, or
prompt/runtime isolation evidence.

## Prototype bounds

The offline prototype freezes these constant, testable bounds:

- maximum segments: `4`;
- maximum characters per segment: `1024`;
- maximum selected characters: `2048`;
- maximum risk flags: `16`;
- maximum risk-flag length: `64`.

These are prototype contract bounds, not production thresholds, AutoRecall
limits, or prompt budgets. `source_fully_selected = true` only records that
the bounded ranges cover the source text; it does not grant raw access or
`RAW_DISCLOSABLE` authority.

## Risk and authority boundary

`risk_flags` are caller-supplied prototype metadata. The adapter performs only
bounded pass-through with duplicate checks and creates a fresh output array;
it does not infer, remove, rewrite, or reclassify risk. This does not establish
production authority for the caller's flags and does not grant
`INTERNAL_CONTEXT`, `CARD_DISCLOSABLE`, `safe_to_disclose`, or selector
authority.

Canonical `memory_id`, `canonical_id`, `source_content_hash`, category, and
kind remain ProjectionArtifact-bound authority. The existing recursive
forbidden-authority validation rejects capability, policy, get-token,
raw-disclosure, and execution-authority fields at any nested level.

`RAW_REFERENCE` remains recognized but unimplemented with
`surface_not_implemented`. `REFERENCE_ONLY` is not implemented by this
contract.

## Source faithfulness and evaluation boundary

The prototype preserves selected source structure, including operational line
breaks and diagnostic fragments, without compact-whitespace normalization or
semantic rewriting. It does not decide which spans deserve selection; ranges
are caller-supplied. It does not detect secrets, select segments, summarize,
call an LLM, or claim runtime instruction/data isolation.

Future offline evaluation must separately measure structural validity,
boundedness, source faithfulness, answer-bearing semantic preservation,
instruction/data isolation, risk metadata preservation, provenance
preservation, and absence of capability authority. C.13 tests use fresh
handcrafted synthetic material only; no holdout or formal evaluation was
created or executed.

## Next bounded candidate

`D.3-C.14 Independent INTERNAL_AGENT_CONTEXT Holdout Freeze` is
`CANDIDATE / NOT AUTHORIZED BY C.13`. Any future holdout must use a fresh
synthetic namespace and must not reuse C.13 unit literals. C.13 does not
authorize that fixture or any runtime integration.

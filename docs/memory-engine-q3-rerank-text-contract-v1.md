# Q3 Canonical Rerank Text Contract v1

Date: 2026-09-09
Status: PROJECTOR PASS / SOURCE CLOSED at 594b423d6e8e167c4964644cb085cc02a1f75750; ORCHESTRATION PASS / SOURCE CLOSED at e5d55b41ee5d05b3493d4077e0912d55beaf1396. Offline Hybrid integration accepted with findings at b300b216f690d6d317bfac0fa655c374bf795368; production text quality and external disclosure remain unqualified.
Authority: Q3 architecture proposal; no production activation or external disclosure authorization.

## Decision

Use one exact canonical Core chunk as the first production-shaped offline text unit. Use canonical.source.text, not fused candidate text and not the 240-character Hybrid preview. Keep memory_id as the exact local identity. Do not reconstruct sessions, merge answer families, append neighbors, add assistant/user role filters, or combine memories.

Source evidence: canonical/memory-object.js exposes source.record_type=chunk, source.text=core.text, content_ref.mode=core_chunk and a content hash. hybrid/canonical-result.js currently returns String(item.text || "").slice(0,240); canonical metadata projection does not establish that this preview equals canonical.source.text. Do not alter that existing public result contract in this task.

The benchmark used session-shaped documents. Its measured gains justify the rerank layer but do not establish this chunk projection's quality. This is the next source contract, not a new production quality claim.

## Pure text projector

Implement a pure module taking already resolved canonical memories and explicit budgets:
- maxCodePointsPerCandidate: positive safe integer, at most 8000;
- maxTotalCodePoints: positive safe integer, at most 400000;
- candidate count: 0..50.

These are engineering ceilings, not selected production defaults or token guarantees. Caller must provide budgets; no hidden default. Query token budgeting belongs to the later provider adapter.

Validate the entire input before returning output: exact unique nonempty memory_id; source.record_type=chunk; source.record_id equals memory_id; source.text is a string. Reject malformed records rather than dropping them. Do not access any DB or modify inputs.

For each valid memory:
1. Use source.text verbatim, retaining whitespace, punctuation and existing content.
2. Apply head truncation by Unicode code points, without suffix or synthetic instructions.
3. Preserve strict empty strings as empty; do not invent text.
4. Return an ordered candidate {id: memory_id, text}, plus local truncation metadata: original/output code-point counts and truncated flag.
5. If the sum of projected text lengths exceeds maxTotalCodePoints, reject the complete projection. Do not remove candidates or apply order-dependent budget allocation.

Do not add paths, hit counts, confidence, category labels, source hints, IDs, gold labels or ranking scores to document text. Existing text may naturally contain such strings; do not strip or redact it with new heuristics. Adapter transport uses positional indexes; identity and projection metadata remain local.

The projector does not perform archive, visibility, permission or provider-egress decisions. Its output is data, not an authorization capability.

## Disclosure and later integration

Local retrieval eligibility, user-facing disclosure, and disclosure to an external provider are separate boundaries. Neither Owner-only get nor DIRECT_CARD selection authorizes external transmission of canonical full text. DIRECT_CARD formatting serves prompt disclosure and must not be repurposed as a full-text egress gate.

No production call is permitted until the caller has established eligibility and authorization for the selected provider and text projection. Unknown authorization must prevent transmission; ranking fallback cannot bypass it. If the system cannot establish such authority, remain on the authorized existing retrieval path.

A later adapter must enforce its model-specific query/document token and request limits. Code points are not tokens. No assumption about hidden server truncation is allowed. Credential/provider selection and real calls are outside this source task.

Placement relative to canonical validation requires a named retrieval profile. The current take-K-then-project behavior remains unchanged; this projector does not implement R3 backfill or change eligible candidates.

## Completed Codex task

Implement this pure projector and focused tests using synthetic canonical records only. Compose it with the accepted rerankCandidates function in a fake-adapter test; do not modify hybridSearch, public tools, config or runtime.

Acceptance:
- Exact IDs and input order survive; no input mutation, session expansion or text enrichment.
- Unicode truncation, strict empty text, per-document and aggregate budget boundaries, duplicate/mismatched IDs and malformed records behave as specified.
- Over-budget or invalid input produces no adapter call; successful composition preserves reranker all-or-nothing fallback and empty-text behavior.

Do not implement a provider adapter or a new permission framework. Report source commit and focused test results. Existing provider consumption is 2523/2523; additional calls=0.

## Status of adjacent work

Independent rerank interface is source-reviewed PASS/CLOSED at 88bca20b47f6cf143f7776a194e65f3572050e97 (11/11 focused tests). Q3 overall remains open. Exact primary search-ID, schemas.sql instruction cleanup and external report hash remain separate small fixes; no benchmark rerun is needed.

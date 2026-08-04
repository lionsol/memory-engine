## Purpose

Define a bounded, deterministic fallback FTS preselection contract that preserves candidate representation for every final H5-C4 bounded term before aligned fallback reranking.

## ADDED Requirements

### Requirement: Fallback preselection preserves bounded-term representation

When the primary normalized FTS query returns no rows and the bounded fallback query executes, the selector MUST run the existing global bounded-OR pool and bounded per-term representative probes before fallback reranking.

The probe terms MUST be the ordered, unique, FTS-safe `fallbackRerankTerms` derived from the final bounded fallback query. The selector MUST NOT perform a second term-selection pass from the raw or normalized query.

#### Scenario: Global BM25 pool is saturated

- **WHEN** the global bounded-OR query reaches the existing `ftsTopK` limit
- **AND** a bounded term has no representative row in that global pool
- **THEN** a bounded probe for that term still contributes up to the fixed per-term probe limit before reranking

### Requirement: Late unique identifiers survive SQL preselection

The bounded preselection union MUST include a target that matches only a late bounded identifier component when the global pool is filled by at least 20 distractors matching other bounded terms.

#### Scenario: Late target is absent from the global pool

- **WHEN** 25–40 distractors fill the global bounded-OR BM25 `LIMIT 20`
- **AND** the target is in `memory/smart-add/...` and matches only a late unique identifier component
- **THEN** the global result may omit the target
- **BUT** the corresponding bounded-term probe MUST recover the target into the union

### Requirement: Aligned fallback reranking remains authoritative

All union rows MUST be passed to the existing H5-C4 fallback reranker using the same bounded terms used for fallback `MATCH`.

Raw-query exact fragments MAY add their existing independent exact bonus, but MUST NOT become coverage terms or change the executed `MATCH` expression.

#### Scenario: Target receives bounded coverage and exact bonus

- **WHEN** the recovered target contains a selected identifier component and the complete compound identifier from the stripped query
- **THEN** its bounded-term coverage is positive
- **AND** its exact-fragment bonus is computed independently
- **AND** existing score weights remain unchanged

### Requirement: Target ranks first before final top-one truncation

For the controlled canary-shaped competition, a recovered unique target MUST rank first after fallback reranking and before any final top-one-shaped fusion or AutoRecall truncation.

#### Scenario: Broad distractors cannot hide a recovered target

- **WHEN** the target is present in the preselection union
- **AND** a broad older row matches only omitted early terms or fewer selected bounded terms
- **THEN** the target MUST rank ahead of that row under the existing scoring formula
- **AND** final topK and candidate gate behavior MUST remain unchanged

#### Scenario: Legitimate selected-term competitor remains legitimate

- **WHEN** a competing row genuinely matches multiple selected bounded terms
- **THEN** those matches MUST continue to increase its coverage under the existing formula
- **AND** H5-C5 MUST NOT suppress it through a target-specific rule

### Requirement: Strict FTS remains unchanged

When the primary normalized FTS query returns one or more rows, the selector MUST NOT execute the fallback query or any per-term probes.

#### Scenario: Primary success

- **WHEN** strict FTS returns rows
- **THEN** strict selection, scoring, enrichment, and debug semantics remain unchanged
- **AND** fallback probe counts remain zero or absent

### Requirement: Preselection is bounded

The fallback selector MUST enforce all of the following limits:

- global pool limit equals the existing `ftsTopK`;
- probe term count is no greater than eight;
- per-term probe limit is two unless a separately reviewed specification changes it;
- maximum raw union is no greater than `ftsTopK + 2 * probe_term_count`;
- rerank output remains limited by existing `ftsTopK`.

#### Scenario: Eight bounded terms at default limits

- **WHEN** `ftsTopK=20` and eight bounded terms are present
- **THEN** no more than eight probes execute
- **AND** no more than 36 raw rows enter deduplication
- **AND** no more than the existing `ftsTopK` rows leave fallback reranking

### Requirement: Union ordering and deduplication are deterministic

Global rows MUST retain their stable order. Probes MUST execute in bounded-term order, use a stable per-probe tie-break, and append only unseen chunk IDs.

#### Scenario: Global and probe duplicate

- **WHEN** the same chunk ID is returned by the global query and one or more probes
- **THEN** the union contains that ID exactly once
- **AND** repeated evaluation produces the same union IDs and rerank order, excluding existing time-dependent recency effects

### Requirement: Legacy and isolated FTS parity

Legacy attached-Core and isolated Core FTS MUST use the same global/probe limits, term order, deduplication semantics, archive filtering, and fallback reranker inputs.

#### Scenario: Equivalent selector modes

- **WHEN** the same fixture is evaluated through legacy and isolated FTS
- **THEN** active IDs, recovered target presence, union semantics, and rerank ordering MUST agree
- **AND** Core readonly and confidence-merge invariants MUST remain intact

### Requirement: Privacy-preserving observability

Fallback debug metadata MUST record only the preselection strategy and bounded counts:

- `fts_preselection_strategy`;
- `fts_preselection_global_count`;
- `fts_preselection_probe_query_count`;
- `fts_preselection_probe_raw_count`;
- `fts_preselection_union_count`;
- `fts_preselection_probe_per_term_limit`;
- `fts_preselection_post_rerank_count`.

Existing `fallback_count`, `strict_count`, `fts_query_final`, `fts_rerank_term_source`, `fts_rerank_term_count`, `post_rerank_topK`, and `candidate_counts_before_filtering` MUST remain available with their established compatibility meanings. No complete prompt, token list, memory body, embedding, or secret may be persisted.

#### Scenario: Bounded preselection evidence

- **WHEN** fallback preselection executes
- **THEN** debug metadata records only the strategy and bounded counts
- **AND** it does not persist the prompt, memory text, embedding, secret, or complete term list

### Requirement: Policy invariants and stop condition

H5-C5 MUST NOT change final topK, score weights, RRF/fusion, candidate gate, Card projection, reinforcement, AutoRecall defaults, runtime configuration, or persistent schema.

#### Scenario: Union does not produce a top-ranked target

- **WHEN** the target is in the preselection union but still does not rank first
- **THEN** implementation MUST stop and report rows, bounded terms, coverage, exact bonus, category boost, recency boost, final scores, and ranking differences
- **AND** no score, topK, fusion, or gate adjustment may be made within H5-C5

#### Scenario: Target remains absent from union

- **WHEN** bounded preselection still fails to include the target
- **THEN** implementation MUST stop and report the preselection evidence
- **AND** it MUST NOT silently increase the global or final retrieval budgets beyond this bounded strategy

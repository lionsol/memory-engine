# fts-fallback-rerank-alignment Specification

## Purpose
Define the lexical correctness contract for fallback FTS retrieval so the terms used to select rows and the terms used to rerank those rows remain aligned, especially for late high-information identifiers in long mixed-language queries.
## Requirements
### Requirement: Fallback MATCH and coverage reranking use the same bounded term set

When the primary normalized FTS query returns no rows and the fallback FTS query executes, token coverage for fallback candidates MUST be calculated from the exact bounded OR terms used by that fallback `MATCH` query.

Terms that are present only in the original normalized query and absent from the final fallback query MUST NOT contribute to fallback token coverage.

#### Scenario: Late identifier survives fallback coverage evaluation
- **WHEN** a bounded fallback query retains a late high-information identifier and a target row matches that identifier
- **THEN** the target receives positive token coverage from the retained identifier term
- **AND** it is not discarded solely because the identifier was outside the original normalized query's initial token window

#### Scenario: Early normalized terms do not create phantom fallback coverage
- **WHEN** a competing row contains early normalized-query terms that were not selected into the final bounded fallback query
- **THEN** those omitted terms do not increase that row's fallback token coverage

### Requirement: Exact fragments remain supplemental and distinct

Fallback reranking MAY retain exact-fragment bonuses derived from the original stripped query, but exact-fragment scoring MUST remain a separate signal from bounded-term coverage.

#### Scenario: Full compound identifier earns an exact bonus
- **WHEN** a target row contains the complete compound identifier from the stripped query
- **THEN** it may receive an exact-fragment bonus in addition to coverage from selected fallback terms

#### Scenario: Exact bonus does not redefine the MATCH term set
- **WHEN** an exact fragment contains components not present in the bounded fallback query
- **THEN** those components do not become coverage terms and do not change the executed FTS `MATCH` expression

### Requirement: Strict FTS behavior remains unchanged

When the primary normalized FTS query returns rows, the channel MUST retain its existing strict-query behavior and MUST NOT substitute fallback rerank terms.

#### Scenario: Primary query succeeds
- **WHEN** the primary normalized FTS query returns one or more rows
- **THEN** fallback `MATCH` is not executed
- **AND** strict candidates continue through the existing lexical enrichment and fusion path

### Requirement: Fallback ordering protects a uniquely matched target from unrelated early-term bias

For a canary-shaped query in which a unique late identifier target and a broad older memory are both returned by fallback `MATCH`, fallback reranking MUST NOT rank the broad memory above the target solely because the broad memory contains early original-query terms omitted from the bounded fallback query.

#### Scenario: Top-one-shaped competition
- **WHEN** the target matches a selected late identifier and the competing row matches only omitted early terms or fewer selected fallback terms
- **THEN** the target ranks ahead of the competing row before final channel truncation

#### Scenario: Legitimate selected-term support still counts
- **WHEN** a competing row genuinely matches multiple terms present in the bounded fallback query
- **THEN** those matches continue to contribute to its coverage and score under the existing scoring formula

### Requirement: Alignment is deterministic, bounded, and privacy-preserving

The fallback rerank term set MUST be deterministically derived from the final bounded fallback query, MUST NOT exceed that query's term count, and MUST NOT require persisting the complete prompt.

#### Scenario: Repeated execution
- **WHEN** the same fallback query is evaluated repeatedly
- **THEN** the same rerank term set and candidate ordering are produced, excluding time-dependent recency effects already present in the scoring model

#### Scenario: Debug evidence
- **WHEN** fallback reranking executes
- **THEN** debug metadata identifies the rerank term source as the bounded fallback query
- **AND** records a bounded term count or equivalent non-sensitive summary
- **AND** does not add the full prompt or full raw token list to persistent events

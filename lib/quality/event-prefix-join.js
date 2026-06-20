function toPrefix16(value) {
  return String(value ?? "").slice(0, 16);
}

function withDefaultEventStats(candidate) {
  return {
    ...candidate,
    id_prefix16: toPrefix16(candidate?.id),
    retrieved_count: 0,
    injected_count: 0,
    last_retrieved_at: null,
    last_injected_at: null,
    event_prefix_matched: false,
    event_prefix_ambiguous: false,
  };
}

export function attachEventStatsByPrefix(candidates, eventAggRows) {
  const normalizedCandidates = Array.isArray(candidates)
    ? candidates.map(withDefaultEventStats)
    : [];
  const rows = Array.isArray(eventAggRows) ? eventAggRows : [];

  const prefixToCandidateIndexes = new Map();
  for (const [index, candidate] of normalizedCandidates.entries()) {
    const indexes = prefixToCandidateIndexes.get(candidate.id_prefix16) ?? [];
    indexes.push(index);
    prefixToCandidateIndexes.set(candidate.id_prefix16, indexes);
  }

  const diagnostics = {
    chunk_prefix_unique_count: 0,
    chunk_prefix_ambiguous_count: 0,
    event_prefix_total_distinct: 0,
    event_prefix_matched_count: 0,
    event_prefix_unmatched_count: 0,
    event_prefix_ambiguous_count: 0,
  };

  for (const indexes of prefixToCandidateIndexes.values()) {
    if (indexes.length === 1) diagnostics.chunk_prefix_unique_count += 1;
    else if (indexes.length > 1) diagnostics.chunk_prefix_ambiguous_count += 1;
  }

  const distinctEventRows = new Map();
  for (const row of rows) {
    distinctEventRows.set(String(row?.memory_id ?? ""), row);
  }

  diagnostics.event_prefix_total_distinct = distinctEventRows.size;

  for (const [memoryId, row] of distinctEventRows.entries()) {
    const matchedIndexes = prefixToCandidateIndexes.get(memoryId) ?? [];

    if (matchedIndexes.length === 1) {
      const candidateIndex = matchedIndexes[0];
      normalizedCandidates[candidateIndex] = {
        ...normalizedCandidates[candidateIndex],
        retrieved_count: Number(row?.retrieved_count ?? 0),
        injected_count: Number(row?.injected_count ?? 0),
        last_retrieved_at: row?.last_retrieved_at ?? null,
        last_injected_at: row?.last_injected_at ?? null,
        event_prefix_matched: true,
        event_prefix_ambiguous: false,
      };
      diagnostics.event_prefix_matched_count += 1;
      continue;
    }

    if (matchedIndexes.length === 0) {
      diagnostics.event_prefix_unmatched_count += 1;
      continue;
    }

    diagnostics.event_prefix_ambiguous_count += 1;
  }

  return {
    candidates: normalizedCandidates,
    diagnostics,
  };
}

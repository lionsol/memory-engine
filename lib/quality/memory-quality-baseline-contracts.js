function buildCheck({ id, name, level, pass, details }) {
  return {
    id,
    name,
    level,
    pass: pass === true,
    details,
  };
}

function hasNoActionableLegacySingletonTarget(report) {
  const wouldDelete = report?.would_delete || {};
  const wouldDeleteTotal = Number(wouldDelete.core_chunks || 0)
    + Number(wouldDelete.core_chunks_fts || 0)
    + Number(wouldDelete.engine_memory_confidence || 0);
  const indexedChunkCount = Number(report?.review?.indexed_chunk_count || 0);
  const chunkIds = Array.isArray(report?.review?.chunk_ids) ? report.review.chunk_ids : [];
  return wouldDeleteTotal === 0 && indexedChunkCount === 0 && chunkIds.length === 0;
}

export const MEMORY_QUALITY_BASELINE_CONTRACTS = [
  {
    id: "unknown_memory_paths_clean",
    name: "unknown memory path audit reports unknown_count === 0",
    level: "structural",
    evaluate(context, contract) {
      return buildCheck({
        id: contract.id,
        name: contract.name,
        level: contract.level,
        pass: Number(context?.unknownReport?.summary?.unknown_count || 0) === 0,
        details: {
          unknown_count: Number(context?.unknownReport?.summary?.unknown_count || 0),
        },
      });
    },
  },
  {
    id: "active_memory_chunks_without_confidence_zero",
    name: "memory quality eval active-memory chunks_without_confidence_count === 0",
    level: "quality",
    evaluate(context, contract) {
      return buildCheck({
        id: contract.id,
        name: contract.name,
        level: contract.level,
        pass: Number(context?.qualityCollected?.diagnostics?.chunks_without_confidence_count || 0) === 0,
        details: {
          chunks_without_confidence_count: Number(context?.qualityCollected?.diagnostics?.chunks_without_confidence_count || 0),
        },
      });
    },
  },
  {
    id: "active_memory_lifecycle_owned_chunks_without_confidence_zero",
    name: "memory quality eval active-memory lifecycle_owned_chunks_without_confidence_count === 0",
    level: "quality",
    evaluate(context, contract) {
      return buildCheck({
        id: contract.id,
        name: contract.name,
        level: contract.level,
        pass: Number(context?.qualityCollected?.diagnostics?.chunks_without_confidence_lifecycle_owned_count || 0) === 0,
        details: {
          lifecycle_owned_chunks_without_confidence_count: Number(context?.qualityCollected?.diagnostics?.chunks_without_confidence_lifecycle_owned_count || 0),
        },
      });
    },
  },
  {
    id: "process_boundary_pass",
    name: "memory process boundary audit still passes",
    level: "process_boundary",
    evaluate(context, contract) {
      return buildCheck({
        id: contract.id,
        name: contract.name,
        level: contract.level,
        pass: String(context?.boundaryReport?.status || "") === "pass",
        details: {
          status: context?.boundaryReport?.status || "unknown",
          boundary_failures: Array.isArray(context?.boundaryReport?.boundary_failures) ? context.boundaryReport.boundary_failures : [],
        },
      });
    },
  },
  {
    id: "legacy_singleton_cleanup_no_actionable_target",
    name: "confirmed legacy singleton stale cleanup dry-run has no actionable target",
    level: "cleanup",
    evaluate(context, contract) {
      return buildCheck({
        id: contract.id,
        name: contract.name,
        level: contract.level,
        pass: hasNoActionableLegacySingletonTarget(context?.legacyCleanupReport),
        details: {
          preflight_passed: Boolean(context?.legacyCleanupReport?.preflight_passed),
          indexed_chunk_count: Number(context?.legacyCleanupReport?.review?.indexed_chunk_count || 0),
          chunk_ids: Array.isArray(context?.legacyCleanupReport?.review?.chunk_ids) ? context.legacyCleanupReport.review.chunk_ids : [],
          would_delete: context?.legacyCleanupReport?.would_delete || null,
        },
      });
    },
  },
  {
    id: "auto_recall_suspected_tool_output_denied",
    name: "autoRecall safety smoke denies suspected_tool_output",
    level: "recall_safety",
    evaluate(context, contract) {
      return buildCheck({
        id: contract.id,
        name: contract.name,
        level: contract.level,
        pass: Boolean(context?.suspectedToolOutputCheck?.pass),
        details: context?.suspectedToolOutputCheck?.details || null,
      });
    },
  },
  {
    id: "auto_recall_dreaming_artifact_denied",
    name: "autoRecall safety smoke denies dreaming artifact candidate",
    level: "recall_safety",
    evaluate(context, contract) {
      return buildCheck({
        id: contract.id,
        name: contract.name,
        level: contract.level,
        pass: Boolean(context?.dreamingArtifactCheck?.pass),
        details: context?.dreamingArtifactCheck?.details || null,
      });
    },
  },
];

export function evaluateMemoryQualityBaselineContracts(context) {
  return MEMORY_QUALITY_BASELINE_CONTRACTS.map(contract => contract.evaluate(context, contract));
}

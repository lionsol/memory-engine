import { createHash } from "node:crypto";
import {
  inspectMemoryQualityBaselineContracts,
} from "./memory-quality-baseline-introspection.js";

export const MEMORY_QUALITY_BASELINE_LEVEL_ORDER = [
  "structural",
  "quality",
  "process_boundary",
  "cleanup",
  "recall_safety",
];

function normalizeForStableStringify(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeForStableStringify);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.keys(value)
    .sort()
    .reduce((normalized, key) => {
      normalized[key] = normalizeForStableStringify(value[key]);
      return normalized;
    }, {});
}

export function stableStringify(value) {
  return JSON.stringify(normalizeForStableStringify(value));
}

function sha256(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function summarizeContractsByLevel(contracts) {
  const grouped = MEMORY_QUALITY_BASELINE_LEVEL_ORDER.reduce((acc, level) => {
    acc[level] = {
      count: 0,
      contract_ids: [],
    };
    return acc;
  }, {});

  for (const contract of contracts) {
    if (!grouped[contract.level]) {
      grouped[contract.level] = {
        count: 0,
        contract_ids: [],
      };
    }
    grouped[contract.level].count += 1;
    grouped[contract.level].contract_ids.push(contract.id);
  }

  return grouped;
}

export function buildMemoryQualityBaselineSnapshot() {
  const contracts = inspectMemoryQualityBaselineContracts().map((contract, index) => ({
    index,
    id: contract.id,
    level: contract.level,
    name: contract.name,
  }));
  const levels = summarizeContractsByLevel(contracts);
  const structure = {
    contract_count: contracts.length,
    contracts,
    levels,
  };

  return {
    contract_count: contracts.length,
    contract_hash: sha256(contracts),
    level_hash: sha256(levels),
    structure_hash: sha256(structure),
    contracts,
    levels,
  };
}

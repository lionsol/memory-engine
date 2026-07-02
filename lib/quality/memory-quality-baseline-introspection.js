import {
  MEMORY_QUALITY_BASELINE_CONTRACTS,
} from "./memory-quality-baseline-contracts.js";

export function inspectMemoryQualityBaselineContracts() {
  return MEMORY_QUALITY_BASELINE_CONTRACTS.map(contract => ({
    id: contract.id,
    level: contract.level,
    name: contract.name,
  }));
}

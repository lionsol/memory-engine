#!/usr/bin/env node

async function buildMemoryQualityBaselineIntrospectionReport() {
  const introspection = await import("../lib/quality/memory-quality-baseline-introspection.js");
  const contracts = introspection.inspectMemoryQualityBaselineContracts();
  const levels = contracts.reduce((acc, contract) => {
    acc[contract.level] = Number(acc[contract.level] || 0) + 1;
    return acc;
  }, {});

  return {
    contract_count: contracts.length,
    contracts,
    levels,
  };
}

async function main() {
  try {
    console.log(JSON.stringify(await buildMemoryQualityBaselineIntrospectionReport(), null, 2));
    return 0;
  } catch (error) {
    console.error(String(error?.message || error));
    return 1;
  }
}

module.exports = {
  buildMemoryQualityBaselineIntrospectionReport,
  main,
};

if (process.argv[1] && /inspect-memory-quality-baseline\.js$/.test(process.argv[1])) {
  main().then(code => {
    process.exitCode = code;
  });
}

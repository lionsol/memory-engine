#!/usr/bin/env node

async function main(args = process.argv.slice(2)) {
  const unknown = args.filter((arg) => arg !== "--json");
  if (unknown.length > 0) {
    process.stderr.write(`unknown argument: ${unknown[0]}\n`);
    return 64;
  }
  try {
    const { runSyntheticManifestSmoke } = await import(
      "../lib/ops/synthetic-host-plugin-metadata-manifest.js"
    );
    process.stdout.write(`${JSON.stringify(runSyntheticManifestSmoke(), null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`synthetic manifest smoke failed: ${error?.message ?? "unknown error"}\n`);
    return 1;
  }
}

module.exports = { main };

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

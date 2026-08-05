const { buildRuntimeArtifactManifestV2 } = require("./manifest-lib.cjs");
const root = process.argv[process.argv.indexOf("--root") + 1];
if (!root) throw new Error("--root required");
process.stdout.write(`${JSON.stringify(buildRuntimeArtifactManifestV2({ rootDir: root }))}\n`);

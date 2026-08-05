import { buildRuntimeBuildIdentity } from "../version/runtime-build-identity.js";
const root = process.argv[process.argv.indexOf("--root") + 1];
if (!root) throw new Error("--root required");
process.stdout.write(`${JSON.stringify(buildRuntimeBuildIdentity({ rootDir: root }))}\n`);

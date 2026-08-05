const { createBroker } = require("./dry-run.js");
const { createRegistry } = require("./command-registry.js");
const { SandboxRunner } = require("./sandbox.js");
const { inspectPlanTools } = require("./tool-identity.js");
const { createDefaultHandlers } = require("./stage-handlers.js");
const { runPreflight, captureHostStability } = require("./preflight.js");

function createProductionFactory({ plan, spawn, toolRunner, serviceStatus } = {}) {
  const broker = createBroker(plan);
  const makeSandbox = stagingRoot => new SandboxRunner({ plan, stagingRoot, spawn });
  const inspectTools = () => inspectPlanTools({ plan, broker, runner: toolRunner });
  const makeRegistry = stagingRoot => createRegistry({ plan, broker, spawn, sandbox: makeSandbox(stagingRoot) });
  const handlers = createDefaultHandlers({ registryFactory: ({ stagingRoot }) => makeRegistry(stagingRoot) });
  return {
    broker,
    makeSandbox,
    inspectTools,
    makeRegistry,
    handlers,
    preflight: ({ paths, strict = true, sandboxRoot = null } = {}) => runPreflight({
      plan, broker, registry: makeRegistry(sandboxRoot), tools: inspectTools(), sandbox: makeSandbox(sandboxRoot), paths, strict,
    }),
    captureHostStability: () => captureHostStability({ plan, broker, registry: makeRegistry(null) }),
    serviceStatus,
  };
}

module.exports = { createProductionFactory };

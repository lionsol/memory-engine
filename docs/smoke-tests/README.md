# Smoke Tests

This directory keeps manual smoke-test runbooks for workflows that are important to verify outside ordinary unit tests.

## Available Runbooks

| Runbook | Scope | Safety boundary |
|:---|:---|:---|
| [`console-annotation-report-handoff.md`](console-annotation-report-handoff.md) | Console `/reports` ↔ `/annotations` GUI handoff for annotation/review queue work | Read-only report fetches only; no label upload, DB write, memory mutation, apply, unarchive, category update, delete, quarantine, reinforce, or LLM call |
| [`openclaw-memory-tools.md`](openclaw-memory-tools.md) | OpenClaw memory tool contract and memory-core / memory-engine split | Tool exposure and routing verification only; no memory mutation |
| [`full-fail-closed-safety-smoke.md`](full-fail-closed-safety-smoke.md) | F1-D-B8-A5 Hybrid Search full fail-closed matrix across all production surfaces | Synthetic SQLite `:memory:` fixtures only; no real DB, plugin reload, config mutation, network call, report write, or legacy code removal |
| [`full-fail-closed-runtime-rollout.md`](full-fail-closed-runtime-rollout.md) | F1-D-B8-A6 controlled plugin reload, scoped-canary evidence classification, channel-by-channel rollout, rollback, observation export, and short controlled-run evidence procedure | Real runtime changes require an operator; report evaluators read JSON/JSONL only; Engine DB access is read-only observation export only; B8-B removal remains prohibited |
| [`full-fail-closed-production-evidence-window.md`](full-fail-closed-production-evidence-window.md) | F1-D-B8-A7 sustained production evidence governance: epoch/build identity, continuity, traffic origin, monitoring, and stop conditions | Design/tooling only until A7 runtime authorization; no sustained full mode, AutoRecall expansion, manufactured traffic, memory mutation, or B8-B removal |
| [`sustained-runtime-authorization-tooling.md`](sustained-runtime-authorization-tooling.md) | F1-D-B8-A7.4 loaded-runtime preflight, parity/product-health generation, scheduled healthcheck, epoch projection, natural-traffic forecast, authorization plan, and read-only monitor cycle | Report-only/dry-run implementation; no real config change, install/reload, scheduler, epoch activation, rollback execution, push, or B8-B removal |
| [`sustained-runtime-authorization-decision-20260720.md`](sustained-runtime-authorization-decision-20260720.md) | First real-environment B8-A7 sustained-runtime authorization review after A7.4 closure | Authorization withheld: records parity, ABI, active-memory, natural-traffic, product-health, and preflight blockers without runtime mutation |
| [`openclaw-state-db-readonly-feasibility.md`](openclaw-state-db-readonly-feasibility.md) | B8-A7-R2B synthetic-only `node:sqlite` read-only state-DB feasibility matrix | Synthetic temporary databases only; no real OpenClaw state, plugin loading, discovery, configuration, or production reader authorization |
| [`tool-surface-runtime-access-audit.md`](tool-surface-runtime-access-audit.md) | F1-D-B8-A6.2 registry vs effective tool visibility audit plus controlled `tools.invoke` production-surface verification | Search-only gateway invocation; no persistent policy widening, memory mutation, Core DB access, Stage 2 auto-authorization, or legacy removal |

## When to Use

Review [openclaw-no-load-plugin-metadata-audit.md](openclaw-no-load-plugin-metadata-audit.md) before any future attempt to identify an installed plugin runtime path for sustained-runtime remediation. This audit is source-only and does not authorize OpenClaw CLI commands, plugin discovery, runtime loading, configuration changes, or A7. Review [openclaw-state-db-readonly-feasibility.md](openclaw-state-db-readonly-feasibility.md) for the synthetic-only R2B feasibility harness; it does not authorize a production reader or real state-DB access.

The B8-A7-R1 remediation procedure is documented in [sustained-runtime-remediation.md](sustained-runtime-remediation.md). It is an operator plan only and does not authorize configuration mutation, plugin install/reload, scheduler creation, healthcheck traffic, epoch activation, A7, or B8-B removal.

Run or review the Console annotation/report handoff smoke whenever changing:

- `console/views/annotations.ejs`
- `console/views/reports.ejs`
- `console/public/charts.js`
- `console/services/reports-service.js`
- report allowlists
- annotation candidate/label report formats
- archived raw-log rescue queue or label report tooling

Run or review the OpenClaw memory tools smoke whenever changing:

- `openclaw.plugin.json`
- memory tool contracts
- memory-core / memory-engine tool boundaries
- agent-facing memory search/get behavior

Run the full fail-closed safety smoke whenever changing:

- KG or Recent fail-closed policy/runtime behavior;
- Hybrid fallback suppression or rollback behavior;
- Hybrid observation rollout markers;
- scoped-canary versus full-mode metrics;
- production search-surface wiring.

Use the controlled runtime rollout runbook only after A5 passes and whenever changing:

- `kgFailClosedMode` / `recentFailClosedMode` manifest schema;
- canary allowlist schema or trusted runtime scope;
- plugin install/reload and rollback steps;
- production observation export or full-rollout evidence collection;
- scoped-canary status classification or JSON/JSONL metrics summarization;
- gateway tool catalog/effective-policy drift;
- production tool-surface execution through `tools.invoke`;
- Node ABI mismatch between the OpenClaw CLI and plugin native dependencies.

## Regression Guard

The runbooks are also covered by static tests so that key links, workflow steps, and safety boundaries remain discoverable:

```text
npm run smoke:console-annotation-handoff
npm run smoke:full-fail-closed
node --test test/full-fail-closed-runtime-rollout-contract.test.js
node --test test/sustained-runtime-authorization-tooling-contract.test.js
node --test test/sustained-runtime-remediation-contract.test.js
node --test test/openclaw-no-load-plugin-metadata-audit-contract.test.js
node --test test/openclaw-state-db-readonly-feasibility-contract.test.js
node --test test/openclaw-state-db-readonly-feasibility.test.js
npm run smoke:openclaw-state-db-readonly
node --test test/tool-surface-runtime-access-audit-doc.test.js
node --test test/agent-memory-tool-strategy.test.js
```

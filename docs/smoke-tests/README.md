# Smoke Tests

This directory keeps manual smoke-test runbooks for workflows that are important to verify outside ordinary unit tests.

## Available Runbooks

| Runbook | Scope | Safety boundary |
|:---|:---|:---|
| [`console-annotation-report-handoff.md`](console-annotation-report-handoff.md) | Console `/reports` ↔ `/annotations` GUI handoff for annotation/review queue work | Read-only report fetches only; no label upload, DB write, memory mutation, apply, unarchive, category update, delete, quarantine, reinforce, or LLM call |
| [`openclaw-memory-tools.md`](openclaw-memory-tools.md) | OpenClaw memory tool contract and memory-core / memory-engine split | Tool exposure and routing verification only; no memory mutation |

## When to Use

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

## Regression Guard

The runbooks are also covered by static tests so that key links, workflow steps, and safety boundaries remain discoverable:

```text
npm run smoke:console-annotation-handoff
node --test test/agent-memory-tool-strategy.test.js
```

# F1-D-B8-A5 Full Fail-Closed Safety Smoke

## Purpose

Verify the explicit Hybrid Search fail-closed modes before any plugin reload or production rollout.

This smoke is a pre-runtime safety gate. Passing it does not authorize removal of legacy KG/Recent SQL or `withLegacyDb` reachability.

## Safety Boundary

The smoke uses three temporary SQLite `:memory:` databases representing core, engine, and legacy access surfaces.

It does not:

- access the real OpenClaw core database;
- access the real memory-engine database;
- reload or reinstall the plugin;
- mutate OpenClaw configuration;
- call the network or an LLM;
- write a runtime report file;
- remove or disable legacy fallback code.

## Production Surfaces

The same matrix is exercised through:

- `auto_recall`;
- `memory_engine_action_search`;
- `memory_engine_search`.

The action and direct-search surfaces use their production tool wrappers. The AutoRecall surface runs the production Hybrid Search implementation and emits the same canonical `hybrid_search_observation` used by the hook.

## Required Matrix

The smoke must pass all checks:

1. Legacy mode executes KG and Recent fallback.
2. Scoped canary hit suppresses KG and Recent fallback.
3. Scoped canary miss restores KG and Recent fallback.
4. Full mode suppresses fallback without canary scope.
5. KG full mode leaves Recent, FTS, and vector available.
6. Recent full mode leaves KG, FTS, and vector available.
7. Full-mode observations emit `runtime_mode=full_fail_closed`, `rollout_scope=full`, `scope_required=false`, and no synthetic scope match.
8. Full-mode events do not increment scoped-canary metrics.
9. Switching back to legacy mode restores fallback immediately.
10. All three production surfaces emit canonical observations.

The fixture records actual legacy SQL calls. A suppressed fallback must have zero matching legacy KG/Recent query executions, not merely an empty result.

## Run

```bash
PATH="$HOME/.local/node24/bin:$PATH" \
~/.local/node24/bin/node bin/run-full-fail-closed-safety-smoke.js --markdown
```

Machine-readable output:

```bash
PATH="$HOME/.local/node24/bin:$PATH" \
~/.local/node24/bin/node bin/run-full-fail-closed-safety-smoke.js --json
```

Focused regression test:

```bash
~/.local/node24/bin/node --test test/full-fail-closed-safety-smoke.test.js
```

## Interpretation

A passing result closes only `F1-D-B8-A5`.

It permits planning a controlled plugin reload and real rollout evidence window. It does not satisfy the B8-A removal gate and does not authorize B8-B legacy fallback deletion.

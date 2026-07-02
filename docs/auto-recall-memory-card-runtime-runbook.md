# AutoRecall Memory Card Runtime Runbook

## Status

P4 closeout runbook.

This document records the P4 memory card / memory object workstream and the operating procedure for the gated card-first autoRecall runtime experiment.

## Summary

P4 introduced a memory object and memory card projection boundary for autoRecall. The project now supports card-first prompt supplements behind an explicit runtime flag. The default runtime behavior remains raw-text autoRecall injection.

The card-first runtime is intentionally conservative:

- default disabled;
- edi-only;
- no DB migration;
- no storage rewrite;
- no retrieval ranking change;
- no automatic `memory_engine_get` call;
- no full content injection;
- no reinforcement from rendering or search;
- cited-id-only reinforcement remains the invariant.

## P4 scope map

### P4.1 Design freeze

Files:

```text
   docs/auto-recall-memory-card-object-model.md
   test/auto-recall-memory-card-object-model.test.js
```

Purpose:

- define memory object envelope;
- define memory card schema;
- define disclosure levels;
- define risk flags and lifecycle exclusion policy;
- define progressive disclosure and cited-id-only reinforcement.

### P4.2 Projection helpers

Files:

```text
   lib/recall/auto-recall-memory-card.js
   test/auto-recall-memory-card.test.js
```

Purpose:

- project retrieval candidates to memory objects;
- project memory objects to memory cards;
- preserve deterministic ids;
- withhold raw-log-like, tool-output-like, dreaming, archived, quarantined, and stale content;
- expose `get_token` without fetching full content.

### P4.3 Replay integration

Files:

```text
   lib/recall/auto-recall-turn-gold-set.js
   test/auto-recall-turn-gold-set-card-projection.test.js
```

Purpose:

- attach read-only `card_projection` to turn gold-set replay results;
- add replay summary counters: `card_expected_count`, `card_projection_count`, and `full_content_on_get_expected_count`;
- keep replay pass/fail semantics unchanged.

### P4.4 Console preview

Files:

```text
   console/services/reports-service.js
   console/views/reports.ejs
   console/public/charts.js
   test/console-reports.test.js
```

Purpose:

- allow `auto-recall-turn-gold-set-replay-YYYYMMDD-HHMMSS.json` reports;
- extract read-only `memory_card_preview` from replay reports;
- show memory cards in Console reports;
- show the preview near the top of `/reports`;
- expose no apply/archive/quarantine/delete/reinforce/get action.

### P4.4b Replay report export checkpoint

Files:

```text
   bin/export-turn-gold-set-replay-report.js
   test/export-turn-gold-set-replay-report.test.js
```

Purpose:

- generate a Console-compatible replay JSON report;
- default to dry-run;
- write only with `--write-report --confirm-write-report WRITE_TURN_GOLD_REPLAY_REPORT`;
- write only allowlisted report filenames.

### P4.5 Gated runtime experiment

Files:

```text
   auto-recall.js
   index.js
   test/auto-recall.test.js
   bin/run-auto-recall-card-runtime-smoke.js
   test/auto-recall-card-runtime-smoke.test.js
```

Purpose:

- add card-first formatter;
- keep default runtime behavior unchanged;
- enable card-first supplement only when explicitly configured;
- make the mode observable through debug metadata;
- validate default raw-text, edi card-first, non-edi raw-text, and raw-log withholding paths.

## Runtime switch

Default behavior:

```text
cardFirstRuntime.enabled is absent or false -> raw_text autoRecall supplement
```

Experimental behavior:

```json
{
  "autoRecall": {
    "enabled": true,
    "cardFirstRuntime": {
      "enabled": true
    }
  }
}
```

Only the default `edi` runtime gate may use this experiment. If the runtime gate resolves a different `agentId`, card-first remains disabled even when the flag is set.

Equivalent snake-case key is accepted for compatibility:

```json
{
  "autoRecall": {
    "enabled": true,
    "card_first_runtime": {
      "enabled": true
    }
  }
}
```

Do not enable this globally for `task-planner`, Codex CLI, background tasks, system chats, tool-output routes, or non-interactive contexts. If `task-planner` appears in the runtime gate, the expected behavior is raw-text mode, not card-first mode.

## Expected runtime behavior

### Default raw-text path

When disabled, autoRecall still uses:

```text
## Auto Recall - relevant memory
```

This is the legacy raw-text supplement path.

### Card-first path

When enabled for `edi`, autoRecall uses:

```text
## Auto Recall - memory cards
```

The supplement contains:

- memory id;
- card title;
- category and kind;
- disclosure level;
- confidence score;
- risk flags;
- card summary;
- salience reason;
- source hint;
- get token.

The supplement must not contain full original memory body text.

## Observability

When autoRecall reaches retrieval and injection, debug metadata includes:

```text
card_first_runtime_enabled
auto_recall_disclosure_mode
```

Expected values:

```text
card_first_runtime_enabled=false, auto_recall_disclosure_mode=raw_text
card_first_runtime_enabled=true,  auto_recall_disclosure_mode=memory_card
```

`memory_injected` event metadata also includes:

```text
card_first_runtime_enabled
disclosure_mode
```

The event type remains `memory_injected` because the runtime still injects an autoRecall prompt supplement. The disclosure mode explains whether the injected supplement was raw text or memory cards.

## Verification commands

Run targeted P4 tests:

```bash
node --test \
  test/auto-recall-memory-card-object-model.test.js \
  test/auto-recall-memory-card.test.js \
  test/auto-recall-turn-gold-set-card-projection.test.js \
  test/console-reports.test.js \
  test/export-turn-gold-set-replay-report.test.js \
  test/auto-recall-card-runtime-smoke.test.js
```

Run runtime-card smoke:

```bash
node bin/run-auto-recall-card-runtime-smoke.js --json
node bin/run-auto-recall-card-runtime-smoke.js --markdown
```

Run replay report export dry-run:

```bash
node bin/export-turn-gold-set-replay-report.js --json
```

Write a Console-visible replay report only when explicitly needed:

```bash
node bin/export-turn-gold-set-replay-report.js \
  --write-report \
  --confirm-write-report WRITE_TURN_GOLD_REPLAY_REPORT
```

Then open:

```text
http://127.0.0.1:8787/reports
```

Expected Console result:

```text
Turn Gold Replay Cards
Memory Card Preview
memory_card_preview cards 5 read-only
```

Run broader relevant checks before enabling the runtime flag:

```bash
git diff --check
node --check index.js
node --test \
  test/auto-recall.test.js \
  test/auto-recall-debug-metadata.snapshot.test.js \
  test/auto-recall-runtime-gate.test.js \
  test/auto-recall-card-runtime-smoke.test.js \
  test/console-reports.test.js
```

## Rollback procedure

Fastest operational rollback:

```json
{
  "autoRecall": {
    "cardFirstRuntime": {
      "enabled": false
    }
  }
}
```

or remove `cardFirstRuntime` entirely.

Code rollback should revert only the P4.5 runtime commit if the issue is runtime-specific:

```text
feat(recall): add gated card-first autoRecall runtime
test(recall): add card runtime smoke
```

Do not revert P4.1-P4.4 unless the object/card/report contract itself is wrong. Projection helpers, replay projections, and Console preview are read-only and safe to keep while runtime card-first is disabled.

## Activation checklist

Before enabling `cardFirstRuntime.enabled` in any real config:

- confirm `autoRecall.enabled` is already intentionally enabled;
- confirm runtime gate allows only `agentId=edi`;
- run `node bin/run-auto-recall-card-runtime-smoke.js --json`;
- run P4 targeted tests;
- generate and review a turn gold-set replay report in Console;
- verify no full body text appears in card-first smoke output;
- verify raw-log/tool-output cards say withheld;
- verify `memory_engine_get:<id>` appears only as a token string;
- verify `card rendered != cited` and `search result != cited` remain documented;
- verify cited-id-only reinforcement tests still pass.

## Do not do

- Do not enable card-first runtime for `task-planner`.
- Do not enable card-first runtime for Codex CLI.
- Do not enable active-memory and memory-engine autoRecall together without a separate dedup plan.
- Do not call `memory_engine_get` automatically from the prompt supplement.
- Do not treat card render, card injection, search result, or Console preview as citation.
- Do not reinforce memory because a card was displayed.
- Do not add destructive Console controls to card preview.
- Do not migrate DB schema for P4.

## Known limitations

- Card titles and summaries are currently projection-time deterministic fallbacks or existing candidate fields, not offline-curated summaries.
- Console card preview uses replay reports, not live runtime traces.
- Runtime card-first is a prompt-supplement experiment, not a full UI interaction model.
- `get_token` is text only; it is not clickable and does not fetch content.
- Full-content access remains explicit through existing memory-engine get/read tooling.

## Next recommended work

P5 should focus on a real, opt-in canary plan instead of broad rollout:

1. add a config sample or documented local-only toggle;
2. run a short `edi` canary session with card-first enabled;
3. inspect `auto_recall_debug` and `memory_injected` events for disclosure mode;
4. compare answer quality and citation behavior against raw-text baseline;
5. decide whether card-first should remain experiment-only or become the default for `edi`.

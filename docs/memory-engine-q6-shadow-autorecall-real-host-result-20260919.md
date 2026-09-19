# Q6-D Exact-Session Real-Host Shadow Observation — Final Report

Date: 2026-09-19

## Final adjudication

```text
Q6-D =
STOPPED / CONSUMED / CLEAN CLOSEOUT

MAX_EXECUTIONS =
1 / 1 consumed

natural turns =
0

runtime shadow evidence =
NONE

mechanism verdict =
NOT REACHED

product-policy verdict =
NO CHANGE / Q6-E NOT READY

next bounded step =
READ-ONLY HOST PLUGIN-METADATA / CONFIG-SCHEMA PUBLICATION DIAGNOSIS
```

## Transaction summary

The authorized Q6-D execution used one exact `main` session:

```text
session_id=01bff721-879f-49bb-85cc-7b7a5c8f67f0
base_source=/home/lionsol/.openclaw/workspace/plugins/memory-engine
```

Four earlier packet attempts stopped before mutation and consumed zero execution. The consumed attempt then reached:

```text
2026-09-19T17:58:56+08:00 PREFLIGHT_BEGIN
2026-09-19T17:59:13+08:00 PREFLIGHT_PASS base_event_id=728
```

After preflight, the packet wrote the exact-session shadow config and attempted the authorized Gateway reload. OpenClaw rejected the config before the shadow runtime could start:

```text
plugins.entries.memory-engine.config.autoRecall:
invalid config: must not have additional properties: "shadow"
```

The packet entered mandatory closeout:

```text
2026-09-19T17:59:33+08:00 CLOSEOUT_BEGIN
2026-09-19T18:00:22+08:00 CLOSEOUT_PASS
```

The machine-readable transaction result was:

```json
{
  "schema": "memory_engine_q6_shadow_autorecall_transaction_result_v1",
  "outcome": "STOPPED",
  "session_id": "01bff721-879f-49bb-85cc-7b7a5c8f67f0",
  "base_source": "/home/lionsol/.openclaw/workspace/plugins/memory-engine",
  "max_executions": 1,
  "max_turns": 6,
  "turns_sent": 0,
  "closeout_ok": true
}
```

## Closeout verification

Independent operator verification after the packet returned showed:

```text
current config SHA256 =
7c78626508387c520fec05e16df1b4afcfd4ee89fe8ec622b94f22fb3f537cf1

pre-config SHA256 =
7c78626508387c520fec05e16df1b4afcfd4ee89fe8ec622b94f22fb3f537cf1

sourcePath =
/home/lionsol/.openclaw/workspace/plugins/memory-engine

Gateway Runtime =
running

Gateway Connectivity probe =
ok
```

Therefore the temporary shadow config was removed exactly, the pre-transaction config bytes were restored, the active source binding remained unchanged, and Gateway health recovered.

## Finding

The frozen Q6 source manifest `openclaw.plugin.json` explicitly declares:

```text
configSchema.properties.autoRecall.properties.shadow
```

with `autoRecall.additionalProperties=false`.

The host startup validator nevertheless rejected `autoRecall.shadow` as an additional property. This excludes a simple Q6 source-schema omission.

The accepted finding is:

```text
SOURCEPATH / INSTALLPATH SCHEMA SPLIT-BRAIN
STALE INSTALLED-EXTENSION MANIFEST PROVEN
```

Read-only follow-up proved:

```text
repo manifest SHA256 = 0ea09bfea5bb5d1f3532ed22c9e0ae9c1cfe64abd785f00a1458b8481b0b0a27
repo autoRecall.shadow = present

installPath manifest SHA256 = 346969a530ac8b6931bd4ec9d624016ca36ae394d47a79f9058bf037f602a735
installPath autoRecall.shadow = absent
```

The installPath hash exactly matches the historical pre-Q6 manifest from `e40186d...`.

Existing OpenClaw 2026.7.1-2 repository audits show that plugin metadata flows through the host `installed_plugin_index`, registry snapshots, and discovery/runtime-loading paths. The stale installed-extension manifest is proven. A corrected direct read-only query of `state/openclaw.sqlite` using the persisted identity field `pluginId` further proved the index contains this exact `memory-engine` plugin metadata:

```text
pluginId = memory-engine
manifestPath = /home/lionsol/.openclaw/extensions/memory-engine/openclaw.plugin.json
manifestHash = 346969a530ac8b6931bd4ec9d624016ca36ae394d47a79f9058bf037f602a735
rootDir = /home/lionsol/.openclaw/extensions/memory-engine
origin = global
enabled = true
packageVersion = 1.0.0
```

The same index row separately records `sourcePath=/home/lionsol/.openclaw/workspace/plugins/memory-engine`. This proves the host metadata is split-brain: installation identity points at the current repo source, while persisted plugin/schema metadata is pinned to the pre-Q6 installed extension manifest. That is sufficient to explain the Gateway config validator rejecting `autoRecall.shadow`. Root-cause attribution is closed; the remaining work is remediation design and separately authorized publication/runtime repair.

## Evidence limitations

No natural turn was submitted after shadow activation because Gateway startup failed before activation completed.

Therefore Q6-D produced no evidence for:

- runtime candidate prevalence;
- `would_inject` prevalence;
- candidate/gate/selection distributions;
- withholding reasons;
- shadow latency;
- apply-suppression behavior on a live natural turn;
- foreign-session isolation under active shadow;
- production false-positive or precision/recall behavior.

The Q6-B/C source and offline mechanism evidence remains valid, but Q6-D neither confirms nor falsifies the real-host shadow mechanism.

## Decision

Do not replay Q6-D under the consumed authorization. The consumed execution packet is intentionally **not** rebound to the post-adjudication Stage Card or repository HEAD; its existing self-binding checks should therefore fail closed on any accidental rerun.

Do not infer a product policy change from this failure.

Before any successor runtime transaction, design and separately authorize a bounded remediation that republishes/synchronizes the installed plugin metadata so the host validates the Q6 manifest rather than the pre-Q6 installPath manifest.

Q6-E remains not ready because the intended runtime-shaped observation evidence was not obtained.

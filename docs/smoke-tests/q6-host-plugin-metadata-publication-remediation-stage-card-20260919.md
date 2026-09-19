# Q6-R1 Host Plugin Metadata Publication Remediation Stage Card — 2026-09-19

> **Status: OWNER AUTHORIZED / ONE-SHOT RUNTIME EXECUTION / SOURCE PACKET + ROLLBACK QUALIFIED**
>
> Owner authorization was granted on 2026-09-19 for exactly one Q6-R1 host plugin metadata publication remediation transaction. This authorizes only the bounded install/recovery operations defined by this card and its bound execution packet. It does not authorize Q6-D replay, shadow activation, natural turns, Q6-D2/Q6-E/Q7, memory-data mutation, push, or tag.

## 1. Decision

Can the proven OpenClaw plugin-metadata split-brain be repaired through one host-owned plugin installation lifecycle so that the installed extension manifest and persisted registry metadata converge on the already-qualified Q6 source manifest, while leaving product configuration and memory data unchanged?

Q6-R1 is a **publication/remediation** stage only. It is not a Q6-D retry and does not collect shadow behavior evidence.

## 2. Proven root cause

Q6-D closed:

```text
STOPPED / CONSUMED / CLEAN CLOSEOUT
NO RUNTIME SHADOW EVIDENCE
```

The real-host failure occurred after Q6-D preflight and temporary shadow-config write, when Gateway config validation rejected:

```text
plugins.entries.memory-engine.config.autoRecall:
invalid config: must not have additional properties: "shadow"
```

Read-only diagnosis proved the following split-brain.

### Repository source manifest

```text
path=/home/lionsol/.openclaw/workspace/plugins/memory-engine/openclaw.plugin.json
sha256=0ea09bfea5bb5d1f3532ed22c9e0ae9c1cfe64abd785f00a1458b8481b0b0a27
autoRecall.shadow=present
```

### Installed extension pre-Q6 runtime

Read-only follow-up proved the installed extension is still the historical pre-Q6 runtime shape:

```text
openclaw.plugin.json
sha256=346969a530ac8b6931bd4ec9d624016ca36ae394d47a79f9058bf037f602a735

lib/config/effective-hybrid-runtime-config.js
sha256=57bd24a41ba6e514549e72c1f5fe745d30cda89c571316c790f23da2d1e2006e

lib/recall/auto-recall-hook-lifecycle.js
sha256=5f75439ea7acb0f0a03e3092f6f460b5ce46f6b70351b610e5beb551354b3a12

lib/recall/auto-recall-shadow.js
ABSENT

autoRecall.shadow schema
ABSENT
```

The installed manifest hash exactly matches the historical pre-Q6 manifest from `e40186d...`.

### Persisted OpenClaw registry metadata

The host-owned `installed_plugin_index` simultaneously records:

```text
installRecords["memory-engine"].sourcePath
= /home/lionsol/.openclaw/workspace/plugins/memory-engine

installRecords["memory-engine"].installPath
= /home/lionsol/.openclaw/extensions/memory-engine

plugins[].pluginId
= memory-engine

plugins[].manifestPath
= /home/lionsol/.openclaw/extensions/memory-engine/openclaw.plugin.json

plugins[].manifestHash
= 346969a530ac8b6931bd4ec9d624016ca36ae394d47a79f9058bf037f602a735

plugins[].rootDir
= /home/lionsol/.openclaw/extensions/memory-engine
```

Therefore:

```text
ROOT CAUSE =
SOURCEPATH / INSTALLPATH SCHEMA SPLIT-BRAIN
+
PERSISTED REGISTRY METADATA PINNED TO PRE-Q6 INSTALLPATH MANIFEST
```

No further root-cause attribution is required before remediation design.

## 3. Fixed source authority

Repository:

```text
REPO=/home/lionsol/.openclaw/workspace/plugins/memory-engine
```

Frozen Q6 runtime source:

```text
Q6 source commit=4f79a8c78fb68bb92294ea78a755293c8b62cbc4
```

Frozen Q6 target hashes:

```text
openclaw.plugin.json
0ea09bfea5bb5d1f3532ed22c9e0ae9c1cfe64abd785f00a1458b8481b0b0a27

lib/config/effective-hybrid-runtime-config.js
61ffb77fead2f4e83265af4d6c7eb28d247c8562ea6771f7fc03fa3df3b2bfb6

lib/recall/auto-recall-hook-lifecycle.js
9baa225f9a94752c94aec6fae92d9e663219a0565ecd0dec2aa35807b6815aa0

lib/recall/auto-recall-shadow.js
ee913beacc1b1ac103283846a82c0e19252240b9faa3e628e4acc21f3173ceef
```

At design freeze, the only non-doc/test file added after `4f79a8c...` is:

```text
bin/q6-shadow-runtime-evidence.js
```

It is a read-only qualification helper and is not part of Gateway plugin startup behavior. No Q6 runtime source file above has changed.

An execution packet must fail closed if these identities change before separately authorized execution.

## 4. Desired repaired host state

A passing Q6-R1 must converge all publication identities:

```text
repo manifest SHA
=
installPath manifest SHA
=
persisted plugins[].manifestHash
=
0ea09bfea5bb5d1f3532ed22c9e0ae9c1cfe64abd785f00a1458b8481b0b0a27
```

And preserve:

```text
install.sourcePath=/home/lionsol/.openclaw/workspace/plugins/memory-engine
install.installPath=/home/lionsol/.openclaw/extensions/memory-engine
plugin version=1.0.0
```

Persisted plugin metadata must resolve to:

```text
pluginId=memory-engine
manifestPath=/home/lionsol/.openclaw/extensions/memory-engine/openclaw.plugin.json
manifestHash=0ea09bfe...
rootDir=/home/lionsol/.openclaw/extensions/memory-engine
enabled=true
```

## 5. Product/config invariants

Q6-R1 must not change product behavior.

Before and after remediation:

```text
autoRecall.enabled=true
autoRecall.topK=3
autoRecall.cardFirstRuntime.enabled=true
autoRecall.agentAllowlist=["main"]
autoRecall.triggerAllowlist=["user"]
autoRecall.chatTypeAllowlist=["interactive_user_chat"]
autoRecall.messageRoleAllowlist=["user"]

autoRecall.shadow absent or enabled=false

explicitSearchRerankProvider.enabled=true
explicitSearchRerankControl.enabled=false

recallHintRuntimeCanary absent/off
```

No shadow session allowlist may remain after Q6-R1.

OpenClaw plugin installation is known to update host bookkeeping `meta.lastTouchedAt`. Config verification must use the existing `memory-engine-config-semantic-equivalence-v1` policy:

- only `meta.lastTouchedAt` may change;
- it must move monotonically forward as canonical UTC;
- every other JSON path must remain equal;
- any other config change is a STOP condition.

## 6. Selected remediation mechanism

The selected forward mechanism is the existing OpenClaw host-owned install lifecycle:

```bash
openclaw plugins install "$REPO" --force
```

using the explicitly resolved Node24/OpenClaw environment.

Reason:

- install lifecycle owns `persistPluginInstall`;
- it commits install records through the host writer;
- it refreshes the plugin registry after mutation;
- it updates the installed extension tree rather than only refreshing stale metadata;
- it avoids direct SQLite writes.

### Rejected alternatives

`openclaw plugins registry --refresh` alone is not selected because the installed extension manifest itself is stale; a refresh could simply republish the same pre-Q6 manifest.

Manual `cp`/rsync of only `openclaw.plugin.json` is not selected because it bypasses OpenClaw install lifecycle and can leave code/package/registry identity inconsistent.

Direct writes to `installed_plugin_index` are forbidden.

`openclaw doctor --fix` is not selected because its repair scope is broader than this proven publication defect.

`plugins update` is not selected for the first remediation design because the current installation source is a local path and the exact update semantics are less direct than reinstalling the already-bound source with `--force`.

## 7. Preflight contract

The authorized execution packet must prove, before the first mutation:

1. Stage Card commit/SHA and clean repository worktree.
2. Current repo path and frozen Q6 hashes from Section 3.
3. Current installed extension still exactly matches the frozen pre-Q6 runtime state from Section 2: manifest/config/lifecycle hashes match and `auto-recall-shadow.js` is absent.
4. Current persisted install record still has repo `sourcePath` and extension `installPath`.
5. Current persisted plugin metadata still has:
   - `pluginId=memory-engine`;
   - `manifestHash=346969a5...`;
   - extension `manifestPath/rootDir`.
6. Gateway is healthy.
7. Current config satisfies Section 5 and shadow is absent/off.
8. Exact pre-config bytes and semantic fingerprint are captured.
9. A bounded immutable rollback snapshot of the current installed extension can be created under `$HOME/.openclaw/backups/memory-engine/q6-r1/`.
10. Static OpenClaw 2026.7.1-2 source review proves local-path `plugins install <path> --force` persists `sourcePath=<path>` and copies to the normal extension `installPath`; `--link` instead sets both sourcePath/installPath to the linked path and cannot be combined with `--force`.
11. No Core/Engine/LanceDB write path is required.
12. The execution packet has a source-reviewed rollback procedure and passes shell/static tests.

Any mismatch stops pre-mutation.

## 8. Proposed one-shot runtime transaction

Execution is **authorized exactly once** under the Owner authorization recorded above, and only through the committed execution packet bound to this Stage Card.

The transaction may perform at most:

1. capture bounded pre-state evidence;
2. create one immutable rollback snapshot of the current installed extension;
3. stop Gateway;
4. run exactly one:
   ```bash
   openclaw plugins install "$REPO" --force
   ```
5. verify installPath manifest, install record, and persisted plugin metadata before Gateway start when possible;
6. start Gateway;
7. verify Gateway/config/plugin identity;
8. run `openclaw config validate` against the normal restored config, with shadow still absent/off;
9. perform no user turn, memory query, AutoRecall probe, shadow activation, or memory tool call;
10. close and report.

```text
MAX_FORWARD_INSTALLS=1
MAX_RUNTIME_EXECUTIONS=1
Q6_SHADOW_ACTIVATIONS=0
NATURAL_TURNS=0
PROVIDER_EXPANSION=0
CORE_ENGINE_LANCE_MUTATIONS=0
```

## 9. Verification gates

A successful Q6-R1 must prove all of the following.

### Publication and runtime parity

```text
repo manifest SHA=0ea09bfe...
installPath manifest SHA=0ea09bfe...
persisted manifestHash=0ea09bfe...

installPath effective-hybrid-runtime-config.js
=61ffb77f...

installPath auto-recall-hook-lifecycle.js
=9baa225f...

installPath auto-recall-shadow.js
=ee913bea...
```

The installed extension manifest must contain the exact Q6 `autoRecall.shadow` schema, and the three Q6 runtime implementation files must match the frozen repo hashes.

### Registry identity

```text
sourcePath=repo
installPath=extension
manifestPath=extension/openclaw.plugin.json
rootDir=extension
version=1.0.0
enabled=true
```

### Runtime source identity

The four frozen Q6 source hashes remain unchanged in the active source.

### Config

The existing semantic-equivalence policy must PASS.

Shadow remains absent/off.

No sibling AutoRecall/rerank setting changes.

### Service

Gateway:

```text
Runtime=running
Connectivity probe=ok
```

### Validation

The normal, non-shadow config validates successfully.

A source-only validation fixture may additionally prove that the repaired installed manifest schema accepts a temporary in-memory/example `autoRecall.shadow` object, but Q6-R1 runtime execution must not write that shadow object to the live config.

## 10. Rollback contract

Rollback is mandatory on any post-mutation failure.

Static review of OpenClaw 2026.7.1-2 closes the rollback mechanics question:

```text
ordinary local-path install:
  sourcePath = exact install input path
  installPath = managed extensions target

--link local-path install:
  sourcePath = linked input path
  installPath = linked input path
  --force + --link = rejected
```

Therefore the already-proven split-brain pre-state (`sourcePath=repo` but old bytes/manifest at extension installPath) cannot and should not be reconstructed as an "exact rollback" through the host lifecycle. Recreating it would deliberately restore the defect Q6-R1 exists to remove.

The rollback target is instead one **coherent safe old runtime**:

```text
ROLLBACK_SNAPSHOT = immutable copy of the pre-Q6-R1 installed extension
rollback manifest hash = 346969a5...
rollback sourcePath = ROLLBACK_SNAPSHOT
rollback installPath = /home/lionsol/.openclaw/extensions/memory-engine
persisted manifestHash = 346969a5...
shadow absent/off
normal config valid
Gateway healthy
```

Concrete rollback implementation:

1. while still pre-forward-install, create one rollback snapshot under `$HOME/.openclaw/backups/memory-engine/q6-r1/<transaction-id>/rollback-extension` using metadata-preserving copy;
2. prove its `openclaw.plugin.json` hash is exactly `346969a5...` and that it is not the live extension path;
3. after any forward-install mutation failure, keep Gateway stopped;
4. run exactly one host-owned `openclaw plugins install "$ROLLBACK_SNAPSHOT" --force`;
5. verify installPath manifest and persisted plugin manifestHash both return to `346969a5...` and persisted `sourcePath` equals the rollback snapshot;
6. start Gateway;
7. verify normal config semantic equivalence, shadow absent/off, Gateway health, version `1.0.0`, and no unexpected product-setting changes;
8. stop further work and report `ROLLED_BACK`.

No direct SQLite write, manual live-extension copy-back, `--link`, or `doctor --fix` is permitted.

This rollback intentionally restores a coherent safe old runtime, not the defective sourcePath/installPath split-brain.

## 11. Stop conditions

Stop pre-mutation if:

- repository or frozen Q6 hashes drift;
- current split-brain no longer matches the proven baseline;
- worktree is dirty;
- config/product switches drift;
- Gateway is unhealthy;
- rollback snapshot cannot be created;
- exact OpenClaw/Node24 paths cannot be resolved;
- execution packet cannot prove bounded rollback.

Stop and rollback post-mutation if:

- install fails or returns ambiguous state;
- installPath manifest does not become `0ea09bfe...`;
- persisted plugin metadata does not become `0ea09bfe...`;
- sourcePath/installPath identity changes unexpectedly;
- config semantic equivalence fails;
- Gateway does not return healthy;
- any memory data mutation is observed or required;
- any shadow activation occurs.

## 12. Explicit non-goals

Q6-R1 does not authorize:

- replay of Q6-D;
- Q6 shadow activation;
- any natural user turn;
- Q6-D2 successor observation;
- Q6-E product decision;
- Q7;
- retrieval/rerank/topK/gate changes;
- provider calls beyond pre-existing startup behavior;
- memory additions/updates/deletes;
- Core/Engine/LanceDB direct mutation;
- direct SQLite registry repair;
- `doctor --fix`;
- push or tag.

## 13. Stage result vocabulary

Use exactly one:

```text
PASS
PASS_WITH_FINDINGS
STOPPED
ROLLED_BACK
```

A PASS means only that host plugin publication/schema identity is repaired.

It does **not** qualify the Q6 real-host shadow mechanism.

## 14. Roadmap after Q6-R1

If the authorized Q6-R1 transaction passes:

```text
Q6-D remains consumed and closed.

Q6-D2 =
possible new exact-session real-host shadow observation
/ separate Stage Card
/ separate Owner authorization
/ not automatic

Q6-E =
still waits for runtime observation evidence

Q7 =
LATER / NOT AUTHORIZED
```

No successor runtime stage inherits Q6-R1 authority.

## 15. Frozen design decision

```text
Q6-R1 =
OWNER AUTHORIZED
SOURCE PACKET + ROLLBACK QUALIFIED
ONE-SHOT RUNTIME EXECUTION AUTHORIZED

selected forward mechanism =
ONE HOST-OWNED FORCE INSTALL FROM CURRENT REPO

manual manifest copy =
REJECTED

direct installed_plugin_index write =
FORBIDDEN

registry refresh alone =
INSUFFICIENT

doctor --fix =
OUT OF SCOPE

shadow activation =
0

Q6-D replay =
FORBIDDEN
```

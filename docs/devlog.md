## 2026-07-20

### F1-D-B8-A7-R2B: synthetic state-DB read-only feasibility harness

Added a synthetic-only `node:sqlite` feasibility harness and report-only CLI. It creates private temporary databases, exercises rollback-journal and WAL/SHM visibility, missing-SHM and WAL-based non-writable-directory behavior, compares normal and immutable readers across a post-open B-to-C writer mutation, rejects INSERT/UPDATE/DELETE/DDL writes, verifies database locations, fingerprints reader phases with BigInt nanosecond metadata, and always removes its temporary root. Exact checkpointed-A, WAL-committed-B, and wal-post-open-C revision markers provide the freshness oracle, and failed opens/queries retain after fingerprints. It accepts no external database or state path and does not import OpenClaw or memory-engine runtime code.

Current boundary:

    B8-A7-R2B synthetic feasibility harness=MODULE-BOUNDARY FIXES IMPLEMENTED / EDI RE-VERIFICATION PENDING
    previous EDI run=FAILED BEFORE HARNESS ENTRY / NON-AUTHORITATIVE
    synthetic syscall trace=NOT AUTHORIZED
    standalone production reader=NOT AUTHORIZED
    real OpenClaw state-DB access=NOT AUTHORIZED
    host remediation execution=NOT AUTHORIZED
    B8-A7 sustained runtime authorization=WITHHELD
    B8-A7 sustained runtime window=NOT AUTHORIZED
    B8-B removal=NOT AUTHORIZED

R2B closure records the synthetic feasibility decision as valid experimental evidence: the harness passed its verification, while the standalone live state-DB reader remains `BLOCKED / ZERO-WRITE OR FRESHNESS NOT PROVEN` due to observable WAL/SHM writes and immutable stale-read behavior. Synthetic syscall tracing is not required for this feasibility decision and remains unauthorized.

### F1-D-B8-A7-R3A: host-published metadata manifest contract

Added a synthetic-only canonical JSON manifest publisher, atomic replacement algorithm, read-only descriptor consumer, installed/absent tombstones, file identity checks, and a CommonJS smoke wrapper with lazy ESM import. No host integration point, real metadata path, production consumer, or real state access has been implemented.

Current boundary:

    B8-A7-R2B synthetic harness verification=PASSED / CLOSED
    B8-A7-R2B standalone read-only live state-DB reader feasibility=BLOCKED / ZERO-WRITE OR FRESHNESS NOT PROVEN
    B8-A7-R3A host-published metadata manifest synthetic contract=IMPLEMENTED / EDI VERIFICATION PENDING
    real host publisher=NOT AUTHORIZED
    production manifest consumer=NOT AUTHORIZED
    real metadata path resolution=NOT AUTHORIZED
    host integration source audit=NOT STARTED
    host remediation execution=NOT AUTHORIZED
    B8-A7 sustained runtime authorization=WITHHELD
    B8-A7 sustained runtime window=NOT AUTHORIZED
    B8-B removal=NOT AUTHORIZED

The first authoritative synthetic evidence record after module-boundary repair was reviewed without rerunning the harness in this documentation checkpoint: Node v24.8.0, module ABI 137, SQLite 3.50.4, and HEAD `908c846`. Missing-database and rollback-journal passed; WAL latest-row and non-writable scenarios observed SHM changes, WAL-without-SHM observed SHM creation, and immutable retained `checkpointed-A` while the normal reader advanced from `wal-committed-B` to `wal-post-open-C`. The filesystem evidence is sufficient to reject the current zero-write design without syscall tracing.

Current boundary:

    B8-A7-R2B synthetic feasibility harness=EXPERIMENTAL EVIDENCE VALID / ASSERTION ALIGNMENT IMPLEMENTED / EDI CLOSURE PENDING
    B8-A7-R2B standalone read-only live state-DB reader feasibility=BLOCKED / ZERO-WRITE OR FRESHNESS NOT PROVEN
    synthetic syscall trace=NOT REQUIRED FOR R2B FEASIBILITY DECISION
    synthetic syscall trace diagnostic execution=NOT AUTHORIZED
    standalone production reader=NOT AUTHORIZED
    real OpenClaw state-DB access=NOT AUTHORIZED
    host remediation execution=NOT AUTHORIZED
    B8-A7 sustained runtime authorization=WITHHELD
    B8-A7 sustained runtime window=NOT AUTHORIZED
    B8-B removal=NOT AUTHORIZED

### F1-D-B8-A7-R2A: OpenClaw no-load plugin metadata source audit

Audited the local OpenClaw 2026.6.9 plugin-registry implementation without executing OpenClaw commands or loading plugin code. The current installed-plugin index resolves through the OpenClaw state directory to state/openclaw.sqlite and reads the installed_plugin_index table. Its snapshot loader performs policy/source/manifest/package staleness checks and falls back to derived plugin discovery when persisted data is missing or stale. The legacy plugins/installs.json path is retired for current storage.

The existing registry/snapshot API is blocked for Phase 0 because readPersistedInstalledPluginIndexFromSqlite() reaches openOpenClawStateDatabase(), which opens DatabaseSync without readOnly=true, ensures state permissions, configures SQLite pragmas, ensures schema, and caches the connection. The complete snapshot path also performs stale checks and can enter derived discovery. SQLite storage alone does not prove plugin loading, and a standalone read-only state-DB reader may be feasible, but its feasibility is not assessed. R2A review fixes are implemented; R2B is not started.

Current boundary:

    B8-A7-R2A existing OpenClaw metadata API=BLOCKED / REVIEW FIXES IMPLEMENTED
    B8-A7-R2B standalone read-only state-DB reader feasibility=NOT STARTED
    host remediation execution=NOT AUTHORIZED
    B8-A7 sustained runtime authorization=WITHHELD / REMEDIATION REQUIRED
    B8-A7 sustained runtime window=NOT AUTHORIZED
    B8-B removal=NOT AUTHORIZED

### F1-D-B8-A7-R1: remediation review fixes implemented

Added the operator runbook and static contract for the withheld sustained-runtime authorization findings. The procedure requires separate evidence for the OpenClaw CLI Node/ABI, gateway Node/ABI, and native dependency ABI; an independent owner-only exact configuration backup; explicit active-memory effective enabled=false; reviewed-source installation under the final gateway runtime; source_runtime_equal=true with difference_count=0; safe initial AutoRecall/KG/Recent/evidence settings; and loaded-runtime preflight before any later authorization review.

The procedure permits only preflight verification in this phase and defines fail-closed stop and byte-for-byte rollback gates. It does not install or reload the plugin, change real configuration, create a scheduler, enable an epoch, call scheduled healthcheck, access databases, generate traffic, or authorize A7/B8-B.

Review fixes now separate original C0 and active-memory-disabled C1 configuration checkpoints, add a prior runtime recovery gate before install/reload, collect CLI identity without a preselected Node path, and assign loaded-host, source/runtime parity, and scheduler inventory facts to separate evidence reports. Configuration-failure, install-failure, and complete-abandonment rollback branches preserve the authorization boundary without requiring C0 restoration to keep active-memory disabled.

Current boundary:

    B8-A7-R1 remediation procedure=NO-LOAD BASELINE FIX IMPLEMENTED / EDI VERIFICATION PENDING
    B8-A7 sustained runtime authorization=WITHHELD / REMEDIATION REQUIRED
    B8-A7 sustained runtime window=NOT AUTHORIZED
    B8-B removal=NOT AUTHORIZED

### F1-D-B8-A7.4: sustained runtime authorization tooling implemented

Implemented the dry-run/report-only tooling required by the sustained runtime authorization review. Added runtime/source parity generation over the accepted runtime dependency closure, auditable AutoRecall product-health evaluation bound to exact injection keys, a plugin-owned `operator.read` scheduled healthcheck limited to the two tool surfaces and grouped by one run identity, raw evidence plus blocking epoch projection, natural traffic forecasting, an exact independent config-backup manifest, a machine-readable authorization/rollback plan, a post-apply activation-baseline finalizer, one-cycle read-only monitoring, and post-rollback verification.

Effective config normalization and the manifest now fail closed when `productionEvidenceWindow.enabled=true` lacks a non-empty `epochId`. The authorization plan requires a clean legacy starting state, clean/fresh parity, a loaded-runtime preflight no more than one hour old, a ready 30-day natural traffic forecast, active-memory explicitly disabled, exact live/backup config byte identity, exact sustained config, and explicit approval for every user-visible or operational change. It separates the normalized evidence snapshot from the manifest-valid OpenClaw merge patch and emits only an inactive baseline template. The separate finalizer emits an active baseline only after post-apply loaded-runtime, raw config-file, epoch, mode, version, build, and parity verification.

Implementation and artifact review found and closed several cross-module contract defects: the initial plan exposed a derived effective config as if writable; product quality review was count-only; rollback consumed `generatedAt` while A5 emits `generated_at`; a backup was not proven to be an independent byte-identical live-config copy; one scheduled surface could satisfy healthcheck freshness; and a pre-apply plan could emit an active baseline. The artifact review then found three additional lifecycle gaps: activation did not bind the post-apply preflight to the exact live config path or reject stale/internally inconsistent plans; active evidence incorrectly began at `authorized_at` instead of `activated_at`; and rollback verification did not require proof that the runtime had actually reached a finalized active baseline. All now fail closed, with direct adversarial tests.

Final implementation review validation:

```text
A7/A7.4 focused tests=171/171 passed
static check=506 files passed
A5 full fail-closed safety smoke=10/10 passed
full suite=1675 tests / 1667 passed / 0 failed / 8 skipped
host-SDK plugin registration integration=passed
code-review-graph parser=tree-sitter-javascript 0.25.0 from the project venv
code-review-graph full snapshot=406 files / 146 flows / 11 communities
code-review-graph affected stored flows=0
code-review-graph heuristic risk=0.85
code-review-graph helper-level test-gap hints=118
```

The graph score is driven by central tiny helpers and callback nodes; it identified no affected stored flow. Load-bearing authorization, config patch, activation baseline, product-health, healthcheck, monitor, exact backup, and rollback paths have direct and end-to-end coverage.

Current boundary:

```text
B8-A7.4=CLOSED / READY FOR SEPARATE SUSTAINED RUNTIME AUTHORIZATION DECISION
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

No real DB mutation, OpenClaw config change, install/reload, scheduler, evidence epoch, healthcheck call, rollback, push, tag, or release was performed.

## 2026-07-19

### F1-D-B8-A7.3: final implementation review closed

Final review accepted implementation checkpoint `cc88825`. The scheduled-healthcheck surface contract now matches the trusted resolver, canonical timestamps reject surrounding whitespace, runtime parity health is separated from parity freshness, product-health freshness is explicit, and monitor freshness includes the overall observation plus all three production surfaces, scheduled healthcheck, parity report, and product-health report.

Independent adversarial checks:

```text
forged auto_recall scheduled-healthcheck validator=invalid / origin_evidence_mismatch
single stale tool surface monitor_freshness_status=stale
runtime parity drift runtime_parity_status=drift
runtime parity drift runtime_parity_freshness_status=fresh
canonical timestamp leading/trailing whitespace=null
focused tests=57/57 passed
static check=467 files passed
A5 smoke=10/10 passed
full suite=1597 tests / 1589 passed / 0 failed / 8 skipped
code-review-graph version=2.3.7
code-review-graph risk score=0.55
code-review-graph affected stored flows=0
code-review-graph helper test-gap hints=5
```

One unrelated `audit-isolated-recent-shadow-cli` privacy assertion failed on the first parallel full-suite run because it searches for the generic substring `1000`; the test passed alone, and two subsequent full-suite runs passed. This is recorded as a non-blocking flaky-test risk rather than an A7.3 regression.

```text
B8-A7.1=CLOSED
B8-A7.2=CLOSED
B8-A7.3=CLOSED / READY FOR A7 RUNTIME AUTHORIZATION REVIEW
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

This closeout authorizes only the next review of sustained runtime configuration, thresholds, monitor cadence, and rollback procedure. It does not authorize enabling `productionEvidenceWindow`, sustained AutoRecall, long-running KG/Recent `full_fail_closed`, a scheduler, or B8-B removal.

### F1-D-B8-A7.3: temporal fix final review changes required

Reviewed implementation checkpoint `3dcd55c`. The original temporal findings are closed: all child evaluators consume the same authorized observation partition, pre-authorization and post-`asOf` rows create stop conditions, future evidence is not fresh, external report timestamps use the shared canonical UTC ISO validator, and incomplete scheduled-healthcheck identity evidence is rejected.

Final adversarial review found three remaining contract defects:

```text
code-review-graph version=2.3.7
code-review-graph risk score=0.60
focused tests=99/99 passed
auto_recall scheduled-healthcheck validator result=valid
trusted resolver result=unknown / non_user_trigger
forged auto_recall healthcheck result=ready_for_removal_gate
canonical timestamp surrounding whitespace accepted=true
stale surface with monitor_freshness_status=fresh
runtime parity drift with runtime_parity_status=fresh
B8-A7.3=REVIEW FIXES IMPLEMENTED / FINAL REVIEW CHANGES REQUIRED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

- `validateHybridTrafficOriginEvidence()` does not restrict `scheduled_healthcheck` to `memory_engine_search` or `memory_engine_action_search`. The trusted resolver cannot emit a scheduled healthcheck for `auto_recall`, but the validator accepts it, and a full synthetic window using that forged freshness row reaches removal readiness.
- `canonicalIsoTimestamp()` trims the input before exact comparison, so timestamps with leading or trailing whitespace are accepted despite the exact canonical contract.
- `monitor_freshness_status` omits per-surface freshness, and `runtime_parity_status` reports only timestamp freshness. Both can say `fresh` while their own stop conditions make the top-level decision `blocked_rollback_required`.

This review did not modify runtime implementation, access databases, install/reload the plugin, enable an evidence epoch, start sustained full mode, or authorize B8-B.

### F1-D-B8-A7.3: implementation review changes required

Reviewed implementation checkpoint `b725dd5`. The composition architecture correctly reuses the accepted identity, continuity, fallback-window, full-rollout, and canonical provenance evaluators, and 75 focused tests pass. `code-review-graph 2.3.7` reported risk 0.55, zero stored-flow impact, and helper-level test gaps around baseline/time/freshness functions. Adversarial review confirmed four evidence-boundary defects that block A7.3 closeout.

```text
pre-authorization 31-day evidence accepted=true
pre-authorization result=ready_for_removal_gate
future-dated observation/parity/product/healthcheck accepted=true
future evidence ages=negative and fresh
non-canonical baseline/report timestamps accepted=true
impossible scheduled-healthcheck identity accepted=true
impossible healthcheck result=ready_for_removal_gate
focused tests=75/75 passed
B8-A7.3=IMPLEMENTED / REVIEW CHANGES REQUIRED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

- `baseline.authorized_at` is format-checked but never bounds the observations supplied to identity, continuity, fallback, full-rollout, or freshness evaluation. A fixture with 31 days of matching observations before authorization plus only a few post-authorization rows returns removal-ready.
- `freshnessStatus()` treats negative ages as fresh. An `asOf` earlier than all canonical observations, parity, product-health, and scheduled-healthcheck reports still returns removal-ready.
- Baseline, parity, product-health, and CLI `asOf` validation use `Date.parse()` rather than the canonical UTC ISO contract already used by observation provenance. Natural-language dates, date-only strings, and normalized impossible dates are accepted.
- Scheduled-healthcheck freshness accepts `traffic_origin_valid=true` and `source=scheduled_healthcheck_wrapper` even when agent/session/tool-call presence is false. That row cannot be produced as valid by the registration-owned resolver but can still satisfy healthcheck freshness and removal readiness.

This review changes only documentation and review state. It does not access real DBs, install/reload the plugin, modify configuration, start the sustained window, execute rollback, or enter B8-B.

### F1-D-B8-A7.3: read-only health monitor implemented

Implemented the A7.3 report-only health monitor and CLI. It composes the existing A7.1 identity, A7.2 continuity/origin, fallback evidence-window, and full fail-closed rollout reports over one observation set. The new layer validates an active authorized baseline, exact epoch/build/config identity, runtime/source parity, product-health status, scheduled-healthcheck freshness, and wall-clock freshness at an explicit `asOf`.

The monitor returns `healthy_collecting`, `insufficient_evidence`, `blocked_rollback_required`, or `ready_for_removal_gate`. Safety conditions such as identity drift, fallback, invalid provenance/schema/origin, full-marker loss, canary leakage, stale monitoring evidence, parity drift, and product rollback health take precedence over ordinary evidence gaps. The CLI is read-only and only recommends rollback; it does not mutate configuration or runtime state.

```text
B8-A7.3 IMPLEMENTED / REVIEW PENDING
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

### F1-D-B8-A7.2: final implementation review closed

Final review accepted implementation checkpoint `47389d3`. The TTL/collision and threshold-input findings are closed: registry cleanup now precedes collision detection, post-TTL `toolCallId` reuse is valid, same-lifetime and scheduled-healthcheck collisions remain fail closed, capacity eviction does not create natural evidence, and decoded threshold JSON is validated before CLI override merging through the same contract used by the evaluator.

Review evidence:

```text
code-review-graph version=2.3.7
code-review-graph changed files=5
code-review-graph risk score=0.65
focused tests=41/41 passed
independent post-TTL unconsumed-entry reuse=natural_agent_tool_call
static check=passed
A5 smoke=10/10 passed
full suite=1574 tests / 1566 passed / 0 failed / 8 skipped
git diff --check=passed
```

Current state:

```text
B8-A7.1=CLOSED
B8-A7.2=CLOSED / READY FOR A7.3
B8-A7.3=NOT STARTED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

This closeout authorizes only A7.3 read-only health monitoring and stop/rollback contract implementation. It does not authorize enabling `productionEvidenceWindow`, sustained AutoRecall, long-running KG/Recent `full_fail_closed`, or B8-B removal.

### F1-D-B8-A7.2: final review changes required

复核 implementation checkpoint `eec0f91`。上一轮四项 finding 已关闭：typed `before_tool_call` origin classification、origin evidence validation、per-surface leading/trailing gap，以及 zero-threshold structural readiness 均通过定向与对抗验证。最终 review 仍发现两个小但会影响长期证据可靠性的边界问题。

```text
expired toolCallId reuse accepted=false
post-TTL reuse result=tool_call_id_collision / unknown
primitive thresholds JSON rejected=false
B8-A7.2=REVIEW FIXES IMPLEMENTED / FINAL REVIEW CHANGES REQUIRED
B8-A7.3=NOT STARTED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

- `createHybridTrafficOriginRegistry.recordBeforeToolCall()` 在执行 TTL cleanup 前读取旧 entry；同一 ID 在过期后合法复用仍被标记 collision。该 observation 会成为 `unknown`，而 unknown origin 会阻塞整个 evidence epoch。
- continuity CLI 对 `--thresholds` 文件先执行 object spread，再检查类型；JSON `null`、数字或布尔值会被静默转换为空 override 并使用默认 thresholds，而不是作为 CLI/input error 返回 64。
- 当前定向 review tests 37/37 通过；上一轮 canonical 对抗输入已验证 bogus origin blocked、missing surface blocked、tool surface 后半窗口消失产生 trailing-gap evidence gaps。实现代码未在本 review 中修改。

本 review 不访问真实 DB、不 install/reload plugin、不修改真实配置、不启动 sustained runtime、不进入 B8-B。

### F1-D-B8-A7.2: review fixes implemented

复核 checkpoint `59a4f3e` 的四项问题已修复，当前等待 review：

- `before_tool_call` origin 只使用宿主 typed contract 的 `agentId/sessionKey/sessionId/runId/toolName/toolCallId`；不再依赖 `trigger`、`toolExecutionSource` 或 `invocationSource`，并通过 registration-owned registry 管理 TTL、容量、consume 和冲突。
- observation 增加 `traffic_origin_valid` 与 `traffic_origin_reasons`；continuity evaluator 对每种 origin 的 trusted source、字段形状、surface 匹配和 validity 做严格校验。
- per-surface gap 同时计算 internal、leading、trailing 和 effective gap；完整 natural window 的边界缺口不能被其他 surface 掩盖。
- threshold override 不能绕过自然 observation、单一 identity 或三个 production surface 的结构性要求；未知 threshold、非法 ratio 和非整数计数输入 fail closed。

```text
B8-A7.2 REVIEW FIXES IMPLEMENTED / REVIEW PENDING
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

### F1-D-B8-A7.2: implementation review changes required

复核 implementation checkpoint `59a4f3e`。A7.2 已新增 traffic-origin metadata、continuity evaluator 和 report-only CLI。当前 Node 24 全量测试实际为 1562 tests、1554 passed、0 failed、8 skipped；实现报告中的 231 pass / 1 unrelated failure 不是当前可复现的全量结果。

Review 确认四项阻塞问题：

1. 当前 OpenClaw `before_tool_call` typed context 仅提供 `agentId/sessionKey/sessionId/runId/toolName/toolCallId` 等字段，不提供 resolver 读取的 `trigger`、`toolExecutionSource` 或 `invocationSource`。因此真实 `natural_agent_tool_call`、`operator_verification_probe` 和 `scheduled_healthcheck` 分支在当前宿主上不可达；
2. continuity evaluator 只验证 `traffic_origin_evidence` 是 object，任意 `{source:"bogus"}` 仍可作为 natural evidence 并得到 ready；
3. per-surface maximum gap 只计算该 surface 内相邻 observation，不计算相对于完整窗口的 leading/trailing boundary gap。构造 31 日窗口时，两项 tool surface 只在前 15 日出现，仍可得到 `continuity_ready`；
4. 将所有 threshold override 设为 0 时，空 observations 会得到 `continuity_ready`、`evidence_epoch_id=null`，违反 ready 必须存在 qualifying identity 和三个 production surface 的不变量。

```text
B8-A7.1=CLOSED / READY FOR A7.2
B8-A7.2=IMPLEMENTED / REVIEW CHANGES REQUIRED
B8-A7.3=NOT STARTED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

本 review 只更新台账与契约，不访问真实 DB、不 install/reload plugin、不修改真实配置、不启动 evidence window、不进入 B8-B。

### F1-D-B8-A7.1: final implementation review closed

Final review accepted implementation checkpoint `caf4373`. The three final guard findings are closed: malformed higher-priority `autoRecall` configuration fails closed without lower-source fallthrough, the Recent canary single-value `token` alias is preserved with malformed values rejected, and runtime dependency validation covers the recursive `index.js` local-import closure plus required filesystem and injected-entry identity scope.

Review evidence:

```text
focused tests=48/48 passed
current repository runtime identity valid=true
runtime identity file_count=131
runtime identity SHA-256 present=true
source worktree clean before closeout docs
```

Current state:

```text
B8-A7.1=CLOSED / READY FOR A7.2
B8-A7.2=NOT STARTED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

This closeout authorizes only A7.2 continuity and traffic-origin tooling. It does not authorize enabling `productionEvidenceWindow`, sustained AutoRecall, long-running KG/Recent `full_fail_closed`, or B8-B removal.

### F1-D-B8-A7.2: continuity and traffic-origin evidence implemented

- 新增 trusted `traffic-origin` resolver：AutoRecall 仅由 `before_prompt_build` trusted `trigger=user` 产生 `natural_user_turn`；tool surface 只有明确的 trusted model-selection/agent-turn context 才产生 `natural_agent_tool_call`，operator probe 和 scheduled healthcheck 分开记录，无法证明时为 `unknown`。
- canonical `hybrid_search_observation` 增加 `traffic_origin`、`traffic_origin_evidence` 和 `traffic_origin_schema_version`，保持 observation `schema_version=1`；tool args、query 和 prompt 不能覆盖 origin。
- 新增只读 `production-evidence-continuity` evaluator/CLI，按单一 A7.1 identity、UTC active days、calendar span、相邻事件最大 gap 和 per-surface continuity 评估；natural denominator 排除 probe、healthcheck、unknown、CLI 和 synthetic rows。
- 默认 continuity thresholds 仅作为 evaluator defaults，不授权生产值：30 日窗口、24 active UTC days、0.8 active-day ratio、72 小时最大 gap、500 natural observations、每 surface 100 条和 15 active days。
- 状态：`B8-A7.2 IMPLEMENTED / REVIEW PENDING`；`B8-A7 sustained runtime window NOT AUTHORIZED`；`B8-B NOT AUTHORIZED`。

### F1-D-B8-A7.1: third implementation review changes required

复核 implementation checkpoint `e607019`。第二轮要求的 root runtime dependency hashing、AutoRecall `topK` compatibility、retrieval-sensitive config fingerprint、environment thresholds 和 malformed field handling 已大体实现，42 个定向测试通过；但最终对抗 review 仍确认三个 fail-closed/compatibility 缺口，因此 A7.1 尚不能关闭，也不能进入 A7.2。

```text
malformed high-priority autoRecall source rejected=false
Recent canary single-value token alias preserved=false
dependency closure guard covers non-lib subdirectories=false
injected fileEntries require declared root runtime files=false
B8-A7.1=REVIEW FIXES IMPLEMENTED / THIRD REVIEW CHANGES REQUIRED
B8-A7.2=NOT STARTED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

具体证据：

- 当 `pluginConfig.autoRecall="bad"`、低优先级 `pluginEntryConfig.autoRecall.enabled=true` 时，resolver 静默跳过非法高优先级值并启用低优先级配置，返回 `valid=true`；这违反高优先级 malformed config 必须 fail closed 的不变量。
- Recent fail-closed policy 支持 `canary.token`、`tokenAllowlist` 和 `tokens`，但 normalized resolver 仅保留后两者。`token` 会被静默丢弃，改变既有 scoped-canary 行为且仍返回 `valid=true`。
- dependency-closure test 对任意包含 `/` 且不位于 `lib/` 的目标直接跳过，未来新增 `runtime/foo.js` 等本地依赖不会触发失败；同时 `buildRuntimeBuildIdentity({ fileEntries })` 只要求三个入口文件，省略全部声明的 root runtime files 仍返回 `valid=true`。

本 review 只更新台账和契约，不修改实现、不访问真实 DB、不 install/reload plugin、不修改真实配置、不启动 A7 runtime、不进入 B8-B。

### F1-D-B8-A7.1: dependency/config closure fixes implemented

完成第二轮 identity closure：runtime identity 纳入声明的根目录 runtime dependency scope 与 `lib/**`，effective config 复用 `getMemoryEngineConfig` 的结果并保留 AutoRecall `topK` fallback；recall/ranking/confidence 和非敏感环境阈值进入 fingerprint，malformed compatibility values 使用安全运行值并使 evidence identity invalid。

```text
B8-A7.1 DEPENDENCY/CONFIG CLOSURE FIXES IMPLEMENTED / REVIEW PENDING
B8-A7.2=NOT STARTED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

### F1-D-B8-A7.1: second implementation review changes required

复核 implementation checkpoint `41892ed`。第一轮要求的 `package.json` 必需文件、runtime symlink fail-closed 和初始 config-source 统一均已实现，34 个定向测试通过；但第二轮对抗 review 仍确认三类 identity 完整性问题，因此 A7.1 尚不能关闭，也不能进入 A7.2。

```text
root-level runtime dependency coverage=incomplete
legacy memoryEngine.recall.topK behavior preserved=false
retrieval-sensitive memoryEngine config fingerprinted=false
malformed compatibility AutoRecall config consistently invalidated=false
B8-A7.1=IMPLEMENTED / SECOND REVIEW CHANGES REQUIRED
B8-A7.2=NOT STARTED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

具体证据：

- `index.js` 与 Hybrid modules 直接或间接依赖根目录 `query-utils.js`、`auto-recall.js`、`memory-manager-runtime.js` 等文件，但当前 runtime identity 只覆盖三个必需入口与 `lib/**`。临时 fixture 修改 `query-utils.js` 后 identity 不变，仍返回 `valid=true`。
- 旧 runtime 在 AutoRecall 未显式配置 `topK` 时读取 `memoryEngine.recall.topK`。对抗输入设置该值为 11，旧行为为 11，新 normalized resolver 将其改成 schema default 3。
- `memoryEngine.recall` / `ranking` 会改变 FTS、vector、Recent、RRF、confidence 和 lexical gate 行为，但这些值变化时当前 `rollout_config_fingerprint` 保持不变。
- compatibility 输入中的非法 `autoRecall.enabled`、`topK`、`timeoutMs` 等没有被一致标记 invalid；部分输入被静默转成不同运行行为，部分非法值继续进入 valid fingerprint。

本 review 只更新台账和契约，不修改实现、不访问真实 DB、不 install/reload plugin、不修改真实配置、不启动 A7 runtime、不进入 B8-B。

### F1-D-B8-A7.1: identity review fixes implemented

实现并验证 A7.1 review fixes：`package.json` 现在是 runtime identity 必需文件，runtime scope 内所有 symlink 均 fail closed，rollout config fingerprint 与实际 normalized effective runtime config 共用同一解析结果，并保留 legacy config source compatibility。当前仍等待最终 review，不授权 A7.2 或 sustained runtime window。

```text
B8-A7.1=REVIEW FIXES IMPLEMENTED / REVIEW PENDING
B8-A7.2=NOT STARTED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

### F1-D-B8-A7.1: implementation review changes required

复核 commit `250435d` 的 evidence epoch、runtime build identity 与 rollout config fingerprint 实现。主要 observation wiring、identity evaluator、CLI 和默认关闭边界方向正确，但 A7.1 尚不能关闭，也不能进入 A7.2。

Review 发现三项 identity 完整性缺口：

1. 删除 `package.json` 后 runtime identity 仍返回 `valid=true`，与 fingerprint 必须覆盖 package manifest 的契约不符；
2. `lib/` 内指向仓库内部目录的 symlink 会被静默跳过，目标 runtime JS 内容变化不会改变 identity；
3. identity fingerprint 使用 `api.pluginConfig || pluginEntryConfig`，而 AutoRecall、KG 和 Recent 的实际运行值仍通过多来源 compatibility chain 解析，因此实际 runtime config 可能变化而 fingerprint 不变。

```text
B8-A7.1=IMPLEMENTED / REVIEW CHANGES REQUIRED
B8-A7.2=NOT STARTED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

本 review 仅执行 repository 只读检查、纯临时目录对抗验证和定向测试；未访问真实 DB、未安装或 reload plugin、未修改真实配置、未开启 production evidence window、未进入 B8-B。

### F1-D-B8-A7: sustained production evidence-window authorization review

Stage 4 已完成 controlled runtime closeout，但 30 天 production evidence window 暂不授权。评审确认现有 30 天 / 500 条 / 每 surface 100 条门槛缺少长期证据治理，直接开启 full mode 会产生不可审计窗口。

阻塞项：

```text
A7.1 evidence epoch / installed runtime identity / rollout config fingerprint
A7.2 active-day continuity / maximum gap / per-surface span / traffic origin
A7.3 read-only health monitor / machine-readable stop and rollback status
```

当前 observation schema 未绑定 reviewed deployment，无法防止 30 天内不同 runtime 版本被合并。现有 evaluator 只用首尾时间计算窗口，无法识别长时间断档。gateway `/tools/invoke` operator probes 与自然 agent tool calls 也没有来源分类，不能让人为探针静默满足 production denominator。

新增设计 runbook：

```text
docs/smoke-tests/full-fail-closed-production-evidence-window.md
```

授权边界：

```text
B8-A7 design/tooling=AUTHORIZED
B8-A7 sustained runtime window=NOT AUTHORIZED
long-running autoRecall.enabled=true=NOT AUTHORIZED
long-running KG/Recent full_fail_closed=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

下一步先实现 B8-A7.1。该阶段只允许 observation metadata、report-only evaluator、测试和文档，不访问真实 DB、不修改 runtime config、不 reload gateway、不产生人为 production denominator、不执行 memory mutation、不进入 B8-B。

### F1-D-B8-A6 Stage 4: final runtime rerun closeout

完成 reviewed commit `6aa26e4` 的最终三 surface runtime rerun 与证据复核，Stage 4 正式关闭。

权威 evidence window 产生：

```text
auto_recall=2
memory_engine_search=1
memory_engine_action_search=1
KG full markers=4/4
Recent full markers=4/4
legacy fallback events=0
channel errors=0
invalid provenance=0
unknown/unsupported/partial events=0
canary leakage=0
```

所有 KG/Recent full observation 均显式满足：

```text
runtime_mode=full_fail_closed
rollout_scope=full
scope_required=false
scope_match=null
legacy_db_fallback_used=false
legacy_db_fallback_channels=[]
```

controlled-run evaluator：

```text
status=insufficient_evidence
controlled_run_surface_coverage_status=complete
missing_controlled_run_surfaces=[]
controlled_run_closeout_eligible=true
controlled_run_blockers=[]
blockers=[]
```

`insufficient_evidence` 只对应独立的 30 天 / 500 条 / 每 surface 100 条 production window 阈值，不阻塞短时 controlled-run closeout。

回滚后双通道恢复 legacy 配置，新 `memory_engine_search` observation 无 full marker residue，source/runtime parity 为零，post-rollback A5=10/10。未发生 Core DB 直接访问、memory mutation、fallback removal、push、tag 或 release。

最终状态：

```text
B8-A6 Stage 4=CLOSED / PASS
B8-A6.5=CLOSED / RUNTIME VERIFIED
B8-B removal=NOT AUTHORIZED
```

下一步只能是单独评审并授权 sustained production evidence window；Stage 4 PASS 本身不授权 B8-B。

### F1-D-B8-A6.5: implementation review closeout

完成 `202c9b2` 与 `899edce` 的实现级 review。三项 review finding 已关闭：required `agentAllowlist` / `triggerAllowlist` 显式空数组 fail closed；KG/Recent full marker 必须显式包含 `scope_match=null`；`legacy_db_fallback_used` / `legacy_db_fallback_channels` 已纳入统一 fallback 事实源并与 controlled-run eligibility 对齐。

验证结果：

```text
focused review tests=63/63
static-check files=445
A5 safety smoke=10/10
git diff --check=passed
```

决策：

```text
B8-A6.5=CLOSED / READY FOR RUNTIME RERUN
B8-A6 Stage 4=AUTHORIZED / FINAL RUNTIME RERUN REQUIRED
B8-B=NOT AUTHORIZED
```

本 review 未访问真实 DB、未修改 runtime 配置、未 reload gateway、未产生真实 observation、未执行 memory mutation、未进入 B8-B。

### F1-D-B8-A6.5: hook-contract-compatible AutoRecall gate

修复 AutoRecall runtime gate 与当前 OpenClaw `before_prompt_build` hook contract 的不匹配。真实 hook 提供 `event.prompt/messages` 以及可信 context 的 `agentId`、`sessionId` 和 `trigger`，不保证 `chatType` 或 `messageRole`。gate 现在以 `agentAllowlist` 和默认 `triggerAllowlist=["user"]` 作为 default-deny 边界；heartbeat、cron、memory、budget、manual、timeout recovery 和 overflow 等非用户 trigger 继续拒绝。

`chatTypeAllowlist` 与 `messageRoleAllowlist` 保留配置兼容性，但仅在 host/event 显式提供字段时执行补充校验，缺失不再产生 `denied_missing_chat_type` 或 `denied_missing_message_role`。manifest 默认仍为 `agentAllowlist=["edi"]`、`triggerAllowlist=["user"]`，没有扩大默认 agent，也没有修改真实 runtime 配置。

同时，full fail-closed rollout evidence 增加 controlled-run surface coverage contract。`auto_recall=0` 会明确产生 `missing_surface:auto_recall`，并设置 `controlled_run_closeout_eligible=false`，而不改变现有 30 天 production window 的 threshold 语义。A6.5 完成后仍需由 edi 重新执行 Stage 4 三 surface runtime verification；B8-B 仍未授权。

Review follow-up 收紧了三个边界：空 `agentAllowlist` 返回 `denied_by_agent_allowlist`，空 `triggerAllowlist` 返回 `denied_by_trigger_allowlist`，两者的显式空数组均 fail closed；KG/Recent full marker 必须显式包含 `scope_match=null`，不能从 `scope_required=false` 推断；`legacy_db_fallback_used` 与 `legacy_db_fallback_channels` 进入统一 fallback 事实源，无法归属 channel 的 fallback 仍阻塞 closeout。controlled-run eligibility 不能在任何 safety blocker 存在时为 true。Stage 4 仍待 edi 重跑，B8-B 仍未授权。

#### B8-A7.1 evidence epoch and deployment identity

- 新增一次性 installed-runtime SHA-256 fingerprint，覆盖 `index.js`、manifest、package metadata 和 `lib/` runtime files；docs/test 变化不会改变 identity，缺失入口或逃逸 symlink 会使结果 invalid。
- 新增 canonical rollout-config fingerprint 与显式 `productionEvidenceWindow.enabled/epochId` contract。三个 canonical production observation surfaces 记录 epoch、runtime build、config fingerprint 和 enabled marker；tool params 与 query 不能覆盖这些字段。
- 新增 report-only identity audit，拒绝 disabled/pre-A7 rows、缺失或非法 identity、invalid provenance 及 mixed epoch/build/config。A7.1 为 `CLOSED / READY FOR A7.2`，sustained runtime window 与 B8-B 仍未授权。

### F1-D-B8-A6 Stage 4: final config-only rerun and host-contract mismatch review

完成 `f52235e` 后的最终 config-only Stage 4 rerun review。该次运行保持 repository 与 installed runtime source 不变，正式配置接受 `autoRecall.agentAllowlist=["edi","main"]`，但仍无法产生 AutoRecall observation。

#### Runtime evidence

```text
auto_recall=0
memory_engine_search=2
memory_engine_action_search=1
KG full markers=3/3
Recent full markers=3/3
fallback events=0
channel errors=0
invalid provenance=0
rollback observation=1
post-rollback A5=10/10
```

#### Root cause verification

本地 OpenClaw plugin SDK 类型与 harness 调用点确认：

```text
PluginHookBeforePromptBuildEvent={prompt,messages}
PluginHookAgentContext includes agentId/sessionId/messageProvider/channel/senderId/trigger
before_prompt_build event/context do not expose chatType or messageRole
normal user run trigger="user"
heartbeat/cron/memory/budget use distinct trigger values
```

memory-engine 的 runtime gate 在 `before_prompt_build` 上强制要求 `chatType` 和 `messageRole`，因此所有真实 main-session turn 都以 `denied_missing_chat_type` 提前退出。B8-A6.4 只解决了 manifest schema 对 allowlist config 的拒绝，无法创造宿主 hook 不提供的字段。

该问题应归类为 plugin/host hook contract mismatch，而不只是缺少 Telegram、webchat 或其他外部会话基础设施。

#### Decision

```text
B8-A6 Stage 4=INCONCLUSIVE / OPEN
B8-A6.4 runtime-gate config contract=CLOSED / INSUFFICIENT
B8-A6.5 hook-contract-compatible AutoRecall gate=OPEN / REQUIRED NEXT
B8-B removal=NOT AUTHORIZED
```

B8-A6.5 应围绕宿主实际提供的可信字段设计 default-deny gate，优先使用 `ctx.agentId` 和 `ctx.trigger`，显式拒绝 heartbeat、cron、memory、budget、缺少 identity 和非用户 trigger；若未来宿主显式提供 chat/role 字段，可作为附加约束而不是当前 hook 的必填前置。还应补 controlled-run surface coverage contract，使 `auto_recall=0` 在 Stage 4 closeout 审计中明确阻塞，而不是只作为 30 天窗口阈值 gap。

### F1-D-B8-A6.4: AutoRecall runtime-gate config contract

Stage 4 clean rerun 保持 reviewed source/runtime 不变，并成功验证 KG/Recent 双通道 full markers、两个 tool surfaces、零 fallback/error/provenance violation 和真实 rollback；但 `auto_recall=0`，因此整体结论为 `INCONCLUSIVE`。

原因是当前可用 session 入口无法同时满足默认 gate：

```text
agent=edi
chat_type=interactive_user_chat
role=user
```

运行时代码原本已经支持以下 config override：

```text
agentAllowlist
chatTypeAllowlist
messageRoleAllowlist
```

但 `openclaw.plugin.json` 的 `autoRecall.additionalProperties=false` 且未声明这些字段，因此无法通过正式 schema 做 config-only rerun。

本阶段将三个字段加入官方 manifest schema，默认值保持不变：

```text
agentAllowlist=["edi"]
chatTypeAllowlist=["interactive_user_chat"]
messageRoleAllowlist=["user"]
```

该变更不扩大生产默认行为。下一次受控 rerun 可以临时将 `main` 加入 `agentAllowlist`，保留 `interactive_user_chat` 和 `user` 两个 gate，使用真实 main interactive user turn 产生 AutoRecall observation，并在完成后恢复原配置。禁止修改 repository 或 installed-runtime source。

Stage 状态：

```text
Stage 4 clean rerun=INCONCLUSIVE / AUTO_RECALL SURFACE MISSING
B8-A6.4 runtime-gate config contract=CLOSED
Stage 4 next rerun=CONFIG-ONLY AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

### F1-D-B8-A6 Stage 4: first runtime attempt evidence review

完成首次 Stage 4 runtime attempt 的证据 review。该次运行产生五条 canonical observation，并成功验证双通道 rollback，但不能关闭 Stage 4。

#### Valid runtime findings

```text
auto_recall=3
memory_engine_search=1
memory_engine_action_search=1
KG full markers=5/5
Recent full markers=5/5
legacy fallback events=0
channel errors=0
invalid event provenance=0
rollback observation=1
post-rollback A5=10/10
```

当前配置已恢复：

```text
agent:main model=deepseek/deepseek-v4-flash
autoRecall.enabled=false
kgFailClosedMode=legacy_fallback
recentFailClosedMode=legacy_fallback
KG/Recent canary enabled=false
```

#### Evidence integrity failure

运行期间曾临时修改 `auto-recall-runtime-gate.js`，扩展 agent allowlist 并关闭 chat-type/role gate，以产生 AutoRecall observation。虽然该文件随后恢复，最终 Git clean 且 reviewed checkout 与安装副本重新一致，但恢复后的 parity 不能证明 evidence window 使用的是 reviewed commit。

因此：

```text
Stage 4 functional wiring observed=true
Stage 4 event-level provenance valid=true
Stage 4 reviewed-runtime provenance=false
Stage 4 closeout=REJECTED
Stage 4 rollback=PASS
Stage 4 clean rerun=REQUIRED
B8-B removal=NOT AUTHORIZED
```

clean rerun 必须保持 repository 和 installed runtime source 全程不变，只允许配置修改。AutoRecall 应通过 reviewed gate 已允许的 `edi` interactive user session 触发，不得再次修改 allowlist、chat-type、role 或其他 runtime gate，也不得直接写 telemetry。

### F1-D-B8-A6 Stage 4: Recent full rollout authorization review

完成 Stage 4 的 operator authorization review，但尚未执行真实 runtime rollout。

#### Authorization basis

- 用户在确认 B8 属于 P0-A / F1-D Hybrid DB isolation 主线后，明确要求继续后续工作。
- 已关闭的前置阶段：
  - B8-A5 safety smoke；
  - B8-A6 Stage 1 KG scoped canary；
  - B8-A6 Stage 2 KG full rollout；
  - B8-A6 Stage 3 KG rollback；
  - B8-A6.3 observation provenance hardening。
- Stage 4 受控 runbook 已定义双通道 full markers、三 surface evidence、stop conditions、canonical export、evidence evaluator 和 rollback discipline。

#### Review validation

Node 24 targeted authorization review：

```text
103 tests
103 passed
0 failed
```

覆盖：

- manifest/config full fail-closed contract；
- A5 deterministic safety smoke；
- KG/Recent full-mode channel isolation；
- Recent fail-closed runtime policy；
- Recent readiness/review/expansion evaluators；
- Recent rollback validation；
- canonical observation provenance；
- full-rollout evidence evaluator；
- legacy removal gate continued blocking。

#### Decision

```text
B8-A6 Stage 4 Recent full rollout=AUTHORIZED / PENDING RUNTIME EXECUTION
B8-B legacy fallback removal=NOT AUTHORIZED
```

Stage 4 必须由 edi 按受控 runbook 执行真实 runtime rollout：先备份配置和确认 source/runtime parity，双通道切换到 `full_fail_closed`，执行三 production surfaces，导出 canonical evidence，要求零 fallback/error/schema/marker/provenance violation，然后恢复双通道 `legacy_fallback` 并验证真实 rollback。

本阶段只更新 authorization ledger 和测试契约，没有修改 runtime config、没有 reload gateway、没有访问真实 DB、没有 memory mutation、没有执行 Stage 4、没有授权 B8-B、没有 push。

### F1-D-B8-A6.3: Hybrid observation provenance hardening

完成 Hybrid production observation provenance 的统一校验与决策链接入，修复“metadata marker 正确但并非真实 runtime observation”仍可能进入 production evidence 的缺口。

#### Trigger

- Stage 2 首次尝试因 `agent:main` 的直连 DeepSeek route credits 不足，真实 AutoRecall turn 失败。
- 随后曾直接插入一条 AutoRecall-shaped telemetry row：`id=11087`。
- 该行具有 full markers，但缺少：
  - `source`
  - `session_id`
  - `trace_id`
  - `metadata.completed_at`
- 原 marker audit 和 metrics 只验证 metadata 字段，因此可能把该行误计为 production evidence。
- 修正后的 Stage 2 retry 已使用真实 `opencode/deepseek-v4-flash` agent turns，产生两条完整 `hybrid.auto_recall` observation；`id=11087` 不属于 authoritative evidence。

#### Shared provenance contract

新增：

```text
lib/recall/hybrid/hybrid-observation-provenance.js
docs/hybrid-observation-provenance.md
```

所有 production observation 必须满足：

```text
event_type=hybrid_search_observation
source=hybrid.<surface>
schema_version=1
search_executed=true
completed_at=canonical UTC ISO
trace_id=present
```

AutoRecall 额外要求非空 `session_id`；gateway tool surface 允许 session 为空，但 trace 和 exact source 必须存在。

#### Decision integration

统一 validator 已接入：

- Console Hybrid fallback metrics；
- scoped-canary evidence evaluator；
- fallback evidence window；
- full fail-closed rollout evidence；
- tool-surface runtime access audit；
- legacy fallback removal gate。

无效 observation：

- 保留在历史 telemetry 中；
- 不进入 production denominator、fallback count、canary/full count；
- 输出 `invalid_provenance_observation_count`；
- 输出可用 event IDs 和 reason distribution；
- 阻塞 canary、rollout、evidence-window 和 removal 决策。

#### Historical contamination handling

- 不自动删除或改写 `id=11087`。
- 该行现在会因 `source_mismatch`、`invalid_completed_at`、`missing_trace_id`、`missing_auto_recall_session_id` 被隔离。
- 长窗口统计和 removal evidence 不再依赖人工记忆排除该记录。

#### Validation

- focused provenance / metrics / canary / full rollout / evidence-window / tool audit / removal-gate tests：101/101 passed。
- documentation contract tests：31/31 passed。
- `npm run check`：`static check passed: 444 files`。
- A5 full fail-closed safety smoke：10/10 passed。
- 全量 Node 24 suite：1484 tests，1476 passed，0 failed，8 skipped。
- 本阶段不访问真实 DB、不修改 runtime config、不 reload gateway、不执行 memory mutation、不进入 Stage 4 或 B8-B。

## 2026-07-18

### F1-D-B8-A5/A6: Full fail-closed rollout readiness and Stage 1 evidence closure

完成 Hybrid Search full fail-closed 的确定性安全矩阵、受控 runtime rollout 准备、KG scoped-canary evidence tooling，以及真实 tool-surface runtime access audit。当前 Stage 1 observation evidence 已满足进入 Stage 2 review 的条件，但 legacy fallback removal 仍未授权。

#### A5 deterministic safety smoke

- 新增全 fail-closed synthetic safety smoke，覆盖 KG / Recent：
  - `legacy_fallback`
  - `shadow_fail_closed`
  - `fail_closed_canary`
  - `full_fail_closed`
- 覆盖三个 production surface：
  - `auto_recall`
  - `memory_engine_action_search`
  - `memory_engine_search`
- 验证 suppression、scope isolation、full rollout markers、rollback 和 observation/metrics 边界。
- A5 只使用 synthetic SQLite fixture，不访问真实数据库或 runtime。

#### A6 runtime readiness

- manifest 正式暴露 KG / Recent fail-closed mode 与 canary 配置，默认保持 `legacy_fallback`。
- runtime 配置优先读取官方 `api.pluginConfig`，保留兼容读取路径。
- 新增 readonly canonical observation exporter、full rollout evidence evaluator 和受控 rollout runbook。
- Stage 0 在真实 OpenClaw runtime 中通过：
  - 插件安装/reload 成功；
  - manifest schema 正常；
  - `memory_engine` / `memory_engine_search` / `memory_engine_get` 注册正确；
  - memory-core 工具所有权未被覆盖；
  - source/runtime 副本零差异；
  - KG / Recent 均保持 `legacy_fallback`。

#### Stage 1 KG scoped canary

- 可信 main/EDi session 产生 6 条 canonical `auto_recall` observation。
- 6/6 命中：
  - `kg_runtime_mode=fail_closed_canary`
  - `kg_rollout_scope=scoped_canary`
  - `kg_scope_required=true`
  - `kg_fail_closed_scope_match=true`
- Recent 始终为 `legacy_fallback`；full-mode marker 和 channel error 均为零。
- 健康 isolated KG topology 没有自然 fallback opportunity，因此不通过破坏真实 DB、TEXT-ID invariant、capability 或 SQL 路径制造 fallback。A5 synthetic smoke 继续负责 suppression branch 的确定性证明。

#### A6.1 scoped-canary evidence tooling

新增：

- `bin/audit-scoped-fail-closed-canary-evidence.js`
- `bin/summarize-hybrid-search-observations.js`
- `lib/recall/hybrid/scoped-fail-closed-canary-evidence.js`

Evaluator 将证据拆成：

```text
scope_status
suppression_status
surface_coverage_status
isolation_status
```

支持状态：

```text
canary_suppression_confirmed
canary_scope_confirmed_no_fallback_opportunity
canary_scope_not_confirmed
canary_safety_violation
```

明确 `stage2_review_eligible` 只代表 observation evidence，不能替代 A5、baseline rollback 或 operator approval。

#### A6.2 tool-surface runtime access audit

真实 OpenClaw 审计发现：

- `tools.catalog` 中 memory-engine 三工具注册完整；
- `tools.effective` 中 main agent 使用 `tools.profile=coding`，memory-engine 工具不在模型可见集合；
- 这解释了 Stage 1 assistant 无法主动调用工具，不是 plugin wrapper 或 observation writer 故障。

没有切换全局 `full` profile，也没有持久增加 `alsoAllow`。改用官方 gateway `tools.invoke`：

- 经正式 gateway registry、policy 和 `before_tool_call` hook；
- 实际执行 `memory_engine_search`；
- 实际执行 `memory_engine action=search`；
- 两次均 `ok=true`、`source=plugin`、返回结构正常；
- 产生两条 canonical production observation；
- 未执行 get/cite/add/update/archive/delete/reinforce。

当前 tool-surface audit：

```text
status=tool_surface_runtime_confirmed_effective_filtered
registry_status=complete
effective_profile=coding
effective_visibility_status=missing
invocation_mode=gateway_rpc
invocation_status=complete
production_surface_execution_confirmed=true
model_visibility_confirmed=false
stage1_tool_surface_coverage_ready=true
```

#### Combined Stage 1 evidence

canonical evidence：

```text
auto_recall=6
memory_engine_action_search=1
memory_engine_search=1
observed_hybrid_events=8
```

最终 evaluator：

```text
status=canary_scope_confirmed_no_fallback_opportunity
scope_status=confirmed
suppression_status=no_opportunity
surface_coverage_status=complete
isolation_status=clean
violations=0
evidence_gaps=0
stage2_review_eligible=true
```

metrics：

```text
kg_fail_closed_canary.enabled_events=6
kg_full_fail_closed_events=0
recent_full_fail_closed_events=0
recent_fail_closed_canary_runtime.enabled_events=0
unknown_surface_events=0
unsupported_schema_version_events=0
```

#### Node runtime finding

- 默认 shell Node 22 使用 ABI 127。
- 当前安装的 `better-sqlite3` 为 Node 24 ABI 137。
- 直接在 Node 22 下运行 OpenClaw CLI 可能出现 native module mismatch；受控 rollout 命令必须显式使用 Node 24 PATH。

#### Documentation and stage gate

- 新增 `docs/hybrid-fail-closed-rollout-status.md` 作为 current rollout ledger。
- 更新 docs index 和 smoke runbook 导航。
- Stage 2 已获得 operator 授权，执行范围仅限 KG `full_fail_closed`、三个 production surface evidence 和强制 Stage 3 rollback。
- Recent full rollout 与 B8-B legacy removal 均未授权。

#### Commits and validation

```text
e8e4eec feat(recall): add full fail closed safety smoke
a0d1bb9 feat(recall): prepare controlled full fail closed rollout
17a90a3 feat(recall): add scoped canary evidence tooling
4a8d7a5 feat(recall): audit runtime tool surface access
```

最近验证：

- focused tests：40/40 passed；
- static check：440 files passed；
- full Node 24 suite：1456 passed，0 failed，8 skipped；
- worktree clean；未 push。

## 2026-07-19

### F1-D-B8-A6 Stage 2 KG full rollout and Stage 3 rollback closeout

完成 KG `full_fail_closed` 的真实 runtime wiring 验证和强制 rollback drill。

#### Corrected Stage 2 production evidence

首次尝试中，`agent:main` 显式配置为 `deepseek/deepseek-v4-flash`，该直连 DeepSeek API 路由 credits 不足，导致 `openclaw agent` 无法完成真实 AutoRecall turn。随后曾写入一条合成 `auto_recall` telemetry row；该事件 `id=11087` 缺少 `source`、`session_id`、`trace_id` 和 `metadata.completed_at`，不作为 production evidence。

为完成真实验证，临时将 `agent:main` model 改为 `opencode/deepseek-v4-flash`。Agent result metadata 确认 provider 为 `opencode`，AutoRecall turn 成功。完成后已恢复原模型 `deepseek/deepseek-v4-flash`。

纠正后的 authoritative Stage 2 export 包含 4 条 canonical runtime observation：

```text
auto_recall=2
memory_engine_search=1
memory_engine_action_search=1
```

全部满足：

```text
event_type=hybrid_search_observation
source=hybrid.<surface>
search_executed=true
kg_runtime_mode=full_fail_closed
kg_rollout_scope=full
kg_scope_required=false
kg_fail_closed_scope_match=null
recent_runtime_mode=legacy_fallback
legacy_db_fallback_channels=[]
channel_error_count=0
```

两条 AutoRecall observation 均具有非空 `session_id`、`trace_id` 和有效 `metadata.completed_at`。KG fallback、Recent full/canary、unknown surface、unsupported schema 和 marker violation 均为零。

#### Stage 3 rollback

Stage 2 evidence collection 后恢复原配置并 reload gateway：

```text
agent:main model=deepseek/deepseek-v4-flash
autoRecall.enabled=false
kgFailClosedMode=legacy_fallback
kgFailClosedCanary.enabled=false
recentFailClosedMode=legacy_fallback
recentFailClosedCanary.enabled=false
```

Rollback search 产生真实 `hybrid.memory_engine_search` observation，未出现 KG full marker residue。Post-rollback A5 smoke 10/10 通过。

#### Runtime and repository verification

- `openclaw plugins inspect memory-engine --runtime --json` 返回 runtime install path：`~/.openclaw/extensions/memory-engine`。
- 源码与 runtime 副本零差异。
- memory-engine 三工具仍注册：`memory_engine`、`memory_engine_search`、`memory_engine_get`。
- Git 工作树 clean。
- 文档中的旧 `../../extensions/memory-engine` 相对路径已纠正为 inspect 返回的实际路径。

#### Decision

```text
Stage 2 KG full rollout: PASS
Stage 3 KG rollback: PASS
Stage 4 Recent full rollout: review eligible, not authorized
B8-B legacy fallback removal: not authorized
```

在 Stage 4 前安排 B8-A6.3 observation provenance hardening：长窗口 metrics 和 rollout/removal evaluator 必须拒绝或显式排除 canonical envelope 与声明 surface 不匹配的行，防止首次尝试中的合成 row 污染未来 30 天 evidence window。

## 2026-07-17

### Architecture documentation governance and release-version policy

完成仓库总架构/治理文档入口、根 README 现状化和发布版本治理。

#### Documentation authority and navigation

- 新增 `docs/README.md`，作为架构、契约、ADR、治理规则、runbook、audit、plan 与 historical 文档的统一入口。
- 建立文档权威层级：
  1. 代码与自动化测试；
  2. Accepted ADR / Current contract / Policy；
  3. Runbook；
  4. Design-only / Plan；
  5. Audit / Baseline；
  6. Historical。
- 增加按修改区域的最短阅读路径，覆盖 OpenClaw 集成、entrypoint、DB/schema、Hybrid Search、AutoRecall、质量治理、数据清理、Console 和 runtime verification。
- 明确 `docs/architecture.txt`、`docs/dataflow.txt` 仅为速览，不是权威事实源；`docs/openclaw_memory_v0.1.md` 与早期 AutoRecall plan 属于历史材料。
- 新增 `test/docs-index.test.js`，锁定根入口、权威层级、关键治理链接及本地 Markdown 链接完整性。

#### Root README current-state rewrite

- 根 README 标题改为无版本的 `Memory Engine for OpenClaw`，不再硬编码易漂移的发布号。
- 重画当前架构边界，补充：
  - `memory-core` substrate 与 `memory-engine` enhancement/governance layer；
  - `memory_search` / `memory_get` 与 `memory_engine_search` / `memory_engine_get` 的工具所有权；
  - Core DB readonly、Engine DB writable、LanceDB vector index；
  - canonical action/service layer；
  - AutoRecall intent/runtime/eligibility gates；
  - current-turn reinforcement allowlist；
  - checkpoint、质量审计、人工标注和 Console 治理层。
- 删除已失真的固定算法描述，包括固定四通道、`0.7 * similarity + 0.3 * confidence` 和固定 `0.55` 门槛。
- 当前检索描述改为：查询归一化 → KG/FTS lexical-first → lexical confidence 决定 vector skip → Recent/fallback → dynamic-channel RRF → configurable boosts → eligibility/pollution gate → tool output 或 AutoRecall injection。
- 参数权威来源指向 `lib/recall/hybrid-search.js`、`lib/recall/hybrid/fusion.js`、`lib/config/defaults.js` 与 `lib/memory-confidence.js`。
- 新增 `test/readme-current-architecture.test.js`，防止旧版本号、旧架构图语义和旧排序公式回归。

#### Release-version governance

- 确认当前主线最新正式发布版本为 `v0.8.22-memory-process-boundary-audit`；今天尚未发布的提交继续视为 `0.8.22` 之后的 unreleased changes，不提前声明为 `0.8.23`。
- 仓库中旧 `v1.0.0` / `v1.0.1` / `v1.0.2` 标签不在当前 HEAD 祖先链上，因此不得通过“全仓库 SemVer 最大值”识别当前版本。
- 当前发布标签解析采用当前提交可达的最近标签，版本语义取标签前缀 `vX.Y.Z`。
- `package.json`、`package-lock.json` 和 lockfile root package version 从陈旧的 `0.8.2` 对齐为 `0.8.22`。
- 新增：
  - `docs/release-version-policy.md`
  - `lib/version/release-version.js`
  - `bin/version-status.js`
  - `test/release-version-policy.test.js`
- 新增命令：

```text
npm run version:status
npm run version:check
```

- `version:status` 分离展示正式 release version 与当前 build identity；未发布提交和 dirty 状态只标记 `unreleased=true`，不导致一致性检查失败。
- `version:check` 校验最近可达发布标签、manifest/lockfile 版本一致性，并忽略非祖先旧标签。

#### Validation and commit

- 版本检查：通过；当时识别为 release `0.8.22`，HEAD 位于该标签之后且工作区为 unreleased/dirty。
- 文档、README、版本策略相关测试：18/18 通过。
- `npm run check`：`static check passed: 359 files`。
- 全量测试需统一 Node 24 PATH；Node 22 会因 `better-sqlite3` ABI 127/137 不匹配产生环境性失败。
- Node 24 环境最终结果：`1181 tests`，`1175 passed`，`0 failed`，`6 skipped`。
- 本阶段代码与文档已提交：

```text
fd64eb5 docs(governance): establish architecture and release policy
```

- 上述提交仅包含本阶段 10 个治理文件，没有包含 `docs/devlog.md`、`docs/memory-entry-boundary-audit.md` 或 `test/memory-entry-boundary-contract.test.js`。

### P0-A Step3-F1-D-B3.1: Hybrid fallback observability aggregation and Console metrics

完成 Hybrid DB isolation fallback observability 闭环。

#### Runtime isolation progress

继 F1-B Hybrid runtime isolated DB access 与 F1-C index sync isolation 后，本阶段没有修改 channel fallback 行为，而是增加可观测性。

当前架构：

- Hybrid search runtime:
  - Core readonly handle
  - Engine readonly handle
  - request-scoped isolated session

- Index sync:
  - Core candidate discovery
  - Engine existence filtering
  - Engine-only write transaction

- Remaining compatibility:
  - KG TEXT-ID invariant fallback
  - Recent topology/TEXT-ID guarded fallback

这些 fallback 保持不变，等待真实生产数据验证后再决定移除。

#### B3: AutoRecall fallback metadata persistence

新增 AutoRecall Hybrid access telemetry。

持久化 canonical fields:

- `kg_access_mode`
- `kg_isolated_fallback_reason`
- `recent_access_mode`
- `recent_isolated_fallback_reason`

新增：

- `legacy_db_fallback_used`
- `legacy_db_fallback_channels`

规则：

- 仅 Hybrid search 执行完成后记录。
- pre-search skip 不生成 fallback 信息。
- channel error 不视为 fallback。
- fallback 判断只依据 access mode，不读取错误字段或 summary 字段。

#### B3.1: Metrics and Console observability

新增：

`retrieval.hybrid_fallback_observability`

统计：

- observed_hybrid_events
- fully_observed_events
- partial_observed_events
- fully_isolated_events
- fallback_events
- fallback_rate
- kg_fallback_events
- recent_fallback_events
- both_fallback_events

设计原则：

- event-based，不按 trace 聚合。
- 使用 unified Engine/Core event source。
- gate_decision 子事件排除。
- canonical mode/reason 优先。
- alias 字段不参与统计。

新增 Console:

Hybrid DB Isolation panel

展示：

- Hybrid observation 数量
- fallback rate
- KG/Recent fallback
- fallback reason distribution

动态 reason 在 UI 层统一 esc。

#### Validation

通过：

- Hybrid runtime isolation tests
- AutoRecall metadata tests
- Metrics aggregation tests
- Console rendering tests

工作区：

- clean
- no real DB access
- no runtime migration
- no push

#### Known limitations

- fallback 尚未删除。
- 当前只能观察 AutoRecall search。
- tool search telemetry 尚未纳入。
- 真实生产 TEXT-ID 数据审计未完成。

下一阶段：

基于真实 observability 数据决定：

1. 保留 guarded fallback；
2. 修复历史 ID 数据后 fail-closed；
3. 完全移除 attached compatibility path。


## 2026-07-16

### Phase 1B：Hybrid 检索数据库隔离与 Recent 灰度验证基础设施

本轮集中记录 2026-07-12 至 2026-07-16 已提交的 Hybrid 检索数据库隔离、KG/Recent 等价性验证、Recent 性能与 rollout readiness 审计，以及默认关闭的 shadow canary 基础设施。提交范围为 `8334887..30087b1`。

#### Hybrid 数据库访问契约与隔离通道

* 新增 `lib/recall/hybrid/db-access.js`，将 Hybrid 检索使用的数据库能力显式拆分为 Core 只读访问、Engine 隔离访问和 legacy 兼容访问，避免新隔离通道继续隐式依赖单一 attached handle。
* FTS 新增 opt-in isolated 路径，默认仍保留 legacy 行为；未新增 manifest、环境变量或用户参数启用入口。
* KG 完成隔离可行性探针、确定性 tie ordering、guarded isolated path 和只读 shadow audit：
  * tie 场景增加稳定次级排序，避免相同分值下结果顺序漂移；
  * isolated KG 只在内部 capability 严格为 `true` 时启用；
  * id/storage invariant 不满足时安全回到 legacy；
  * shadow audit 只比较结果，不改变实际 served candidates。

#### Recent 隔离路径与等价性边界

* 完成 isolated Recent 等价性探针，并确认旧查询仅按 `updated_at DESC` 排序时存在 tie 不确定性；生产查询增加稳定次级排序。
* 新增 Recent isolation readiness audit，明确三种归档过滤策略的语义差异：
  * Core `LIMIT` 后再由 JavaScript 排除 archived IDs 会破坏候选数量和排序语义；
  * Engine-first 会漏掉缺失 `memory_confidence` 的 Core rows；
  * Core-first 并在 SQL 中排除 archived IDs 后再 `LIMIT`，可以保持 legacy 语义。
* guarded isolated Recent 使用独立 Core/Engine 只读 handle：
  * Core 负责候选查询和 archived 排除；
  * Engine 负责 metadata merge；
  * 覆盖 `like_fallback`、`recent_scored`、`recent_fallback` 和 `episode_projection`；
  * storage/id guard 失败时原子回退 legacy；
  * 一旦 isolated 路径已选中，SQL 错误不会带着部分结果回退，而是记录稳定错误并返回空的 isolated 输出。
* 新增只读 Recent shadow audit，对 legacy 与 isolated 的 ordered IDs、raw/normalized fingerprints、候选数量、channel membership 和分支覆盖进行比较；真实数据库审计未执行写操作。

#### Recent 性能优化与 rollout readiness

* 新增 fixture/real 两种 Recent performance probe，用于比较 archive exclusion 策略、查询计划、序列化成本和端到端延迟。
* isolated Recent archived exclusion 从 correlated `NOT EXISTS` 改为单一 SQL source 中的 JSON list subquery：

```sql
AND c.id NOT IN (
  SELECT CAST(archived.value AS TEXT)
  FROM json_each(?) AS archived
)
```

* 真实数据基线中，旧策略约为 `6.7–7.5s`，优化后约为 `40–65ms`，约 `116–168x` 加速；JSON stringify 约为 `2.6ms`，不是主要瓶颈。
* rollout readiness audit 使用生产 `collectRecentCandidates` 路径和 worker-thread 独立只读连接执行真实并发验证：
  * 共 51 个 query、102 个 legacy/isolated scenario；
  * 101 个 isolated scenario 等价，1 个为双方均无命中；
  * 四个 Recent 分支均覆盖；
  * mismatch、partial result、SQL error 和非预期 fallback 均为 0；
  * concurrency 2 的 p95 约为 `234–238ms`；
  * concurrency 4 的 p95 约为 `311–317ms`；
  * 未观察到 `SQLITE_BUSY`。
* readiness decision 达到 `pass_canary_readiness`，但仍明确输出 `production_enablement_recommended=false`。

#### 数据库稳定性与 WAL sidecar 语义

* 修正 rollout audit 对数据库稳定性的判定：只读连接可能创建零字节 WAL、创建 SHM 或更新 SHM mtime，这类 WAL-index sidecar 活动不能直接等同于业务数据修改。
* 报告 schema 将以下概念分离：
  * `logical_database_stable`
  * `main_file_content_stable`
  * `sidecar_neutral`
  * SQLite `data_version` / `schema_version` / `total_changes`
  * `readonly_wal_index_activity`、`wal_content_change`、`logical_database_change` 等 activity class。
* 新增用户显式声明的 `--isolated-snapshot` 模式，通过 SQLite Backup API 创建静态副本后审计；对 live DB、symlink、hardlink 和 URI 等价路径增加 identity 保护。
* 当前 `better-sqlite3@11.10.0` 构建不支持 SQLite URI，因此没有引入不可验证的 immutable URI 功能面。

#### Guarded Recent shadow canary

* 新增 `recent-canary-policy.js` 和 `recent-canary-shadow.js`，允许的运行模式只有：
  * `off`
  * `shadow`
* 默认 sample rate 为 `0`，production 未注入 provider；默认路径不打开额外 handle、不执行额外 SQL，也不做 fingerprint comparison。
* policy 使用内部 provider、可信 context 和确定性 SHA-256 bucket 计算采样；provider 不能直接覆盖最终 `sampled` 结果。
* shadow 模式分别运行一份 legacy 和 isolated Recent，并始终只返回 legacy：
  * isolated candidates、warnings 和 errors 不进入 live candidate state；
  * isolated-only IDs 不进入最终结果、引用或强化可见链路；
  * legacy/isolated 的 query count、timing 和比较结果保持隔离。

#### Canary scope 审计与信任边界收紧

* 新增只读 scope-source audit，核实 OpenClaw `ToolDefinition.execute` 的真实签名为 `execute(toolCallId, params, signal, onUpdate, ctx)`。
* 当前插件入口可见的 `toolCallId` 仅能分类为 `framework_derived_but_ambiguous`；`params.action` 和 `params.query_or_text` 均为 `user_controlled`。
* 当前 `ExtensionContext` 未向 memory-engine 暴露可信的 agent/session/request/turn/chat scope，因此审计 decision 为：

```text
no_trusted_scope_available
```

* `resolveRecentCanaryContext` 从旧签名：

```js
resolveRecentCanaryContext({ toolCallId, action, params })
```

收紧为：

```js
resolveRecentCanaryContext({ trustedRuntimeContext })
```

* `trustedRuntimeContext` 默认 `null`；tool params 中伪造 `recentCanaryContext`、provider、sample key、rate 或 mode 均不能启用 shadow。
* resolver 抛错、返回非法对象、缺少 `source` 或返回旧 scope 形状时均安全关闭，并保持 legacy served result 不变。

#### 当前结论

* isolated FTS/KG/Recent 的实现、等价性探针、真实性能审计和 Recent shadow 基础设施已经就绪。
* Recent shadow provider 仍未注入，sample rate 仍为 `0`，实际运行模式仍为 `off`。
* 不通过 query、params、action 或 `toolCallId` 猜测 agent/session 身份。
* OpenClaw trusted scope 集成暂缓；在宿主没有稳定公共插件契约前，不维护版本相关的本地宿主补丁，避免 memory-engine 与 OpenClaw 升级形成持续耦合。
* 本轮没有启用 isolated Recent production serving，没有改变引用/强化结果，没有执行真实数据库写入，也没有发布新 release 或创建 tag。

#### 验证

* Recent rollout readiness 真实审计两次得到 `pass_canary_readiness`，同时保持 `production_enablement_recommended=false`。
* guarded shadow canary 完成 policy、shadow execution、integration、snapshot 和引用/强化隔离测试；该阶段完整测试通过。
* scope-source audit 定向测试与三次稳定性测试通过；提交 `e99acc0` 时完整测试为 `161/161`。
* context boundary 收紧后完整测试为 `162/162`，`npm run check` 为 `static check passed: 348 files`。
* 截至 `30087b1`，上述阶段代码均已提交；未 push、未 tag。

## 2026-07-08

### P33 后续：新增只读 event_at recovery audit CLI

本轮在已有 `core-chunk-time-migration` recovery diagnostics 之上，补齐了专门的只读 audit 入口，避免用户把 dry-run audit 误解成 migration apply 准备步骤。

新增内容：

* `lib/db/core-chunk-time-migration.js`
  * 复用既有 `buildSessionTranscriptEventIndex` / `extractReliableEventAtFromText` / recovery diagnostics。
  * 新增导出 `auditCoreChunkEventTimeRecovery(options = {})`。
  * audit 返回明确的只读字段：
    * `mode: "dry_run"`
    * `writes_db: false`
    * `recoverable_event_at_count`
    * `recoverable_from_text_timestamp_count`
    * `recoverable_from_session_transcript_count`
    * `text_and_session_transcript_agree_count`
    * `conflict_count`
    * `sample_conflicts`
    * `sample_recoverable`
  * conflict 诊断中，若 raw_log text timestamp 与 transcript exact-id timestamp 冲突，则不 backfill。
* `bin/audit-core-chunk-event-time-recovery.js`
  * 新增独立 CLI：
    * `node bin/audit-core-chunk-event-time-recovery.js --json`
  * 只读，不调用 `applyCoreChunkTimeMigration`。
  * 拒绝：
    * `--apply`
    * `--force`
    * `--write-db`
    * `--no-backup`
* `test/core-chunk-event-time-recovery-audit.test.js`
  * 覆盖 dry-run 不写 DB。
  * 覆盖 timezone-explicit text timestamp 可恢复。
  * 覆盖无 timezone timestamp 不可恢复。
  * 覆盖 session transcript exact chunk id 可恢复。
  * 覆盖 text/transcript 一致时 `agree_count` 计数。
  * 覆盖 text/transcript 冲突时不 backfill、只记 `conflict_count`。
  * 覆盖 `updated_at` 不能作为恢复来源。
  * 覆盖 CLI 拒绝 `--apply` / `--force` / `--write-db`。
  * 覆盖 legacy 真实 fixture dry-run 不新增 `event_at` / `created_at`。

trusted sources 明确限定为：

* raw_log text 开头的 timezone-explicit timestamp。
* exact session transcript chunk-id match。

明确不可信、不会用于 backfill 的来源：

* `updated_at`
* 文件 mtime
* smart-add 文件日期
* checkpoint episode 日期

验证：

* Targeted tests：
  * `node --test test/core-chunk-event-time-recovery-audit.test.js test/core-chunk-time-migration.test.js test/checkpoint-raw-log.test.js test/flush-session-rawlog-static.test.js test/core-write-guard.test.js`
  * 5/5 pass。
* Syntax / whitespace：
  * `node --check bin/audit-core-chunk-event-time-recovery.js` pass。
  * `node --check lib/db/core-chunk-time-migration.js` pass。
  * `git diff --check` pass。

真实 DB audit：

* 运行：
  * `node bin/audit-core-chunk-event-time-recovery.js --json`
* 结果：
  * `writes_db=false`
  * `core_db_path=/home/lionsol/.openclaw/memory/main.sqlite`
  * `engine_db_path=/home/lionsol/.openclaw/memory/memory-engine/memory-engine.sqlite`
  * `sessions_dir=/home/lionsol/.openclaw/agents/main/sessions`
  * `has_event_at=false`
  * `has_created_at=false`
  * `has_updated_at=true`
  * `session_files_scanned=194`
  * `session_records_read=8952`
  * `session_malformed_records=12`
  * `session_messages_indexed=2020`
  * `session_chunk_id_conflict_count=0`
  * `raw_log_total_count=7048`
  * `event_at_existing_count=0`
  * `event_at_null_count=7048`
  * `recoverable_event_at_count=1738`
  * `recoverable_from_text_timestamp_count=0`
  * `recoverable_from_session_transcript_count=1738`
  * `session_transcript_exact_chunk_id_match_count=1738`
  * `conflict_count=0`
  * `unrecoverable_event_at_null_count=5310`
* 结论：
  * audit CLI 可在真实 core DB 上只读运行。
  * 本次未修改真实 DB，`apply migration = no`。
  * 与上一轮 migration dry-run 基线 `7042/1855/5187` 相比，当前 live DB 和 session transcript 集合已经变化，因此以本次 `7048/1738/5310` 作为最新 audit 基线。

追加 apply 保护：

* `lib/db/core-chunk-time-migration.js`
  * 新增二次确认 token：`ALLOW_UNRECOVERABLE_EVENT_AT_NULLS`。
  * `applyCoreChunkTimeMigration()` 在 preflight 后检查 `unrecoverable_event_at_null_count`。
  * 如果 apply 会留下 `event_at NULL` 的 raw_log，只有 `MIGRATE_CORE_CHUNK_TIMES` 不够，必须额外提供 `confirmUnrecoverableEventAtNulls=ALLOW_UNRECOVERABLE_EVENT_AT_NULLS`。
  * 该保护在备份前触发，避免用户误以为只是 schema migration，却实际改变历史 checkpoint DB raw_log 输入范围。
* `bin/migrate-core-chunk-times.js`
  * 新增 CLI 参数：`--confirm-unrecoverable-event-at-nulls ALLOW_UNRECOVERABLE_EVENT_AT_NULLS`。
  * dry-run JSON 明确输出：
    * `apply_would_leave_unrecoverable_event_at_nulls=true`
    * `unrecoverable_event_at_null_confirm_token_required="ALLOW_UNRECOVERABLE_EVENT_AT_NULLS"`
* 测试已覆盖：
  * apply 缺少 core migration token 会失败。
  * apply 只有 core migration token、但存在 unrecoverable event_at NULL raw_log 时也会失败。
  * 同时提供两个 explicit token 后，fixture migration 才能继续。

Full test：

* `npm test` 仍未全绿，当前为 `101 pass / 13 fail / 0 skip`。
* 失败文件包括：
  * `test/archived-raw-log-rescue-sampler.test.js`
  * `test/auto-recall-card-runtime-smoke.test.js`
  * `test/auto-recall-long-input-smoke.test.js`
  * `test/auto-recall-turn-gold-set-observation.test.js`
  * `test/build-archived-raw-log-rescue-review-queue.test.js`
  * `test/export-turn-gold-set-replay-report.test.js`
  * `test/memory-process-boundary-audit.test.js`
  * `test/memory-quality-baseline-smoke.test.js`
  * `test/report-archived-raw-log-rescue-labels.test.js`
  * `test/report-archived-raw-log-rescue-review-queue-labels.test.js`
  * `test/smart-add-duplicate-baseline-smoke.test.js`
  * `test/smart-add-duplicate-cleanup-manifest.test.js`
  * `test/smart-add-duplicate-cleanup-preview.test.js`
* 其中 smart-add duplicate baseline 相关失败仍在，但 full test 失败不只集中于该组；本轮不把这些失败归因到 event_at audit 改动。

## 2026-07-07

### Core chunks 时间语义长期线：event_at / created_at / updated_at 分离

本轮从 P33 的短期修复继续推进长期 schema 线：P33 暂时让 `flush-session-rawlog` 把原始事件时间写入 `chunks.updated_at`，并让 checkpoint reader 在缺少更好字段时用 `updated_at_event_time` 兜底。长期方案改为明确区分三类时间：

* `event_at`：原始事件发生时间，用于 `raw_log` / checkpoint `targetDate` filtering。
* `created_at`：DB row 创建时间。
* `updated_at`：DB row 最近更新时间、reindex、repair、migration 时间。

只读摸底结果：

* 仓库工作树干净，位于 `main...origin/main`。
* 当前真实 core DB `chunks` schema 只有 `updated_at INTEGER NOT NULL`，没有 `event_at` / `created_at`。
* 当前真实 raw_log 聚合：`raw_log_total_count=7042`。
* 新 migration CLI 初始真实 DB dry-run 结果：
  * `would_add_columns=[event_at, created_at]`
  * `event_at_null_count=7042`
  * 仅靠 raw_log text timestamp 时：`recoverable_event_at_backfill_count=0`，`unrecoverable_event_at_null_count=7042`
  * `writes_db=false`
* 随后加入 session transcript exact chunk-id recovery 后，真实 DB dry-run 结果：
  * `session_files_scanned=191`
  * `session_messages_indexed=2128`
  * `session_chunk_id_conflict_count=0`
  * `recoverable_event_at_backfill_count=1855`
  * `session_transcript_exact_id_backfill_count=1855`
  * `backfill_conflict_count=0`
  * `unrecoverable_event_at_null_count=5187`
  * `writes_db=false`
* 结论：不能把历史 `updated_at` 批量当成 `event_at`；但可以用原始 session transcript 与 `flush-session-rawlog` chunkId 公式做精确恢复。当前可可靠恢复 1855/7042 条，仍有 5187 条需保持 `event_at NULL` 或另寻证据。

代码变更：

* `bin/flush-session-rawlog.js`
  * 写入前检查 `chunks` 列。
  * 若存在 `event_at`：
    * `event_at = 原始 session message timestamp`
    * `created_at = 写入时刻`
    * `updated_at = 写入时刻`
  * 若不存在 `event_at`：继续使用 P33 legacy fallback，`updated_at = 原始事件时间`，确保迁移前 checkpoint 仍可按目标日期读取。
* `lib/checkpoint/raw-log.js`
  * DB raw_log reader 时间选择改为：
    1. `event_at`
    2. legacy-only `created_at_legacy_event_time`（仅当无 `event_at` 时）
    3. legacy `updated_at_event_time`
  * 一旦 core schema 有 `event_at`，`event_at IS NULL` 的 raw_log 不再回退到 `updated_at`，避免 reindex/repair 时间污染 episode。
  * 增加 `rawLogMissingEventAt` 诊断计数。
* `bin/session-checkpoint.js` / `bin/run-session-checkpoint-direct.sh`
  * fallback diagnostics 从 `created_at/event_time` 更新为 `event_at/legacy_event_time`。
* `lib/db/core-chunk-time-migration.js`
  * 新增专门 core schema migration 模块。
  * 默认 dry-run，只读检查 schema 与 backfill 可能性。
  * apply 需要显式 token：`MIGRATE_CORE_CHUNK_TIMES`。
  * apply 前备份 core DB 及存在的 `-wal` / `-shm` 文件。
  * apply 只添加 `chunks.event_at` / `chunks.created_at`。
  * `event_at` backfill 保守执行：只接受 raw_log text 开头带明确时区的 ISO timestamp，或原始 session transcript 的 exact chunk-id match；不盲目复制 `updated_at`。
  * transcript exact chunk-id match 使用 `flush-session-rawlog` 旧公式：`sha256(text + timestamp + dateStr)`。
  * 旧数据无法确认事件时间则保持 `event_at NULL`，并通过 dry-run/postflight 诊断计数。
* `bin/migrate-core-chunk-times.js`
  * 新增 CLI。
  * 默认 dry-run。
  * `--sessions-dir <path>` 可指定 transcript 扫描目录。
  * 默认启用 session transcript exact-id recovery，可用 `--no-session-transcript-recovery` 关闭。
  * `--apply` 必须配 `--confirm-core-time-migration MIGRATE_CORE_CHUNK_TIMES`。
  * 拒绝 `--force` / `--write-db` / `--no-backup`。
* `lib/db/core-write-guard.cjs`
  * 补强 core write guard：
    * 阻止 `CREATE INDEX ... ON core.chunks(...)`。
    * 阻止 `CREATE INDEX core.idx ...` / `DROP INDEX core.idx` / `REINDEX core...`。
    * 阻止 `db.exec` 多语句绕过，例如 `SELECT 1; ALTER TABLE core.chunks ...`。

测试覆盖：

* `test/checkpoint-raw-log.test.js`
  * 旧 `event_at` + 新 `updated_at` 不进入新日期 episode。
  * 目标日 `event_at` + 后续 `updated_at` 进入目标日期 episode。
  * `event_at NULL` 不回退到 `updated_at`。
  * 无 `event_at` 的 legacy schema 仍使用 `updated_at_event_time`。
* `test/core-chunk-time-migration.test.js`
  * migration dry-run 不写 DB。
  * apply 需要 backup + explicit confirm token。
  * apply 只 conservative backfill 可确认 timestamp 或 exact transcript chunk-id match 的 raw_log。
  * 普通 core write guard 仍阻止 schema 写入；只有专门 migration path 能写 core。
* `test/core-write-guard.test.js`
  * 覆盖 ALTER / CREATE INDEX / DROP INDEX / 多语句绕过。
* `test/flush-session-rawlog-static.test.js`
  * 覆盖 `event_at` 新 schema 写入与 legacy `updated_at` fallback。

验证：

* Targeted tests：
  * `node --test test/core-write-guard.test.js test/core-chunk-time-migration.test.js test/checkpoint-raw-log.test.js test/flush-session-rawlog-static.test.js test/session-checkpoint.integration.test.js`
  * 51/51 pass。
* Syntax / whitespace：
  * `node --check bin/migrate-core-chunk-times.js` pass。
  * `node --check lib/db/core-chunk-time-migration.js` pass。
  * `git diff --check` pass。
* Real DB dry-run：
  * `node bin/migrate-core-chunk-times.js --json`
  * 确认 `writes_db=false`，真实 DB 未执行 schema 修改。
  * session transcript recovery enabled 后可恢复 1855 条，仍有 5187 条不可恢复。
* Full test：
  * `npm test` 未全绿：782 pass / 8 fail / 6 skip。
  * 失败集中在 smart-add duplicate baseline / cleanup preview / manifest 的当前数据基线断言，和本轮 changed files 无直接交集。
  * 本轮不把 full test 记为通过。

未执行：

* 未 apply migration。
* 未修改真实 core DB schema。
* 未把历史 `updated_at` backfill 为 `event_at`。

## 2026-07-04

### Archived raw_log rescue P11-P18：scoring diagnostics 闭环与 tiered conflict cap 默认实现

P10 之后，archived raw_log rescue 的核心问题从“采样与标注”转向“如何解释并改进 v0.2 scoring 的误判”。这批工作从 label leakage 修复后的真实 replay 出发，逐步建立 diagnostics、what-if calibration、scoring parts 分析，最后把验证过的 tiered conflict cap 规则落到默认 scoring 行为中。

背景问题：

* 早期 v0.1 rules replay 暴露出 evaluator 存在 label leakage：label annotation 被合并进 prediction sample，导致 v0.1 看起来达到 100% accuracy。
* 修复 leakage 后，真实结果显示：

  * v0.1 对 seed/P2/P4 的表现不稳定，尤其 P4 false positive 很高；
  * v0.2 precision 很高，但 recall 被 positive/negative conflict cap 明显压低；
  * P2 中 cap 造成多个 false negative；
  * P4 中 cap 又确实挡住大量 false positive。
* 因此不能简单取消 conflict cap，需要找到 candidate-only discriminator。

本轮提交链路：

* `9272af1 fix(annotation): prevent rescue label evaluation leakage`

  * 修复 evaluator 中 label annotation 泄漏到 prediction input 的问题。
  * `target_category`、`rescue_confidence` 只能用于 diagnostics / ground truth 分析，不再进入 rules/scoring prediction path。
* `ea8d4a9 feat(evaluate): add rescue mismatch diagnostics`

  * 为 v0.1 rules 和 v0.2 scoring 增加 mismatch diagnostics。
  * 输出 prediction/actual/mismatch/FP/FN distributions，帮助定位错误来源。
* `32557dd feat(evaluate): add candidate-only what-if calibration diagnostics`

  * 增加 opt-in `--include-calibration`。
  * 对 threshold、rawLogPenalty、toolOutputPenalty 等 candidate-only scoring 参数做 what-if。
* `debb55c feat(evaluate): add candidate-only what-if calibration grid`

  * 增加 opt-in `--include-calibration-grid`。
  * 扩展为 threshold × rawLogPenalty × toolOutputPenalty grid。
  * 结论：threshold 有影响，但权重调整无法单独解决 conflict cap 带来的 recall loss。
* `0316424 feat(evaluate): add opt-in conflict cap diagnostics`

  * 增加 opt-in `--include-conflict-cap-diagnostics`。
  * 量化当前 cap 的收益与代价：

    * P2：cap 造成 4 个 FN，几乎没有 FP protection；
    * P4：cap 保护 15 个 FP，但也造成 1 个 FN。
* `f42aa18 feat(evaluate): add opt-in tiered conflict cap calibration`

  * 增加 opt-in tiered cap what-if。
  * 证伪 `raw_log_leak` 作为 discriminator；它只是 archived raw_log rescue 的背景标记。
* `1deae30 feat(evaluate): add opt-in signal diversity diagnostics`

  * 增加 opt-in `--include-signal-diversity-diagnostics`。
  * 发现 risk_signals 区分度不足：P2 正例和 P4 噪音样本都带有大量 high-value-looking signals。
  * `risk_signal_count`、`positive_signal_family_count`、`project_plus_noise_only_pattern` 都不足以作为默认规则。
* `0d85c38 feat(evaluate): add opt-in scoring parts diagnostics`

  * 增加 opt-in `--include-scoring-parts-diagnostics`。
  * 直接分析 `scoring.parts` 的正负分数组成。
  * 找到第一个有效 discriminator：

    * `high_value_positive_parts_pattern` 更倾向 P2 capped FN；
    * `project_plus_engineering_only_positive_parts_pattern` 更倾向 P4 capped FP。
* `633379a feat(evaluate): add opt-in scoring-parts tiered cap calibration`

  * 增加 opt-in `--include-scoring-parts-tiered-cap-calibration`。
  * 比较 7 个 scoring-parts tiered cap variants：

    * `baseline_current_cap`
    * `no_conflict_cap`
    * `uncap_if_high_value_positive_parts`
    * `uncap_if_has_preference_signal_part`
    * `uncap_if_has_project_decision_or_preference_part`
    * `uncap_if_has_preference_decision_or_todo_part`
    * `cap_unless_project_plus_engineering_only`
  * replay 证明 `uncap_if_high_value_positive_parts` 是当前最好的 tradeoff。
* `c27a4ef feat(scoring): implement tiered conflict cap for archived raw log rescue`

  * 把 P17 验证过的 `high_value_positive_parts_pattern` 落到默认 v0.2 scoring 行为中。
  * 默认 conflict cap 从“一刀切 yes → unsure”改成 tiered cap。

最终 scoring 行为：

* 当存在 positive/negative conflict 且 raw prediction 为 `yes` 时：

  * 如果 positive scoring parts 满足 high-value 条件，最终 prediction 保持 `yes`；
  * 否则仍然 cap 成 `unsure`。
* high-value 条件完全基于 candidate-only scoring parts：

  * `project_decision_signal`
  * `preference_signal`
  * `project_todo_signal`
  * 或至少 2 个 non-project positive parts。
* `manual_review_flags` 仍然保留 `positive_negative_conflict`，即使最终 prediction 保持 `yes`。
* `positive_negative_conflict_prediction_cap` 只在实际执行 cap 时写入 scoring parts。
* 不使用 label-derived `target_category` / `rescue_confidence`。
* 不改 threshold、weights、rawLogPenalty、toolOutputPenalty。
* 不触碰 DB、reports artifact、AutoRecall P5/card-first runtime 或 `openclaw.plugin.json`。

P18 replay 结果：

Seed：

* 0 capped rows。
* 新旧 scoring 行为一致。
* recall 仍为 0，说明 seed 的问题不是 conflict cap，而是 scoring weights/threshold 侧的问题。

P2：

* 旧 always-cap baseline：

  * exact_accuracy 0.600
  * yes_precision 1.000
  * yes_recall 0.588
  * yes_f1 0.741
  * yes_false_positive 0
  * yes_false_negative 7
  * capped_count 4
* 新 default tiered cap：

  * exact_accuracy 0.700
  * yes_precision 1.000
  * yes_recall 0.706
  * yes_f1 0.828
  * yes_false_positive 0
  * yes_false_negative 5
  * capped_count 2
* 效果：

  * recall +11.8pp
  * f1 +8.7pp
  * FP 仍为 0

P4：

* 旧 always-cap baseline：

  * exact_accuracy 0.050
  * yes_precision 1.000
  * yes_recall 0.200
  * yes_f1 0.333
  * yes_false_positive 0
  * yes_false_negative 4
  * capped_count 16
* 新 default tiered cap：

  * exact_accuracy 0.100
  * yes_precision 0.500
  * yes_recall 0.400
  * yes_f1 0.444
  * yes_false_positive 2
  * yes_false_negative 3
  * capped_count 13
* 效果：

  * recall +20.0pp
  * f1 +11.1pp
  * 释放 1 个原本被 cap 的 TP
  * 新增 2 个 FP
  * 仍保留 13/15 的 FP protection

Diagnostics 语义变化：

* P18 后，conflict-capped diagnostics 只会看到仍被 cap 的 rows。
* high-value conflict rows 现在默认保持 `yes`，因此不再出现在 capped-row diagnostics 中。
* P17 calibration 的 `baseline_current_cap` 在 P18 后表示“新默认 cap”，不再表示旧 always-cap。
* 如需长期保留旧 always-cap 对照，可后续低优先级增加 `legacy_always_cap` / `always_conflict_cap` what-if variant。

验证：

* Rules/scoring targeted tests：

  * 19/19 pass
* Evaluator targeted tests：

  * 26/26 pass
* Syntax / whitespace：

  * `node --check bin/evaluate-archived-raw-log-rescue-labels.cjs` pass
  * `git diff --check` pass
* All diagnostic/calibration flags 共存正常：

  * `--include-calibration`
  * `--include-calibration-grid`
  * `--include-conflict-cap-diagnostics`
  * `--include-tiered-cap-calibration`
  * `--include-signal-diversity-diagnostics`
  * `--include-scoring-parts-diagnostics`
  * `--include-scoring-parts-tiered-cap-calibration`

安全边界：

* 没有 DB write。
* 没有 unarchive / category update / delete / quarantine / reinforce。
* 没有生成 reports artifact。
* 没有触碰 AutoRecall P5 / card-first runtime。
* 没有修改 `openclaw.plugin.json`。
* 只改变 archived raw_log rescue v0.2 scoring 的 conflict cap 默认行为。


### Session checkpoint P33：raw_log 事件时间基准与状态优先级

P32 提交为 `c253255 docs(readme): mention annotation handoff smoke command` 后，原本准备进入 release/tag。但 7 月 3 日对比 edi 实时总结与 checkpoint 生成的 episode 摘要后，发现 checkpoint 质量上还有两个更高优先级的问题，因此暂停打 tag，先修这条线：

1. 旧 raw_log 对话在重新 flush 后可能被拉进目标日期，因为 `updated_at` 表示的是 flush/update 时间，而不是原始事件发生时间；
2. nightly LLM prompt 可能会总结较早的“需修复”状态，即使目标日后续证据已经验证该问题“已修复”。

实现内容：

- 更新 `lib/checkpoint/raw-log.js` 的 DB raw-log 收集逻辑：
  - 检测 `chunks.created_at` 是否存在；
  - 有 `created_at` 时，优先把它作为 raw-log 事件时间基准；
  - 只有当 core `chunks` schema 没有 `created_at` 列时，才 fallback 到 `updated_at_event_time`；
  - 同步更新 `rawLogTimeBasis`、`rawLogTimeBasisNote` 和 `evidenceDateFilter` diagnostics。
- 更新 `bin/flush-session-rawlog.js`：
  - 由于当前 core `chunks` 还没有 `created_at` 列，raw-log DB 写入时把 session message 的事件 timestamp 写入 `updated_at`；
  - 不再把 `Date.now()` 写成 flushed session message 的 raw-log `updated_at`；
  - `memory_confidence.last_confidence_update` 也与 raw-log 事件 timestamp 对齐。
- 更新 `bin/session-checkpoint.js` 与 `bin/run-session-checkpoint-direct.sh` 的 fallback diagnostics：
  - 使用 `created_at/event_time` 语义；
  - 不再把普通 `updated_at` 伪装成原始事件时间。
- 更新 `lib/checkpoint/llm.js` nightly prompt：
  - 同一事项出现多个状态时，以更晚的验证结果、测试结果或用户确认作为当前状态；
  - 较早的 `待修复/需修复` 不能覆盖较晚的 `已修复/已验证`。
- 新增/更新测试：
  - `test/checkpoint-raw-log.test.js` 覆盖 created_at-vs-updated_at 污染链：旧 created_at + 目标日 updated_at 会被排除；目标日 created_at + 更晚 updated_at 会被纳入。
  - `test/flush-session-rawlog-static.test.js` 防止未来把 flush-time `updated_at` 写法改回来。
  - `test/checkpoint-llm.test.js` 保护“最新状态优先”的 prompt 规则。
  - Episode/session integration tests 现在预期新的 raw-log time-basis metadata。
- 没有对真实数据执行 DB mutation 或 cleanup。

验证：

```text
node --test test/checkpoint-raw-log.test.js test/flush-session-rawlog-static.test.js test/checkpoint-llm.test.js test/checkpoint-episode-writer.test.js test/session-checkpoint.integration.test.js test/smart-add-propagation-audit.test.js
# 67/67 pass

node --check bin/flush-session-rawlog.js
node --check bin/session-checkpoint.js
node --check lib/checkpoint/raw-log.js
node --check lib/checkpoint/llm.js
# pass
```

备注：当前真实 OpenClaw core `chunks` schema 没有 `created_at` 列，所以这个 patch 还不能在 production core DB 上直接读取 `created_at`。当前策略是：如果未来 schema 有 `created_at` 就优先使用；在当前 fallback 路径下，先确保 `flush-session-rawlog.js` 把原始事件时间写入 `updated_at`。fallback 生效时，diagnostics 会显式标为 `updated_at_event_time`。

### Archived raw_log rescue P32：README 补充 Console annotation smoke 命令

P31 提交为 `bc61522 test(console): add annotation handoff smoke script` 后，P32 把 targeted smoke 命令补到顶层 README 的 `Console Annotation Workflow` 小节。现在 README 不仅链接文档，也直接给出准确的回归验证命令。

实现内容：

- 更新 `README.md` 的 `Console Annotation Workflow` 小节。
- 在 Console annotation/report handoff 文档旁补充 `npm run smoke:console-annotation-handoff`。
- 更新 `test/readme-console-annotation-workflow.test.js`，保护 README 中的命令入口不会被删掉。
- 没有 runtime code 改动。

验证：

```text
node --test test/readme-console-annotation-workflow.test.js test/package-scripts.test.js test/smoke-tests-index-doc.test.js
# 7/7 pass

npm run smoke:console-annotation-handoff
# 56/56 pass
```

### Archived raw_log rescue P31：Console annotation handoff npm smoke 脚本

P30 提交为 `6046fe2 docs(smoke): index console annotation runbooks` 后，P31 新增了 Console annotation/report handoff 的 targeted npm script。这样以后不需要复制很长的 `node --test ...` 命令，就能跑 GUI handoff 回归测试集。

实现内容：

- 在 `package.json` 新增 `smoke:console-annotation-handoff`。
- 该脚本运行 Console annotation/report handoff 测试集：
  - `test/console-reports.test.js`
  - `test/console-annotations.test.js`
  - `test/console-annotation-report-handoff-doc.test.js`
  - `test/human-annotation-workflow-doc.test.js`
  - `test/readme-console-annotation-workflow.test.js`
  - `test/smoke-tests-index-doc.test.js`
  - `test/report-archived-raw-log-rescue-review-queue-labels.test.js`
  - `test/build-archived-raw-log-rescue-review-queue.test.js`
- 更新 `docs/smoke-tests/README.md`，把 `npm run smoke:console-annotation-handoff` 作为文档化的 regression guard 命令。
- 新增 `test/package-scripts.test.js`，保护 npm script 及其包含的测试文件。
- 没有 runtime code 改动。

验证：

```text
npm run smoke:console-annotation-handoff
# 56/56 pass

node --test test/package-scripts.test.js test/smoke-tests-index-doc.test.js
# 5/5 pass
```

### Archived raw_log rescue P30：Smoke tests 索引

P29 提交为 `8646190 docs(readme): link console annotation workflow` 后，P30 新增 `docs/smoke-tests/README.md`，让 smoke-test runbook 可以从 smoke-test 目录本身发现。

实现内容：

- 新增 `docs/smoke-tests/README.md`。
- 索引现有 smoke runbook：
  - `console-annotation-report-handoff.md`
  - `openclaw-memory-tools.md`
- 记录每条 smoke 路径什么时候需要 run/review。
- 在索引中保留 Console annotation/report handoff 的安全边界：只读 report fetch；不上传 labels，不写 DB，不修改 memory，不执行 apply / unarchive / category update / delete / quarantine / reinforce，也不调用 LLM。
- 新增 `test/smoke-tests-index-doc.test.js`，保护索引可发现性、安全措辞和文档化的 regression guard 命令。
- 没有 runtime code 改动。

验证：

```text
node --test test/smoke-tests-index-doc.test.js test/console-annotation-report-handoff-doc.test.js test/agent-memory-tool-strategy.test.js
# 17/17 pass

node --test test/console-reports.test.js test/console-annotations.test.js test/console-annotation-report-handoff-doc.test.js test/human-annotation-workflow-doc.test.js test/readme-console-annotation-workflow.test.js test/smoke-tests-index-doc.test.js test/agent-memory-tool-strategy.test.js test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js
# 63/63 pass
```

### Archived raw_log rescue P29：README Console annotation workflow 入口

P28 提交为 `e04c377 docs(annotation): link console handoff workflow` 后，P29 在 README 增加顶层 Console annotation workflow 入口，让 GUI handoff 文档可以从项目首页发现。

实现内容：

- 在 `README.md` 新增 `Console Annotation Workflow` 小节。
- 链接主 annotation workflow 文档：`docs/human-annotation-gold-set.md`。
- 链接 GUI handoff smoke runbook：`docs/smoke-tests/console-annotation-report-handoff.md`。
- 记录顶层安全边界：GUI 路径只读取 whitelisted reports，不上传 labels，不写 DB，也不执行 apply / unarchive / category update / delete / quarantine / reinforce。
- 新增 `test/readme-console-annotation-workflow.test.js`，保护 README 可发现性和安全措辞。
- 没有 runtime code 改动。

验证：

```text
node --test test/readme-console-annotation-workflow.test.js test/human-annotation-workflow-doc.test.js test/console-annotation-report-handoff-doc.test.js
# 10/10 pass

node --test test/console-reports.test.js test/console-annotations.test.js test/console-annotation-report-handoff-doc.test.js test/human-annotation-workflow-doc.test.js test/readme-console-annotation-workflow.test.js test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js
# 52/52 pass
```

### Archived raw_log rescue P28：Human annotation workflow 链接 Console handoff

P27 提交为 `d62dc10 docs(console): add annotation report handoff smoke` 后，P28 更新主 human-annotation workflow 文档，把新的 Console `/reports` ↔ `/annotations` GUI 路径从 smoke-test 目录挂回主 annotation 文档，避免只在 smoke runbook 中可见。

实现内容：

- 更新 `docs/human-annotation-gold-set.md` 的 `Annotation Workflow`。
- workflow 现在优先推荐 Console `/annotations` 加载 whitelisted report，同时仍允许通过 browser File API 加载本地 JSONL。
- 增加 `/reports` handoff 路径：
  - `Open with Latest Labels`
  - `/annotations?candidate=<report>&labels=<labels>`
  - 在 Console `/reports` 中查看 structured preview
- 增加本地输出说明：
  - labels JSONL export
  - browser-local QC JSON export
- 从主 annotation workflow 链接 `docs/smoke-tests/console-annotation-report-handoff.md`。
- 保留 GUI 只读安全边界：server 侧只读 whitelisted reports；不上传 labels，不写 DB，不修改 memory，不执行 apply / unarchive / category update / delete / quarantine / reinforce。
- 新增 `test/human-annotation-workflow-doc.test.js`，防止主 workflow 文档退回旧的 standalone-only 路径。
- 没有 runtime code 改动。

验证：

```text
node --test test/human-annotation-workflow-doc.test.js test/console-annotation-report-handoff-doc.test.js
# 8/8 pass

node --test test/console-reports.test.js test/console-annotations.test.js test/console-annotation-report-handoff-doc.test.js test/human-annotation-workflow-doc.test.js test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js
# 50/50 pass
```

### Archived raw_log rescue P27：Console annotation/report handoff smoke runbook

P26 提交为 `0430052 feat(console): copy annotation deep link` 后，P27 增加 `/reports` ↔ `/annotations` GUI handoff 的 smoke-test runbook，并用静态回归测试保护文档化的 hooks 与安全边界。

实现内容：

- 新增 `docs/smoke-tests/console-annotation-report-handoff.md`。
- smoke runbook 覆盖：
  - `/reports` latest cards
  - structured report previews
  - rescue combined preview
  - review queue preview
  - review queue label preview
  - local QC preview
  - `Open in Annotations`
  - `Open with Latest Labels`
  - `/annotations` query auto-load
  - current review deep link
  - `Copy Link`
  - labels import identity alignment
  - local labels/QC export
- 新增 `test/console-annotation-report-handoff-doc.test.js`。
- 静态测试断言：
  - smoke doc 存在
  - read-only 安全边界存在
  - required report families 存在
  - structured latest/default preference 存在
  - deep-link URL forms 存在
  - `reports.ejs`、`annotations.ejs`、`charts.js` 中的实现 hooks 存在
  - lifecycle labels 仍然只是 advisory
- 没有 runtime code 改动。
- 没有新增 server route、upload、DB write、apply、unarchive、category update、delete、quarantine、reinforce、LLM 或 network side effect。

验证：

```text
node --test test/console-annotation-report-handoff-doc.test.js
# 6/6 pass

node --test test/console-reports.test.js test/console-annotations.test.js test/console-annotation-report-handoff-doc.test.js test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js
# 48/48 pass
```

### Archived raw_log rescue P26：复制当前 annotation deep link

P25 提交为 `add58ec feat(console): show current annotation deep link` 后，P26 为当前 `/annotations` deep link 增加复制动作。这样 server-loaded candidate/labels 的续标链接可以直接复用，不需要手动选择 anchor URL。

实现内容：

- 在 `Current Deep Link` panel 中新增 `Copy Link` 按钮。
- 只有 server-loaded candidate/queue report 生成可复用 deep link 后，copy button 才显示。
- 新增 `copyCurrentDeepLink()`。
- 复制逻辑使用 `navigator.clipboard.writeText()`，并基于当前 origin 生成 absolute URL。
- Clipboard 失败时，会在状态文本中展示完整链接，方便手动复制。
- candidate-only 与 candidate+labels 链接复用同一套 copy path。
- 本地 browser files 仍然不会生成 server deep links。
- 没有新增 server route、upload、DB write、apply、unarchive、category update、delete、quarantine、reinforce、LLM 或 network side effect。

验证：

```text
node --test test/console-annotations.test.js
# 13/13 pass

node --test test/console-reports.test.js test/console-annotations.test.js test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js
# 42/42 pass
```

### Archived raw_log rescue P25：Annotations 当前 review deep link

P24 提交为 `783cd84 feat(console): open annotations with latest labels` 后，P25 在 `/annotations` 增加当前 review deep-link panel。当 candidate/queue report 以及可选 labels report 通过 server allowlist 加载后，页面会显示同一 review session 的可复用链接。

实现内容：

- 在 `/annotations` 新增 `Current Deep Link` panel。
- 新增 `state.serverCandidateReportName` 和 `state.serverLabelReportName`。
- 新增 `updateCurrentDeepLink()`。
- server-loaded candidate/queue JSONL 会记录 report name，并显示 `/annotations?candidate=<report>`。
- server-loaded labels JSONL 会把同一个链接更新为 `/annotations?candidate=<report>&labels=<label-report>`。
- 加载新的 candidate report 会清空旧 label state，并在设置新 server candidate 前重置 deep-link state。
- 本地 browser files 不生成 server deep links，避免为未通过 allowlisted reports API 暴露的文件生成不可用链接。
- 现有 query auto-load、JSONL format checks 和 label identity alignment 保持不变。
- 没有新增 server route、upload、DB write、apply、unarchive、category update、delete、quarantine、reinforce、LLM 或 network side effect。

验证：

```text
node --test test/console-annotations.test.js
# 13/13 pass

node --test test/console-reports.test.js test/console-annotations.test.js test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js
# 42/42 pass
```

### Archived raw_log rescue P24：Reports 跳转 annotations 时携带最新 labels

P23 提交为 `9ff21dc feat(console): link reports to annotations` 后，P24 为 report-to-annotation handoff 增加续标快捷入口。当 `/reports` 正在显示可加载的 candidate/queue JSONL report，且 allowlisted report list 中存在最新 `annotation_labels` JSONL 时，detail view 会提供 `Open with Latest Labels` 链接。

实现内容：

- 在 `console/public/charts.js` 新增 `latestAnnotationLabelReportName()`。
- `annotationDeepLinkForReport()` 现在接受可选 label report name。
- 基础链接仍是 `/annotations?candidate=<report>`。
- 续标链接为 `/annotations?candidate=<report>&labels=<latest-label-report>`。
- 续标链接只对可加载的 annotation input reports 显示：
  - `annotation_candidates` JSONL
  - `archived_raw_log_rescue_review_queue` JSONL
- 只有当 `pageData.files` 中存在 whitelisted `annotation_labels` JSONL 时才显示续标链接。
- `/annotations` 仍通过现有 query auto-load 路径和只读 `/api/reports/file` endpoint 执行实际读取。
- 导航后现有 label identity alignment 仍然生效。
- 没有新增 server route、upload、DB write、apply、unarchive、category update、delete、quarantine、reinforce、LLM 或 network side effect。

验证：

```text
node --test test/console-reports.test.js
# 20/20 pass

node --test test/console-reports.test.js test/console-annotations.test.js test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js
# 41/41 pass
```

### Archived raw_log rescue P23：Reports 到 annotations 的 deep-link handoff

P22 提交为 `376bc5d feat(console): auto-load annotation reports from query` 后，P23 把 `/annotations` 的 deep-link 能力暴露到 `/reports`。现在 candidate/queue JSONL report 可以从 report detail view 直接打开到 `/annotations`。

实现内容：

- 在 `console/public/charts.js` 新增 `annotationDeepLinkForReport()`。
- Report detail 现在会为可加载的 annotation input reports 显示 `Open in Annotations`：
  - `annotation_candidates` JSONL
  - `archived_raw_log_rescue_review_queue` JSONL
- 链接目标为 `/annotations?candidate=<encoded-report-name>`。
- Markdown 文件、JSON summary/QC reports、label alignment reports 和其他非 candidate artifacts 不显示该链接。
- Deep-link loading 仍复用现有 `/annotations` query auto-load 路径，以及只读 `/api/reports/file` report fetch。
- 没有新增 server route、upload、DB write、apply、unarchive、category update、delete、quarantine、reinforce、LLM 或 network side effect。

验证：

```text
npm exec -- node --test test/console-reports.test.js
# 20/20 pass

node --test test/console-reports.test.js test/console-annotations.test.js test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js
# 41/41 pass
```

备注：第一次直接运行 `node --test test/console-reports.test.js` 被外部 safety check 拦截一次，因此单文件测试改用 `npm exec -- node` 重跑。组合测试随后使用系统 Node runtime（`/usr/bin/node`, v22.22.2）成功通过。

### Archived raw_log rescue P22：Annotations report deep-link auto-load

P21 提交为 `7436ec9 feat(console): open reports from latest cards` 后，P22 为 `/annotations` 增加 deep-link auto-load 支持。页面现在可以直接从 URL query parameters 加载 whitelisted candidate/queue JSONL 和可选 labels JSONL。

实现内容：

- 增加 `/annotations` query auto-load 支持：
  - `?candidate=<report.jsonl>`
  - `?candidate_report=<report.jsonl>`
  - `?labels=<labels.jsonl>`
  - `?label_report=<labels.jsonl>`
- Query auto-load 使用现有只读 `/api/reports/file?name=<report>` 路径。
- Candidate report 先加载；label report 只有在 candidate load 成功后才加载。
- Candidate 与 label loaders 现在返回 success/failure booleans，因此 candidate failure 时可以安全停止加载序列。
- 现有 format checks 继续生效：
  - candidate report 必须是 JSONL
  - label report 必须是 JSONL
- labels 的 identity alignment 继续生效；wrong queue labels 和 identity mismatches 仍会被 skipped and counted。
- 没有新增 server route、upload、DB write、apply、unarchive、category update、delete、quarantine、reinforce、LLM 或 network side effect。

验证：

```text
node --test test/console-annotations.test.js
# 12/12 pass

node --test test/console-reports.test.js test/console-annotations.test.js test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js
# 41/41 pass
```

### Archived raw_log rescue P21：Reports latest cards 可点击

P20 提交为 `1239f9d fix(console): prefer structured rescue latest reports` 后，P21 让 `/reports` latest cards 可直接点击。latest cards 现在会直接打开对应 whitelisted report，不再只是展示日期/名称并要求用户到 reports table 再查一次。

实现内容：

- 在 `console/public/charts.js` 新增 `reportLatestCards()`。
- Latest report cards 渲染为带 `data-report-latest-name` 的 buttons。
- 点击 latest card 会通过现有只读 `/api/reports/file?name=<report>` endpoint 获取 report。
- Click handling 复用 `renderReportDetail()`，因此所有 structured preview panels 仍由同一个只读 report payload 驱动。
- Card labels 仍使用 `reportKindLabel()`，并显示 latest date 与 report filename。
- 没有新增 route、mutation path、upload、DB write、apply、unarchive、category update、delete、quarantine、reinforce、LLM 或 network side effect。

验证：

```text
node --test test/console-reports.test.js
# 20/20 pass

node --test test/console-reports.test.js test/console-annotations.test.js test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js
# 40/40 pass
```

### Archived raw_log rescue P20：Reports latest/default 结构化 rescue artifacts

P19 提交为 `90bd2ca feat(console): preview rescue combined reports` 后，P20 修复 `/reports` latest/default routing 缺口。combined rescue reports、P7 queue JSONL、P8 queue-label reports 和 local QC reports 已经有 structured previews，但 P7 queue 没有纳入 latest tracking，而且较新的 Markdown companion 可能抢占 preview-capable rescue families 的 latest selection。

实现内容：

- 把 `archived_raw_log_rescue_review_queue` 加入 latest report tracking。
- 把 `latest.archived_raw_log_rescue_review_queue` 加入 `/reports` latest cards。
- 把 P7 queue report 加入 default report preference：位于 turn gold-set replay 和 combined rescue reports 之后，local QC 和 queue-label reports 之前。
- 为 preview-capable rescue families 增加 structured-format preference：
  - `archived_raw_log_rescue_combined_report` latest 优先 `.json`。
  - `archived_raw_log_rescue_review_queue` latest 优先 `.jsonl`。
  - `archived_raw_log_rescue_review_queue_label_report` latest 优先 `.json`。
- 这样可以防止较新的 Markdown companion files 抢占 latest/default selection，导致没有 structured preview。
- 只读边界不变：只做 latest selection 与 rendering；不写 DB，不修改 memory，不执行 apply / unarchive / category update / delete / quarantine / reinforce，也不调用 LLM 或产生 network side effects。

验证：

```text
node --test test/console-reports.test.js
# 20/20 pass

node --test test/console-reports.test.js test/console-annotations.test.js test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js
# 40/40 pass
```

### Archived raw_log rescue P19：Console archived raw-log rescue combined report preview

P18 提交为 `d957d95 feat(console): preview rescue review queue reports` 后，P19 为 P2/P4 archived raw-log rescue combined label report 增加 `/reports` 结构化预览。combined reports 已经在 allowlist 中并被 latest tracking 识别，但此前选中后仍需要直接阅读 raw JSON/Markdown 才能看 scoring 与 breakdown。

实现内容：

- 在 `console/services/reports-service.js` 为 `archived_raw_log_rescue_combined_report` JSON files 增加 `rescue_combined_preview` derivation。
- Preview 提取：
  - threshold and unsure threshold
  - labels valid/invalid counts
  - total scored labels
  - exact match / exact accuracy
  - yes true/false positive/negative counts
  - yes precision / recall / F1
  - manual review count
  - non-manual count
  - predicted keep_active distribution
  - actual keep_active distribution
  - manual-review raw/final prediction distributions
  - manual-review flag distribution
  - manual-review selection reason distribution
  - manual-review target category distribution
  - manual-review rescue confidence distribution
  - non-manual prediction distribution
  - non-manual selection reason distribution
  - by-round metrics
  - by-bucket metrics
  - by-selection-reason metrics
  - first 10 false positives
  - first 10 false negatives
  - first 10 invalid labels
- 在 `/reports` 新增 `Archived Raw-log Rescue Combined Preview` panel。
- 在 `console/public/charts.js` 新增 `renderRescueCombinedPreview()`。
- 为 `latest.archived_raw_log_rescue_combined_report` 增加 latest-card/default-report preference，位置在 turn gold-set replay 之后、local QC 与 queue label reports 之前。
- 安全边界保持明确：不写 DB，不修改 memory file，不执行 unarchive / category update / delete / quarantine / reinforce，不调用 LLM，也不产生 network side effects。

验证：

```text
node --test test/console-reports.test.js
# 18/18 pass

node --test test/console-reports.test.js test/console-annotations.test.js test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js
# 38/38 pass
```

### Archived raw_log rescue P18：Console review queue JSONL preview

P17 提交为 `65c3b7d feat(console): preview rescue queue label reports` 后，P18 为 P7 manual-review queue JSONL 本身补上剩余的 `/reports` 结构化预览。Queue JSONL 已经 allowlisted 且可在 `/annotations` 加载，但此前在 `/reports` 中选中后只显示 raw JSONL。

实现内容：

- 在 `console/services/reports-service.js` 为 `archived_raw_log_rescue_review_queue` JSONL files 增加 `review_queue_preview` derivation。
- Preview 提取：
  - total queue rows
  - unique sample ids
  - duplicate sample-id count
  - min/max queue priority
  - archived count
  - content-missing count
  - review reason distribution
  - primary bucket distribution
  - raw predicted keep_active distribution
  - final predicted keep_active distribution
  - manual review flag distribution
  - risk signal distribution
  - first 10 queue samples
  - first 10 duplicate sample ids
- 在 `/reports` 新增 `Review Queue Preview` panel。
- 在 `console/public/charts.js` 新增 `renderReviewQueuePreview()`。
- 从 `/reports` table 选择 P7 queue JSONL 时可看到该 preview。
- 安全边界保持明确：不写 DB，不修改 memory file，不执行 unarchive / category update / delete / quarantine / reinforce，不调用 LLM，也不产生 network side effects。

验证：

```text
node --test test/console-reports.test.js
# 17/17 pass

node --test test/console-reports.test.js test/console-annotations.test.js test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js
# 37/37 pass
```

### Archived raw_log rescue P17：Console review queue label report preview

P16 提交为 `526e57c feat(console): preview local annotation qc reports` 后，P17 为 P8 review queue label alignment reports 增加对应的 `/reports` 结构化预览。此前 `archived-raw-log-rescue-review-queue-label-report-*.json` 已经 allowlisted 并纳入 latest tracking，但 detail view 仍只显示 raw JSON/Markdown。

实现内容：

- 在 `console/services/reports-service.js` 为 `archived_raw_log_rescue_review_queue_label_report` JSON files 增加 `review_queue_label_preview` derivation。
- Preview 提取：
  - queue total/valid/unique counts
  - queue invalid and duplicate sample-id counts
  - labels total
  - valid aligned labels
  - invalid labels
  - labels not in queue
  - identity mismatches
  - duplicate label sample ids
  - unlabeled queue count
  - coverage rate
  - top queue reason distribution
  - queue bucket distribution
  - quality distribution
  - keep_active distribution
  - preferred_action distribution
  - target_category distribution
  - rescue_confidence distribution
  - first 10 queue errors
  - first 10 invalid labels
  - first 10 labels not in queue
  - first 10 identity mismatches
  - first 10 duplicate queue/sample ids
  - first 10 unlabeled queue samples
  - first 10 valid labels
- 在 `/reports` 新增 `Review Queue Label Preview` panel。
- 在 `console/public/charts.js` 新增 `renderReviewQueueLabelPreview()`。
- 为 `latest.archived_raw_log_rescue_review_queue_label_report` 增加 latest-card/default-report preference，位置在 turn gold-set replay 和 local QC reports 之后、generic annotation summaries 之前。
- 安全边界保持明确：不写 DB，不修改 memory file，不执行 unarchive / category update / delete / quarantine / reinforce，不调用 LLM，也不产生 network side effects。

验证：

```text
node --test test/console-reports.test.js
# 16/16 pass

node --test test/console-reports.test.js test/console-annotations.test.js test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js
# 36/36 pass
```

### Archived raw_log rescue P16：Console annotation local QC report preview

P15 提交为 `59a7d4e feat(console): load annotation labels from reports` 后，P16 为 browser-local annotation QC reports 增加 `/reports` 结构化预览。此前 `annotation-local-qc-report-*.json` 可以 list/read，但 detail view 只是 raw JSON `<pre>`。

实现内容：

- 在 `console/services/reports-service.js` 为 `annotation_local_qc_report` JSON files 增加 `annotation_local_qc_preview` derivation。
- 该 preview 是 QC JSON 的只读投影，提取：
  - total candidates
  - unique sample ids
  - duplicate candidate sample ids
  - labeled count
  - unlabeled count
  - coverage rate
  - last label-import skipped counts
  - top candidate bucket distribution
  - top queue reason distribution
  - quality distribution
  - keep_active distribution
  - preferred_action distribution
  - target_category distribution
  - rescue_confidence distribution
  - first 10 unlabeled samples
  - first 10 duplicate sample ids
- 在 `/reports` 新增 `Annotation QC Preview` panel。
- 在 `console/public/charts.js` 新增 `renderAnnotationQcPreview()`。
- 为 `latest.annotation_local_qc_report` 增加 latest-card/default-report preference，位置在 turn gold-set replay 之后、generic annotation summary 之前。
- derived preview 的安全边界保持明确：不写 DB，不修改 memory file，不 upload，不执行 apply / archive / delete / quarantine / reinforce，不调用 LLM，也不产生 network side effects。

验证：

```text
node --test test/console-reports.test.js
# 15/15 pass

node --test test/console-reports.test.js test/console-annotations.test.js test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js
# 35/35 pass
```

### Archived raw_log rescue P15：Console 一键加载 whitelisted label reports

P14 提交为 `e7ab763 feat(console): load annotation candidates from reports` 后，P15 补齐 label reports 的一键续标路径。`/annotations` 现在可以在 candidate/queue report 已加载后，从 Console 列表加载 whitelisted labels JSONL。

实现内容：

- 在 `/annotations` 增加 `Available Label Reports`。
- 为 `annotationReportsSnapshot().available_labels` 列出的 whitelisted labels JSONL 增加 `Load` 按钮。
- 增加通过 `/api/reports/file?name=<label-report>` 的只读 fetch 路径。
- Labels 只能在 candidate/queue JSONL 已加载后通过 server 加载。
- 该 UI 路径只允许加载 JSONL label reports。
- server-loaded labels 复用现有 `importLabelsFromText()` flow。
- 现有 identity alignment 继续生效：
  - `sample_id`
  - `memory_id`
  - `chunk_id`
  - `primary_bucket`
  - `source_path`
- Wrong-queue labels、identity mismatches、empty labels 和 parse-invalid lines 仍会被 skipped and counted。
- 为 candidate 和 label report lists 增加 shared `renderReportList()` helper。
- 加载新的 candidate report 会重置 server label-report status，避免 stale label import state 跨 queue 泄漏。
- 只读边界不变：没有新增 upload、DB write、apply、archive、delete、quarantine、reinforce 或 memory mutation path。

验证：

```text
node --test test/console-annotations.test.js
# 11/11 pass

node --test test/console-reports.test.js test/console-annotations.test.js test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js
# 34/34 pass
```

### Archived raw_log rescue P14：Console 一键加载 whitelisted candidate reports

P13 提交为 `ec14e9a feat(console): list local annotation qc reports` 后，P14 移除 `/annotations` 中已经可见 reports 的最后一步手动选文件操作。Available candidate reports 现在可以直接通过现有只读 reports API 从 Console 列表加载。

实现内容：

- 更新 `/annotations`，为每个 available candidate report 显示 `Load` 按钮。
- 增加通过 `/api/reports/file?name=<report>` 的只读 fetch 路径。
- server-side allowlist 仍是可读文件的唯一权威。
- 只有 JSONL reports 可以加载进 annotation UI。
- server-loaded reports 复用与本地 browser-selected files 相同的 `parseJsonl()` 和 normalization path。
- 加载 server report 会清空现有 labels、重置 label import state、刷新 bucket filters、重置 view filters，与本地 file-load 行为一致。
- 增加 server candidate loading / failure 状态文本。
- 更新安全文案：页面现在支持 browser-local file loading 或 whitelisted read-only report loading，但仍不上传 labels、不写 DB、不修改 memory。
- 只读边界不变：没有新增 apply、archive、delete、quarantine、reinforce、DB write 或 memory mutation path。

验证：

```text
node --test test/console-annotations.test.js
# 10/10 pass

node --test test/console-reports.test.js test/console-annotations.test.js test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js
# 33/33 pass
```

### Archived raw_log rescue P13：Console reports 对 local QC report 的 handoff

P12 提交为 `069ca24 feat(console): export local annotation qc report` 后，P13 补齐 browser-local QC reports 的归档/handoff 缺口。浏览器可下载 `annotation-local-qc-report-*.json`；现在只要该文件移动到 `reports/`，Console reports service 就能识别它，而不会把它当成 candidate 或 labels file。

实现内容：

- 在 `console/services/reports-service.js` allowlist 中增加 `annotation_local_qc_report`。
- 支持浏览器下载 timestamp 文件名：
  - `annotation-local-qc-report-YYYY-MM-DDTHH-MM-SS.mmmZ.json`
  - `annotation-local-qc-report-YYYY-MM-DDTHH-MM-SSZ.json`
- 把 `annotation_local_qc_report` 加入 latest report tracking。
- 确认 `/reports/file` 可以把 QC JSON 作为 whitelisted report 读取。
- 确认 `/annotations` 不会把 local QC reports 列为 loadable candidates。
- 确认 `/annotations` 不会把 local QC reports 列为 labels。
- 安全边界不变：只 list/read reports；不写 DB，不修改 memory，不执行 apply / archive / delete / quarantine / reinforce。

验证：

```text
node --test test/console-reports.test.js
# 14/14 pass

node --test test/console-reports.test.js test/console-annotations.test.js test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js
# 32/32 pass
```

### Archived raw_log rescue P12：Console browser-local QC report export

P11 提交为 `7cc7b69 feat(console): resume annotation labels locally` 后，P12 降低 manual review loop 对命令行的依赖：`/annotations` 现在可以基于当前已加载的 candidate/queue 和 labels 导出 browser-local QC report。

实现内容：

- 在 `/annotations` 增加 `Export QC Report JSON`。
- Report 完全在浏览器中由 loaded candidate JSONL 与 local labels 生成。
- 没有新增 upload、DB write、apply、archive、delete、quarantine、reinforce、LLM、network 或 server-side report generation path。
- Report mode 为 `annotation_local_qc_report`。
- Report 包含：
  - candidate count
  - unique candidate sample count
  - duplicate candidate sample-id count
  - labeled count
  - unlabeled count
  - coverage rate
  - candidate bucket distribution
  - queue reason distribution
  - quality distribution
  - keep_active distribution
  - preferred_action distribution
  - target_category distribution
  - rescue_confidence distribution
  - last label-import skipped counts
  - first 25 duplicate sample ids
  - first 25 unlabeled samples
- 加载新 candidate file 会重置 last label-import summary，避免 stale skipped counts 被带到新 review 中。
- Label export schema 保持不变。

验证：

```text
node --test test/console-annotations.test.js
# 9/9 pass

node --test test/console-reports.test.js test/console-annotations.test.js test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js
# 30/30 pass
```

### Archived raw_log rescue P11：Console local label resume support

P10 提交为 `a2ade05 feat(console): show rescue review queue metadata` 后，P11 修复下一个 GUI workflow 缺口：`/annotations` 能导出 labels，但不能重新加载已有 labels JSONL 来恢复未完成的 manual review。

实现内容：

- 在 `/annotations` 增加 `Load labels JSONL to resume`。
- Label import 仍然是 browser-local，并且只使用 File API；没有新增 upload、DB write、apply、archive、delete、quarantine 或 reinforce path。
- Labels 只能在 candidate JSONL 加载后导入。
- Imported labels 会按 `sample_id` 和 identity fields 匹配当前 candidate set：
  - `memory_id`
  - `chunk_id`
  - `primary_bucket`
  - `source_path`
- 不属于当前 candidate set 的 labels 会被 skipped and counted。
- identity mismatches 会被 skipped and counted。
- Empty labels 与 parse-invalid rows 会被 skipped and counted。
- 加载新 candidate file 会清空已导入 labels 并重置 label-file input，防止 stale cross-queue progress 泄漏到新 review。
- Imported labels 会写入现有 local label map，因此 progress counts 和 `Unlabeled only` filtering 能在 resumed sessions 中继续工作。
- Export schema 保持不变。

验证：

```text
node --test test/console-annotations.test.js
# 8/8 pass

node --test test/console-reports.test.js test/console-annotations.test.js test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js
# 29/29 pass
```

### Archived raw_log rescue P10：Console review queue metadata 展示

P9 提交为 `7f7426c feat(console): list rescue review queue reports` 后，P10 修复下一个 Console handoff 缺口：`/annotations` 可以加载 P7 queue JSONL，但页面会把 samples 归一化成 generic annotation fields，从而丢掉标注者需要的 review-queue context。

实现内容：

- 更新 `console/views/annotations.ejs`，加载 candidate JSONL 时保留 P7 queue metadata：
  - `queue_type`
  - `queue_priority`
  - `review_reasons`
  - `raw_predicted_keep_active`
  - `predicted_keep_active`
  - `score`
  - `boundary_distance`
  - `manual_review_flags`
  - `scoring_parts`
  - `prior_sampling_reason`
- 在 `/annotations` 增加条件显示的 `Review Queue Metadata` card。
- Card 展示：
  - queue priority
  - raw → final prediction
  - score / boundary distance
  - prior sampling reason
  - review reasons
  - manual review flags
  - risk signals
  - scoring parts
- 普通 candidate JSONL row 如果没有 queue metadata，该 card 会隐藏。
- Label export schema 不变；queue metadata 仅用于展示，不写入 label JSONL。
- 只读边界不变：没有 upload、DB write、apply、archive、delete、quarantine 或 reinforce。

验证：

```text
node --test test/console-annotations.test.js
# 7/7 pass

node --test test/console-reports.test.js test/console-annotations.test.js test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js
# 28/28 pass
```

### Archived raw_log rescue P9：Console reports 对 P7/P8 artifacts 的 handoff

P8 提交为 `e40296e feat(annotation): add rescue review queue label report` 后，P9 修复 Console handoff 缺口：P7/P8 artifacts 已经在磁盘上存在，但 Console reports allowlist 还不识别 archived raw_log rescue artifact names，`/annotations` 也不会把 P7 queue 列为 loadable candidate。

实现内容：

- 更新 `console/services/reports-service.js` allowlist，支持：
  - `archived-raw-log-rescue-combined-report-p*-*.{json,md}`
  - `archived-raw-log-rescue-manual-review-queue-p*-*.{jsonl,md}`
  - `archived-raw-log-rescue-review-queue-label-report-p*-*.{json,md}`
- 把 rescue combined report 和 review queue label report 加入 latest report tracking。
- 更新 `annotationReportsSnapshot()`，让 `/annotations` 把 P7 manual-review queue JSONL 列为 loadable candidate。
- Markdown queue files 和 label reports 继续排除在 `available_candidates` 之外，避免 annotation UI 误把非 sample artifact 当成 candidate file。
- 增加 Console reports tests，覆盖 classification、latest null defaults 和 annotation snapshot candidate list。

变更后的真实 repo snapshot：

```text
p7_kind = archived_raw_log_rescue_review_queue
p8_kind = archived_raw_log_rescue_review_queue_label_report
available_candidates includes archived-raw-log-rescue-manual-review-queue-p7-20260704.jsonl
latest_rescue_combined = archived-raw-log-rescue-combined-report-p2-p4-20260703.md
latest_rescue_label_report = archived-raw-log-rescue-review-queue-label-report-p8-preflight-20260704.md
```

验证：

```text
node --test test/console-reports.test.js test/console-annotations.test.js
# 18/18 pass
```

### Archived raw_log rescue P8：review queue label alignment report

P7 提交为 `07a5eee feat(annotation): add rescue manual review queue` 后，P8 增加 queue-aware label report，避免未来 manual-review labels 在没有确认属于同一个 P7 queue 的情况下被错误汇总。

实现内容：

- 新增 `bin/report-archived-raw-log-rescue-review-queue-labels.cjs`。
- 新增 `test/report-archived-raw-log-rescue-review-queue-labels.test.js`。
- Report 会先验证 queue rows，并检查显式安全字段：
  - `db_writes=false`
  - `unarchive=false`
  - `category_update=false`
  - `delete=false`
  - `quarantine=false`
  - `reinforce=false`
- Report 会按 `sample_id` 和 identity fields 验证 labels 是否属于该 queue：
  - `memory_id`
  - `chunk_id`
  - `primary_bucket`
  - `source_path`
- 重复 label `sample_id` 被视为 blocking issue，且不计入 aligned coverage，避免重复 label 抬高覆盖率。
- Report 支持无 labels 的 preflight mode：只验证 queue integrity，并报告所有 queue rows 均为 unlabeled。
- Report 同时输出 JSON 和 Markdown。

生成的 P8 preflight artifacts：

```text
reports/archived-raw-log-rescue-review-queue-label-report-p8-preflight-20260704.json
reports/archived-raw-log-rescue-review-queue-label-report-p8-preflight-20260704.md
```

Preflight 命令：

```bash
node bin/report-archived-raw-log-rescue-review-queue-labels.cjs \
  --queue reports/archived-raw-log-rescue-manual-review-queue-p7-20260704.jsonl \
  --out-json reports/archived-raw-log-rescue-review-queue-label-report-p8-preflight-20260704.json \
  --out-md reports/archived-raw-log-rescue-review-queue-label-report-p8-preflight-20260704.md \
  --sample-limit 10
```

Preflight 摘要：

```text
queue_total = 50
queue_valid = 50
queue_unique_sample_ids = 50
queue_invalid = 0
queue_duplicate_sample_ids = 0
labels_total = 0
labels_valid_aligned = 0
queue_unlabeled = 50
coverage_rate = 0
queue_reason_distribution = positive_negative_conflict: 50
queue_bucket_distribution = archived_raw_log_project: 50
```

验证：

```text
node --test test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js
# 9/9 pass

node --test test/report-archived-raw-log-rescue-review-queue-labels.test.js test/build-archived-raw-log-rescue-review-queue.test.js test/report-archived-raw-log-rescue-labels.test.js test/evaluate-archived-raw-log-rescue-labels.test.js test/archived-raw-log-rescue-rules-scoring.test.js test/archived-raw-log-rescue-sampler.test.js
# 35/35 pass
```

### Archived raw_log rescue P7：manual-review queue artifact

P7 开始并实现 archived raw_log rescue 的 manual-review queue 设计。该 queue 刻意与 P6 combined label report 分离：combined report 用于衡量 scoring quality，而 P7 queue 负责产出下一轮稳定 human-review artifact。

安全边界保持不变：

```text
DB write = false
unarchive = false
category_update = false
delete = false
quarantine = false
reinforce = false
```

实现内容：

- 新增 `bin/build-archived-raw-log-rescue-review-queue.cjs`。
- 新增 `test/build-archived-raw-log-rescue-review-queue.test.js`。
- 扩展 `lib/annotation/archived-raw-log-rescue-sampler.cjs`，让 `scoreCandidate()` 把 `unsureThreshold` 传入 scoring，而不是在下游暴露一个假的/无效的 CLI knob。
- Queue priority 确定性排序，重点围绕：
  - `positive_negative_conflict`
  - `raw_predicted_keep_active=yes && predicted_keep_active=unsure`
  - `near_boundary`
  - `predicted_unsure` 作为低优先级 fallback
- Queue rows 包含 annotation-ready JSONL fields，以及 score、boundary distance、raw/final prediction、manual review flags、source input/line、preview content 和显式 no-side-effect safety fields。
- CLI 支持通过 `--exclude-labels` 排除已标注样本，因此 seed/P2/P4 已标注 samples 不会被重新加入 queue。
- CLI 可同时写出 JSONL 和 Markdown artifacts。

生成的 P7 local artifacts：

```text
reports/archived-raw-log-rescue-manual-review-queue-p7-20260704.jsonl
reports/archived-raw-log-rescue-manual-review-queue-p7-20260704.md
```

生成命令：

```bash
node bin/build-archived-raw-log-rescue-review-queue.cjs \
  --input reports/archived-raw-log-rescue-candidates-active-p2-pool.jsonl,reports/archived-raw-log-rescue-candidates-active-p4-pool.jsonl \
  --exclude-labels reports/archived-raw-log-rescue_labels_seed_v0.1_20samples_20260702.jsonl,reports/archived-raw-log-rescue_labels_active_p2_20samples_20260703.jsonl,reports/archived-raw-log-rescue_labels_active_p4_20samples_20260703.jsonl \
  --limit 50 \
  --out-jsonl reports/archived-raw-log-rescue-manual-review-queue-p7-20260704.jsonl \
  --out-md reports/archived-raw-log-rescue-manual-review-queue-p7-20260704.md
```

生成 queue summary：

```text
input_count = 1100
excluded_count = 51
duplicate_sample_ids = 70
eligible_count = 390
selected_count = 50
primary_reason_distribution = positive_negative_conflict: 50
all_reason_distribution = positive_negative_conflict: 50, raw_yes_capped_to_unsure: 50, near_boundary: 50
predicted_distribution = unsure: 50
raw_predicted_distribution = yes: 50
```

验证：

```text
node --test test/build-archived-raw-log-rescue-review-queue.test.js test/archived-raw-log-rescue-sampler.test.js
# 9/9 pass

node --test test/report-archived-raw-log-rescue-labels.test.js test/evaluate-archived-raw-log-rescue-labels.test.js test/archived-raw-log-rescue-rules-scoring.test.js
# 21/21 pass
```

也运行了 full `npm test`。全局没有通过：725 个测试中 711 pass / 8 fail / 6 skip。失败集中在既有 smart-add duplicate baseline/manifest/preview 断言上，这些断言依赖当前真实数据 baseline count；不属于 archived raw_log rescue P7 路径。

## 2026-07-03

### Archived raw_log rescue active learning closeout: P3.5 → P6

今天继续推进 archived raw_log rescue 标注闭环，重点从“能抽样、能标注”推进到“能用两轮人工标签校准 scoring / manual-review 策略”。本轮仍保持 safety boundary：只读评估、只写 annotation/report 文件，不写 DB，不执行 unarchive / category update / delete / quarantine / reinforce。

#### P3.5：conflict scoring refinement

P2 第一轮 20 条 active samples 标注完成后，回放发现 `positive_negative_conflict` 样本在第一轮里 4/4 都被标成 `keep_active=yes`。因此先做了一版 conflict scoring refinement：

- `positive_negative_conflict_penalty` 从纯 transient penalty 中拆出来，设置为弱负分 `-5`。
- `engineering_evidence_signal + transient_runtime_noise_signal` 不再直接吃 `transient_runtime_noise_penalty=-35`。
- scoring 增加 `manual_review_flags=["positive_negative_conflict"]`。
- sampler JSONL 输出增加 `sampling.manual_review_flags`。

P3.5 在 P2 上显著提升 recall，但这个判断后来被 P4 第二轮标注修正。

#### P4：排除已标注样本并生成第二轮 active samples

完成 P3.5 后提交，再新增 sampler exclude 能力：

- `bin/v4-active-sampler.cjs` 新增 `--exclude-labels <path[,path...]>`。
- Sampler 会读取 labels JSONL 中的 `sample_id`，从候选池里排除已标注样本，再做 active sampling。
- 新增测试覆盖已标注样本不重复抽取。

生成第二轮候选与样本：

```bash
node bin/export-archived-raw-log-rescue-candidates.cjs \
  --limit 1000 \
  --preview-chars 1000 \
  --out reports/archived-raw-log-rescue-candidates-active-p4-pool.jsonl

node bin/v4-active-sampler.cjs \
  --input reports/archived-raw-log-rescue-candidates-active-p4-pool.jsonl \
  --exclude-labels reports/archived-raw-log-rescue_labels_active_p2_20samples_20260703.jsonl \
  --limit 20 \
  --format jsonl \
  --out reports/archived-raw-log-rescue-active-samples-p4-20samples.jsonl
```

P4 样本检查：

```text
rows = 20
overlap_with_p2_labels = 0
all_have_sampling = true
all_have_annotation = true
```

P4 标注结果保存到：

```text
reports/archived-raw-log-rescue_labels_active_p4_20samples_20260703.jsonl
```

第二轮人工标签分布与 P2 完全不同：

```text
P4 labels: yes = 5, no = 15
```

其中大量 `positive_negative_conflict` 实际是 `raw_log` / `episodic` / polluted dialogue summary，应当 drop 或保留人工复核，而不是自动 keep。

#### P5：把 conflict prediction cap 到 unsure

P4 回放证明 P3.5 的弱负分策略会产生大量 false positive：

```text
P3.5 on P4:
yes_false_positive = 15
yes_precision ≈ 0.118
```

因此 P5 改为更安全的策略：

```text
positive_negative_conflict = high-priority manual review
positive_negative_conflict != automatic keep
```

实现：

- `computeArchivedRawLogRescueScore()` 增加 `raw_predicted_keep_active`。
- 如果 `hasPositiveNegativeConflict && raw_predicted_keep_active === "yes"`，则最终 `predicted_keep_active` cap 为 `unsure`。
- `score` / `boundary_distance` 仍保留，用于 sampler 排序与 boundary analysis。
- `parts` 增加 `positive_negative_conflict_prediction_cap:0`，便于解释。
- sampler JSON / JSONL 输出增加 `sampling.raw_predicted_keep_active`。

P5 回放：

```text
P2:
labels_valid = 20
yes_false_positive = 0
yes_false_negative = 7
yes_precision = 1.0
yes_recall ≈ 0.588

P4:
labels_valid = 20
yes_false_positive = 0
yes_false_negative = 4
yes_precision = 1.0
yes_recall = 0.2
```

结论：P5 牺牲了一部分 recall，但消除了 P4 暴露出的 raw_log false positive；这是当前 rescue pipeline 更安全的方向。

#### P6：P2 + P4 combined label report

新增 combined report 工具：

- `bin/report-archived-raw-log-rescue-labels.cjs`
- `test/report-archived-raw-log-rescue-labels.test.js`

功能：

- 支持多轮 `--pair name=labels:candidates`。
- 合并多轮 labels/candidates。
- 去重并报告 duplicate / missing candidate / invalid keep_active。
- 输出 JSON 和 Markdown。
- 单独统计 `manual_review` 与 `non_manual`。
- 按 round / bucket / selection_reason 统计 metrics。
- 明确 `write_db=false`、`memory_side_effects=false`、`reinforcement_side_effects=false`。

P6 生成的报告：

```text
reports/archived-raw-log-rescue-combined-report-p2-p4-20260703.json
reports/archived-raw-log-rescue-combined-report-p2-p4-20260703.md
```

由于 P2 active samples 文件曾缺失，先用 P2 pool 重新生成，并验证与 P2 labels 20/20 对齐后保存回：

```text
reports/archived-raw-log-rescue-active-samples-p2-20samples.jsonl
```

最终 combined report 关键结果：

```text
valid labels = 40
invalid labels = 0
actual yes = 22
actual no = 18
predicted yes = 11
predicted unsure = 23
predicted no = 6
yes_false_positive = 0
yes_false_negative = 11
yes_precision = 1.0
yes_recall = 0.5
```

Manual review bucket：

```text
manual_review total = 23
actual yes = 7
actual no = 16
predicted unsure = 23
raw predicted yes = 20
```

Selection reason 观察：

```text
positive_negative_conflict:
  total = 9
  actual yes = 4
  actual no = 5
  predicted unsure = 9

boundary:
  total = 15
  actual yes = 7
  actual no = 8
  yes_precision = 1.0
  yes_recall = 1.0

bucket_diversity:
  total = 12
  actual yes = 10
  actual no = 2
  yes_precision = 1.0
  yes_recall = 0.4

transient_sanity_check:
  total = 4
  actual yes = 1
  actual no = 3
```

核心结论：

- `positive_negative_conflict` 不是 yes，也不是 no，而是稳定的 manual-review queue。
- P5 cap 后，overall yes precision 保持 1.0，当前没有 false positive。
- `manual_review` 里 no 多于 yes，不能自动 restore。
- `boundary` 批次表现最好，可作为后续提升 recall 的优先分析对象。
- `keyword` / `transient` 仍存在少量人工 yes，但应优先从 signal refinement 修正，不应放宽 hard-drop。

#### 已提交节点

今天已提交：

```text
5912320 feat(annotation): refine raw log rescue active sampling
cd2b784 feat(annotation): exclude labeled samples in rescue sampler
a6a703d fix(annotation): cap conflict rescue predictions to unsure
```

P6 当前尚未提交，新增未提交文件：

```text
bin/report-archived-raw-log-rescue-labels.cjs
test/report-archived-raw-log-rescue-labels.test.js
```

#### 验证

P6 最终 targeted suite：

```bash
node --check bin/report-archived-raw-log-rescue-labels.cjs
git diff --check
node --test \
  test/annotation-reviewer-static.test.js \
  test/console-annotations.test.js \
  test/archived-raw-log-rescue-rules-scoring.test.js \
  test/archived-raw-log-rescue-sampler.test.js \
  test/evaluate-archived-raw-log-rescue-labels.test.js \
  test/report-archived-raw-log-rescue-labels.test.js
```

结果：

```text
# tests 35
# pass 35
# fail 0
```

未执行项：

- 未运行全量 `npm test`。
- 未写入真实 DB。
- 未执行 unarchive / category update / delete / quarantine / reinforce。
- 未把 reports runtime artifacts 加入 commit。

#### 明天继续：P7 manual-review queue design

建议下一步从 P6 结论继续做 P7：

- 生成稳定的 manual-review queue artifact，而不是继续混在普通 active samples 中。
- queue 输入优先来自：`positive_negative_conflict`、`raw_predicted_keep_active=yes && predicted_keep_active=unsure`、boundary near-threshold。
- queue 输出应包含：raw/capped prediction、manual_review_flags、selection_reason、target_category / rescue_confidence 分布、source bucket、compact reasons。
- 保持 read-only，只产出 JSONL / Markdown，不做 lifecycle apply。
- 后续再用更多人工标签判断是否需要拆分 conflict 子类，例如 `autorecall_log_noise`、`polluted_dialogue_summary`、`project_decision_with_noise`、`config_change_with_noise`。

### AutoRecall P5 card-first runtime canary plan

在 P4 closeout 之后，补齐 P5 opt-in canary plan。目标不是直接打开 card-first runtime，而是让下一次真实 `edi` canary 有明确的 schema、preflight、观测 SQL、通过/失败标准和回滚步骤。

#### Config schema 开关补齐

- `openclaw.plugin.json` 的 `autoRecall` schema 仍保持 `additionalProperties=false`。
- 新增 `autoRecall.cardFirstRuntime.enabled` schema，使本地 config 可以显式 opt-in，而不会被 manifest schema 拒绝。
- 默认值仍为：
  - `autoRecall.enabled=false`
  - `autoRecall.cardFirstRuntime.enabled=false`
- schema 只暴露开关，不改变 runtime 默认行为。
- runtime 仍由 `shouldUseAutoRecallCardRuntime()` 额外限制为 `agentId=edi`；`task-planner`、Codex CLI、缺失 agent id、非 user role、非 interactive chat 都不应进入 card-first。

#### Canary plan 文档

- 新增 `docs/auto-recall-card-runtime-canary-plan.md`。
- 文档明确 P5 是 local-only / opt-in canary，不建议 broad rollout。
- 记录 non-goals：不启用 task-planner / Codex CLI、不同时启用 active-memory 与 memory-engine autoRecall、不改 retrieval ranking、不自动调用 `memory_engine_get`、不注入 full content、不因 card render/search result/Console preview reinforcement。
- 记录 preflight checklist：`git diff --check`、`node --check index.js`、`node bin/run-auto-recall-card-runtime-smoke.js --json`、以及 autoRecall/runtime/card 相关 targeted tests。
- 记录 5 类 canary prompts：project continuation、P4 decision recall、history-aware debug、generic rewrite skip、generic log summarize skip。
- 记录事件观测 SQL：检查 `auto_recall_debug` 中的 `card_first_runtime_enabled` / `auto_recall_disclosure_mode`，以及 `memory_injected` 中的 `card_first_runtime_enabled` / `disclosure_mode` / `reinforcement_allowed`。
- 记录 pass criteria：只在 `edi` interactive user turn 出现 `card_first_runtime_enabled=true`，generic long-input rewrite/summarize 仍跳过 recall，card-first context 不包含 full memory body，raw-log/tool-output withheld，citation/reinforcement 仍保持 cited-id-only。
- 记录 fail criteria：card-first 跑到 task-planner/Codex/missing agent/non-user/non-interactive，prompt supplement 泄露 full raw body/stack/timestamp/tool output，assistant 机械引用 memory id，无 cited id reinforcement，active-memory 与 memory-engine autoRecall 双重注入，或 disclosure-mode observability 缺失。
- 记录 rollback：将 `autoRecall.cardFirstRuntime.enabled=false` 或删除 `cardFirstRuntime`，重启/重载 OpenClaw gateway/plugin runtime，再用 smoke 和 event 查询确认回到 raw_text。
- 记录 canary decision template，方便后续决定 keep disabled / repeat canary / expand edi canary / reject card-first default。

#### 静态测试

- 新增 `test/auto-recall-card-runtime-canary-plan.test.js`。
- 测试覆盖：
  - canary plan 文档存在；
  - `openclaw.plugin.json` schema 暴露 `cardFirstRuntime.enabled`；
  - manifest 默认不启用 autoRecall 或 card-first runtime；
  - schema 暴露开关后 runtime 仍保持 edi-only；
  - canary plan 明确 opt-in / local-only / no broad rollout；
  - non-goals、安全边界、schema 样例、rollback config、preflight commands、event inspection SQL、pass/fail criteria、decision record template 均存在。

#### 验证

已执行 targeted tests：

```bash
git diff --check
node --test \
  test/auto-recall-card-runtime-canary-plan.test.js \
  test/auto-recall-card-runtime-smoke.test.js \
  test/auto-recall-memory-card-runtime-runbook.test.js \
  test/auto-recall-runtime-gate.test.js \
  test/config-runtime.test.js \
  test/review-findings.test.js
```

结果：

```text
# tests 48
# pass 48
# fail 0
```

未执行项：

- 未修改真实 OpenClaw runtime config。
- 未启用 `cardFirstRuntime.enabled`。
- 未运行真实 `edi` canary session。
- 未运行全量 `npm test`。

结论：

- P5 canary plan 已就绪，但 card-first runtime 仍保持默认关闭。
- 下一步可以在工作区干净、active-memory 确认关闭、autoRecall 显式启用且仅限 `edi` 的前提下，做一次短 canary session，并用事件 SQL 对照 raw_text / memory_card disclosure mode。

### Archived raw_log rescue active sampler JSONL 与 annotation filter UX

补齐 archived raw_log rescue 标注闭环中的两处 UX / workflow 缺口：一是 active sampler 能直接输出 `/annotations` 可加载的 JSONL，二是 Console annotations 页面在切换候选文件时清理旧 filter，避免 stale filter 让新文件看起来没有内容。

#### v4 active sampler JSONL 输出

- 扩展 `bin/v4-active-sampler.cjs`。
- 新增 `--format <json|jsonl>`：
  - `json`：继续输出 compact sampler summary。
  - `jsonl`：输出 annotation-ready full sample rows。
- 新增 `--out <path>`：显式写入 sampler output file。
- JSONL row 保留原 candidate/sample 字段，并新增 `sampling` metadata：
  - `sampler_version`
  - `selection_reason`
  - `sampler_tags`
  - `threshold`
  - `computed_score`
  - `predicted_keep_active`
  - `boundary_distance`
  - `score_parts`
  - `score_signals`
- `readJsonl()` 现在会过滤空行，减少手工处理 JSONL 时的脆弱性。
- Sampler helper 增加 CommonJS exports，便于测试 `serializeAnnotationSample()` / `serializeCompactSample()` / `renderOutput()`。
- 修正文案边界：sampler 不再笼统称为 read-only，而是明确为 lifecycle read-only；只有传入 `--out` 时才写 annotation output file，仍不写 DB、不 unarchive、不 category update、不 delete/quarantine/reinforce。

示例：

```bash
node bin/v4-active-sampler.cjs \
  --input reports/archived-raw-log-rescue-candidates-latest.jsonl \
  --limit 20 \
  --format jsonl \
  --out reports/archived-raw-log-rescue-active-samples.jsonl
```

#### Console `/annotations` filter reset

- 扩展 `console/views/annotations.ejs`。
- 新增 filter status：显示当前 bucket/path/unlabeled filter 和 `showing X / Y`。
- 新增 `Clear Filters` 按钮。
- 加载新 candidate file 后调用 `clearFilters()`，自动清空 stale bucket/path/unlabeled filter。
- 继续保持 browser File API local-only：server 不接收 labels upload，不写 DB，不执行 apply/delete/archive/quarantine/reinforce。

#### 测试

- 扩展 `test/archived-raw-log-rescue-sampler.test.js`：覆盖 `--format jsonl --out`、annotation-ready full rows、`sampling` metadata、输出文件写入标记和 lifecycle side-effect false。
- 扩展 `test/console-annotations.test.js`：覆盖 filter status、clear filters 按钮、加载新文件后清理 stale filters。

已执行 targeted tests：

```bash
git diff --check
node --check bin/v4-active-sampler.cjs
node --test \
  test/archived-raw-log-rescue-sampler.test.js \
  test/archived-raw-log-rescue-rules-scoring.test.js \
  test/archived-raw-log-rescue-evaluator.test.js \
  test/console-annotations.test.js \
  test/annotation-reviewer-static.test.js
```

结果：

```text
# tests 24
# pass 24
# fail 0
```

未执行项：

- 未运行全量 `npm test`。
- 未写入真实 DB。
- 未执行 unarchive / category update / delete / quarantine / reinforce。
- 未提交 sampler 生成的本地 reports artifact。

结论：

- Active sampler 现在可以直接产出下一轮人工标注可用的 JSONL。
- `/annotations` 在切换候选文件时不再受旧 filter 污染。
- 这一步仍属于标注工作流增强，不是 archived memory 自动恢复或 apply。

## 2026-07-02

### Cron maintenance command 化与 archived raw_log rescue 标注闭环

本轮围绕 nightly cron 漂移风险、archive 事故止血和 archived raw_log rescue 标注闭环做了一轮收敛。核心目标是：把纯脚本类 cron 从 `agentTurn` 退回 `command`，冻结会产生 lifecycle side effect 的 nightly maintenance，并建立 read-only 的 archived raw_log rescue 标注路径，避免把 6319 条 accidental archive 结果简单全量 rollback。

#### Cron runtime 修正与冻结

运行态确认 `Memory Daily Stats` 已保持 `command` payload，04:00 自然调度成功，不再依赖外层 LLM agent 启动。

进一步检查发现 `Memory Engine Nightly Maintenance` 虽然被改成 `deepseek/deepseek-v4-flash` 并清空 `toolsAllow` 后可手动标记成功，但 cron summary 只显示读取 skill，没有证据证明实际执行了 `detect-conflicts -> archive -> kg-bridge -> status`。同时 `memory-weekly-p2-stats` 被重建为 `agentTurn`，暴露全工具列表，这会重新引入 Episode Drift / 权限膨胀 / 模型 allowlist 依赖风险。

本轮将运行态 cron 收敛为：

* `Memory Daily Stats`：保持 `command`，直接运行 `memory-stats.js`。
* `memory-weekly-p2-stats`：改回 `command`，直接运行 `memory-weekly-stats.js`。
* `Memory Engine Nightly Maintenance`：改为 command 指向 repo 内 `bin/nightly-maintenance-command.cjs`，随后冻结为 `--dry-run`，等待 archive 策略审计完成后再允许 apply。

新增 `bin/nightly-maintenance-command.cjs`，作为 command-safe maintenance runner。设计边界：

* 只写 memory-engine DB 生命周期表。
* `ATTACH` core DB 只读，并通过 core write guard 防止误写 `core.*`。
* 输出 JSON summary。
* 支持 `--dry-run`。
* 步骤覆盖 `detect_conflicts`、`archive`、`kg_bridge`、`status`。

手动 apply 时触发了实际 lifecycle side effect：

* `archive.scanned = 7141`
* `archive.archived = 6319`
* archived rows 主要来自 `memory/smart-add/*` 的 `raw_log`

随后立即将 nightly cron 冻结为 dry-run，避免下一次自然调度继续写入。

#### Archived raw_log rescue 审计与候选导出

只读审计确认 6319 条 archived memory 主要是 smart-add raw_log，覆盖 `2026-05-09` 到 `2026-06-22`。抽样与关键词审计显示其中大部分是 raw log / debug / execution trace，但也混有 project、decision、preference、todo 等高价值信息。因此决定不做全量 rollback，而是走小样本人工标注 + 规则放大的 rescue 路径。

新增 archived raw_log rescue candidate exporter：

* `bin/export-archived-raw-log-rescue-candidates.cjs`
* `bin/export-archived-raw-log-rescue-candidates.js`

Exporter 保持 read-only：

* 不写 DB。
* 不 unarchive。
* 不更新 category。
* 不 delete / quarantine / reinforce。
* 只输出 annotation-ready JSONL / Markdown candidate report。

默认候选关键词：

* `决定`
* `结论`
* `修复`
* `偏好`
* `待办`
* `memory-engine`
* `OpenClaw`

候选导出采用 stratified bucket，默认覆盖：

* `archived_raw_log_decision`
* `archived_raw_log_preference`
* `archived_raw_log_todo`
* `archived_raw_log_project`
* `archived_raw_log_keyword`

已生成本地标注候选：

* `reports/archived-raw-log-rescue-candidates-latest.jsonl`

该 reports 产物属于本地运行数据，不纳入提交。

#### Annotation UI 扩展

扩展 Console `/annotations` 本地标注页，继续保持 browser File API local-only，不增加任何 DB write / apply / upload 能力。

新增 archived raw_log rescue 相关字段：

* `keep_active`
* `target_category`
* `rescue_confidence`

保留并复用原有字段：

* `quality`
* `currency`
* `auto_recall_eligible`
* `preferred_action`
* `reason`
* `notes`

标注流程确认：

* candidate JSONL 由本地浏览器读取。
* labels JSONL 由本地浏览器导出。
* server 不接收 label upload。
* 不产生 restore / unarchive / category update / delete / quarantine / reinforce side effect。

用户已完成第一批 seed labels，导出到：

* `reports/archived-raw-log-rescue_labels_seed_v0.1_20samples_20260702.jsonl`

后续检查发现该文件实际包含 23 条 label，其中至少一条 `keep_active` 为空。因此后续 evaluator 必须区分 valid / invalid label，不能把空标注用于阈值校准。

#### v0.1 policy 与 v0.2 scoring 复盘

基于第一批标注，暂定 v0.1 rescue policy：

* `archived_raw_log_keyword` terminal drop。
* 只有 project-related decision 才保留。
* preference 是稳定正信号。
* todo 不是 category，而是 lifecycle / temporal state，需要弱化并分级。
* `keep_active=no` 优先于 `target_category`。
* `rescue_confidence=low` 默认压制。
* `unsure` 默认不进入自动 apply。

本轮 review 后明确：v0.1 deterministic rules 尚未工程化，不能视为已实现。后续应抽出独立 rule engine，再让 preview / evaluator / sampler 共用。

#### v0.4 active sampler MVP 与 v0.2 scoring rebalancing

新增实验性 sampler：

* `bin/v4-active-sampler.cjs`

当前定位是 annotation sampling prototype，不是 production apply tool。它读取 archived raw log rescue candidates，计算 v0.2 scoring，并按 `abs(score - threshold)` 选择最接近边界的样本，帮助提高下一轮人工标注的信息密度。

第一版 sampler 暴露出 scoring 缺陷：

* `project 45 + todo 15 = 60`，刚好撞上 threshold。
* top20 中 todo 占 11 条。
* 多条 sample `computed_score = 60`，出现 threshold collapse。

随后修正 v0.2 scoring：

* `threshold = 55`
* `unsure_threshold = 30`
* `project = +44`
* `projectDecision = +18`
* `preference = +46`
* `projectTodo = +6`
* `nonProjectTodo = -8`
* `keywordHardDrop = -55`
* `rawLogPenalty = -6`
* `toolOutputPenalty = -16`
* `positiveCap = 70`

修正后回跑 sampler：

```text
selected = 20
threshold = 55
buckets:
  archived_raw_log_decision = 9
  archived_raw_log_preference = 10
  archived_raw_log_todo = 1
predictions:
  unsure = 13
  yes = 7
score_min = 44
score_max = 64
```

结论：todo 过度入选和 threshold collapse 已修正；keyword 不再进入 boundary top20。但纯 boundary sampling 现在偏向 decision / preference，project bucket 覆盖不足。这属于 sampler diversity 问题，不应继续通过调整 v0.2 scoring 解决。

#### 当前成熟度判断

当前真实状态应定义为：

* Candidate exporter：稳定，read-only。
* Annotation UI：稳定-ish，仍需 label completeness 校验。
* v0.1 rules：policy 已定，尚未工程化。
* v0.2 scoring：alpha，目前仍内嵌在 sampler。
* v0.3 online feedback：设计讨论阶段，暂停实现。
* v0.4 sampler：MVP / prototype，尚未提交为稳定工具。

下一步计划：

1. 抽出 `lib/annotation/archived-raw-log-rescue-rules.cjs`。
2. 抽出 `lib/annotation/archived-raw-log-rescue-scoring.cjs`。
3. 新增 `bin/evaluate-archived-raw-log-rescue-labels.cjs`。
4. 用第一批 seed labels 回放 v0.1 / v0.2。
5. 为 v4 sampler 增加 diversity quota，避免下一批样本偏向 decision / preference。
6. 暂不实现 v0.3 online feedback，避免在 seed labels 太少且有 incomplete labels 的情况下引入 feedback loop corruption。

#### 验证

已执行 targeted checks：

```bash
node --check bin/nightly-maintenance-command.cjs
node --check bin/export-archived-raw-log-rescue-candidates.cjs
node --check bin/export-archived-raw-log-rescue-candidates.js
node --check bin/v4-active-sampler.cjs
node --test test/annotation-reviewer-static.test.js test/console-annotations.test.js
```

已执行 read-only/manual validation：

```bash
node bin/export-archived-raw-log-rescue-candidates.cjs --limit 100 --preview-chars 1000 --out reports/archived-raw-log-rescue-candidates-latest.jsonl
node bin/v4-active-sampler.cjs --input reports/archived-raw-log-rescue-candidates-latest.jsonl --limit 20
```

测试结果：

* annotation reviewer / console annotations targeted tests：7 pass, 0 fail。
* exporter dry-run summary 明确 `db_writes=false`、`unarchive=false`、`category_update=false`、`delete=false`、`quarantine=false`、`reinforce=false`。
* sampler 回跑显示 todo collapse 已修正，但 sampling diversity 仍待补齐。

未执行项：

* 未运行全量 `npm test`。
* 未对 archived rows 执行 restore / unarchive / category update。
* 未把 seed labels / candidate reports 提交入库。

### AutoRecall P4 Memory Card / Object Model 与 card-first runtime 收敛

完成 AutoRecall P4 memory card / memory object model 工作流。目标是把 autoRecall 从“直接把召回命中文本注入 prompt”推进到“先投影为可审计、可预览、可渐进披露的 memory card”，同时保持 runtime 默认行为不变。P4 全阶段仍不引入 DB migration、storage rewrite、retrieval ranking 变更、自动 `memory_engine_get`、full-content 默认注入或 card-render reinforcement。

#### P4.1 memory card / object model design freeze

- 新增设计文档：`docs/auto-recall-memory-card-object-model.md`。
- 新增静态测试：`test/auto-recall-memory-card-object-model.test.js`。
- 定义 memory object envelope，包括 `schema_version`、`object_id`、`memory_id`、`source`、`classification`、`content_ref`、`card`、`confidence`、`policy`、`debug`。
- 定义 memory card schema，包括 `card_id`、`memory_id`、`title`、`summary`、`salience_reason`、`source_hint`、`category`、`kind`、`confidence_score`、`risk_flags`、`disclosure_level`、`get_token`。
- 固定 disclosure vocabulary：`none`、`memory_card`、`short_summary`、`full_content_on_get`。
- 固定风险标记：`raw_log_like`、`tool_output_like`、`dreaming_artifact`、`low_confidence`、`archived`、`quarantined`、`stale_index_candidate`、`conflict_flag`、`cross_agent_scope`、`sensitive_source`。
- 固定 progressive disclosure 不变量：card rendered != cited、card injected != cited、search result != cited；只有当前 turn 显式 cited memory ids 才能进入 reinforcement。
- 明确 agent scope 边界：默认面向 `edi`；`task-planner` 不自动注入到 `edi`；Codex CLI 保持在 memory-engine autoRecall 之外。

#### P4.2 projection helpers

- 新增 `lib/recall/auto-recall-memory-card.js`。
- 新增测试：`test/auto-recall-memory-card.test.js`。
- 新增纯函数：
  - `normalizeCandidateToMemoryObject(candidate, options)`
  - `projectMemoryObjectToCard(memoryObject)`
  - `projectCandidateToMemoryCard(candidate, options)`
  - `isInjectableMemoryCard(card)`
- projection 层为 read-only：不读 DB、不写 DB、不写 event、不访问文件、不 retrieval、不 injection、不 reinforcement。
- 普通 active candidate 默认投影为 `memory_card`；dreaming / archived / quarantined / stale candidate 默认 `none`。
- raw-log-like / tool-output-like 内容会输出 withheld card summary，不泄露 traceback、stack、timestamp log body。
- card 只包含 compact summary、source hint、risk flags 和 `memory_engine_get:<id>` token，不包含 full content。

#### P4.3 turn gold-set replay card projection

- 扩展 `lib/recall/auto-recall-turn-gold-set.js`，为 replay result 增加 `card_projection`。
- 新增测试：`test/auto-recall-turn-gold-set-card-projection.test.js`。
- Replay summary 新增：
  - `card_expected_count`
  - `card_projection_count`
  - `full_content_on_get_expected_count`
- 当前 seed baseline：12 条 replay 全部通过；其中 5 条期望 card projection。
- P4.3 只生成 synthetic expected memory card，不伪造真实 retrieval candidate，不改变 P3 replay pass/fail mismatch 逻辑。

#### P4.4 Console memory card preview

- 扩展 Console reports allowlist，支持 `auto-recall-turn-gold-set-replay-YYYYMMDD-HHMMSS.json`。
- `console/services/reports-service.js` 从 replay JSON 中提取 read-only `memory_card_preview`，最多展示 8 张 card。
- `console/views/reports.ejs` 增加 Memory Card Preview 区块。
- `console/public/charts.js` 渲染 card title、summary、salience reason、source hint、memory id、get token、risk flags、disclosure level。
- 修复 UX：`/reports` 默认优先选择最新 turn gold replay report，并在顶部 `Turn Gold Replay Cards` 下方直接展示 Memory Card Preview。
- 保持 Console 只读：不加 apply/archive/quarantine/delete/reinforce/get 按钮，不绑定 `memory_engine_get` click 行为。
- 新增/扩展测试：`test/console-reports.test.js`。

#### P4.4b replay report export checkpoint

- 新增 CLI：`bin/export-turn-gold-set-replay-report.js`。
- 新增测试：`test/export-turn-gold-set-replay-report.test.js`。
- CLI 默认 dry-run，只打印 Console-compatible replay report payload，不写文件。
- 只有显式传入 `--write-report --confirm-write-report WRITE_TURN_GOLD_REPLAY_REPORT` 才写入 `reports/auto-recall-turn-gold-set-replay-YYYYMMDD-HHMMSS.json`。
- 写入前验证 filename allowlist、replay 无 failed row、无 invalid row。
- 测试验证 dry-run 不写、缺 confirm token 不写、confirm 后只写临时 reports 目录，并且 Console `readReportFile()` 可读取 `memory_card_preview`。

#### P4.5 gated card-first runtime experiment

- 扩展 `auto-recall.js`，新增：
  - `buildAutoRecallCardContext(results, options)`
  - `formatAutoRecallCardContext(results, options)`
  - `shouldUseAutoRecallCardRuntime(config, runtimeGate)`
- 扩展 `index.js`，只在 `autoRecall.cardFirstRuntime.enabled === true` 且 runtime gate 解析到 `agentId=edi` 时使用 card-first prompt supplement。
- 默认仍走旧 `formatAutoRecallContext()` raw-text 路径，现有 runtime 行为不变。
- card-first supplement header 为 `## Auto Recall - memory cards`，只注入 card preview，不注入 full original memory body。
- `auto_recall_debug` metadata 新增：
  - `card_first_runtime_enabled`
  - `auto_recall_disclosure_mode`
- `memory_injected` event metadata 新增：
  - `card_first_runtime_enabled`
  - `disclosure_mode`
- event type 仍为 `memory_injected`，通过 disclosure mode 区分 raw_text / memory_card。
- 新增 runtime smoke：`bin/run-auto-recall-card-runtime-smoke.js`。
- 新增测试：`test/auto-recall-card-runtime-smoke.test.js`。
- smoke 覆盖：默认 raw_text、`edi` + explicit flag 使用 memory_card、非 `edi` 即使开 flag 仍 raw_text、raw-log/tool-output body withheld。

#### P4 closeout / runbook

- 新增 runbook：`docs/auto-recall-memory-card-runtime-runbook.md`。
- 新增静态测试：`test/auto-recall-memory-card-runtime-runbook.test.js`。
- Runbook 固定：默认关闭、edi-only、task-planner 保持 raw-text、Codex CLI 不进入 memory-engine autoRecall、无 DB migration、无 storage rewrite、无 retrieval ranking change、无自动 `memory_engine_get`、无 full content injection、无 card render/search result reinforcement。
- Runbook 记录 activation checklist、rollback procedure、verification commands、Console preview 操作和 P5 canary 建议。

#### 验证

P4 targeted tests：

```bash
node --test \
  test/auto-recall-memory-card-runtime-runbook.test.js \
  test/auto-recall-memory-card-object-model.test.js \
  test/auto-recall-card-runtime-smoke.test.js \
  test/auto-recall-memory-card.test.js \
  test/auto-recall-turn-gold-set-card-projection.test.js \
  test/console-reports.test.js
```

结果：

```text
# tests 52
# pass 52
# fail 0
```

P4.5 runtime/card targeted tests：

```bash
git diff --check
node --check index.js
node --test \
  test/auto-recall.test.js \
  test/auto-recall-debug-metadata.snapshot.test.js \
  test/auto-recall-memory-card.test.js \
  test/auto-recall-runtime-gate.test.js \
  test/auto-recall-turn-gold-set-card-projection.test.js \
  test/console-reports.test.js
```

结果：

```text
# tests 51
# pass 51
# fail 0
```

Runtime smoke targeted tests：

```bash
git diff --check
node --check bin/run-auto-recall-card-runtime-smoke.js
node --test \
  test/auto-recall-card-runtime-smoke.test.js \
  test/auto-recall.test.js \
  test/auto-recall-memory-card.test.js \
  test/auto-recall-runtime-gate.test.js
```

结果：

```text
# tests 43
# pass 43
# fail 0
```

手动验证：

- 生成 `reports/auto-recall-turn-gold-set-replay-20260702-133531.json` 后，`http://127.0.0.1:8787/reports` 可显示 `Turn Gold Replay Cards` 与 5 张 `Memory Card Preview`。
- `/api/reports/file?name=auto-recall-turn-gold-set-replay-20260702-133531.json` 返回 `memory_card_preview.summary.preview_count = 5`。

未执行项：

- 未运行全量 `npm test`。
- 未默认启用 `cardFirstRuntime.enabled`。
- 未在真实 OpenClaw runtime session 中做 card-first canary。
- 未修改真实 runtime config。
- 未做 DB migration 或 memory 文件 mutation。

结论：

- P4 已完成 closeout：设计、projection、replay、Console preview、export checkpoint、gated runtime experiment、runtime smoke、runbook 均已落地。
- 当前 card-first runtime 是 opt-in experiment，默认关闭。
- 下一步建议进入 P5：只做 `edi` 本地小范围 canary plan，观察 `auto_recall_debug` / `memory_injected` disclosure mode、引用行为和答案质量，再决定是否扩大使用。

## 2026-07-01

### AutoRecall P1 / P2 / P3 闭环收敛

完成 autoRecall Master Plan 中 P1 runtime gate、P2 long-input/focused-query smoke、P3 turn-level gold set replay 与 dataset lifecycle 的收敛工作。本阶段目标是把 autoRecall 从规则逻辑推进到可回放、可诊断、可冻结、可人工扩展的数据闭环；仍不引入 ML / classifier / online learning，也不自动修改 runtime 规则。

#### P1 runtime hook guard

- 新增 `lib/recall/auto-recall-runtime-gate.js`，集中实现 autoRecall runtime 入口 allowlist 判定。
- `index.js` 的 `before_prompt_build` hook 在进入 `explainAutoRecallSkip()`、`analyzeAutoRecallIntent()`、`hybridSearch()` 之前先执行 runtime gate。
- 默认只允许 `agent_id=edi`、`chat_type=interactive_user_chat`、`message_role=user`。
- 缺失 `agent_id`、`chat_type`、`message_role` 时 default-deny，分别返回：
  - `denied_missing_agent_id`
  - `denied_missing_chat_type`
  - `denied_missing_message_role`
- 非 allowlist agent/chat/role 分别返回：
  - `denied_by_agent_allowlist`
  - `denied_by_chat_type_allowlist`
  - `denied_by_message_role_allowlist`
- 支持 config override：`agentAllowlist` / `agent_allowlist`、`chatTypeAllowlist` / `chat_type_allowlist`、`messageRoleAllowlist` / `message_role_allowlist`。
- 未通过 runtime gate 时只记录 `auto_recall_debug` 和 `recall_completed` skip event，并立即 return；不会进入 intent、retrieval、injection 或 reinforcement。
- 新增 isolated unit test：`test/auto-recall-runtime-gate.test.js`，覆盖默认 allow、缺字段 default-deny、非 allowlist deny、config override、以及从 ctx 读取 agent id。

#### P2 long-input gate / focused-query smoke 与 Console decision trace

- 新增只读 smoke CLI：`bin/run-auto-recall-long-input-smoke.js`。
- 新增测试：`test/auto-recall-long-input-smoke.test.js`。
- smoke 覆盖：long rewrite skips recall、long summarize skips recall、long translate skips recall、long debug without history skips recall、long project review uses focused query、long debug with history uses focused query。
- smoke 明确 side-effect false：不写 DB、不修改 memory 文件、不 retrieval、不 injection、不 cleanup/apply、不 archive/quarantine/reinforce、不调用 LLM、不访问网络、不写 runtime report。
- 新增 `lib/recall/auto-recall-decision-trace.js`，把 `analyzeAutoRecallIntent()` 输出映射成稳定 Console 展示结构。
- `console/services/reports-service.js` 对 autoRecall JSON report 增加 `decision_trace`，仅从 report content 做 pure mapping，不调用 runtime、不执行 search/inject。
- `console/views/reports.ejs` 新增 `Long Input Decision Trace` panel。
- `console/public/charts.js` 渲染 `long_input_detected`、`generic_task_detected`、`explicit_history_context`、`should_recall`、`intent_reason`、`focused_query`。
- `test/console-reports.test.js` 增加前端静态 token guard 和 reports-service `decision_trace` pure mapping 测试。

#### P3 turn-level gold set replay system

- 新增 `lib/recall/auto-recall-turn-gold-set.js`，实现 turn-level gold set schema、JSONL parser、row validation、replay、mismatch classification、feedback clustering、expansion plan。
- schema version 固定为 `TURN_GOLD_SET_SCHEMA_VERSION = 1`。
- schema 支持 `turn_id`、`prompt` / `user_prompt` / `input` / `text`、`task_intent`、`recall_intent`、`disclosure_level`、`expected_should_recall`、`expected_intent_reason`、`expected_focused_query_contains`、`expected_focused_query_excludes`、`label_confidence`。
- 新增 seed dataset：`test/fixtures/auto-recall-turn-gold-set.seed.jsonl`。
- 当前 seed dataset 固定为 12 条，覆盖 long generic skip、debug without history skip、debug with history recall + focused query、long project review + current baseline recall、short continuation recall、explicit history rewrite recall、project-state question recall。
- 当前 seed replay 结果：12/12 pass，invalid=0，feedback clusters=0，expansion candidates=0。

#### P3 mismatch feedback / expansion / commit gate

- `buildTurnGoldSetReplayFeedback()` 将 replay mismatch 聚合为可解释 cluster。
- mismatch category 包括 `false_positive_recall`、`false_negative_recall`、`intent_reason_mismatch`、`focused_query_missing_expected_token`、`focused_query_contains_forbidden_token`、`json_parse_error`、`invalid_label_row`。
- `buildTurnGoldSetExpansionPlan()` 根据 feedback 生成人工复核候选行；默认只生成 plan，不写回 dataset。
- 新增只读 replay CLI：`bin/run-turn-gold-set-replay.js`，输出 replay + feedback + expansion-plan summary。该 CLI 位于 `bin/` 的 CommonJS package scope 下，已改为 CommonJS + dynamic import，避免 ESM syntax error。
- 新增 manual-gated commit CLI：`bin/commit-turn-gold-set-expansion.js`。
- commit CLI 默认 dry-run；只有同时满足 `--apply`、`--confirm-append-turn-gold-set APPEND_TURN_GOLD_SET`、candidate status 为 `approved` / `human_approved` / `approved_for_append`、`row_template` schema valid、target dataset 不存在 duplicate `turn_id`、target dataset 没有 invalid JSONL row，才 append dataset。
- commit CLI 只允许写 dataset 文件；不写 DB、不改 memory 文件、不 retrieval/injection/reinforce、不调用 LLM、不访问网络、不写 runtime report。

#### P3 freeze / dataset growth observation

- 新增 `lib/recall/auto-recall-dataset-observation.js`，实现 seed dataset freeze check、coverage analysis、growth gap detection 和只读 observation report。
- 新增 `TURN_GOLD_SET_SEED_FREEZE`，冻结当前 seed baseline：`total_count=12`、`valid_count=12`、`failed_count=0`、`feedback_cluster_count=0`、`expansion_candidate_count=0`。
- 新增 CLI：`bin/observe-turn-gold-set-dataset.js`，默认观测 `test/fixtures/auto-recall-turn-gold-set.seed.jsonl`。
- 新增测试：`test/auto-recall-turn-gold-set-observation.test.js`，覆盖 seed freeze contract stable、required task intent / recall intent / case family coverage、side-effect false contract、freeze drift 和 coverage gap 检测、replay CLI 与 observation CLI 在 `bin/package.json` CommonJS scope 下可执行。
- 修复 observation case-family 分类：不再只依赖 `prompt.length >= 1000`，而是优先使用 replay actual 中的 `long_input_detected`，避免 evaluation layer 与 runtime long-input 判定漂移。

#### 验证

通过 targeted tests：

```bash
node --test test/auto-recall-runtime-gate.test.js test/auto-recall-turn-gold-set-observation.test.js test/auto-recall-intent.test.js test/auto-recall-long-input-smoke.test.js test/auto-recall-decision-trace.test.js test/console-reports.test.js
```

结果：

```text
# tests 36
# pass 36
# fail 0
```

手动验证：

```bash
node bin/run-turn-gold-set-replay.js --summary
```

输出基线：

```text
- replay_total: 12
- replay_passed: 12
- replay_failed: 0
- replay_pass_rate: 1
- feedback_clusters: 0
- expansion_candidates: 0
```

未执行项：

- 未运行全量 `npm test`。
- 未运行真实 autoRecall runtime hook。
- 未访问真实 DB / memory 文件 apply 路径。
- 未引入 ML、classifier、online learning、自动 rule update 或自动 dataset mutation。

结论：

- P1 runtime gate 已从隐式 hook 逻辑收敛为显式 default-deny allowlist gate。
- P2 long-input/focused-query 已有只读 smoke、Console decision trace 和 report pure mapping。
- P3 已形成 turn-level gold set replay、feedback、expansion plan、manual commit gate、freeze contract 与 dataset growth observation 的完整非 ML 数据闭环。
- 下一步建议进入提交整理：将 runtime gate、Console decision trace、P3 dataset lifecycle 分为清晰逻辑 commit；提交前可再补一次 `git diff --check` 与相关测试。

### Memory quality baseline / snapshot / introspection

新增 memory quality baseline 观测链路，用于把 memory quality 的关键诊断结果固化为可检查、可回归、可对比的 baseline snapshot。

本轮新增文件：

* `bin/run-memory-quality-baseline-smoke.js`
* `bin/inspect-memory-quality-baseline.js`
* `lib/quality/memory-quality-baseline-contracts.js`
* `lib/quality/memory-quality-baseline-introspection.js`
* `lib/quality/memory-quality-baseline-snapshot.js`
* `test/memory-quality-baseline-smoke.test.js`
* `test/memory-quality-baseline-introspection.test.js`
* `test/memory-quality-baseline-snapshot.test.js`

该链路目标：

* 提供 memory quality baseline 的 smoke 检查入口。
* 支持 baseline snapshot 的结构化生成与检查。
* 支持 introspection，便于解释当前 baseline 中包含哪些 quality 维度、diagnostic 字段和 contract 约束。
* 将 baseline 输出与 contract 检查拆开，避免后续质量治理时只依赖人工读 report。
* 为后续长期追踪 quality drift、ownership-aware flags、unknown path、chunks without confidence 等指标提供稳定检查点。

安全边界：

* baseline / snapshot / introspection 只用于观测和验证。
* 不执行 archive。
* 不执行 delete。
* 不执行 quarantine。
* 不执行 reinforce。
* 不修改 memory 文件。
* 不调用 LLM。
* 不访问网络。

验证建议：

* `node --test test/memory-quality-baseline-smoke.test.js test/memory-quality-baseline-introspection.test.js test/memory-quality-baseline-snapshot.test.js`

结论：

* memory quality 现在有了更明确的 baseline 检查入口。
* 后续质量治理可以先看 baseline 是否漂移，再决定是否进入具体 cleanup / apply 流程。
* 该能力属于观测层增强，不改变现有 memory lifecycle 行为。

### Smart-add duplicate cleanup apply design

补充 smart-add duplicate cleanup apply 设计文档与静态测试，为后续从 preview / manifest 进入受控 apply 做准备。

本轮新增文件：

* `docs/smart-add-duplicate-cleanup-apply-design.md`
* `test/smart-add-duplicate-cleanup-apply-design.test.js`

该设计明确 smart-add duplicate cleanup 的 apply 边界：

* apply 前必须基于 preview / manifest。
* apply 必须区分 dry-run、preview、confirm、apply。
* apply 不应越过 ownership boundary。
* 只允许处理 memory-engine lifecycle-owned smart-add duplicate。
* 涉及非 scope path、unknown owner、generated/diagnostic owner 时必须 hard stop 或 manual review。
* 删除或归档前必须保留可审计记录。
* apply 流程必须可回滚或至少可追溯。

设计重点：

* 将 duplicate cleanup 从“检测到重复”推进到“可控 apply”之前，先固定安全协议。
* 避免 cleanup 工具误删 non-lifecycle memory、generated artifact 或历史诊断数据。
* 要求 apply 入口具备显式确认、manifest 校验、scope 校验和 side-effect 记录。
* 后续实现 apply mode 时，测试应先覆盖 safety contract，再允许真实写入。

验证建议：

* `node --test test/smart-add-duplicate-cleanup-apply-design.test.js`

结论：

* smart-add duplicate cleanup 的 apply 阶段暂未直接落地真实写入。
* 当前完成的是 apply design 和安全约束固化。
* 后续如实现 apply，应严格按该设计推进，避免把 duplicate cleanup 做成不可审计的批量删除工具。


## 2026-06-30

### 质量治理 / Smart-Add 重复清理确认清单校验

* 新增只读 CLI：`bin/validate-smart-add-duplicate-cleanup-manifest.js`，用于校验人工确认的 smart-add duplicate cleanup manifest。
* 新增测试：`test/smart-add-duplicate-cleanup-manifest.test.js`，覆盖 manifest shape 校验、group/hash 匹配、keep/delete candidate 校验、skip/manual-review 分支、unsafe current group 拒绝、mixed valid/invalid 场景、CLI JSON/Markdown 输出和非零退出码。
* manifest 必须满足 `version === 1`、`kind === "smart_add_duplicate_cleanup_manifest"`、`mode === "dry_run_only"`，并只能使用 `approve_delete_candidates`、`skip`、`manual_review_required` 三种 decision。
* validator 只接受当前 preview 中仍然安全的候选组：`cleanup_eligibility === true`、`classification === "ingestion_bug_candidate"`、retrieved/injected 均为 0、且仅属于 lifecycle-owned smart_add。
* 输出 dry-run 报告，包括 `would_keep`、`would_delete`、approved/skipped/manual-review/rejected 计数、errors/warnings 和完整 side-effect false 合约。
* 修正 mixed manifest 场景下的局部错误计数：一个坏 group 不会污染后续合法 group 的 `would_keep` / `would_delete` 产出。
* manifest shape 校验统一由 `validateCleanupManifestAgainstPreview()` 负责，避免 file-based 路径重复追加同一类 shape error。
* 本阶段仍不引入任何 cleanup/apply 行为；CLI 只读，不写 DB、不修改真实 memory 文件、不 archive/quarantine/reinforce/backfill、不调用 LLM、不访问网络、不写 runtime report 文件。


### 质量治理 / Smart-Add 重复候选预览

* 新增只读 CLI：`bin/preview-smart-add-duplicate-cleanup-candidates.js`，用于预览当前 smart-add duplicate cleanup 候选组。
* 新增 npm 入口：`preview:smart-add-duplicate-cleanup`，对应命令为 `node bin/preview-smart-add-duplicate-cleanup-candidates.js`。
* 新增测试：`test/smart-add-duplicate-cleanup-preview.test.js`，覆盖参数解析、破坏性参数拒绝、JSON/Markdown 输出、`--limit`、候选字段完整性、keep/delete candidates、以及完整 side-effect false 合约。
* 预览 CLI 仅筛选 `cleanup_eligibility === true` 且 `classification === "ingestion_bug_candidate"` 的候选组，当前基线为：

  * cleanup eligible groups: 10
  * cleanup eligible entries: 27
* 每个候选组输出 `group_hash`、`normalized_content_hash`、分类、风险等级、原因、代表内容 preview、路径/日期/category/fingerprint、`suggested_keep_candidate`、`suggested_delete_candidates` 和 compact occurrences，方便人工 review。
* 明确保持只读边界：不写 DB、不修改真实 memory 文件、不执行 cleanup/apply、不 archive/quarantine/reinforce/backfill、不调用 LLM、不访问网络、不写 runtime report 文件。
* 本阶段只提供人工 review 预览，不引入任何 cleanup/apply 行为；后续是否实现 confirmed-selector cleanup，需要先人工检查全部 10 组候选。
* 验证通过：`git diff --check`、`node bin/preview-smart-add-duplicate-cleanup-candidates.js --json`、`node bin/preview-smart-add-duplicate-cleanup-candidates.js --markdown --limit 3`、`node --test test/smart-add-duplicate-cleanup-preview.test.js`、`npm test`。


### Smart-add duplicate safety baseline smoke

新增只读的 smart-add duplicate safety baseline smoke，并暴露 npm 入口：

* `npm run smoke:smart-add-duplicates`

这次没有去 snapshot 全部 live duplicate totals，而是冻结高信号的安全基线：

* cleanup eligible groups: 10
* cleanup eligible entries: 27
* ingestion bug candidate groups: 10
* unsafe-to-cleanup groups: 37

同时验证 retrieved / injected / repeated-confirmation / mixed-or-unclear duplicate groups 继续保持 non-cleanup-eligible。本轮没有引入任何 cleanup/apply 行为。

### Memory quality baseline smoke

新增只读的 memory quality baseline smoke，用来冻结当前已清理完成的质量基线状态：

* unknown memory paths = 0
* active-memory chunks without confidence = 0
* lifecycle-owned chunks without confidence = 0
* process-boundary audit pass
* confirmed legacy singleton stale cleanup dry-run has no actionable target
* autoRecall safety smoke continues to deny suspected tool output and dreaming artifacts

同时修复了 `unknown-memory-path-audit.test.js`，将其改为使用 hermetic synthetic fixture，而不是依赖可变的 live baseline 或 import-time env 假设。

### Session-checkpoint cron / LLM 稳定化

完成 session-checkpoint 凌晨执行链路的稳定化收尾。本轮问题的核心结论是：凌晨 03:30 的失败并不主要是 LLM API 在脚本内不可用，而是 OpenClaw cron 以 `agentTurn` 方式运行 checkpoint，导致任务在执行脚本前就可能卡死于外层 agent model call 的 `model-call-started` 阶段。

P0 已落地：session-checkpoint cron 已从 agentTurn 切换为 command payload，直接执行 deterministic wrapper：

* `bin/run-session-checkpoint-direct.sh`

该 wrapper 负责：

* 按 Asia/Shanghai 计算默认 targetDate 为 yesterday。
* 先运行插件内 canonical `bin/flush-session-rawlog.js --checkpoint`。
* 再运行插件内 canonical `bin/session-checkpoint.js --target-date <targetDate>`。
* 只有 checkpoint exit 0 且 `memory/episodes/<targetDate>.md` 存在且非空时才判定成功。
* checkpoint 失败或 episode 缺失时，写入 `memory/episodes/<targetDate>.md` fallback marker。
* fallback marker 使用 canonical metadata，包括 `targetDate`、`generatedAt`、`timeZone`、`category`、`source_type: checkpoint_fallback`、`smartAddInputPolicy` 与 `evidenceDateFilter`。
* fallback DB 统计尊重 `MEMORY_ENGINE_CORE_DB_PATH`，不再硬编码 core DB 路径。

运行态 cron 已验证切换成功：

* `payload.kind: command`
* command: `/bin/bash /home/lionsol/.openclaw/workspace/plugins/memory-engine/bin/run-session-checkpoint-direct.sh`
* `cwd: /home/lionsol/.openclaw/workspace`
* `timeoutSeconds: 900`
* `noOutputTimeoutSeconds: 180`
* `outputMaxBytes: 30000`
* schedule 仍为 `30 3 * * *`
* timezone 仍为 `Asia/Shanghai`
* `staggerMs: 0`

P1a 新增 checkpoint-size synthetic healthcheck，用于测试接近 checkpoint 规模的大 prompt LLM 请求，而不是只测 `回复 OK 即可` 的小请求：

* `bin/checkpoint-size-healthcheck.js`
* `test/checkpoint-size-healthcheck.test.js`

该 CLI 默认使用 synthetic checkpoint-sized prompt，不读取真实 `raw_log`、session 或 memory 内容。默认参数：

* provider: `siliconflow`
* chars: `22000`
* maxTokens: `1024`
* timeoutMs: `120000`
* SiliconFlow 默认 model: `deepseek-ai/DeepSeek-V3.2`
* DeepSeek 默认 model: `deepseek-chat`
* JSONL 日志默认写入 `~/.openclaw/workspace/memory/checkpoint-size-health-log.jsonl`
* 可通过 `MEMORY_ENGINE_CHECKPOINT_SIZE_HEALTH_LOG` 覆盖日志路径

真实 synthetic 对照结果：

* SiliconFlow 22k / 1024 tokens: ok=true, durationMs=67525
* DeepSeek 22k / 1024 tokens: ok=true, durationMs=6503
* SiliconFlow 22k / 4096 tokens: ok=true, durationMs=63609
* DeepSeek 22k / 4096 tokens: ok=true, durationMs=6463

结论：不要把 SiliconFlow 改为默认 primary。当前数据支持继续保留 DeepSeek primary、SiliconFlow fallback。

P1b 完成 LLM provider 顺序可配置化，默认顺序保持不变：

* primary: `deepseek`
* fallback: `siliconflow`

新增 env：

* `MEMORY_ENGINE_CHECKPOINT_PRIMARY_PROVIDER`
* `MEMORY_ENGINE_CHECKPOINT_FALLBACK_PROVIDER`

允许 provider 值：

* `deepseek`
* `siliconflow`
* `none`

其中 `fallback=none` 表示禁用 fallback；`fallback === primary` 时只尝试一次，避免重复打同一个 provider。非法 provider 采用 fail-soft 策略：回退默认值并记录 warning，避免 nightly 自动任务因为 env 写错而整条中断。

LLM telemetry 已改为 provider-agnostic 结构化日志：

* `LLM attempt provider=... model=... chars=...`
* `LLM failed provider=... model=... durationMs=... error=...`
* `LLM succeeded provider=... durationMs=...`
* `LLM fallback disabled ...`
* `LLM fallback skipped ... reason=same-provider`

同时移除了 JSON parse miss 时输出 raw response 片段的行为。现在只记录 response length，例如：

* `LLM response did not contain JSON responseChars=<n>`

`llmComplete()` 的 parse failure 错误也已去掉 raw body 片段，仅保留 `responseChars=<n>`，避免日志泄露 raw response。

P2 完成 checkpoint LLM request budget 可配置化。新增 request budget helper：

* `resolveCheckpointLlmRequestConfig()`

新增 env：

* `MEMORY_ENGINE_CHECKPOINT_LLM_MAX_INPUT_CHARS`
* `MEMORY_ENGINE_CHECKPOINT_LLM_MAX_TOKENS`
* `MEMORY_ENGINE_CHECKPOINT_LLM_TIMEOUT_MS`

默认值：

* `maxInputChars: 45000`
* `maxTokens: 4096`
* `timeoutMs: 120000`

本轮将 nightly checkpoint 默认 `maxTokens` 从 8192 降为 4096。理由是 P1a synthetic 4096 已验证可用，而真实 `episode_summary + smart_memories + configs` 通常不需要 8192；较高输出预算会增加 provider 延迟和失败风险。如需临时拉高，可通过 env 覆盖。

`llmNightlyExtract()` 现在通过 request budget helper 控制：

* input trim 上限
* maxTokens
* timeoutMs

attempt 日志也包含请求预算：

* `chars=... maxTokens=... timeoutMs=...`

验证已完成：

* `node --test test/checkpoint-config.test.js test/checkpoint-llm.test.js test/checkpoint-size-healthcheck.test.js`
* 41 tests，41 pass，0 fail

未执行项：

* 未运行真实 API。
* 未运行 live cron。
* 未扩大修改到 raw-log selection、自动压缩或 token 估算。
* 未处理既有 audit `SQLITE_CANTOPEN` 问题。

代码状态说明：

* P0 commit: `55a6c0d fix(checkpoint): add direct cron runner`
* P1a commit: `771470c feat(checkpoint): add checkpoint-size healthcheck`
* P1b commit: `1fad51c feat(checkpoint): make LLM provider order configurable`
* P2 当前实现已通过 targeted tests，建议与本 devlog 一起提交为独立 commit。

结论：

* 03:30 checkpoint 已脱离 agentTurn 外层模型调用，不再受 `model-call-started` 卡死影响。
* checkpoint-size healthcheck 已能观测大 prompt LLM 路径。
* provider 顺序可配置但默认仍保持 DeepSeek primary。
* LLM request budget 已可配置，默认输出预算降为 4096。
* 下一步建议观察今晚 03:30 direct cron + 4096 token budget 的真实运行日志，再决定是否需要进一步调整 raw-log input budget 或摘要压缩策略。

### Confirmed legacy singleton stale cleanup apply

完成 `memory/daily.md` confirmed-only stale indexed chunk cleanup。

背景：

前序只读审计已确认 `memory/daily.md` 是唯一 unknown memory path，并且 legacy singleton review 进一步确认：

* 文件不存在于 disk
* core index 中残留 1 条 indexed chunk
* 无 confidence record
* 无 retrieved event
* 无 injected event
* 分类为 `stale_index_candidate`

本次使用 guarded cleanup 工具执行真实 apply：

* `bin/cleanup-confirmed-legacy-singleton-stale.js`
* confirm token: `cleanup-confirmed-legacy-singleton-stale`

apply 前 dry-run 确认：

* `preflight_passed: true`
* `would_delete.core_chunks: 1`
* `would_delete.core_chunks_fts: 1`
* `would_delete.engine_memory_confidence: 0`
* `side_effects.db_writes: false`

apply 已完成，并创建 core DB backup：

* `/home/lionsol/.openclaw/memory/backups/main-before-confirmed-legacy-singleton-stale-cleanup-20260630T122914Z.sqlite`

实际删除范围：

* 删除 `core.chunks` 中精确 id/path 匹配的 stale row
* 删除 `chunks_fts` 中精确 id 匹配的 stale row
* `engine.memory_confidence` 删除数为 0
* 不删除 `memory_events`
* 不修改 memory 文件
* 不执行 archive / quarantine / reinforce / confidence backfill

post-check 全部通过：

* `review-legacy-singleton-memory`: `indexed_chunk_count: 0`
* `audit-unknown-memory-paths`: `unknown_count: 0`
* `cleanup-confirmed-legacy-singleton-stale` dry-run: `preflight_passed: false`，无可清理残留
* `memory-quality-eval --scope active-memory`: `chunks_without_confidence: 0` / `lifecycle_owned_chunks_without_confidence_count: 0`

结论：

* `memory/daily.md` stale indexed chunk 已干净删除。
* unknown memory path 已归零。
* active-memory 缺 confidence/category 的残留已归零。
* 本次 cleanup 未产生 memory 文件、副作用路径或 lifecycle 状态变更。

### Nightly cron maintenance 修复

本轮检查了昨日 session-checkpoint 与 nightly 相关 cron 运行状态。`session-checkpoint` 已确认正常：03:30 生成 episode，无 LLM 超时标记，执行耗时约 15.6s；smart-add 也保持连续生成。

本次主要修复三个 nightly cron 问题：

* `Memory Engine Nightly Maintenance`

  * 原问题：连续失败，原因是 `payload.model` 仍为 `siliconflow/deepseek-ai/DeepSeek-V4-Flash`，已被 `agents.defaults.models` allowlist 拒绝。
  * 修复：将 model 改为 `deepseek/deepseek-v4-flash`。
  * 同时将 `toolsAllow` 收窄为 `memory_engine`，避免该任务继续暴露不必要的 read/write/exec/process 等工具。
  * 保持 `payload.kind = agentTurn`，因为该任务本身是通过 `memory_engine` tool 执行 `detect-conflicts -> archive -> kg-bridge -> status`。

* `Memory Daily Stats`

  * 原问题：04:00 首跑经常卡在外层 `agentTurn` 的 `model-call-started`，触发 180s timeout；重试后偶尔成功。
  * 修复：改为 `command` payload，直接运行 `node /home/lionsol/.openclaw/workspace/scripts/memory-stats.js`。
  * 新配置：`timeoutSeconds=300`，`noOutputTimeoutSeconds=120`，`outputMaxBytes=30000`。
  * 目标：避免统计脚本再依赖外层 LLM agent 启动。

* `memory-weekly-p2-stats`

  * 原问题：周日 05:00 任务同样使用已被 allowlist 移除的 `siliconflow/deepseek-ai/DeepSeek-V4-Flash`，导致 cron preflight 直接失败。
  * 修复：改为 `command` payload，直接运行 `node /home/lionsol/.openclaw/workspace/scripts/memory-weekly-stats.js`。
  * 新配置：`timeoutSeconds=300`，`noOutputTimeoutSeconds=120`，`outputMaxBytes=30000`。
  * 目标：避免 weekly stats 这类纯脚本任务继续走 `agentTurn`。

修复后预期状态：

* `Memory Engine Nightly Maintenance`

  * `payload.kind = agentTurn`
  * `payload.model = deepseek/deepseek-v4-flash`
  * `payload.toolsAllow = ["memory_engine"]`

* `Memory Daily Stats`

  * `payload.kind = command`
  * model 显示为 `-`
  * command 指向 `memory-stats.js`

* `memory-weekly-p2-stats`

  * `payload.kind = command`
  * model 显示为 `-`
  * command 指向 `memory-weekly-stats.js`

说明：`cron list` 中这几个任务暂时仍显示 `error`，属于旧的 `lastRunStatus / lastError` 记录，不代表新配置失败。需要等待下一次自然调度后刷新状态。

后续观察点：

* 明天 02:00：确认 `Memory Engine Nightly Maintenance` 不再出现 allowlist error。
* 明天 04:00：确认 `Memory Daily Stats` 不再出现 `model-call-started` timeout。
* 周日 05:00：确认 `memory-weekly-p2-stats` command payload 正常完成。



## 2026-06-29

### Episode 文件冗余与漂移问题收尾

本轮完成 episode 文件冗余与漂移问题的主链路修复与验证，可以按“主问题关闭，历史清理项进入 backlog”处理。

已确认新的 canonical checkpoint episode 格式生效。episode 文件现在包含明确的 `targetDate`、`generatedAt`、`source_type: checkpoint_llm`、`smartAddInputPolicy: trusted_only:manual,agent_smart_add`、`smartAddIncluded`、`rawLogIncluded` 与 `evidenceDateFilter` 等 metadata，用于明确生成日期、证据来源与 raw-log-first 边界。

已验证 `2026-06-27` episode 为 clean canonical checkpoint 输出。该文件由 bounded raw logs 生成，`smartAddIncluded: 0`，正文中出现历史污染排查相关内容属于当天真实 raw log 主题，不应再被视为 smart-add 传播污染。

已对 `2026-06-25` 与 `2026-06-26` polluted episode 文件进行隔离，并基于 raw-log-first checkpoint 重新生成 active episode。重生成后的 active 文件均使用 bounded raw logs，`smartAddIncluded: 0`，旧污染关键词不再出现在 active episode 中。

修复了 smart-add propagation audit 对 clean canonical checkpoint episode 的误报问题。audit 现在可以正确识别 `# Episode` 标题后的 canonical metadata，并跳过符合 raw-log-first 条件的 clean checkpoint episode。已补充回归测试，覆盖“正文提到历史污染关键词，但 metadata clean”的 canonical episode 场景。

已完成 `2026-06-16` 至 `2026-06-26` legacy-risk window 的只读 audit，没有对历史风险窗口执行自动 apply。剩余风险主要集中在旧 smart-add suspect、少量旧 episode suspect 与 stale smart-add chunks，属于历史数据清理问题，不再阻塞 episode 漂移主问题收尾。

结论：episode 漂移传播链路已切断，核心日期 `2026-06-25`、`2026-06-26`、`2026-06-27` 已完成修复或验证。该问题可以关闭。后续将 legacy smart-add cleanup 与 stale index cleanup 作为独立 backlog 项继续跟进。


### Memory process boundary audit

新增只读的记忆过程边界审计，用于验证当前双记忆系统基线是否稳定。

本次审计目标是确认在关闭 `active-memory`、`dreaming` 和 memory-engine `autoRecall` 后，是否还存在新增的过程层记忆污染。审计会报告预期基线、可探测到的配置状态、最近一次本地 03:00 边界或显式 `--since` 之后新增的 `memory/dreaming/*` 文件、non-lifecycle recall warning 摘要，以及明确的无副作用声明。

新增文件：

* `lib/quality/memory-process-boundary-audit.js`
* `bin/audit-memory-process-boundary.js`
* `test/memory-process-boundary-audit.test.js`

验证已完成：

* `node --test test/memory-process-boundary-audit.test.js`
* `npm test`
* `node bin/audit-memory-process-boundary.js --json`
* `node bin/audit-memory-process-boundary.js --markdown`
* `node bin/audit-memory-process-boundary.js --since "2026-06-29 03:00:00" --json`
* Markdown 报告已输出到 `/tmp/memory-engine-reports/memory-process-boundary-audit-20260629.md`

真实运行结果：

* `status: pass`
* `new_dreaming_files_since_count: 0`
* `non_lifecycle_injected_count: 1`，判定为历史遗留 warning，不作为本次失败条件
* 所有 `side_effects` 字段均为 `false`

安全边界：

* 不写入数据库
* 不修改记忆文件
* 不修改配置
* 不执行 archive / quarantine
* 不执行 reinforce
* 不启用 autoRecall

结论：

* 当前关闭后的过程边界验证通过。
* `dreaming` 在 2026-06-29 03:00 之后没有继续生成新文件。
* non-lifecycle injected 计数没有新增增长，当前仅保留历史遗留记录。
* 本次不创建新的 release tag。
* GitHub 最新 tag 继续保持为 `v0.8.21-annotation-loop-validation`。
* 在达到真正可用的 1.0 版本前，后续完成项通过 `docs/devlog.md` 和普通 commit 记录，不再发布新的 release tag。

### Ownership-aware quality flags

修正 quality flags 的 ownership 语义，避免 memory-engine 把 OpenClaw memory-core / generated diagnostic 层的正常无 confidence 状态误判为 P0 质量缺陷。

本次变更原则：

* `missing_category` 只在候选记忆 `expected_confidence=true` 时进入 P0。
* `chunks_without_confidence` 只在候选记忆 `expected_confidence=true` 时进入 P0。
* `memory/smart-add/*` 和 `memory/episodes/*` 仍保持严格的 memory-engine lifecycle 质量约束。
* `memory/dreaming/*`、daily-root、`MEMORY.md` 等 non-lifecycle / memory-core-owned 记录不再因为缺少 category / confidence 被打 P0。
* 内容风险 flags 不降级：`raw_log_leak`、`debug_noise`、`timestamp_pollution`、`duplicate_exact` 等仍按原逻辑生效。
* 未知路径继续保持严格策略；真实 DB 中唯一剩余的 `missing_category / chunks_without_confidence` P0 是历史误写孤本 `memory/daily.md`。

代码变更：

* `lib/quality/quality-rules.js`
  * 引入 `classifyQualityScope()`。
  * 在 `evaluateQualityFlags()` 中解析 `expected_confidence` / quality scope。
  * 将 category / confidence 缺失检查改为 ownership-aware。
  * 输出 `quality_scope_family`、`quality_scope_owner`、`expected_confidence`，便于报告和测试确认语义。
* `test/memory-quality-eval.test.js`
  * 增加 lifecycle-owned 与 memory-core/generated-owned 对照测试。
  * 覆盖 smart-add / episodes 无 confidence 仍为 P0。
  * 覆盖 dreaming / daily-root / `MEMORY.md` 无 confidence 不再为 P0。
  * 覆盖 memory-core-owned 记录中的 `raw_log_leak` 仍保留 P0。
* `lib/quality/memory-process-boundary-audit.js`
  * 顺手修复 audit 运行时读取 `OPENCLAW_CONFIG_PATH` 的问题，避免测试 fixture 设置 env 后仍读取模块导入时的默认 config 路径。

真实 DB 验证：

* `node bin/memory-quality-eval.js --scope all --json --top 10`
  * `total_evaluated: 8498`
  * `average_score: 86.67`
  * `chunks_without_confidence_count: 1497` 仍保留为 diagnostics。
  * `lifecycle_owned_chunks_without_confidence_count: 0`
  * `top_flags` 中已不再出现 `missing_category` / `chunks_without_confidence`。
* `node bin/memory-quality-eval.js --scope active-memory --json --top 10`
  * `total_evaluated: 7002`
  * `average_score: 87.69`
  * `chunks_without_confidence_count: 1`
  * `lifecycle_owned_chunks_without_confidence_count: 0`
  * 剩余 1 条为 `memory/daily.md`，owner/family 为 `unknown`，继续保留 P0 作为异常路径提示。
* 直接统计确认：
  * `scope=all` 下 `missing_category=1`，`chunks_without_confidence=1`，均属于 `unknown` owner。
  * `dreaming` / daily-root / `MEMORY.md` 不再因缺 category / confidence 被记为 P0。

验证已完成：

* `node --test test/memory-quality-eval.test.js test/export-annotation-candidates.test.js test/timestamp-pollution-audit.test.js`
  * 53/53 通过。
* `node --test test/memory-process-boundary-audit.test.js`
  * 9/9 通过。
* `npm test`
  * 491 tests，485 pass，6 skip，0 fail。

结论：

* quality report 现在区分 lifecycle quality defect 与 non-lifecycle diagnostic observation。
* memory-core-owned / generated diagnostic 层不再制造 `missing_category` / `chunks_without_confidence` P0 噪声。
* 内容风险检测和 dreaming artifact hard-deny 语义不受影响。
* 本次仍不创建新的 release tag，继续通过 devlog + 普通 commit 记录。

### Unknown memory path audit

新增 unknown memory path 只读审计，用于解释 ownership-aware quality flags 修正后剩余的唯一 `missing_category / chunks_without_confidence` P0 来源。

背景：

ownership-aware quality flags 生效后，memory-engine lifecycle-owned 的 confidence/category 缺口已经归零，但质量报告中仍剩余 1 条 `missing_category / chunks_without_confidence` P0。该条目不是 `memory/smart-add/*` 或 `memory/episodes/*`，而是历史误写路径：

* `memory/daily.md`

本次新增只读 audit，用于定位 indexed memory 中 `quality_scope_owner=unknown`、`quality_scope_family=unknown` 或 unknown path family 的候选，确认其使用情况与处理建议。

新增文件：

* `lib/quality/unknown-memory-path-audit.js`
* `bin/audit-unknown-memory-paths.js`
* `test/unknown-memory-path-audit.test.js`

CLI 支持：

* `--help`
* `--json`
* `--markdown`
* `--out <path>`
* `--include-archived`
* `--sample-limit <n>`

安全边界：

* 不写入数据库
* 不修改 memory 文件
* 不修改配置
* 不执行 archive / quarantine
* 不执行 reinforce
* 不执行 confidence backfill
* 不调用 LLM
* 不访问网络

真实 DB 验证结果：

* `unknown_count: 1`
* 唯一路径：`memory/daily.md`
* `quality_scope_owner: unknown`
* `quality_scope_family: unknown`
* `path_family: memory-other`
* `has_confidence_record: false`
* `retrieved_count: 0`
* `injected_count: 0`
* `suggested_action: safe_to_review_for_stale_index_or_legacy_file`

结论：

* `memory/daily.md` 是当前唯一 unknown memory path。
* 该条目未被 retrieved，未被 injected，也没有 confidence record。
* 当前不执行删除、archive 或 quarantine。
* 后续如需处理，应走单独的 stale-index / legacy-file 人工确认流程。

验证已完成：

* `node --test test/unknown-memory-path-audit.test.js`
* `node bin/audit-unknown-memory-paths.js --json`
* `node bin/audit-unknown-memory-paths.js --markdown`
* `node bin/audit-unknown-memory-paths.js --json --out /tmp/memory-engine-reports/unknown-memory-path-audit-20260629.json`
* `npm test`

全量测试结果：

* `497 tests`
* `491 pass`
* `6 skip`
* `0 fail`

### Annotation export / quality report validation

完成 ownership-aware quality flags 之后的 annotation export 与 quality report 验证，确认质量报告和标注候选不再被 non-lifecycle `missing_category / chunks_without_confidence` 噪声污染。

验证结果：

* `--scope all` 的 top 100 flags 中，`missing_category` 已完全消失。
* `--scope all` 的 `lifecycle_owned_chunks_without_confidence_count: 0`。
* `--scope active-memory` 只剩 1 条 `chunks_without_confidence`，即 `memory/daily.md`，owner 为 `unknown`，不属于 memory-engine lifecycle。
* unknown memory path 实测仅有 `memory/daily.md` 一条。
* annotation export 保持只读：

  * `write_db: false`
  * `annotation_side_effects: false`
  * `reinforcement_side_effects: false`

本次 annotation export 输入源是 memory 级别样本，没有 dreaming 级别样本，因此 dreaming buckets 为 0：

* `dreaming_maintenance_log: 0`
* `dreaming_candidate_staging: 0`
* `dreaming_duplicate: 0`
* `dreaming_non_duplicate: 0`

这不是异常。本次验证重点是 ownership-aware 修正后，annotation export 不再被 non-lifecycle missing metadata 噪声污染。

候选 primary bucket 分配正常：

* `raw_log_leak: 50`
* `suspected_tool_output: 50`
* `duplicate_exact: 50`
* `never_retrieved: 35`

结论：

* memory-engine lifecycle-owned confidence/category 缺口已经归零。
* `missing_category / chunks_without_confidence` 的主噪声已经清除。
* annotation export 仍保持 read-only。
* bucket 分配正常。
* 剩余异常已收敛到单一历史路径 `memory/daily.md`。
* 今天的质量治理链条已闭环：process-boundary audit → ownership-aware quality flags → unknown memory path audit → annotation export / quality report validation。


## 2026-06-28

### 新增：date-specific recap 回答策略

今天补充了 retrieval / answering policy，解决“昨天做了什么 / 某天做了什么 / 上周做了什么”这类 date-specific recap 不能只凭 episode 作答的问题。

#### 背景

近期排查 checkpoint 污染时发现，历史 legacy checkpoint 曾生成过跨日污染的 episode。根因已经止血：

* `workspace/scripts/session-checkpoint.js` 已改为 thin shim。
* canonical checkpoint implementation 已统一到：

  * `bin/session-checkpoint.js`
  * `lib/checkpoint/*`
* 新版 checkpoint 已具备：

  * targetDate evidence filtering
  * reset direct parse 默认关闭
  * smart-add provenance gating

但历史 episode 已经被旧逻辑污染。更重要的是，回答“昨天做了什么”时，如果直接把 episode 当成权威事实来源，就会把 LLM 二手摘要中的错误再次放大。

因此，本次补充的不是 checkpoint 生成逻辑，而是 **回答策略**。

#### 新规则

新增文档：

* `docs/retrieval-answering-policy.md`

新增 fixture：

* `test/fixtures/date-specific-recap-policy.json`

新增测试：

* `test/retrieval-answering-policy.test.js`

文档明确规定：

1. date-specific recap 包括：

   * “昨天做了什么”
   * “某天做了什么”
   * “上周做了什么”
   * “某个日期我们修了什么”
2. 这类问题不能只凭 episode 回答。
3. source priority 为：

   * primary：raw session / raw_log
   * secondary：manual / agent_smart_add
   * tertiary：episode
4. episode 是 derived summary，不是 authoritative fact source。
5. 如果 episode 与 raw_log 冲突，以 raw_log 为准。
6. legacy-risk episode 只能作为线索，不能作为最终事实依据。
7. 以下路径不参与事实回答：

   * `memory/generated-smart-add/`
   * `memory/quarantined-*`
   * `memory/legacy-daily-mirrors/`
8. 明确禁止：

   * `episode_only_answer`

#### 目的

该策略修复的是污染链的第三层：

| 层级   | 问题                                      | 状态                   |
| ---- | --------------------------------------- | -------------------- |
| 生产入口 | legacy checkpoint 绕过插件版 targetDate 过滤   | 已修复                  |
| 派生记忆 | 历史 episode / smart-add 被旧 checkpoint 写脏 | 后续 confirmed-only 清理 |
| 回答策略 | date-specific recap 直接信 episode         | 本次补充 policy          |

本次变更要求未来回答日期回顾问题时，必须先验证原始 session / raw_log，再使用 episode 作为辅助线索。

---

### 验证：AutoRecall safety smoke 现有覆盖

今天还复查了 AutoRecall safety smoke 中对 dreaming artifact 的防护覆盖。

确认现有代码已经包含相关 case，不需要新增实现：

* `bin/run-auto-recall-safety-smoke.js`
* `test/auto-recall-safety-smoke.test.js`
* `test/auto-recall-eligibility.test.js`

已覆盖 synthetic dreaming artifact case：

* `dreaming_candidate_staging`
* `dreaming_maintenance_log`

验证点：

* `deny_reasons` 包含：

  * `denied_by_dreaming_artifact`
* `reinforcement_allowed=false`
* staging case 验证：

  * `reinforced_ids` 不包含该 candidate id

边界保持不变：

* 不写 DB
* 不改 memory
* 不 quarantine / delete / archive
* 不 reinforcement
* `dreaming_duplicate` alone 仍不 hard deny
* `raw_log_leak` 仍是 risk-only

执行命令：

```bash
node --test test/auto-recall-safety-smoke.test.js test/auto-recall-eligibility.test.js
npm test
node bin/run-auto-recall-safety-smoke.js
```

生成 smoke report：

* `reports/auto-recall-safety-smoke-20260628-025631.md`

report 中确认：

* `checks_passed: 8/8`
* `dreaming_candidate_staging` 被 `denied_by_dreaming_artifact` 拒绝
* `dreaming_maintenance_log` 被 `denied_by_dreaming_artifact` 拒绝

该 report 属于运行产物，不提交到 repo。

---

### 测试结果

新增 policy 后执行测试：

```bash
node --test test/retrieval-answering-policy.test.js
npm test
```

最终全量结果：

* `77/77 passed`
* `0 failed`

---

### 结果

本次变更建立了 date-specific recap 的 source hierarchy：

```text
raw session / raw_log
> manual / agent_smart_add
> episode
```

这意味着之后回答“昨天做了什么”时，episode 只能作为摘要线索，不能替代原始记录。

后续仍需继续处理历史 polluted episode：

1. 等待 `2026-06-27` 摘要作为 shadow entrypoint fix 后的回归样本。
2. 如果 06-27 clean，再对 `2026-06-25` / `2026-06-26` 做 confirmed polluted episode quarantine / regenerate。
3. legacy-risk window `2026-06-16` 至 `2026-06-26` 只先 audit，不自动 apply。



## 2026-06-28

### Console Annotation Reviewer 第一阶段

完成 Console 内置标注页面第一阶段，将原先独立的 `tools/annotation-reviewer.html` 能力迁移到 Console，同时保留 standalone 页面以降低迁移风险。

新增 `/annotations` 页面和导航入口：

* `console/server.js`
* `console/views/layout.ejs`
* `console/views/annotations.ejs`
* `console/public/style.css`
* `test/console-annotations.test.js`

第一阶段保持完全本地化和只读边界：

* 使用浏览器 File API 加载本地 `annotation-candidates-*.jsonl`
* 在浏览器本地填写标注字段
* 在浏览器本地导出 `annotation-labels-*.jsonl`
* 不上传 labels 到 server
* 不写 DB
* 不修改 memory records
* 不提供 apply / delete / archive / quarantine / reinforce / write-db 操作入口

页面支持：

* 展示 `sample_id` / `memory_id` / `chunk_id`
* 展示 `primary_bucket` / `sample_buckets` / `source_path` / `risk_score`
* 展示 `content_preview`
* 填写 `quality` / `currency` / `auto_recall_eligible` / `preferred_action` / `reason`
* 按 `primary_bucket` 筛选
* 按 `source_path prefix` 筛选
* 只看未标注项
* 展示 total / labeled / remaining / by primary_bucket 进度
* 导出 labels JSONL

### Console Reports allowlist 兼容 bucket slug

修复 Console `/api/reports` 文件名白名单与 annotation export 输出命名不一致的问题。

问题表现：

* export 工具会生成带 bucket slug 的文件名，例如：

  * `annotation-candidates-dreaming_duplicate-dreaming_maintenance_log-dreaming_candidate_staging-20260628-030143.jsonl`
* Console reports allowlist 之前只接受：

  * `annotation-candidates-YYYYMMDD-HHMMSS.jsonl`
* 导致 `/api/reports` 返回空数组。

修复后，Console reports allowlist 支持：

* 标准 annotation candidates 报告
* 带单个 bucket slug 的 candidates 报告
* 带多个 bucket slug 的 candidates 报告
* date-only legacy bucket 文件名

安全边界保持不变：

* 拒绝 `../`
* 拒绝绝对路径
* 拒绝嵌套路径
* 拒绝非白名单文件
* 拒绝任意扩展名
* 不放宽为 `annotation-candidates-.*`

验收结果：

* `/api/reports` 已能展示带 bucket slug 的 annotation candidates 报告
* `/api/reports/latest` 能正确返回最新 autoRecall safety smoke 报告
* 非白名单和路径穿越仍被拒绝

### autoRecall safety smoke 覆盖确认

确认最新 smoke 报告已覆盖 dreaming artifact hard gate：

* `checks_passed: 8/8`
* `dreaming_candidate_staging` synthetic candidate 被 `denied_by_dreaming_artifact` 拒绝
* `dreaming_maintenance_log` synthetic candidate 被 `denied_by_dreaming_artifact` 拒绝
* `reinforcement_allowed=false`

保持不变：

* `dreaming_duplicate` alone 不 hard deny
* `raw_log_leak` 仍是 risk-only
* 不写 DB
* 不改 memory
* 不 quarantine / delete / archive
* 不触发 reinforcement

### 验证

本轮验证：

* `node --test test/console-annotations.test.js test/console-reports.test.js test/annotation-reviewer-static.test.js`
* `npm test`

结果：

* 全量测试通过：`76/76`

### 运行产物处理

本轮生成的 reports 运行产物不进入 git，已按惯例移出或保留在 `/tmp/memory-engine-reports/`。

### 建议 tag

建议本轮提交后打 tag：

* `v0.8.19-console-annotation-reviewer`

建议 commit message：

* `feat(console): add annotation reviewer page`

### 下一步

建议先跑一个真实 GUI 标注闭环：

1. 在 `/reports` 找最新 candidates 报告
2. 在 `/annotations` 本地加载 candidates JSONL
3. 标注 10 条
4. 导出 labels JSONL
5. 用 CLI 生成 annotation summary / eligibility preview
6. 回到 `/reports` 查看生成结果

闭环跑通后，再考虑 Console 第二阶段：从白名单 reports 列表中选择 candidates 自动加载，但 labels 仍保持本地导出，不让 server 写入。



## 2026-06-27

### 修复：checkpoint shadow entrypoint bypass

今天继续排查昨天摘要污染问题时，发现一个新的 P0：之前修复的插件版 `session-checkpoint` 并不是唯一生产入口。实际历史路径中还存在一个 workspace 级 legacy entrypoint：

* `/home/lionsol/.openclaw/workspace/scripts/session-checkpoint.js`

该文件是 Phase 6 重构期留下的 workspace 副本，创建时间为 `2026-06-15 19:40`。它保留了一份独立 checkpoint 实现逻辑，并没有使用插件版最新的：

* `plugins/memory-engine/bin/session-checkpoint.js`
* `plugins/memory-engine/lib/checkpoint/*`

这意味着即使插件版 checkpoint 已经修复了 targetDate 过滤、reset direct parse 默认关闭、smart-add provenance gating，只要 cron 或 legacy path 仍调用 workspace script，就会绕过这些修复。

#### 问题根因

legacy workspace script 中仍存在旧的 raw evidence 收集逻辑。

DB raw_log source 使用无日期过滤查询：

```sql
WHERE mc.category = 'raw_log'
ORDER BY c.updated_at DESC
LIMIT 100
```

这会直接取最新 100 条 raw_log，而不是目标日期的 raw_log。

更严重的是，`flush-session-rawlog.js` 写入时使用的是当前写入时间作为 `updated_at`。如果旧 reset 文件被重新 flush，旧对话会因为 `updated_at=Date.now()` 变成“最新 raw_log”，从而被 legacy checkpoint 读入昨天摘要。

reset transcript source 也没有日期过滤：

```js
const resetFiles = readdirSync(SESSIONS_DIR).filter(f => f.includes(".jsonl.reset."));
for (const file of resetFiles) {
  // ...
}
```

旧逻辑会扫描所有 `.jsonl.reset.*` 文件，不按 targetDate / timestamp range 筛选，导致任意历史 session 内容都可能被送入 LLM。

插件版 `lib/checkpoint/raw-log.js` 已经有：

* `getTargetDateRange`
* `isTimestampInRange`
* targetDate bounded DB raw_log collection
* reset direct parse 默认关闭
* legacy reset direct parse 也按 timestamp 过滤

但 legacy workspace script 绕过了这些逻辑。

#### 修复方式

没有在 workspace legacy script 里复制新版逻辑，而是将其改成 thin shim。

现在：

* `/home/lionsol/.openclaw/workspace/scripts/session-checkpoint.js`

只负责把调用转发到：

* `../plugins/memory-engine/bin/session-checkpoint.js`

shim 行为：

* 保留 shebang
* 透传 `process.argv.slice(2)`
* 透传 `stdio`
* 透传 `env`
* 返回插件入口的 exit code

这样即使 cron、fallback shell、旧文档命令或其他 legacy caller 继续调用 workspace path，也会落到 canonical plugin checkpoint implementation。

#### 时间线确认

后续确认文件时间线：

* `2026-06-15 19:40`

  * `workspace/scripts/session-checkpoint.js` 创建，为 Phase 6 重构期留下的 workspace 副本。
* `2026-06-27 15:05`

  * 该文件被替换为 557-byte thin shim。
* `2026-06-27 19:22`

  * edi 检查 staged 内容时，workspace script 已经是 shim，因此静态测试通过。

这说明：

* 当前态修复有效。
* 静态测试证明的是“当前 legacy path 已是 shim，并防止未来回归”。
* 静态测试不证明 `2026-06-27 15:05` 之前没有 legacy script 产物污染。

因此将 legacy-risk window 定义为：

* `2026-06-15 19:40` 至 `2026-06-27 15:05`

这段时间内，任何通过 `workspace/scripts/session-checkpoint.js` 生成的 episode / smart-add 都需要视为 legacy-risk generated。

#### 防回归保护

新增静态测试：

* `test/session-checkpoint-shadow-entrypoint.test.js`

测试目标：

* workspace legacy script 必须是 thin shim。
* 不允许再出现旧 checkpoint 实现细节，包括：

  * `WHERE mc.category = 'raw_log'`
  * `ORDER BY c.updated_at DESC`
  * `LIMIT 100`
  * `.jsonl.reset.`
  * `llmNightlyExtract`
  * raw evidence collection / LLM prompt assembly 逻辑

README 同步补充 canonical checkpoint implementation 说明：

唯一 canonical checkpoint implementation 是：

* `bin/session-checkpoint.js`
* `lib/checkpoint/*`

workspace-level legacy entrypoint 只能是 shim，不应再承载业务逻辑。

#### 入口审计

完成入口审计：

| 项目                                   | 结果                                                    |
| ------------------------------------ | ----------------------------------------------------- |
| `crontab -l`                         | 当前未见 `session-checkpoint` 条目，仅有 agentmemory `@reboot` |
| `systemctl --user list-timers --all` | 未见 checkpoint 相关 timer                                |
| plugin `package.json`                | 无 checkpoint npm script                               |
| `workspace/scripts/`                 | 未发现第二个 checkpoint JS 复制品                              |
| `checkpoint-fallback-episode.sh`     | 仍引用 workspace script path，但该 path 现在已是 shim           |
| workspace docs                       | 仍存在旧命令 / 旧实现描述，记录为文档陈旧                                |
| production checkpoint code           | 未发现旧无边界 checkpoint raw collection 逻辑                  |

旧逻辑特征审计结果：

* `workspace/scripts/session-checkpoint.js`

  * 已无 `ORDER BY c.updated_at DESC`
  * 已无 `.jsonl.reset.` 扫描逻辑
* `plugins/memory-engine/bin/session-checkpoint.js`

  * 不包含旧 raw_log latest-100 查询
  * 走 `lib/checkpoint/raw-log.js`
* `.jsonl.reset.` 的生产引用仅保留在：

  * `lib/checkpoint/raw-log.js`
  * 且有 timestamp range filtering / legacy flag 保护
* 其他命中主要是：

  * 测试
  * 标注数据
  * 对该 bug 的讨论记录
  * 非生产代码

#### 历史摘要审计

对近期 episode 做了人工审计。

结果：

| 日期           | 结论   | 说明                                                                                             |
| ------------ | ---- | ---------------------------------------------------------------------------------------------- |
| `2026-06-26` | 污染   | 混入 06-24 `huashu-design skill` 安装、06-24/25 `opencode provider` 调试、更早的 FTX 巴哈马；同时也包含 06-26 真实事件 |
| `2026-06-25` | 污染   | 混入更早的 FTX 巴哈马；opencode / Tailscale 基本是当天讨论，需更细审                                                |
| `2026-06-24` | 基本干净 | huashu-design 是当天真实事件，但 FTX 巴哈马为跨日 carryover                                                   |
| `2026-06-27` | 尚未生成 | 将作为 shim 生效后的首个回归样本                                                                            |

因此后续历史审计范围不应只看 06-25 / 06-26，而应覆盖 legacy-risk window：

* `memory/episodes/2026-06-16.md` 至 `memory/episodes/2026-06-26.md`
* `memory/smart-add/2026-06-16.md` 至 `memory/smart-add/2026-06-26.md`

但处理优先级保持：

1. P1：`2026-06-25` / `2026-06-26`
2. P2：`2026-06-24`
3. P3：`2026-06-16` 至 `2026-06-23`

#### 验证

测试通过：

* `node --test test/session-checkpoint-shadow-entrypoint.test.js`
* `npm test`

全量测试结果：

* `69/69 passed`
* `0 failed`

tag：

* `v0.8.14-checkpoint-shadow-entrypoint-fix`

#### 结果

这次修复确认了一个关键架构原则：

> checkpoint 只能有一个 canonical implementation。任何 workspace-level / cron-level / fallback-level entrypoint 都只能是 shim，不能复制业务逻辑。

否则后续即使插件代码修复，也可能被 shadow entrypoint 绕过。

---

### 新增：人工标注候选导出与 annotation reviewer

今天还继续推进 memory-quality 人工标注闭环，为后续 Recall Hint / 统计型 LTR / content-aware recall 提供可验证的 gold-set 数据。

#### 背景

之前的 memory-quality-eval、orphan confidence cleanup、chunks without confidence、smart-add propagation audit 已经能产出大量候选问题，但还缺一个轻量、可复核、可导出的人工标注流程。

目标不是立刻训练模型，而是先建立一个最小闭环：

1. 从 quality / recall / pollution audit 中导出候选样本。
2. 人工判断样本质量、时效性、是否适合 auto-recall。
3. 形成 JSONL gold-set。
4. 汇总标签分布，为后续 recall policy / LTR 提供评估集。

#### 新增候选导出工具

新增文件：

* `lib/annotation/export-annotation-candidates.js`
* `bin/export-annotation-candidates.js`
* `test/export-annotation-candidates.test.js`

能力：

* 从 memory-quality / recall / audit 数据中导出 annotation candidates。
* 输出 JSONL / Markdown report。
* 样本字段包含：

  * `sample_id`
  * `sample_type`
  * `memory_id`
  * `chunk_id`
  * `primary_bucket`
  * `sample_buckets`
  * `source_path`
  * `risk_score`
  * `content_preview`
  * 其他辅助审查字段

导出结果示例：

* `reports/annotation-candidates-20260626-131339.jsonl`
* `reports/annotation-candidates-20260626-131349.md`
* `reports/annotation-candidates-20260626-133014.jsonl`
* `reports/annotation-candidates-20260626-133055.md`
* `reports/annotation-candidates-20260626-133843.jsonl`
* `reports/annotation-candidates-20260626-133907.md`

这些 report 属于运行产物，是否提交需要单独决定。默认不建议将全部生成样本提交到 repo，除非要固定一版 gold-set seed。

#### 新增本地 annotation reviewer

新增文件：

* `tools/annotation-reviewer.html`
* `test/annotation-reviewer-static.test.js`

设计原则：

* 纯静态页面
* 本地运行
* 只读输入
* 不依赖服务端
* 不直接修改 DB / memory 文件

使用方式：

* 通过浏览器 File API 加载 `reports/annotation-candidates-*.jsonl`
* 在页面中逐条审查候选样本
* 导出 annotation labels JSONL

页面展示字段包括：

* `sample_id`
* `memory_id`
* `chunk_id`
* `primary_bucket`
* `sample_buckets`
* `source_path`
* `risk_score`
* `content_preview`

支持标注字段：

* `quality`
* `currency`
* `auto_recall_eligible`
* `preferred_action`
* `reason`

支持筛选：

* `primary_bucket`
* `source_path` prefix
* unlabeled only

支持统计：

* total
* labeled
* remaining
* labeled by primary_bucket

导出的 label schema 包含：

* `schema_version`
* `sample_id`
* `sample_type`
* `quality`
* `currency`
* `auto_recall_eligible`
* `preferred_action`
* `reason`
* `labeled_at`

#### 新增 annotation labels summary / validator

新增文件：

* `lib/annotation/summarize-annotation-labels.js`
* `bin/summarize-annotation-labels.js`
* `test/summarize-annotation-labels.test.js`

能力：

* 读取 `reports/annotation-labels-*.jsonl`
* 校验 required schema
* 校验 enum values
* 输出 Markdown 或 JSON summary

汇总内容包括：

* total label count
* labeled count
* missing-field count
* primary_bucket distribution
* quality distribution
* auto_recall_eligible distribution
* preferred_action distribution
* per-bucket breakdown

示例 label 文件：

* `reports/annotation-labels-20260626-first50.jsonl`

同样，label 文件是否提交需要单独判断。如果只是本地试标，建议不提交；如果作为初始 gold-set，可在文档中明确 frozen sample version 后提交。

#### 文档

新增 / 更新：

* `docs/human-annotation-gold-set.md`

文档说明：

* annotation candidate 的来源
* reviewer 使用方式
* label schema
* quality / currency / auto_recall_eligible / preferred_action 的判定口径
* gold-set 如何用于后续 recall / LTR 评估

#### 验证

相关测试包括：

* `test/export-annotation-candidates.test.js`
* `test/annotation-reviewer-static.test.js`
* `test/summarize-annotation-labels.test.js`

这些工具为后续两个方向打基础：

1. Recall quality evaluation

   * 判断哪些记忆适合 auto-recall。
   * 判断哪些记忆应降权、归档、合并或修正。
2. Statistical LTR / policy tuning

   * 将人工标签作为训练 / 验证集合。
   * 对比 lexical score、vector score、RRF、recency、category boost、reinforcement 等特征与人工 judgment 的相关性。

---

### 当前待办

#### 1. 观察 2026-06-27 checkpoint 输出

`2026-06-27` 将是 shadow entrypoint fix 后的首个关键回归样本。

需要检查：

* 是否由 canonical plugin checkpoint 生成。
* metadata 是否包含新版 diagnostics。
* `resetDirectParseEnabled=false`。
* raw_log evidence 是否按 targetDate window 过滤。
* 是否还混入旧日期内容：

  * FTX 巴哈马
  * huashu-design
  * old opencode provider
  * 其他 legacy-risk window 中的跨日内容

#### 2. confirmed polluted episode regenerate

确认 `2026-06-27` clean 后，再处理历史污染 episode。

优先级：

1. `memory/episodes/2026-06-26.md`
2. `memory/episodes/2026-06-25.md`
3. `memory/episodes/2026-06-24.md`

建议流程：

1. quarantine old polluted episode
2. 使用 canonical plugin checkpoint 显式 targetDate regenerate
3. 如果 evidence 不足，不生成 fabricated episode，而是写 data-insufficient marker
4. reindex / verify
5. 记录 quarantine log

#### 3. legacy-risk window audit

对 `2026-06-16` 至 `2026-06-26` 的：

* `memory/episodes/*.md`
* `memory/smart-add/*.md`

做只读 audit，不自动 apply。

重点识别：

* block id 日期与文件日期不一致
* 明显跨日主题
* old reset carryover
* FTX / opencode / huashu-design 等已知污染链

#### 4. annotation reports 是否入库

当前 annotation candidate / label reports 属于运行产物，需要决定：

* 不提交，仅作为本地审查输出；
* 或冻结一版小规模 seed gold-set，并明确 schema / 版本 / 来源后提交。

默认建议：

* 工具、测试、文档提交；
* 大量 `reports/annotation-candidates-*` 不提交；
* `annotation-labels-20260626-first50.jsonl` 只有在确认作为 seed gold-set 时再提交。



## 2026-06-26

### 修复：session-checkpoint evidence 与 targetDate 脱钩

今天继续处理 `session-checkpoint` 的日期归因污染问题。

此前发现，`memory/episodes/YYYY-MM-DD.md` 和 `memory/smart-add/YYYY-MM-DD.md` 的文件名使用 `yesterdayDateStr()`，但实际喂给 LLM 的 evidence 没有严格绑定到同一个 `targetDate`。这会导致文件名日期与内容来源日期不一致。

#### 真实数据流

这次重新梳理后确认，问题不是简单的“reset 文件日期不准”，而是 checkpoint 的 evidence selection 本身没有统一日期边界。

真实流程如下：

1. `session-checkpoint` 会先调用 `flush-session-rawlog.js --checkpoint`。
2. `flush-session-rawlog.js` 解析 `.jsonl.reset.*` 文件：

   * 按消息自身的 `timestamp` 分组到日期。
   * 跳过今天。
   * 非今天消息写入 DB：

     * `chunks`
     * `memory_confidence`
     * `category='raw_log'`
3. `session-checkpoint` 随后又读取多个 evidence source：

   * smart-add：读取昨天日期的笔记。
   * DB raw_log：旧逻辑读取最新 100 条，未按日期过滤。
   * reset 文件：旧逻辑再次全量解析所有 `.jsonl.reset.*`。

核心问题有三点：

* DB raw_log 查询使用 `ORDER BY updated_at DESC LIMIT 100`，没有 targetDate 过滤。
* reset 文件直读没有按消息 timestamp 筛选日期，可能混入很旧的对话。
* flush 已经解析 reset 并写入 DB，checkpoint 又重复解析 reset 文件，造成 reset 内容重复进入 LLM context。

#### 修复内容

本次修复后，`session-checkpoint` 统一使用一个 `targetDate`，并确保所有 evidence 都与这个 targetDate 对齐。

改动包括：

* `main()` 先调用 `flush-session-rawlog --checkpoint`，再按同一个 `targetDate` 收集 evidence。
* DB raw_log 查询改为 targetDate bounded：

  * 不再使用无边界的 latest 100 fallback。
  * diagnostics / metadata 明确写入 `rawLogTimeBasis=updated_at`。
  * 查询结果按时间窗口约束，避免跨日 raw_log 混入。
* reset 文件直读默认关闭：

  * 默认不再直接解析所有 `.jsonl.reset.*`。
  * 只有显式传入 `--legacy-reset-direct-parse` 时才启用。
  * legacy 模式下也必须逐条按消息 `timestamp` 过滤 targetDate。
  * 无 timestamp 的消息会跳过并计入 diagnostics。
* smart-add 仍按 targetDate 读取：

  * `memory/smart-add/YYYY-MM-DD.md`
* episode / marker 文件增加 evidence filter 相关 metadata：

  * `targetDate`
  * `generatedAt`
  * `timeZone`
  * `rawLogTimeBasis`
  * `rawLogIncluded`
  * `resetDirectParseEnabled`
  * evidence date filter diagnostics

#### 时区边界测试

为避免以后退化成字符串日期匹配或 UTC 日期匹配，补充了精确到毫秒的 Asia/Shanghai 时区边界测试。

新增测试：

`timezone-aware boundary includes start and excludes end for Asia/Shanghai targetDate`

固定：

* `targetDate = 2026-06-17`
* `timeZone = Asia/Shanghai`

验证窗口语义为：

`windowStart <= updated_at < windowEnd`

覆盖边界：

* `2026-06-16T16:00:00.000Z`

  * 等于 `2026-06-17 00:00:00 Asia/Shanghai`
  * 应被包含
* `2026-06-16T15:59:59.999Z`

  * 等于 `2026-06-16 23:59:59.999 Asia/Shanghai`
  * 应被排除
* `2026-06-17T16:00:00.000Z`

  * 等于 `2026-06-18 00:00:00 Asia/Shanghai`
  * 应被排除，因为 window end 是 exclusive

#### 验证

相关测试通过：

* `test/checkpoint-raw-log.test.js`
* `test/checkpoint-episode-writer.test.js`
* `test/session-checkpoint.integration.test.js`
* `test/checkpoint-orphan-repair.test.js`
* `npm test`

当时全量测试结果：

* `62 passed`
* `0 failed`

本修复提交：

* `b8d6fbb fix(checkpoint): bind evidence collection to target date`

---

### 修复：smart-add feedback loop 污染

在修复 checkpoint 日期过滤后，又发现一个更严重的二阶污染问题：smart-add 会作为 checkpoint 的污染放大器。

#### 问题表现

真实事件：

* `opencode` 的 `env:` 前缀修复实际发生在 `2026-06-10`。

污染链：

1. 旧 checkpoint 因为没有日期过滤，在 `2026-06-25` 凌晨把 `6/10` 的事件误写入 `memory/smart-add/2026-06-24.md`。
2. `2026-06-26` 凌晨 checkpoint 又读取 `memory/smart-add/2026-06-24.md`。
3. LLM 把错误 smart-add 当成近期 evidence，升级写入 `memory/episodes/2026-06-25.md`。

这说明 smart-add 当时同时承担了两个角色：

* 人工/agent 主动追加的候选记忆输入池。
* checkpoint LLM 自动生成内容的输出池。

这会形成 feedback loop：

raw evidence → checkpoint LLM → smart-add → 下一轮 checkpoint LLM → episode

只要 LLM 一次错写，错误就会被持久化并在后续 checkpoint 中继续传播。

#### 修复内容

本次改动把 checkpoint 生成物和 checkpoint 输入池彻底拆开。

新的规则：

* `session-checkpoint` 只从 `memory/smart-add/YYYY-MM-DD.md` 读取可信 provenance 的条目：

  * `manual`
  * `agent_smart_add`
* 以下 provenance 默认跳过：

  * `checkpoint_generated`
  * `migrated_legacy`
  * missing / unknown provenance
* checkpoint 自己生成的内容不再写回 `memory/smart-add/*`。
* checkpoint 生成内容改写到：

  * `memory/generated-smart-add/YYYY-MM-DD.md`
* generated smart-add 明确写入：

  * `Provenance: checkpoint_generated`

episode diagnostics 也补充了 smart-add 输入策略字段：

* `smartAddPath`
* `smartAddInputPolicy`
* `smartAddIncluded`
* `smartAddSkippedUnknownProvenance`
* `smartAddSkippedCheckpointGenerated`

普通 agent / CLI 写入 smart-add 时会自动写入：

* `Provenance: agent_smart_add`

这样后续 checkpoint 可以继续信任 agent/CLI 明确写入的 smart-add，但不会再消费 checkpoint 自己生成的内容。

#### 验证

相关测试通过：

* `test/checkpoint-raw-log.test.js`
* `test/checkpoint-smart-add-writer.test.js`
* `test/session-checkpoint.integration.test.js`
* `test/timestamp-pollution-audit.test.js`
* `npm test`

本修复提交：

* `d689aaa fix(checkpoint): prevent smart-add feedback-loop pollution`

---

### 修复：generated-smart-add scope 漏洞

在将 checkpoint 生成内容改写到 `memory/generated-smart-add/` 后，继续审计发现该新路径没有被所有 scope 系统识别。

#### 问题

`memory/generated-smart-add/` 不匹配普通 `memory/smart-add/` 规则，会掉到 `unknown` family。

而当时 `unknown` 的默认行为是：

* `default_quality_score_scope: true`
* `retrieval_visible: true`

这意味着虽然 generated smart-add 不再作为 checkpoint 输入，但仍可能进入 quality / recall 周边路径。

#### 修复内容

补齐 `memory/generated-smart-add/` 在各层的排除规则：

* `lib/quality/quality-scope.js`

  * 新增 `generated_smart_add`
  * `default_quality_score_scope=false`
  * `diagnostic_scope=true`
  * `retrieval_visible=false`
* `lib/quality/path-family.js`

  * 新增 path family `generated-smart-add`
  * 默认 excluded
* `lib/quality/collect-quality-candidates.js`

  * SQL 硬排除 `memory/generated-smart-add/%`
* `lib/quality/chunks-without-confidence-audit.js`

  * candidate 读取排除 `memory/generated-smart-add/%`
  * `inferAuditPathPrefix` 显式支持该前缀
* `lib/category-inference.js`

  * `memory/generated-smart-add/` 映射为 `generated`
* recall 层：

  * `lib/recall/hybrid/normalize-candidate.js` 新增统一 `isRetrievalExcludedPath`
  * `lib/recall/hybrid/channels/fts.js` 加 SQL 硬排除
  * `lib/recall/hybrid/channels/recent.js` 加 SQL 硬排除
  * `normalizeCandidate` / `isCandidateAllowedForRerank` 也会拒绝该路径

修复后，边界为：

| 路径                             | 角色                 | quality | recall |     checkpoint input |
| ------------------------------ | ------------------ | ------: | -----: | -------------------: |
| `memory/smart-add/`            | manual / agent 输入池 |       是 |      是 | provenance-safe only |
| `memory/generated-smart-add/`  | checkpoint 生成物     |       否 |      否 |                    否 |
| `memory/episodes/`             | canonical episode  |      受控 |     受控 |            不作为默认递归输入 |
| `memory/legacy-daily-mirrors/` | quarantine         |       否 |      否 |                    否 |

#### 验证

相关测试覆盖：

* generated-smart-add quality scope 非 retrieval-visible
* 不进入 collect-quality-candidates
* 不进入 chunks-without-confidence-audit
* path family 默认 excluded
* `inferCategoryFromPath` 返回 `generated`
* recall normalize / rerank 排除

全量测试：

* `63/63 passed`

本修复提交：

* `1182c7c fix(memory): exclude checkpoint-generated smart-add outputs`

---

### 新增：smart-add propagation audit

新增只读审计工具，用于扫描 smart-add 传播污染。

实现文件：

* `lib/quality/smart-add-propagation-audit.js`
* `bin/audit-smart-add-propagation.js`
* `test/smart-add-propagation-audit.test.js`

审计范围：

* `memory/smart-add/*.md`
* `memory/episodes/*.md`

输出字段包括：

* `suspected_wrong_date_smart_add`
* `suspected_propagated_episode`
* `source_date_candidate`
* `target_date_polluted`
* quarantine 建议
* stale index / core DB 清理候选

真实 workspace 审计报告曾输出：

* `suspected_wrong_date_smart_add: 129`
* `suspected_propagated_episode: 6`
* `stale_index_cleanup_path_count: 14`
* `stale_index_cleanup_chunk_count: 1203`

其中已知污染对象命中：

* `memory/smart-add/2026-06-24.md`
* `memory/episodes/2026-06-25.md`

该 audit 故意偏保守，宁可多报，不做自动删除或自动 DB 清理。

测试通过：

* `test/smart-add-propagation-audit.test.js`
* `npm test`

本提交：

* `456d8ca feat(quality): audit smart-add propagation pollution`

tag：

* `v0.8.12-checkpoint-date-provenance`

---

### 新增：confirmed-only smart-add propagation quarantine

在只读 audit 之后，新增 confirmed-only quarantine 工具，用于手术式隔离已人工确认的传播污染。

实现文件：

* `lib/quality/smart-add-propagation-quarantine.js`
* `bin/quarantine-smart-add-propagation.js`
* `test/smart-add-propagation-quarantine.test.js`

#### 行为

工具默认 dry-run，不修改 live memory。

apply 必须显式提供：

* `--apply`
* `--confirm quarantine-smart-add-propagation`

工具只处理明确传入的 confirmed path / selector，不会自动处理全部 suspected。

支持 selector：

* `--confirmed-path`
* `--confirmed-fingerprint`
* `--confirmed-prefix`

能力：

* block / segment-level quarantine
* 无安全边界时返回 `requires_manual_review`
* dry-run 输出 exact changed block preview
* quarantine log 记录：

  * `schema_version`
  * `quarantined_at`
  * `source_path`
  * `target_path`
  * `block_id`
  * `fingerprint`
  * `block_hash`
  * `reason`
  * `pollution_type`
  * `review_status`
  * `source_date_candidate`
  * `polluted_target_date`
  * `matched_terms`

#### live cleanup：episode

先对 confirmed 的 `memory/episodes/2026-06-25.md` 执行 quarantine。

隔离内容：

* 1 句 summary：

  * `apiKey` 缺失 `env:` 前缀相关污染
* 1 行 config bullet：

  * `env:OPENCODE_API_KEY`

结果：

* `quarantined_count: 2`
* 复跑 `would_quarantine_count: 0`
* 文件中 2 个污染段落已移除

#### live cleanup：smart-add

随后对 `memory/smart-add/2026-06-24.md` 做 manual review。

文件结构：

* 25 个条目
* 13 个 `2026-06-23_` 前缀条目错误进入 `2026-06-24.md`
* 1 个 `2026-06-24_` 前缀条目 fingerprint `87c081ed` 含 OpenCode 污染
* 10 个 clean 条目保留

执行 selector：

* `--confirmed-prefix 2026-06-23_`
* `--confirmed-fingerprint 3f503661`
* `--confirmed-fingerprint 87c081ed`

最终 unique blocks：

* 13 个 `2026-06-23_` wrong-file blocks
* 1 个 `87c081ed` confirmed OpenCode pollution block
* 共 14 个 blocks

apply 后复查：

* `would_quarantine_count: 0`
* `grep "2026-06-23_"` 无结果
* `grep "87c081ed"` 无结果
* `grep "3f503661"` 无结果
* `OpenCode` 仍在 clean raw_log transcript 中合法残留，不隔离

本提交：

* `6bd85c0 feat(quality): quarantine confirmed smart-add propagation pollution`

---

### 新增：confirmed-only stale chunk cleanup verification

在 block-level quarantine 后，继续检查 core DB / FTS 是否仍有旧 chunk 残留。

此前初步检查曾怀疑 `memory/smart-add/2026-06-24.md` 仍有 14 条 stale chunks。但进一步确认后发现其中包含误报：一些 marker residual 实际是 `2026-06-23.md` 文件名引用，不是 `2026-06-23_` block-id 前缀污染。

为避免手工误删 DB，新增 confirmed-only stale cleanup 工具。

实现文件：

* `lib/quality/confirmed-smart-add-propagation-stale-cleanup.js`
* `bin/cleanup-confirmed-smart-add-propagation-stale-chunks.js`
* `test/confirmed-smart-add-propagation-stale-cleanup.test.js`

#### 行为

工具默认 dry-run。

初始范围严格限制为：

* `memory/smart-add/2026-06-24.md`

confirmed markers：

* `2026-06-23_`
* `87c081ed`
* `3f503661`

删除前要求：

* 当前磁盘文件已无这些 marker
* quarantine log 中存在 confirmed evidence
* chunk 内容精确匹配 confirmed markers

如果 apply，必须显式提供：

* `--apply`
* `--confirm cleanup-confirmed-smart-add-propagation-stale-chunks`

删除范围为：

* `chunks`
* `chunks_fts`
* 如存在对应 `memory_confidence`，同步删除，避免 orphan confidence

不会按整条 path 删除，因此 clean raw_log 中合法的 OpenCode / OPENCODE_API_KEY transcript 会被保留。

#### live 验证结果

真实 workspace dry-run：

* `confirmed_stale_chunk_count: 0`
* `confirmed_stale_fts_row_count: 0`
* `affected_paths: []`
* `matched_markers: []`
* `would_delete_chunk_ids: []`
* `clean_keyword_residuals_ignored` 中包含合法 OpenCode transcript chunk

随后执行 apply，创建备份：

* `main-before-smart-add-propagation-stale-cleanup-20260626T113620Z.sqlite`

由于 DB 已经 clean，实际删除：

* `deleted_chunk_count: 0`
* `deleted_fts_row_count: 0`

最终确认：

* 文件系统 clean
* core DB chunks clean
* FTS clean
* 合法 raw_log OpenCode transcript 保留

本提交：

* `57d4796 fix(quality): verify confirmed smart-add propagation stale chunks`

tag：

* `v0.8.13-smart-add-propagation-cleanup`

---

### 测试结果

最终全量测试通过：

* `tests: 413`
* `pass: 407`
* `fail: 0`
* `skipped: 6`
* `duration_ms: 6579.8726`

最终版本线：

* `v0.8.12-checkpoint-date-provenance`

  * checkpoint date / evidence 绑定
  * smart-add provenance 防污染
  * generated-smart-add scope 排除
  * propagation audit
* `v0.8.13-smart-add-propagation-cleanup`

  * confirmed-only propagation quarantine
  * confirmed live cleanup
  * stale chunk cleanup verification

---

### 结果

本轮完成了从未来防污染到历史 confirmed 污染清理的闭环：

1. checkpoint evidence 不再与 targetDate 脱钩。
2. raw_log 不再使用无边界 latest 100。
3. reset 文件直读默认关闭，避免与 flush 重复消费。
4. smart-add 增加 provenance gate。
5. checkpoint 生成内容不再写回 smart-add 输入池。
6. generated-smart-add 从 quality / recall / audit 默认路径排除。
7. 新增 smart-add propagation audit。
8. 对 confirmed 历史污染进行 block-level quarantine：

   * `memory/episodes/2026-06-25.md`：2 段
   * `memory/smart-add/2026-06-24.md`：14 blocks
9. 验证 core DB / FTS 对 confirmed 文件无 stale 污染。
10. 保留合法 raw_log OpenCode transcript，避免过度清理。

剩余的 129 suspected 只作为后续人工审计队列，不自动 apply，不进入本轮清理范围。



## 2026-06-25

### 修复：session-checkpoint evidence 与 targetDate 脱钩

今天修复了 `session-checkpoint` 生成 episode / smart-add 时日期标签不准的问题。

问题表现是：

* `memory/episodes/YYYY-MM-DD.md`
* `memory/smart-add/YYYY-MM-DD.md`

文件名使用 `yesterdayDateStr()`，但实际喂给 LLM 的 evidence 并没有严格限制在这个 `targetDate` 内，导致文件名日期与摘要内容来源日期可能不一致。

### 根因

这次问题的真实数据流如下：

1. `session-checkpoint` 先调用 `flush-session-rawlog.js --checkpoint`。
2. `flush-session-rawlog.js` 解析 `.jsonl.reset.*` 文件：

   * 按消息自身的 `timestamp` 分组到日期。
   * 跳过今天。
   * 非今天消息写入 DB：

     * `chunks`
     * `memory_confidence`
     * `category='raw_log'`
3. `session-checkpoint` 随后又从多个源收集 evidence：

   * smart-add：读取昨天日期的笔记。
   * DB raw_log：旧逻辑读取最新 100 条，未按日期过滤。
   * reset 文件：旧逻辑再次全量解析所有 `.jsonl.reset.*`。

核心问题有三点：

* DB raw_log 查询使用 `ORDER BY updated_at DESC LIMIT 100`，没有 targetDate 过滤。
* reset 文件直读没有按消息 timestamp 筛选日期，可能混入很旧的对话。
* flush 已经解析 reset 并写入 DB，checkpoint 又重复解析 reset 文件，造成 reset 内容重复进入 LLM context。

### 修复内容

本次修复后，`session-checkpoint` 统一使用一个 `targetDate`，并确保所有 evidence 都与这个 targetDate 对齐。

具体改动：

* `main()` 先调用 `flush-session-rawlog --checkpoint`，再按同一个 `targetDate` 收集 evidence。
* DB raw_log 查询改为 targetDate bounded：

  * 不再使用无边界的 latest 100 fallback。
  * diagnostics / metadata 明确写入 `rawLogTimeBasis=updated_at`。
  * 查询结果按时间窗口约束，避免跨日 raw_log 混入。
* reset 文件直读默认关闭：

  * 默认不再直接解析所有 `.jsonl.reset.*`。
  * 只有显式传入 `--legacy-reset-direct-parse` 时才启用。
  * legacy 模式下也必须逐条按消息 `timestamp` 过滤 targetDate。
  * 无 timestamp 的消息会跳过并计入 diagnostics。
* smart-add 仍按 targetDate 读取：

  * `memory/smart-add/YYYY-MM-DD.md`
* episode / marker 文件增加 evidence filter 相关 metadata：

  * `targetDate`
  * `generatedAt`
  * `timeZone`
  * `rawLogTimeBasis`
  * `rawLogIncluded`
  * `resetDirectParseEnabled`
  * evidence date filter diagnostics

### 时区边界测试

为避免以后退化成字符串日期匹配或 UTC 日期匹配，补充了精确到毫秒的 Asia/Shanghai 时区边界测试。

新增测试：

```text
timezone-aware boundary includes start and excludes end for Asia/Shanghai targetDate
```

固定：

```text
targetDate = 2026-06-17
timeZone = Asia/Shanghai
```

验证窗口语义为：

```text
windowStart <= updated_at < windowEnd
```

覆盖边界：

* `2026-06-16T16:00:00.000Z`

  * 等于 `2026-06-17 00:00:00 Asia/Shanghai`
  * 应被包含
* `2026-06-16T15:59:59.999Z`

  * 等于 `2026-06-16 23:59:59.999 Asia/Shanghai`
  * 应被排除
* `2026-06-17T16:00:00.000Z`

  * 等于 `2026-06-18 00:00:00 Asia/Shanghai`
  * 应被排除，因为 window end 是 exclusive

### 变更文件

本轮涉及文件：

* `bin/session-checkpoint.js`
* `lib/checkpoint/raw-log.js`
* `lib/checkpoint/episode-writer.js`
* `lib/checkpoint/markers.js`
* `lib/checkpoint/runtime.js`
* `test/checkpoint-raw-log.test.js`
* `test/checkpoint-episode-writer.test.js`
* `test/session-checkpoint.integration.test.js`
* `test/checkpoint-orphan-repair.test.js`

### Dry-run diagnostics

受控 fixture 下的 dry-run 结果：

```text
targetDate: 2026-06-17
rawLogIncluded: 1
rawLogSkippedOutOfTargetDate: 0
rawLogTimeBasis: updated_at
resetDirectParseEnabled: false
resetFilesScanned: 0
resetEventsIncluded: 0
resetEventsSkippedOutOfTargetDate: 0
smartAddPath: memory/smart-add/2026-06-17.md
generatedEpisodePath: /tmp/memory-engine-dryrun-*/memory/episodes/2026-06-17.md
```

其中 `rawLogSkippedOutOfTargetDate=0` 是预期行为，因为 SQL 已经先做 targetDate bounded 过滤，不再把跨日 raw_log 读入后再丢弃。

### 测试

已运行：

```bash
node --test test/checkpoint-raw-log.test.js
node --test test/checkpoint-episode-writer.test.js
node --test test/session-checkpoint.integration.test.js
node --test test/checkpoint-orphan-repair.test.js
npm test
```

结果：

```text
62 passed
0 failed
```

### 结果

本轮修复后，`session-checkpoint` 不再把无边界 raw_log 和全量 reset 文件混入 `yesterdayDateStr()` 对应的输出文件。

新的默认语义是：

* `targetDate` 统一生成。
* smart-add、raw_log、episode metadata 都围绕同一个 targetDate。
* reset 文件直读不再是默认 evidence source。
* flush 写入 DB raw_log 后，checkpoint 以 DB raw_log 为 canonical source。
* 不再 fallback 到 latest 100 或 all reset files。

这次修复堵住了 checkpoint 日期归因污染的主要入口，避免 episode / smart-add 文件继续出现“文件名是某天，但内容混入其他日期数据”的问题。



## 2026-06-24

### 修复：停止 session-checkpoint 生成 legacy daily mirror

今天处理了 `session-checkpoint` 生成 episode 时同时写入两份 daily 摘要的问题。

旧逻辑中，`writeEpisodeFiles()` 会同时写：

* `memory/episodes/YYYY-MM-DD.md`：完整 canonical episode，包含元数据、LLM 摘要、配置记忆和 generated footer。
* `memory/YYYY-MM-DD.md`：简版 daily 摘要，仅包含标题和 LLM 摘要正文。

由于 `episodes/YYYY-MM-DD.md` 每次 checkpoint 都会覆盖更新，而 `memory/YYYY-MM-DD.md` 只有文件不存在时才创建，两个文件会在后续 checkpoint 中产生内容漂移。同时，root-level `memory/YYYY-MM-DD.md` 也会被分类为 `daily_journal` / `daily_memory`，存在进入 retrieval-visible 范围并污染召回的风险。

本次修复后：

* `session-checkpoint` 默认只写 canonical episode：`memory/episodes/YYYY-MM-DD.md`。
* `memory/YYYY-MM-DD.md` 不再默认由 checkpoint 创建。
* 保留显式 legacy 开关 `checkpointLegacyDailyMirror` 作为兼容回退，默认关闭。
* 历史 root daily 文件不自动删除，避免误伤人工 daily journal。

相关测试覆盖：

* canonical episode 仍正常写入。
* 默认不会创建 root-level daily mirror。
* 已存在的 root-level daily journal 不会被覆盖。
* runtime 默认关闭 legacy mirror 写入。

### 新增：legacy daily mirror audit / quarantine

新增 legacy daily mirror 审计和隔离工具，用于识别历史遗留的 root-level `memory/YYYY-MM-DD.md` 镜像文件。

新增能力：

* 扫描 root-level `memory/YYYY-MM-DD.md`。
* 与对应 `memory/episodes/YYYY-MM-DD.md` 比对。
* 输出三类结果：

  * `legacy_daily_mirror_candidates`
  * `manual_daily_journal_candidates`
  * `ambiguous_daily_files`
* 默认 dry-run，不修改文件。
* apply 模式必须显式传入 `--apply --confirm quarantine-legacy-daily-mirrors`。
* 确认的 legacy mirror 会被移动到 `memory/legacy-daily-mirrors/`，并记录到 `quarantine-log.jsonl`。

同时新增 `path-family` / quality scope 支持：

* `memory/legacy-daily-mirrors/` 被识别为 `quarantined_daily_mirror`。
* 该 path family 非 retrieval-visible。
* 不进入 default quality scope。
* 从 quality candidates 和 chunks-without-confidence audit 中排除。
* path-family 规则确认 `quarantined_daily_mirror` 优先于 `daily_memory`，避免被宽泛 root daily 规则误判。

### 修复：legacy episode 格式导致 audit false negative

初版 detector 只支持带有 `targetDate` / `generatedAt` / `category` / `source_type` 元数据头的 modern episode。真实 workspace 中多数历史 episode 是旧格式：

* `# Episode`
* 摘要正文
* 可选 `### 配置记忆`
* `_Generated at ..._` footer

由于旧格式缺少元数据，原 detector 会把 summary 解析为空，导致相似度为 0，所有 root daily mirror 都落入 ambiguous，无法被自动 quarantine。

本次修复后，`parseCanonicalEpisode()` 支持两种格式：

* `modern`：带完整 metadata 的 canonical episode。
* `legacy`：旧格式 `# Episode` + body + optional config memory + generated footer。

legacy 解析逻辑会：

* 去掉 H1 标题。
* 去掉 `_Generated at ..._` footer。
* 去掉 `### 配置记忆` 块。
* 使用剩余正文与 root daily 内容做相似度比对。

真实 workspace 复跑后：

* `memory/2026-06-20.md`
* `memory/2026-06-21.md`
* `memory/2026-06-22.md`

被正确识别为 legacy mirror。

`memory/2026-06-23.md` 因为此前已手动重写，相似度约 0.2123，被保留为 `manual_daily_journal_candidate`，未被误伤。

### 真实 workspace 清理结果

在真实 workspace 执行 legacy daily mirror quarantine 后，共隔离 12 个历史 legacy mirror：

* `memory/2026-05-28.md`
* `memory/2026-05-30.md`
* `memory/2026-06-06.md`
* `memory/2026-06-09.md`
* `memory/2026-06-11.md`
* `memory/2026-06-13.md`
* `memory/2026-06-14.md`
* `memory/2026-06-15.md`
* `memory/2026-06-19.md`
* `memory/2026-06-20.md`
* `memory/2026-06-21.md`
* `memory/2026-06-22.md`

这些文件与对应 episode 摘要相似度均为 `1`，确认是完全镜像。

清理后复跑 audit：

* `legacy_daily_mirror_candidates: 0`
* `memory/2026-06-23.md` 保留为 manual daily journal
* 无 ambiguous 误判

### 新增：stale quarantined chunk cleanup

filesystem quarantine 后，发现 OpenClaw core DB 中仍有旧 root daily path 的 indexed chunks 残留。虽然文件已经从 `memory/YYYY-MM-DD.md` 移到 `memory/legacy-daily-mirrors/YYYY-MM-DD.md`，但 core DB 的 `chunks` / `chunks_fts` 仍可能指向旧 path，继续污染 retrieval。

新增 audit-first cleanup 工具：

* 默认 dry-run，不修改 DB。
* 只清理 confirmed quarantined legacy mirror 的旧 root daily path。
* 不清理普通 missing-file chunks。
* 不清理仍存在的 root daily journal。
* apply 模式必须显式传入 `--apply --confirm cleanup-stale-quarantined-chunks`。
* apply 前自动备份 core DB。
* apply 时同时删除 `chunks` 和 `chunks_fts` 对应行。

真实 dry-run 识别到 7 个 stale core DB chunks：

* `memory/2026-05-28.md`
* `memory/2026-05-30.md`
* `memory/2026-06-06.md`
* `memory/2026-06-09.md`
* `memory/2026-06-11.md`
* `memory/2026-06-13.md`
* `memory/2026-06-14.md`

apply 后结果：

* 删除 7 条 `chunks`
* 删除 7 条 `chunks_fts`
* 备份创建于 `backups/main-before-stale-quarantined-chunk-cleanup-20260624T081406Z.sqlite`

复查结果：

* `stale_quarantined_legacy_mirror_chunks: 0`
* `would_delete_chunk_count: 0`
* core DB 查询上述 7 个 path 无结果
* `memory/2026-06-23.md` 仍保留

### 增强：quarantine log schema v2 与 review report

历史 `quarantine-log.jsonl` 没有被重写，保持 append-only。

未来新增 quarantine 记录升级为 `schema_version=2`，字段包括：

* `schema_version`
* `moved_at`
* `timestamp`
* `moved_from`
* `moved_to`
* `episode_path`
* `episode_format`
* `reason`
* `similarity`
* `daily_sha256`
* `episode_summary_sha256`

同时新增 review report 能力：

* CLI 支持 `--review-report`
* 只读扫描现有 `quarantine-log.jsonl`
* 输出 `memory/legacy-daily-mirrors/quarantine-review-YYYY-MM-DD.json`
* 为历史 moved entries 补充 `episode_path`、`episode_format`、hash 和 `review_result`
* 不修改原始 JSONL

`stale-quarantined-chunk-cleanup` 也兼容旧 v1 quarantine log：

* `timestamp` 缺失时回退到 `moved_at`
* `episode_format` 缺失时视为 `unknown`
* 旧日志不会因为缺少新字段而影响 stale cleanup 判定

### 测试

本次相关测试均通过，包括：

* `test/checkpoint-episode-writer.test.js`
* `test/checkpoint-runtime.test.js`
* `test/legacy-daily-mirror-audit.test.js`
* `test/stale-quarantined-chunk-cleanup.test.js`
* `test/memory-quality-eval.test.js`
* `test/chunks-without-confidence-audit.test.js`
* `test/timestamp-pollution-audit.test.js`

全量测试通过：

* tests: 378
* pass: 372
* fail: 0
* skipped: 6
* duration: 4595ms

### 结果

本轮完成了 legacy daily mirror 污染的完整闭环：

1. writer 层停止继续生成 root daily mirror。
2. audit 层支持 modern / legacy episode mirror 检测。
3. filesystem 层将 12 个历史 mirror quarantine。
4. quality/retrieval scope 层排除 quarantined mirror。
5. core DB 层删除 7 个 stale chunks 和 7 个 FTS rows。
6. 审计层补齐 v2 log 和 review report 能力。
7. manual daily journal `memory/2026-06-23.md` 被正确保留。

这次修复把 `memory/episodes/YYYY-MM-DD.md` 明确为 canonical generated episode，把 `memory/YYYY-MM-DD.md` 重新留给真实 daily journal / user-facing daily memory，消除了历史双写带来的冗余、漂移和 retrieval 污染。



## 2026-06-23

### P2: Agent memory tool strategy and smoke runbook

完成 P2：agent 记忆工具使用策略与 smoke test 文档化。

这一步没有改检索逻辑，也没有改 OpenClaw 配置。目标是把 P0/P1 之后形成的 memory contract 固化下来，避免 edi、task-planner 或未来 agent 误用工具、重复召回，或者把 memory-engine 错误升级成 memory slot owner。

---

## Background

前面已经完成 OpenClaw memory contract compatibility：

* `memory-core` 保持为 OpenClaw 标准记忆底座。
* `memory_search` / `memory_get` 继续属于 `memory-core`。
* `memory-engine` 保持为增强层，不接管 `plugins.slots.memory`。
* `memory-engine` 不注册、不 shadow `memory_search` / `memory_get`。
* `memory-engine` 暴露自己的增强工具：

  * `memory_engine`
  * `memory_engine_search`
  * `memory_engine_get`
* `active-memory` 暂不启用。
* `memory-engine autoRecall` 暂不启用。

P2 的目的就是把这些决策写成 agent-facing policy，并用静态测试防止文档和 manifest 漂移。

---

## Changes

新增文档：

* `docs/agent-memory-tool-strategy.md`
* `docs/smoke-tests/openclaw-memory-tools.md`

新增测试：

* `test/agent-memory-tool-strategy.test.js`

### Agent memory tool strategy

新增 `docs/agent-memory-tool-strategy.md`，明确 agent 应该如何选择记忆工具。

当前策略：

| Scenario              | Tool                   |
| --------------------- | ---------------------- |
| 搜索 OpenClaw 原生记忆文件    | `memory_search`        |
| 读取 OpenClaw 原生 source | `memory_get`           |
| 使用 memory-engine 增强检索 | `memory_engine_search` |
| 读取 memory-engine 搜索结果 | `memory_engine_get`    |
| 管理、状态、维护、质量评估、冲突检测    | `memory_engine`        |

关键约束：

* `memory_search` / `memory_get` 保持属于 `memory-core`。
* `memory_engine_search` / `memory_engine_get` 属于 `memory-engine`。
* `memory_engine` 继续作为管理型 action router。
* `memory-engine` 不作为 blind replacement 替代 `memory_search`。
* 不为每个问题同时调用 `memory_search` 和 `memory_engine_search`。
* 不启用 `active-memory` 与 `memory-engine autoRecall` 的双轨召回，除非后续实现 dedup。
* `memory_engine_get` 遇到 ambiguous id prefix 时必须要求更长 id，不允许 silent pick first。

### Runtime smoke runbook

新增 `docs/smoke-tests/openclaw-memory-tools.md`，用于 edi 或人工在真实 OpenClaw 环境验证工具契约。

Runbook 覆盖：

* 配置前置条件。
* `openclaw doctor`。
* `openclaw plugins inspect memory-engine --runtime --json`。
* 预期工具可见性。
* memory-core 与 memory-engine 工具边界。
* non-shadowing behavior。
* manual behavior smoke cases。

预期稳定状态：

* `memory_search` / `memory_get` 由 memory-core 提供。
* `memory_engine` / `memory_engine_search` / `memory_engine_get` 由 memory-engine 提供。
* memory-engine 不注册 `memory_search` / `memory_get`。
* `plugins.slots.memory` 不指向 memory-engine。
* `active-memory` disabled。
* `memory-engine autoRecall` disabled。
* 无 duplicate recall injection。

---

## Tests

新增静态测试，锁定文档与 manifest 的契约一致性。

测试覆盖：

* strategy doc exists。
* smoke runbook exists。
* docs state the memory-core vs memory-engine split。
* docs state `memory_search` / `memory_get` stay with memory-core。
* docs state `memory_engine_search` / `memory_engine_get` stay with memory-engine。
* docs state `memory_engine` remains the management/action router。
* docs warn against enabling `active-memory` and memory-engine `autoRecall` together without dedup。
* docs include ambiguous id-prefix guidance for `memory_engine_get`。
* manifest exposes only:

  * `memory_engine`
  * `memory_engine_search`
  * `memory_engine_get`
* manifest does not expose:

  * `memory_search`
  * `memory_get`

Validation:

```text
find test -name '*.test.js' -print0 | xargs -0 node --test
Passed: 59/59
```

Runtime smoke was attempted in Codex but could not complete because the environment was read-only:

```text
EROFS: read-only file system, chmod '/home/lionsol/.openclaw/state'
```

This is an environment limitation, not a code/test failure. The real runtime smoke should be run in the normal WSL OpenClaw environment.

---

## Decisions

* P2 is documentation + contract validation only.
* No retrieval behavior changed.
* No plugin registration behavior changed.
* No `kind:"memory"` added.
* No `plugins.slots.memory` takeover.
* No OpenClaw config changes.
* No `active-memory` enablement.
* No memory-engine `autoRecall` enablement.
* No Recall Hint / LTR work in this step.

---

## Current baseline

The current memory architecture remains:

```text
memory-core
  ├─ owns OpenClaw standard memory slot
  ├─ provides memory_search
  └─ provides memory_get

memory-engine
  ├─ enhancement / governance layer
  ├─ provides memory_engine
  ├─ provides memory_engine_search
  └─ provides memory_engine_get
```

Agent-facing rule:

```text
Use memory_search/memory_get for OpenClaw native memory.
Use memory_engine_search/memory_engine_get for memory-engine enhanced retrieval.
Use memory_engine for management and maintenance.
Do not shadow memory-core tools.
Do not run dual auto-recall paths without dedup.
```

---

## Next

Before starting P3, run the runtime smoke in the normal WSL environment:

```bash
openclaw doctor || true
openclaw plugins inspect memory-engine --runtime --json || true
```

Then proceed to P3 only after the tool boundary is confirmed in runtime.

Potential P3 direction:

* Recall Hint。
* Statistical LTR feature extraction。
* Observation-only feature debug first, no ranking change initially.



## 2026-06-23

### Memory-engine: OpenClaw memory contract compatibility + checkpoint input hardening

今天完成两条关键稳定化工作：

1. 明确 memory-engine 与 OpenClaw 内建记忆系统的边界。
2. 修复 session-checkpoint 原始日志输入污染问题，避免 daily checkpoint 把跨天历史、工具输出和过长 transcript 混进长期记忆。

---

## 1. OpenClaw memory contract compatibility

完成 OpenClaw 新版记忆契约审计，并调整 memory-engine 当前定位。

### 结论

当前 memory-engine 不应接管 OpenClaw `plugins.slots.memory`，而应作为 `memory-core` 之上的增强层运行。

新的稳定基线：

* `memory-core`：OpenClaw 标准记忆底座，提供 `memory_search` / `memory_get`。
* `memory-engine`：增强检索、confidence、LanceDB/vector、质量评估、生命周期治理层。
* `active-memory`：暂不启用，避免 blocking pre-reply 子代理与 memory-engine autoRecall 形成双轨召回。
* `memory-engine autoRecall`：暂不启用。
* `memory_search` / `memory_get`：不拦截、不 shadow。
* `memory_engine_search` / `memory_engine_get`：memory-engine 显式增强工具面。

### 配置修复

修复 OpenClaw 配置中与记忆系统不一致的问题：

* 移除 `tools.deny` 中的 `memory_search` / `memory_get`，恢复 memory-core 标准工具。
* 移除 `plugins.slots.contextEngine="legacy"`，避免误认为 memory-engine 接管 context engine。
* 移除 `plugins.slots`，让 OpenClaw 默认回退到 `memory-core`。
* 保持 `memory-engine.enabled=true`。
* 保持 `memory-engine.config.autoRecall.enabled=false`。
* 保持 `active-memory` disabled。

验证结果：

* `memory-core` enabled，索引状态正常。
* `memory-engine` enabled。
* `memorySearch.enabled=true`。
* `memory_search` / `memory_get` 不再被屏蔽。
* 无 memory slot / models.json doctor error。
* 剩余 warning 为已知无害的 plugin install metadata conflict：`acpx`, `codex`。

### 工具面收敛

新增 memory-engine 显式 wrapper tools：

* 保留 `memory_engine`，保持 backward compatibility。
* 新增 `memory_engine_search`，薄 wrapper 到现有 hybrid search path。
* 新增 `memory_engine_get`，支持通过 engine id / id prefix 读取 memory，并返回 path / line_range metadata。
* 明确不注册 `memory_search` / `memory_get`，避免 shadow OpenClaw 标准 memory tools。

测试覆盖：

* manifest 只包含 `memory_engine`, `memory_engine_search`, `memory_engine_get`。
* runtime registration 与 manifest 对齐。
* `memory_engine_search` 与原 `memory_engine action=search` 行为一致。
* `memory_engine_get` 对 missing id 有清晰错误处理。
* `memory_engine_get` 对 ambiguous id prefix 返回 multiple-match metadata，不 silent pick first。
* memory-engine 不注册、不 shadow `memory_search` / `memory_get`。

---

## 2. Session-checkpoint raw-log input hardening

修复 session-checkpoint 的 daily input pipeline。

### 问题

`readYesterdayRawLogs` 名义上读取“昨天”的 checkpoint 输入，但实际只有 smart-add source 按日期过滤：

* Source 1：`memory/smart-add/{targetDate}.md`，正确按日期读取。
* Source 2：DB raw_log，原来使用 `WHERE category='raw_log' LIMIT 100`，没有日期边界。
* Source 3：`.jsonl.reset.*` transcript，原来扫描所有 reset 文件，没有日期边界。

这会导致 daily checkpoint 混入：

* 跨天历史对话。
* reset transcript 中的大量工具调用结果。
* 配置文件、doctor 输出、test 输出等大块文本。
* 旧 assistant 答复和误答。
* 多 session 重复内容。

根因不是 LLM 摘要能力不足，而是 checkpoint 输入数据边界错误。

### 修复

将 checkpoint 输入收集改为 explicit `targetDate` path：

* CLI 支持 `--target-date`。
* CLI 支持 `--dry-run`。
* DB raw_log 按 business-day range 过滤，并按时间排序。
* reset/session transcript 只读取 targetDate 相关文件。
* `.trajectory.*` 文件排除。
* live `.jsonl` 如果存在 `.reset.*` counterpart，则避免重复读取。
* DB / reset 重复内容 dedup，reset transcript 优先。
* 保留 user / assistant 自然语言对话。
* raw `toolResult` / `tool_output` / `role=tool` 不再进入 `combinedText`。
* 非 message transcript records、thinking、tool-call implementation noise 不再进入 LLM 输入。
* 白名单工具输出只允许压缩为 compact assistant-style summaries。
* 增加 source/session/final input budgets，避免同日输入过大压垮 summarizer。

当前预算：

* `maxFinalCombinedChars=40000`
* `toolSummaryChars=4000`

### Dialogue-first checkpoint

checkpoint 输入现在采用：

```text
targetDate-scoped sources
→ dialogue-first extraction
→ raw tool output suppression
→ selected compact tool summaries
→ dedup
→ source/session/final budgets
→ debug stats
→ LLM summarization
```

不再采用原来的 raw-log 大杂烩模式。

### Role inference cleanup

修复 DB raw_log 中带 timestamp/session prefix 的 role 识别：

```text
[timestamp | session:...] **User:** ...
[timestamp | session:...] **Assistant:** ...
```

现在会先剥离前缀，再识别 `**User:**` / `**Assistant:**`。

保守策略：

* 有明确 `**User:**` / `**Assistant:**` 证据：归类为 `user` / `assistant`。
* 裸文本没有显式 role 证据：保留为 `metadata_header`。
* 不通过语义猜测把裸文本强行归为 user，避免 silent misclassification。

### Dry-run result

对 `2026-06-22` dry-run：

* `charsBeforeBudget=106504`
* `charsAfterBudget=40000`
* `budgetApplied=true`
* `droppedByBudgetCount=151`

预算后角色分布：

| Role                   |  Chars | Notes                                                 |
| ---------------------- | -----: | ----------------------------------------------------- |
| note                   | 15,925 | smart-add notes                                       |
| user                   | 12,466 | user dialogue                                         |
| assistant              |  3,643 | assistant natural-language replies                    |
| metadata_header        |  7,506 | historical DB raw_log bare text without role evidence |
| assistant_summary      |      0 | none in this run                                      |
| assistant_tool_summary |      0 | no whitelisted tool summaries present in this run     |

`metadata_header` 已审计：

* 不包含 raw tool output。
* 不包含配置文件原文。
* 不包含 doctor/test 输出。
* 不包含 trajectory。
* 不包含 thinking。
* 主要是历史 DB raw_log 中缺少 role prefix 的真实对话文本。

保留为 `metadata_header` 是有意设计，避免把无法机器验证 role 的历史裸文本误标成 user。

### Tests

新增/覆盖测试：

* DB raw_log outside targetDate 被排除。
* reset transcript outside targetDate 被排除。
* raw tool output 不进入 `combinedText`。
* targetDate user/assistant dialogue 被保留。
* DB/reset duplicate content 只保留一份。
* large tool output 不主导最终输入。
* explicit `targetDate` 语义覆盖旧 implicit “yesterday” 行为。
* full tool output absent。
* compact test summary retained。
* compact doctor summary retained。
* large config-style output dropped。
* user/assistant dialogue retained。
* tool summaries stay within budget。
* timestamp-prefixed `**User:**` DB row classified as user。
* timestamp-prefixed `**Assistant:**` DB row classified as assistant。
* bare text remains `metadata_header`。
* long summary-like text is not misclassified as user。

验证通过：

```text
find test -name '*.test.js' -print0 | xargs -0 node --test
node bin/session-checkpoint.js --dry-run --target-date 2026-06-22
```

---

## Files changed

Compatibility wrapper work:

* `openclaw.plugin.json`
* `index.js`
* `lib/tools/memory-engine-actions.js`
* `lib/tools/register-memory-engine-tools.js`
* `test/memory-engine-tool-wrappers.test.js`
* `test/review-findings.test.js`
* `README.md`
* `docs/openclaw-memory-contract-compat.md`

Checkpoint hardening:

* `bin/session-checkpoint.js`
* `lib/checkpoint/raw-log.js`
* `lib/checkpoint/runtime.js`
* `test/checkpoint-raw-log.test.js`

---

## Decisions

* memory-engine 当前不做 `kind:"memory"`。
* memory-engine 当前不接管 `plugins.slots.memory`。
* memory-engine 不注册 `memory_search` / `memory_get`。
* memory-core 继续作为 OpenClaw 标准记忆底座。
* memory-engine 作为增强层提供更强检索、置信度和生命周期治理。
* active-memory 暂不启用。
* memory-engine autoRecall 暂不启用。
* checkpoint 输入必须是 dialogue-first，而不是 raw-log-first。
* raw toolResult 永不直接进入 checkpoint LLM 输入。
* 历史裸文本 raw_log 不人工猜 role，不强行回填。

---

## Current status

已完成并 push：

* OpenClaw memory contract compatibility baseline。
* memory-engine explicit search/get wrapper tools。
* session-checkpoint raw-log input hardening。
* dialogue-first checkpoint input。
* input budget。
* metadata_header 审计与 role inference cleanup。

当前稳定基线：

```text
memory-core = OpenClaw standard memory substrate
memory-engine = enhancement / governance layer
active-memory = off
memory-engine autoRecall = off
checkpoint = targetDate-scoped + dialogue-first + budgeted
```

---

## Next

下一步建议进入 P2：agent 工具使用策略与 smoke test。

需要明确 edi / task-planner 何时使用：

* `memory_search`：OpenClaw 原生记忆文件搜索。
* `memory_get`：读取 OpenClaw 原生 source。
* `memory_engine_search`：使用 memory-engine 增强检索能力。
* `memory_engine_get`：读取 memory-engine 具体结果。
* `memory_engine`：管理、状态、维护入口。

暂缓：

* 不做 memory slot owner 化。
* 不启用 active-memory。
* 不同时启用 active-memory 与 memory-engine autoRecall。
* Recall Hint / 统计型 LTR 等新功能等工具契约稳定后再推进。



## 2026-06-22

### OpenClaw memory contract compatibility

完成 memory-engine 与新版 OpenClaw 内建记忆系统的兼容性审计与第一轮适配。

本次审计确认：OpenClaw 当前记忆底座由 `memory-core` 提供，标准工具为 `memory_search` / `memory_get`；`active-memory` 是可选的召回编排层，不是 memory backend；`memory-wiki` 是旁路知识层。memory-engine 当前实现依赖 `memory-core` 的 `getMemorySearchManager` 作为 lexical 通道，因此现阶段不应接管 `plugins.slots.memory`，而应定位为 `memory-core` 之上的增强层。

#### Decisions

* 保持 `memory-core` 作为 OpenClaw 标准记忆底座。
* memory-engine 暂不声明 `kind:"memory"`，不接管 memory slot。
* memory-engine 不注册、不 shadow `memory_search` / `memory_get`。
* `active-memory` 暂不启用，避免与 memory-engine autoRecall 形成双轨召回。
* memory-engine 继续作为增强层提供 hybrid rerank、confidence、LanceDB/vector、质量评估与生命周期治理能力。

#### Config compatibility fix

清理 OpenClaw 配置中的误导项：

* 移除 `tools.deny` 中的 `memory_search` / `memory_get`，恢复 memory-core 标准工具。
* 移除 `plugins.slots.contextEngine="legacy"`，避免误认为 memory-engine 接管 context engine。
* 移除 `plugins.slots`，让 OpenClaw 默认回退到 `memory-core`。
* 保持 `memory-engine.enabled=true`。
* 保持 `memory-engine.config.autoRecall.enabled=false`。
* 保持 `active-memory` disabled。

验证结果：

* `memory-core` enabled，索引状态正常：246/246 files，4848 chunks，Dirty=no。
* `memory-engine` enabled，工具为 `memory_engine`，autoRecall=false。
* `memorySearch.enabled=true`。
* `memory_search` / `memory_get` 不再被屏蔽。
* 无 memory slot / models.json doctor error。
* 剩余 warning 为已知无害的 plugin install metadata conflict：`acpx`, `codex`。

#### Tool wrapper compatibility

新增显式 memory-engine 工具面，降低 agent 使用成本，同时保持不抢占 OpenClaw 标准 memory tools：

* 保留 `memory_engine` 作为 backward-compatible 管理型入口。
* 新增 `memory_engine_search`，作为 existing hybrid search path 的薄 wrapper。
* 新增 `memory_engine_get`，支持通过 engine id / id prefix 读取 memory，并在 chunk metadata 存在时返回 path 与 line_range。
* `openclaw.plugin.json` 的 `contracts.tools` 与 runtime 注册保持一致。
* 明确不注册 `memory_search` / `memory_get`，避免 shadow memory-core。

相关文件：

* `openclaw.plugin.json`
* `index.js`
* `lib/tools/memory-engine-actions.js`
* `lib/tools/register-memory-engine-tools.js`
* `test/memory-engine-tool-wrappers.test.js`
* `test/review-findings.test.js`
* `README.md`
* `docs/openclaw-memory-contract-compat.md`

#### Tests

测试通过：

* `find test -name '*.test.js' -print0 | xargs -0 node --test`
* Result: 58 passed, 0 failed

新增/覆盖测试点：

* manifest 包含且仅包含 `memory_engine`, `memory_engine_search`, `memory_engine_get`。
* runtime registration 与 manifest 对齐。
* `memory_engine_search` 与原 `memory_engine action=search` 结果一致。
* `memory_engine_get` 对 missing id 有清晰错误处理。
* `memory_engine_get` 对 ambiguous id prefix 返回 multiple-match metadata，不会 silent pick first match。
* memory-engine 不注册、不 shadow `memory_search` / `memory_get`。

#### Notes

Codex 环境中 `openclaw doctor` 与 `openclaw plugins inspect --runtime --json` 曾因 EROFS 无法写入 `~/.openclaw/state` / `~/.openclaw/logs` 而失败，属于环境限制，不是测试失败。后续 runtime-level 验证应在真实可写 OpenClaw 环境中执行。

#### Current architecture baseline

当前稳定基线：

* `memory-core` = OpenClaw 标准记忆底座。
* `memory-engine` = 增强检索 / confidence / 生命周期治理层。
* `active-memory` = 暂不启用。
* `memory-engine autoRecall` = 暂不启用。
* `memory_engine_search` / `memory_engine_get` = memory-engine 显式工具面。
* `memory_search` / `memory_get` = memory-core 标准工具，不拦截、不 shadow。

#### Next

下一步建议进入 P2：agent 工具使用策略与 smoke test。

需要明确 edi / task-planner 何时使用：

* `memory_search`：OpenClaw 原生记忆文件搜索。
* `memory_get`：读取 OpenClaw 原生 source。
* `memory_engine_search`：使用 memory-engine 增强检索能力。
* `memory_engine_get`：读取 memory-engine 具体结果。
* `memory_engine`：管理、状态、维护入口。

暂缓：

* 不做 `kind:"memory"` / slot owner 化。
* 不启用 `active-memory`。
* 不同时启用 active-memory 与 memory-engine autoRecall。
* Recall Hint / 统计型 LTR 等新功能等工具契约稳定后再推进。


## 2026-06-21

### Checkpoint confidence warning hotfix

Review 发现 `bin/session-checkpoint.js` 中仍有 3 处 `catch (e) {}` 静默吞掉 `writeConfidence` 失败。

这类问题很危险，因为 nightly checkpoint 是无人值守 cron 路径。如果 memory 内容写入成功但 confidence 写入失败，第二天只会看到质量缺口，却没有失败上下文。

已修复：

* `writeConfidence` 失败不再 silent
* checkpoint 流程仍然不中断
* warning 中包含：

  * `entryId`
  * `category`
  * `section`
  * optional `type/key`
  * error message

同时清理了 `lib/quality/quality-score.js` 中 `getSuggestedAction(..., candidate)` 的死参数。

相关 commit/tag：

* `f222db9 fix(checkpoint): warn on confidence write failures`
* `v0.8.10-checkpoint-confidence-warning`

### Diagnostics repair policy

补充 quality diagnostics repair policy 文档，明确质量诊断不是自动修复指令。

文档化原则：

* `orphan_confidence`

  * 可 dry-run
  * 可 guarded apply
  * 必须 backup + explicit confirm
* `chunks_without_confidence`

  * ownership-aware diagnostic
  * 不自动 backfill confidence/category
* `duplicate_exact`

  * audit-only
  * 不自动 delete
* `timestamp_pollution`

  * source audit + false-positive refinement
  * 不自动 rewrite historical memory content

核心红线：

* diagnostics 不等于 cleanup instruction
* 自动修复必须有单独 guarded apply mode
* 必须 dry-run、备份、明确确认
* 禁止因为 report 中出现 flag 就直接改 DB 或重写 memory 内容

相关 commit：

* `e35098f docs(quality): document diagnostics repair policy`

### 测试与最终状态

最终状态：

* `main` 与 `origin/main` 同步
* 工作区 clean
* tag 链完整：`v0.8.3` 到 `v0.8.10`
* 测试全绿：

  * `346 tests`
  * `340 pass`
  * `0 fail`
  * `6 skipped`

### 当前结论

这一轮收尾后，memory quality evaluation 已经从“发现一堆质量问题”推进到“能解释问题属于谁、是否还在产生、是否允许修复”。

关键结论：

* lifecycle-owned missing confidence: `0`
* timestamp pollution after-fix: `0`
* smart-add duplicates 已审计，但不盲删
* quality diagnostics 不再被误当成 cleanup 指令
* checkpoint confidence 写入失败不再 silent

下一步不建议继续清历史数据。更合理的方向是进入 quality eval stabilization，让这些 report 稳定跑几天，再决定是否接 Console、做 guarded cleanup，或推进 Recall Hint / 统计型 LTR。


## 2026-06-20

### Memory Quality Evaluation 收尾

* 完成 `chunks_without_confidence / missing_category` 的根因审计与 ownership-aware quality scope 修正。

  * 原始现象：`chunks_without_confidence = 1504`，`missing_category = 1504`，两者为同一 chunk 集合。
  * 审计后确认：`memory_engine_lifecycle` 范围内缺失 confidence 的数量为 `0`。
  * 将质量评估 scope 拆分为 lifecycle-owned、OpenClaw core-owned、generated/diagnostic、legacy/manual、unknown/stale indexed records。
  * 默认质量分不再惩罚 memory-engine 不拥有 lifecycle 的 indexed memory。
  * 默认评分口径变化：

    * `total_evaluated: 4582 -> 3079`
    * `average_score: 80.07 -> 89.92`
  * `--scope all` 仍保留全量 indexed diagnostics，不隐藏历史债务。

* 确认 `memory/daily.md` 为历史误写孤本。

  * 源文件已删除。
  * core index 中仍残留 stale `core.files/core.chunks` 记录。
  * 根因是 OpenClaw main agent 配置 `memorySearch.enabled: false` 会同时关闭 runtime recall 和 index maintenance，导致 `openclaw memory index --agent main --force` 返回 `Memory search disabled.`，无法自然 prune。
  * 该问题已记录为 OpenClaw core 配置语义耦合问题，不在 memory-engine 中手写 DB 修复。

* 修正 `sync-memory-index.js` CLI 依赖边界。

  * 避免本地缺少 OpenClaw harness-only package 时直接 import-time hard fail。
  * 在缺少本地 runtime manager 时，降级走 sanctioned `openclaw memory index --agent main --force` 路径。
  * 未添加 direct SQL delete，未弱化 core write guard。

### Smart-add Duplicate Audit

* 新增 lifecycle-owned smart-add exact duplicate 只读审计。

  * 保留旧的单文件 fingerprint audit 兼容模式。
  * 新增 ownership-aware duplicate audit 报告：

    * `reports/memory-quality/smart-add-duplicate-audit.json`
    * `reports/memory-quality/smart-add-duplicate-audit.md`
    * `reports/memory-quality/p3-smart-add-duplicate-summary.md`
  * 审计结果：

    * lifecycle-owned smart-add duplicate groups: `127`
    * duplicate entries: `299`
    * cleanup eligible: `7 groups / 19 entries`
    * retrieved duplicate groups: `37`
    * injected duplicate groups: `18`
    * mixed_or_unclear: `83`
    * unsafe_to_cleanup: `37`
  * 结论：smart-add duplicate 不是可直接批量删除的问题，大多数重复需要保留语义判断或因 retrieval/injection 触碰而不安全。
  * 本阶段未执行 cleanup、未写 DB、未改 recall、未改 quality score、未接 Console。

### Timestamp Pollution Audit

* 新增 timestamp pollution 只读审计。

  * 新增：

    * `bin/audit-timestamp-pollution.js`
    * `lib/quality/timestamp-pollution.js`
    * `lib/quality/timestamp-pollution-audit.js`
    * `reports/memory-quality/timestamp-pollution-audit.{json,md}`
    * `reports/memory-quality/p4-timestamp-pollution-summary.md`
  * live audit 初始结果：

    * all scope: `164`
    * default scope: `57`
    * generated/diagnostic: `98`
    * lifecycle-owned: `57`
    * core-owned: `9`
    * after-fix newly created pollution: `0`

* 收窄 timestamp pollution detector 的 false positive。

  * 现在会忽略正常 session/date/generated footer 模式，例如：

    * `# Session: ...`
    * `generatedAt: ...`
    * `_Generated at ..._`
    * 普通 markdown 日期标题
  * 仍继续标记 raw log 风格和 smart-add 内容中的嵌入式操作时间戳，例如：

    * `[2026-05-09 16:21:33][ERROR]...`
    * smart-add fact 中夹带 ISO operational timestamp
  * refinement 后结果：

    * all scope: `164 -> 154`
    * default scope: `57 -> 56`
    * core-owned: `9 -> 0`
    * episode: `1 -> 0`
  * 剩余污染为：

    * dreaming generated diagnostics: `98`
    * historical smart-add residue: `56`
  * 结论：没有证据表明当前 post-fix pipeline 仍在持续生成 timestamp pollution；历史 cleanup 暂缓。

### Reports / Tests

* 新增并更新多份 memory quality 报告：

  * `p2-ownership-scope-summary.md`
  * `smart-add-duplicate-audit.{json,md}`
  * `p3-smart-add-duplicate-summary.md`
  * `timestamp-pollution-audit.{json,md}`
  * `p4-timestamp-pollution-summary.md`

* 测试全部通过：

  * ownership scope / chunks-without-confidence tests
  * smart-add duplicate audit tests
  * timestamp pollution audit tests
  * full `node --test`

### Tags / Branches

* `v0.8.7-quality-ownership-scope`

  * 捕获 P2 ownership-aware quality scope merge 状态。
* `fix/smart-add-duplicate-audit`

  * 已完成 P3 smart-add duplicate audit。
* `fix/timestamp-pollution-audit`

  * 已完成 P4 timestamp pollution audit 与 detector refinement，待 merge/tag。

### 后续

* 不建议立即做 smart-add duplicate cleanup。

  * 当前 cleanup-eligible 仅 `7 groups / 19 entries`，收益较小，且已有大量重复被 retrieval/injection 触碰。
* 不建议立即做 timestamp pollution historical cleanup。

  * 当前没有 post-fix 新增污染证据，剩余主要是历史 residue。
* 下一步建议让 quality eval 稳定运行几天，再决定是否接 Console 或做 guarded historical cleanup。



## 2026-06-20

### 清理

- 已在真实 engine DB 上执行 orphan confidence cleanup apply。
- 清理对象仅为 `memory_confidence` 中确认 orphan 的 stale rows。
- 本次 `confidence_total_count` 从 `9782` 降到 `3078`。
- 本次共删除 `6704` 条 orphan `memory_confidence` rows。
- 清理后：
  - `orphan_confidence_count = 0`
  - `would_delete_count = 0`
  - `remaining_orphan_confidence_count = 0`
  - `memory-quality-eval` 的 orphan diagnostics count = `0`

### 边界

- 没有清理 `core.chunks`。
- 没有清理 `memory_events`。
- 没有清理 memory files。
- 没有清理 LanceDB / vector data。
- 没有执行 `VACUUM`。

### 备份

- apply 前已自动创建 engine DB 备份：
  - `memory-engine-before-orphan-confidence-cleanup-20260620T030551Z.sqlite`

### 验证

- 清理后重新运行 orphan confidence dry-run，确认 orphan 计数归零。
- 清理后重新运行 `memory-quality-eval`，确认 orphan diagnostics count 归零。
- 平均分约 `80.07`，与清理前基本不变；orphan confidence diagnostics 不参与 per-memory scoring。

### 后续

- `chunks_without_confidence = 1504` 仍然存在，且本次清理前后未变。
- `chunks_without_confidence` 属于后续单独问题，不包含在本次 orphan confidence cleanup 范围内。


## 2026-06-20

### v0.8.5-memory-quality-eval

完成 memory quality evaluation MVP，并发布 `v0.8.5-memory-quality-eval`。

新增内容：

* 新增 `bin/memory-quality-eval.js`，用于生成只读 memory quality 诊断报告。
* 新增 Markdown / JSON 报告输出：

  * `tmp/memory-quality/latest.md`
  * `tmp/memory-quality/latest.json`
* 默认 scope 为 `active-memory`。
* 引入 path family 分类：

  * `smart-add`
  * `dreaming`
  * `episodes`
  * `projects`
  * `daily-root`
  * `memory-root`
  * `memory-other`
  * `stats-history`
  * `non-memory`
* 默认排除 `stats-history` path family。
* 支持基于 `core.chunks`、`memory_confidence`、`memory_events` 的质量诊断。
* 修正 `memory_events.memory_id` 与 `chunks.id` 的 16 字符 prefix join 逻辑。
* 新增质量 flags / diagnostics：

  * `never_retrieved`
  * `chunks_without_confidence`
  * `missing_category`
  * `duplicate_exact`
  * `timestamp_pollution`
  * `category_path_mismatch`
  * `orphan_confidence`
* orphan confidence 在本阶段仅作为 diagnostics 输出，不进入 per-memory score，也不执行清理。
* 新增 `tmp/memory-quality/` gitignore，避免报告产物污染工作区。

验证结果：

* `npm test` 通过。
* `node bin/memory-quality-eval.js --top 20` 真实库运行通过。
* live report evaluated memories: 4582。
* average score: 80.07。
* grade distribution:

  * A: 2577
  * B: 1052
  * C: 453
  * D: 500
* top flags:

  * `never_retrieved`: 2198
  * `chunks_without_confidence`: 1504
  * `missing_category`: 1504
  * `duplicate_exact`: 742

后续拆分：

* `orphan_confidence = 6704` 被确认为 stale confidence rows，后续在 `v0.8.6-orphan-confidence-cleanup` 单独处理。
* `chunks_without_confidence = 1504` 是另一类问题，后续需要单独排查 confidence 生成 / 补全路径。



## 2026-06-19

### 新增

* 新增 `memory-quality-eval` MVP，用于对 memory-engine 当前记忆库进行只读质量评估。
* 新增 CLI：

  * `node bin/memory-quality-eval.js`
  * 支持 `--json`
  * 支持 `--top <n>`
  * 支持 `--include-stats-history`
  * 支持 `--path-family <family>`
  * 支持 `--category <category>`
  * 支持 `--path-prefix <prefix>`
  * 支持 `--include-archived`
* 新增质量评估模块：

  * `lib/quality/collect-quality-candidates.js`
  * `lib/quality/event-prefix-join.js`
  * `lib/quality/path-family.js`
  * `lib/quality/quality-rules.js`
  * `lib/quality/quality-score.js`
  * `lib/quality/quality-report.js`
  * `lib/quality/quality-types.js`
* 新增记忆质量报告输出：

  * `tmp/memory-quality/latest.md`
  * `tmp/memory-quality/latest.json`
* 新增 `docs/memory-quality-eval-mvp-v4.md`，记录 MVP v4 的设计边界、真实 schema 假设、collector 策略、评分规则和后续路线。
* 新增 `memory:quality` npm script，用于运行记忆质量评估。

### 功能

* 实现 active memory candidates 的只读扫描。
* 支持从 OpenClaw core DB `chunks` 与 memory-engine DB `memory_confidence` / `memory_events` 收集评估数据。
* 支持基于真实 schema 的 event prefix join：

  * `memory_events.memory_id` 为 16 位前缀。
  * 与 `chunks.id.slice(0, 16)` 做前缀匹配。
  * 输出 prefix matched / unmatched / ambiguous diagnostics。
* 支持 path family 分类：

  * `smart-add`
  * `dreaming`
  * `episodes`
  * `projects`
  * `daily-root`
  * `memory-root`
  * `memory-other`
  * `stats-history`
  * `non-memory`
* 默认纳入 `MEMORY.md`。
* 默认排除 `memory/stats-history.md`，避免统计生成物污染普通记忆质量评估。
* 支持 deterministic quality flags：

  * `missing_content`
  * `content_empty`
  * `content_too_short`
  * `timestamp_pollution`
  * `raw_log_leak`
  * `debug_noise`
  * `missing_category`
  * `unknown_category`
  * `category_path_mismatch`
  * `duplicate_exact`
  * `conflict_flagged`
  * `too_generic`
  * `chunks_without_confidence`
  * `never_retrieved`
  * `old_and_unused`
* 支持 100 分制评分、A/B/C/D 分级、hard cap 与 suggested action。
* 支持 duplicate exact group 报告。
* 支持 Markdown 与 JSON 双格式报告。
* 支持 DB health diagnostics：

  * orphan confidence count
  * truly missing orphan confidence count
  * fake orphan confidence count
  * chunks without confidence count
  * confidence id length distribution
  * orphan confidence month distribution
  * event type distribution
  * prefix join diagnostics
  * path family distribution
  * cite / reinforce sparse signal diagnostics

### 修正与约束

* 明确 `orphan_confidence` 只进入 diagnostics，不进入 per-memory score。
* 确认当前 6704 条 orphan confidence 是历史遗留的 stale data，而不是 prefix / id format mismatch。
* 明确 orphan confidence 后续应由单独 dry-run cleanup 脚本处理，不属于本 MVP。
* 明确 `memory_cited` / `memory_reinforced` 当前信号过稀疏，不参与 per-memory scoring。
* `never_retrieved` 与 `old_and_unused` 使用 age gate，避免误伤新记忆。
* CLI 禁止 MVP 外危险参数：

  * `--fix`
  * `--archive`
  * `--delete`
  * `--write-db`
  * `--llm-judge`

### 验证

* `npm test` 通过：53 tests passed, 0 failed。
* 真实 DB live report 生成成功：

  * Markdown report：约 49-51 KB
  * JSON report：约 13 MB
* 验证命令通过：

  * `node bin/memory-quality-eval.js`
  * `node bin/memory-quality-eval.js --json`
  * `node bin/memory-quality-eval.js --include-stats-history`
  * `node bin/memory-quality-eval.js --path-family <family>`
* 验证结果：

  * path family 包含 `dreaming` 与 `episodes`
  * `stats-history` 默认 excluded
  * `MEMORY.md` 默认 included
  * orphan confidence 仅在 diagnostics
  * `chunks_without_confidence` 进入 per-memory flags
  * `event_prefix_ambiguous = 0`
  * `latest.md` / `latest.json` 真实生成

### 当前报告发现

* 本次 live report 共评估 4470 条记忆，平均分 79.68。
* 等级分布：

  * A：2475
  * B：1052
  * C：443
  * D：500
* 3866 条记忆被至少一个 flag 标记。
* Top issues：

  * `never_retrieved`：2198
  * `chunks_without_confidence`：1504
  * `missing_category`：1504
  * `duplicate_exact`：732
  * `timestamp_pollution`：164
  * `category_path_mismatch`：119
* 发现 6704 条 orphan confidence，确认为 2026-06 集中产生的陈旧 confidence 数据，建议后续单独 dry-run cleanup。
* 发现 smart-add 文件存在大量跨日重复，后续建议做 duplicate audit，而不是直接删除。


## 2026-06-19

### 修复

- **`raw-log.js`** — checkpoint 读取 session 文件的过滤逻辑重写：
  - 不再只读取 `.jsonl.reset.*` 文件，避免漏掉已结束但未 reset 的 session。
  - 现在读取昨天修改过的 `.reset.*` 与过期 `.jsonl` session 文件，并排除 trajectory 文件。
  - `.reset.*` 文件按 mtime 过滤，而不是 reset 时间戳，避免历史 reset 文件被每晚重复扫描。
  - `.jsonl` 文件仅在没有对应 `.reset.*` 且 mtime 属于昨天时纳入。
  - 修复 Dashboard session `aaff432b` 这类已结束但未 reset 的 session 被漏读的问题。
  - 将 nightly checkpoint 扫描范围从历史 reset 文件缩小到昨日相关 session 文件，减少重复扫描与历史噪声。

### 测试

- 补充 `checkpoint-raw-log` 测试，覆盖：
  - `.reset.*` mtime 过滤。
  - stale `.jsonl` fallback。
  - `.jsonl` 有对应 `.reset.*` 时不重复纳入。
  - trajectory 文件排除。
  - 已结束但未 reset 的 session 纳入 checkpoint 输入。

## 2026-06-18

### 重构

- 完成 `bin/session-checkpoint.js` 行为保持拆分，将原本的大型 checkpoint 脚本拆为 `lib/checkpoint/*` 模块：
  - `date.js`
  - `runtime.js`
  - `config.js`
  - `llm.js`
  - `db.js`
  - `raw-log.js`
  - `completeness.js`
  - `markers.js`
  - `episode-writer.js`
  - `confidence-writer.js`
  - `conflict-resolver.js`
  - `orphan-repair.js`
  - `smart-add-writer.js`

- 保留 `bin/session-checkpoint.js` 作为 thin orchestrator / CLI entrypoint，继续负责：
  - `nightlyCheckpoint()` 主编排
  - `main()` CLI 流程
  - runtime fallback 安装
  - legacy/test compatibility exports

- 为各 checkpoint 子模块补齐直接单元测试，锁定：
  - raw-log 输入完整性门控
  - marker episode 写入
  - normal episode 文件写入
  - confidence 写入
  - config conflict resolution
  - orphan vector repair
  - smart-add append/dedup

### 修复

- 修复新建 smart-add daily 文件时未写入 `# Smart Added Memory` header 的历史问题。
- 保持已有 smart-add 文件追加行为不重复写 header。

### 验证

- `npm test` 通过，0 fail。

## 2026-06-18

- 拆分 `lib/recall/hybrid-search.js`：
  - 抽离 debug/warning helper
  - 抽离 candidate normalization
  - 抽离 lexical confidence helper
  - 抽离 fusion/final scoring helper
  - 抽离 KG/FTS/recent/vector retrieval channels
- 保持 `hybridSearch()` 和 `inferCategoryFromPath` public API 不变。
- 保持 SQL、召回通道、vector fallback、lexical confidence、warning-once、scoring weights、debug metadata 兼容。
- 新增 hybrid normalize / lexical / fusion / channels 专项测试。
- runtime smoke 通过，Console 正常，memory-engine 重启后无新增异常。


## 2026-06-17

- 将 core DB 写保护抽出为 `lib/db/core-write-guard.*`，由 CLI 与 engine DB 复用；新增 `test/core-write-guard.test.js` 覆盖 core 表写入拦截、engine 表写入放行，以及大小写、空白、SQL 注释前缀等边界场景。
-  `bin/session-checkpoint.js` 新增集成测试覆盖，使用临时 workspace、临时 core DB、临时 engine DB 与 mock LLM，避免访问真实 `~/.openclaw/memory` 或真实工作区。
- 盖 nightly checkpoint 关键路径：

  - aw log 不足时跳过 LLM，并写入 incomplete marker，避免生成幻觉摘要；
  - 定时钟与 `Asia/Shanghai` 时区，验证 `targetDate` / `generatedAt` 语义稳定；
  - ore DB 只读、engine DB 可写；
  - ore / engine / attached core 的 `busy_timeout=5000`；
  - 常 raw log 下写入 episode 与 smart-add 文件；
  - LM 失败时写入明确 failure marker，不写伪造摘要。
-为 `session-checkpoint` 增加最小可测试性注入点，包括临时路径、时区、时钟、LLM、raw log reader、repair/conflict handler；保留 `if (require.main === module) main()` 的直接执行行为。


## 2026-06-16

### 仓库结构

- 完成 `memory-engine` 仓库根迁移：新 git root 固定为 `~/.openclaw/workspace/plugins/memory-engine/`。
- 将原本散落在 workspace 根目录的项目文件集中到插件仓库内，包括 `docs/`、`skills/`、`test/`、`bin/`、README、schema、service 文件和调参文档。
- 将 workspace 根级运维脚本迁移到 `bin/`，避免和插件内部 `scripts/` 混淆。
- 更新文档、测试、skill、CLI 帮助文本中的旧路径引用：
 - `plugins/memory-engine/...` → 新仓库根路径
 - `scripts/...` → `bin/...`
 - `tests/...` → `test/...`
 - `openclaw plugins install ./plugins/memory-engine --force` → `openclaw plugins install . --force`
- 重写 `.gitignore` 为新仓库根适配的黑名单策略，并新增 `.env.example`。

### 修复

- 修复 `session-checkpoint.js` 的 SQLite 打开方式：
 - core `main.sqlite` 使用 safer open options。
 - 增加 `fileMustExist` / readonly 语义。
 - 为 core DB 与 engine DB 设置 `busy_timeout=5000`，降低并发访问时的锁冲突风险。
- 修复 `memory-engine-cli.js` 仍默认连接 OpenClaw core DB `~/.openclaw/memory/main.sqlite` 的遗留问题。
- CLI 默认 DB 改为隔离后的 engine DB：`~/.openclaw/memory/memory-engine/memory-engine.sqlite`。
- CLI DB 路径解析优先级调整为：
 1. `--db`
 2. `MEMORY_ENGINE_DB_PATH`
 3. `MEMORY_ENGINE_DB`
 4. 默认 engine DB 路径
- 修复 CLI `status/search` 因 `memory_confidence` 表位于 engine DB 而不是 core DB 导致的失败。
- CLI 现在区分三种 DB 访问模式：
 - `withEngineDb()`：访问 engine DB。
 - `withCoreDb()`：只读访问 OpenClaw core DB。
 - `withBothDbs()`：连接 engine DB，并 attach core DB 用于跨库搜索。
- 为 CLI 的 `withBothDbs()` 增加 core DB 写保护：
 - 新增 `isWriteSql(sql)`、`writeTargetIsCore(sql)`、`patchWriteGuards(db)`。
 - 在 attach core DB 后立即 patch `db.prepare` / `db.exec`。
 - 阻止 CLI 对 `core.*` 表执行写操作。
 - 误写 core DB 时抛出：`writes to OpenClaw core DB are blocked in memory-engine CLI`。

### 工具与测试

- 新增 `test/memory-engine-cli.test.js`，覆盖 CLI DB 路径解析与 DB 访问行为。
- 将 3 个未跟踪但属于 memory-engine 的项目脚本纳入新仓库：
 - `bin/backfill-lancedb.js`
 - `bin/benchmark-scale.js`
 - `bin/memory-benchmark.js`
- 更新 `static-check` 扫描范围，适配新仓库根与 `bin/` 目录。
- 更新 `sync-memory-index`、`smart-add`、`nightly-maintenance` 等脚本中的路径定位逻辑，减少对旧 workspace 层级的依赖。

### 验证

- `npm run check` 通过：86 files。
- `npm test` 通过：148 tests，142 pass，6 skip，0 fail。
- `node bin/memory-engine-cli.js --help` 正常输出用法。
- `node bin/memory-engine-cli.js status` 正常返回 engine DB 状态。
- `node bin/memory-engine-cli.js search "memory-engine"` 正常返回搜索结果。
- `openclaw plugins install . --force` 成功。
- Gateway 重启后确认：
 - `memory-engine` 插件正常加载。
 - autoRecall hook 注册成功。
 - LanceDB 初始化成功。
 - hot reload 后 autoRecall 可重新注册。

### 标签

- `v0.8.3-relocate-stable`：仓库根迁移完成后的稳定点。
- `v0.8.4-cli-core-guard`：CLI 使用隔离 engine DB，并阻止误写 OpenClaw core DB。
﻿

# OpenClaw 记忆系统 架构与开发文档 (LanceDB + SQLite 双引擎)

## 1. 架构核心哲学 (Design Philosophy)

本系统以agentmemory和knowledge graph为基础，采用“存算分离、惰性衰减、实证强化”体系，并在工程细节上加固了边缘防护与可观测性。

- **统一底座与双轨融合**：SQLite 为全局唯一持久化存储；Node.js Knowledge Graph 作为内存抽象引擎，图谱结论打包写回 SQLite，启动时从 SQLite 瞬间重建。
- **惰性计算**：不在后台任务中刷新活跃数据的置信度。时间流逝不消耗 I/O，仅在“检索召回”或“归档判定”时实时计算衰减。
- **基于引用的实证主义**：检索召回 ≠ 记忆强化。仅 LLM 实际输出的 `cited_memory_ids` 触发强化，杜绝噪音虚假繁荣。冷启动阶段引入**弱引用**（排名第一的隐式采纳）平滑过渡。
- **防御性设计**：所有参数可配置，所有关键链路均有诊断日志。

## 2. 数据库设计 (Schema & Migration)

在agentmemory数据库现有`chunks` 表基础上增加元数据字段。**注意：`base_tau` 为该记忆的初始半衰期（天），即 τ_min；最大半衰期 τ_max 固定为 365 天。**

### 2.1 变更脚本

```sql
-- 1. 置信度与生命周期追踪
ALTER TABLE chunks ADD COLUMN initial_confidence REAL DEFAULT 0.5;
ALTER TABLE chunks ADD COLUMN confidence REAL DEFAULT 0.5;
ALTER TABLE chunks ADD COLUMN last_confidence_update INTEGER;         -- Unix 秒
ALTER TABLE chunks ADD COLUMN base_tau REAL DEFAULT 7.0;              -- 该记忆专属的最小半衰期 (天)
ALTER TABLE chunks ADD COLUMN hit_count INTEGER DEFAULT 0;

-- 2. 状态与权限控制
ALTER TABLE chunks ADD COLUMN is_archived BOOLEAN DEFAULT 0;
ALTER TABLE chunks ADD COLUMN is_protected BOOLEAN DEFAULT 0;
ALTER TABLE chunks ADD COLUMN conflict_flag BOOLEAN DEFAULT 0;

-- 3. 类别与图谱支撑
ALTER TABLE chunks ADD COLUMN category TEXT DEFAULT 'raw_log';
ALTER TABLE chunks ADD COLUMN kg_data TEXT;                           -- JSON 子图容器
```

初始化脚本：将历史数据的 `last_confidence_update` 设置为 `updated_at`，`confidence` 和 `initial_confidence` 维持默认或手动评估。

## 3. 核心写入流：智能分级路由 (Smart Add)

在 `agentmemory.add` 外层封装网关，根据类别自动注入初始物理参数。

### 3.1 类别法则基准表

| Category       | initial_confidence | base_tau (天) | 适用场景                         |
|----------------|--------------------|---------------|----------------------------------|
| temporary      | 0.40               | 2.0           | 临时变量、单次任务               |
| raw_log        | 0.50               | 7.0           | 日常对话、未提炼想法             |
| episodic       | 0.70               | 30.0          | 情节摘要、会话总结               |
| preference     | 0.70               | 30.0          | 用户习惯、格式要求               |
| kg_node        | 0.85               | 90.0          | 经图谱提炼的结构化结论           |
| user_identity  | 0.95               | 365.0         | 核心身份、职业、受保护数据       |

### 3.2 写入网关实现

```python
import time

def smart_add_memory(text, metadata=None):
    if metadata is None:
        metadata = {}
    
    category = metadata.get('category', 'raw_log')
    is_protected = metadata.get('is_protected', False)
    
    # 路由分配
    if is_protected or category == 'user_identity':
        init_c, tau = 0.95, 365.0
    elif category == 'kg_node':
        init_c, tau = 0.85, 90.0
    elif category == 'preference':
        init_c, tau = 0.70, 30.0
    elif category == 'temporary':
        init_c, tau = 0.40, 2.0
    else:  # raw_log
        init_c, tau = 0.50, 7.0

    metadata['initial_confidence'] = metadata.get('initial_confidence', init_c)
    metadata['confidence'] = metadata['initial_confidence']
    metadata['base_tau'] = metadata.get('base_tau', tau)
    metadata['last_confidence_update'] = int(time.time())
    metadata['hit_count'] = 0
    metadata['conflict_flag'] = 0

    return agentmemory.add(text, metadata)
```

## 4. 核心检索流：混合门控排序 (Hybrid Search)

采用**动态阈值门控 + 动态指数衰减 + 加权求和**，参数可通过配置文件调整。

### 4.1 配置项

```python
CONFIG = {
    "MIN_SIMILARITY_THRESHOLD": 0.55,   # 门控阈值（需根据嵌入模型分布调整）
    "ALPHA_VECTOR_WEIGHT": 0.7,         # 语义权重（剩余 0.3 归置信度）
    "TAU_MAX": 365.0,                   # 最大半衰期
    "BETA": 0.3,                        # 巩固速率因子
    "CONFLICT_PENALTY": 0.5,            # 冲突惩罚固定值
    "ARCHIVE_THRESHOLD": 0.15           # 归档置信度冰点
}
```

### 4.2 数学公式

**动态半衰期：**
$$
\tau(\text{hits}) = \text{base\_tau} + (365 - \text{base\_tau}) \cdot (1 - e^{-0.3 \cdot \text{hits}})
$$

**实时置信度（带冲突惩罚）：**
$$
\text{Conf}_{realtime} = \max(0, \, \text{Conf}_{snapshot} \cdot e^{-\frac{\Delta t_{days}}{\tau(\text{hits})}} - \text{Penalty}_{conflict})
$$

### 4.3 检索拦截器

```python
import math
import time

def calculate_tau(hits, base_tau, tau_max=CONFIG["TAU_MAX"], beta=CONFIG["BETA"]):
    if base_tau >= tau_max:
        return base_tau
    return base_tau + (tau_max - base_tau) * (1 - math.exp(-beta * hits))

def hybrid_search(query_text, top_k=5):
    candidates = agentmemory.search(query_text, limit=30)
    current_time = int(time.time())
    results = []
    
    alpha = CONFIG["ALPHA_VECTOR_WEIGHT"]
    threshold = CONFIG["MIN_SIMILARITY_THRESHOLD"]
    penalty = CONFIG["CONFLICT_PENALTY"]
    
    for chunk in candidates:
        if chunk.is_archived:
            continue
        
        vector_score = chunk.similarity
        if vector_score < threshold:
            continue  # 门控拦截
        
        # 惰性衰减计算
        if chunk.is_protected:
            real_time_conf = chunk.confidence
        else:
            # 防御：last_confidence_update 为空时视作刚更新
            if not chunk.last_confidence_update:
                delta_days = 0.0
            else:
                delta_days = (current_time - chunk.last_confidence_update) / 86400.0
            
            tau = calculate_tau(chunk.hit_count, chunk.base_tau)
            decay = math.exp(-delta_days / tau)
            real_time_conf = max(0.0, chunk.confidence * decay - (penalty if chunk.conflict_flag else 0.0))
        
        final_score = (alpha * vector_score) + ((1 - alpha) * real_time_conf)
        
        # 附加诊断信息
        chunk.current_score = final_score
        chunk.real_time_conf = real_time_conf
        results.append(chunk)
    
    results.sort(key=lambda x: x.current_score, reverse=True)
    top_results = results[:top_k]
    
    # 诊断日志（影子测试阶段）
    log_search_diagnostics(query_text, candidates, top_results)
    
    return top_results
```

## 5. 记忆演化流：强化、冲突与归档

### 5.1 引用强化闭环 (Update Hook)

LLM 响应必须包含 `cited_memory_ids`。系统仅对这些 ID 执行强化。

```sql
UPDATE chunks 
SET hit_count = hit_count + 1,
    confidence = MIN(1.0, <real_time_conf> + 0.1),
    last_confidence_update = strftime('%s', 'now')
WHERE id IN (?, ?);
```

**冷启动过渡**：在系统初期 LLM 引用率不稳定时，可启用**弱引用模式**（默认关闭）。即：若 LLM 未提供任何引用，则将本次检索排名第一的记忆视为隐式采纳，给予 `+0.03` 的微小强化并更新命中次数。此模式通过 `ENABLE_WEAK_CITATION = True` 开关控制，待引用率稳定后关闭。

### 5.2 冲突标记生成

冲突判定双链路：

- **快速链路（图谱驱动）**：Knowledge Graph 检测到 Concept Drift 后，通过向量检索定位相关的 `raw_log` 记忆，直接将其 `conflict_flag` 置为 1。
- **慢速链路（心跳扫描）**：每日定时任务，提取近 24 小时的高置信度新记忆，检索语义相似但时间久远的记忆，调用轻量 LLM 判断是否矛盾。若矛盾，将旧记忆的 `conflict_flag` 置为 1。

未来优化方向：冲突惩罚量可根据新事实的置信度动态计算（如 `penalty = 0.5 * Conf(new_fact)`），v3.1 暂用固定值。

### 5.3 纯净心跳归档 (Zero-Write Compaction)

**绝对禁止**更新活跃记忆的 `confidence` 或时间戳。仅计算内存中的实时置信度，对跌破冰点的记忆标记 `is_archived`。

```python
def heartbeat_compaction():
    active = db.query(
        "SELECT id, confidence, last_confidence_update, hit_count, base_tau, is_protected, category "
        "FROM chunks WHERE is_archived = 0 AND is_protected = 0"
    )
    current_time = get_unix_timestamp()
    to_archive = []
    
    for chunk in active:
        # 额外防护：user_identity 即使未设保护也不归档
        if chunk.category == 'user_identity':
            continue
        
        if not chunk.last_confidence_update:
            continue  # 数据异常，跳过
        
        delta_days = (current_time - chunk.last_confidence_update) / 86400.0
        tau = calculate_tau(chunk.hit_count, chunk.base_tau)
        real_conf = chunk.confidence * math.exp(-delta_days / tau)
        
        if real_conf < CONFIG["ARCHIVE_THRESHOLD"]:
            to_archive.append(chunk.id)
    
    if to_archive:
        db.execute("UPDATE chunks SET is_archived = 1 WHERE id IN (?)", to_archive)
```

## 6. 图谱桥接：子图打包方案 (KG Integration)

为保留结构化信息，`kg_data` 采用“节点为中心”的子图容器，三元组可附带置信度。

**Node.js 写入示例：**

```javascript
agentmemory.add({
  text: "用户倾向使用 Rust 开发系统层级应用，极其看重内存安全。",
  metadata: {
     category: "kg_node",
     kg_data: JSON.stringify({
         "core_concept": "Rust_Preference",
         "triplets": [
             {"s": "User", "p": "prefers", "o": "Rust", "confidence": 0.9},
             {"s": "User", "p": "applies_to", "o": "System_Programming", "confidence": 0.7},
             {"s": "Rust", "p": "provides", "o": "Memory_Safety", "confidence": 0.85}
         ]
     }),
     is_protected: 1
  }
});
```

**启动重建流：** Node.js 服务启动时，查询 `SELECT kg_data FROM chunks WHERE category='kg_node' AND is_archived=0`，解析 JSON 并调用 `GraphMemory.rebuild(triplets)` 恢复内存图谱。

## 7. 可观测性与调参

### 7.1 诊断日志

在 `hybrid_search` 中输出每次检索的关键指标：

- 候选池大小
- 经门控过滤后数量
- 每条返回结果的 `vector_score`、`real_time_conf`、`final_score`、`hit_count`
- 阈值命中率

### 7.2 调参指引

- **MIN_SIMILARITY_THRESHOLD**：观察向量相似度的整体分布，通常取 **下四分位数** 附近。若大部分查询候选 >0.7，可上调至 0.65；若模型区分度低，可下调至 0.5。
- **ALPHA_VECTOR_WEIGHT**：若 Agent 回答过度受低置信度记忆干扰，增大 α（加大语义权重）；若受高语义但低置信度误导，可适当降低 α，使置信度发挥更大过滤作用。
- **BETA**：根据实际命中分布调整。若用户频繁确认相同事实，可降低 β 使巩固更平缓；若希望快速巩固核心信息，可提高至 0.5。
- **弱引用模式**：仅冷启动阶段使用，一旦 `cited_memory_ids` 稳定输出即关闭。

## 8. 实施路线图

### 里程碑 1：底层与门控
- 执行 SQL Schema 变更
- 部署 `smart_add_memory` 网关
- 实现 `hybrid_search`，配置诊断日志，运行影子测试（收集参数分布）

### 里程碑 2：强化闭环
- 修改 Agent Prompt，要求输出 `cited_memory_ids`
- 开发 Update Hook，支持弱引用冷启动选项
- 验证高频记忆衰减减缓效果

### 里程碑 3：图谱自净与归档
- 更新 Node.js 模块，采用子图 Schema 写入 SQLite
- 部署图谱漂移触发的 Conflict 打标链路
- 上线纯净心跳归档任务
- 关闭弱引用（若 LLM 引用率合格）

### 后续迭代（v1.0+）
- 动态冲突惩罚（与置信度挂钩）
- 基于显著性 Saliency 的强化增量调整
- 记忆质量监控仪表盘

# 更新日志

## v0.1 项目初始化 (2026-05-10)

### 初始实现

- 在 `chunks` 表上进行 Schema 迁移，新增置信度、生命周期和状态列。
- 支持分类路由的智能添加网关。
- 混合检索：动态阈值门控 + 指数衰减 + 加权评分。
- 用于引用增强的更新钩子（命中数 +1，置信度 +0.1）。
- 纯心跳压缩（对活跃置信度零写入）。
- KG 桥接：子图打包（`kg_data` 列）。
- 诊断日志与参数调优指南。

## v0.1.1 新增功能 (2026-05-15)

### 新增

- SQLite 中的 `memory_confidence` 并行表。
- 基于分类的置信度路由：每个分类的初始置信度 + 基础 tau 值。
- 混合检索（向量相似度 + 置信度加权）。
- `smart_add`：文件 → 重索引 → 置信度工作流。
- `update --hit`：用于引用增强。
- `archive`：低置信度分块的归档。
- `diagnose`：追踪未纳管的分块。
- `status`：汇总统计信息。
- 通过 `Qwen/Qwen3-Embedding-4B`（SiliconFlow）进行嵌入。

## v0.2 新增特性 (2026-05-16)

### FTS5 并行召回

利用 OpenClaw 原生 `chunks_fts`（FTS5 虚拟表，100% 覆盖率），在向量搜索同时并行执行 BM25 全文搜索。专有名词、代码库名、API 名称精准命中，弥补纯语义搜索短板。

### RRF 三通道融合

检索请求并行发送至三个独立通道：

| 通道 | 候选数 | 方式 |
|:---|:---:|:---|
| 向量语义 | 30 | cosine similarity + 置信度衰减 |
| FTS5 关键词 | 20 | BM25 排序 |
| KG 概念桥 | 15 | 知识图谱概念 → FTS5 chunks 映射 |

结果以 **Reciprocal Rank Fusion** (k=60) 等权融合排序：$\text{RRF}(d) = \sum_{i} \frac{1}{60 + r_i(d)}$

### 情节摘要中间层 (Episodic Memory)

新增 `episodic` 类别（conf=0.70, τ=30 天），`summarize` 命令汇聚 raw_log 通过 LLM 生成摘要（失败时关键词回退），`kg_data` 存储 `episode_of` 链接源 chunk ID，`drill <chunk_id>` 下钻查看原文。搜索含时间意向词时自动 RRF 加权 +0.1。

---

## v0.3 新增特性 (2026-05-18)

### Plugin Contracts 声明

插件入口增加 `contracts: { tools: true }`，`openclaw.plugin.json` 增加工具名声明 `["memory_engine", "image_vision"]`，确保 OpenClaw 插件系统正确注册工具。

### image_vision 工具

新注册 agent 工具，调用 SiliconFlow 的 Qwen3-VL-32B-Instruct 进行图片识别。参数：`image_path`（必填）+ `question`（可选），默认输出中文详细描述。

### 自动配置检测 (detectConfig)

`smart_add` 写入流程中增加自动分类探测：检测 API Key、Voice ID、模型名、文件路径、长哈希、中文配置关键词（"设置声音为…"等）时自动将 `raw_log` 提升为 `preference`（conf=0.80, tau=90天）。

### Session 检查点 (session-checkpoint.js)

`scripts/session-checkpoint.js`，每日 03:55 CST 执行：

1. 从 DB 读取昨日 raw_log + episodic 的文本
2. 调用 SiliconFlow API 提取 `<key> = <value>` 形式的新配置
3. 每条配置写入 preference 记忆
4. 原始日志 → LLM 摘要（150-200字）→ 写入 episodic 类别
5. **自动冲突标记**：同 key 配置保留最新，旧条目设 `conflict_flag=1`；唯一条目误标则自动解除

当前 `session-checkpoint` 只写 canonical episode 到 `memory/episodes/YYYY-MM-DD.md`。
不会再默认创建或更新 `memory/YYYY-MM-DD.md` 这类 daily journal namespace 文件；历史 daily 文件仅保留，不做迁移删除。
如确有兼容需求，可通过显式 legacy 开关 `checkpointLegacyDailyMirror` 恢复旧 mirror 行为。

Quality scope 约定同步更新：
- `memory/episodes/YYYY-MM-DD.md` 是 canonical generated episode。
- `memory/YYYY-MM-DD.md` 只保留给真实 daily journal。
- 识别出的 legacy generated mirror 应移动到 `memory/legacy-daily-mirrors/YYYY-MM-DD.md` 做 quarantine，不参与 recall / quality candidate 链路。

### Memory Prompt Supplement

`registerMemoryPromptSupplement` 在 session 启动时动态注入：
- `[昨日概要]` — 昨日 episode 摘要
- `[受保护记忆]` — `user_identity` + `protected` 标记的记忆列表
- 仅主 session 和 heartbeat session 生效

---

## v0.4 — autoRouteCategory + LanceDB 双引擎 (2026-05-20)

### 实时分类规则引擎

`plugins/memory-engine/index.js` 新增 `autoRouteCategory()` 函数，在 `smart_add` 入口实时路由：

| 规则 | 匹配示例 | 目标类别 |
|------|----------|----------|
| API key / 配置值 | `api_key = sk-...` | preference |
| 身份介绍 | `我是Sol, 一名开发者` | user_identity |
| 临时性表述 | `临时测试一下` | temporary |
| 偏好习惯 | `我喜欢用Zsh` | preference |
| 决策结论 | `最终选择了Linux` | preference |
| 无匹配 | 日常对话 | raw_log |

显式传 category 且非 raw_log 时尊重原值，不覆盖。

### LanceDB 双引擎存储

**初始化**：插件 `register()` 时异步 init，fire-and-forget 不阻塞启动。

**写入路径**：
```
smart_add → ① 规则引擎 → ② 写 smart-add 文件 → ③ manager.sync()
         → ④ SQLite confidence (同步)
         → ⑤ generateEmbedding → LanceDB (异步，fire-and-forget)
```

**检索路径**（4 通道 RRF 融合）：
```
Channel 1:  OpenClaw Manager (向量)
Channel 1b: LanceDB (向量)
Channel 2:  FTS5 (关键词)
Channel 3:  KG Bridge (概念)
                 ↓
          RRF 融合 (k=60)
                 ↓
          门控 → 加权排序
```

**向量维度**：Qwen3-Embedding-4B 输出 2560 维。

**数据库位置**：`~/.openclaw/memory/lancedb/` — 独立目录，与 SQLite 同级。

### Session Checkpoint 增强

`scripts/session-checkpoint.js` 合并为单次 LLM 调用：

**旧版** (v0.3)：2 次 LLM 调用（配置提取 + 摘要生成）
**新版** (v0.4)：1 次 LLM 调用，统一 prompt，产出 3 类结果：

1. `smart_memories` — 6 种类型：profile / preference / entity / event / case / pattern
2. `episode_summary` — ≤200 字每日摘要
3. `configs` — 配置信息提取（格式保持不变）

**新增功能**：
- FTS5 去重检测（`isDuplicate`），避免重复写入
- 写入全部 6 种 memory_engine category 及 confidence 记录
- 空内容占位 episode（`writeEmptyEpisode`）

### 关键变更

| 组件 | 变更 |
|------|------|
| `plugins/memory-engine/index.js` | +autoRouteCategory, +initLanceDB, +generateEmbedding, 双写 + 4通道检索 |
| `scripts/session-checkpoint.js` | 3→1 LLM 调用, +mapToCategory, +appendSmartAdd, +isDuplicate |
| `scripts/migrate-to-lancedb.js` | 新增，一次性迁移脚本 |
| `scripts/e2e-lancedb-test.js` | 新增，端到端验证脚本 |
| `package.json` | +@lancedb/lancedb 依赖 |
| cron: session-checkpoint | 超时 默认→120s |

### 数据分布

| 存储引擎 | 存储内容 | 行数 |
|----------|----------|------|
| SQLite `chunks` | 原始文本 (OpenClaw 索引) | ~327 |
| SQLite `memory_confidence` | 元数据 (置信度/分类/强化) | ~94 |
| LanceDB `chunks` | 向量 + 文本 | ~94 |

---

## v0.5 (2026-05-24) - autoRecall 自动注入 + Memory Console

### 新增功能
- **autoRecall 自动检索** — 注册 `before_prompt_build` hook，每轮回复前自动调混合检索注入 topK 记忆，自适应跳过问候/斜杠/短确认
- **Memory Console Lite** — 独立控制台 (`http://localhost:8787/`)，Dashboard / Session Trace / Memory Inspector / Telemetry / Metrics

### bug fix
- 插件不启动（缺 activation.onStartup: true，只加载了 7 个插件）
- autoRecall 配置读不到（读 `api.config` 实际在 `api.pluginConfig`）
- Dashboard JSON 渲染崩——HTML escape 把引号转成了 &quot;，JSON.parse() 失败
- SQLite 损坏路径处理
- peer dependency 缺失（需手动 symlink）

---

## v0.6 (2026-05-25) - Memory Engine 架构整理

### 完成 FTS 查询预处理解耦：

新增 `query-utils.js`，将：
  - `sanitizeFtsQuery()`
  - `buildFtsFallbackQuery()` 从 `auto-recall.js` 抽离
  - `index.js` 与 `auto-recall.js` 统一改为依赖 `query-utils.js`

效果：

- 消除 `index -> auto-recall` 的反向耦合
- retrieval pipeline 更清晰
- 为后续 recall strategy 扩展做准备


### Memory Console 指标系统升级

新增第一代“记忆质量指标（Memory Quality Metrics）”。

#### Retrieval Diversity（检索多样性）

基于近 7 天 `memory_candidate_retrieved` 事件统计：

- `distinct_categories`
- `entropy`
- `normalized_entropy`
- `top1_share`

用于评估：

- recall 是否过度集中
- 记忆类别覆盖是否健康
- retrieval 是否发生“单一化”


#### Reinforcement Concentration（强化集中度）

基于 active memories 的 `hit_count` 分析：

- `reinforced_memories`
- `top10_share`
- `hhi`

用于评估：

- 是否出现“超级记忆”
- reinforcement 是否过度集中
- 长期记忆结构是否失衡


#### Console Dashboard 改进

更新 Metrics 页面：

- 新增 Diversity Metrics 卡片
- 新增 Reinforcement Metrics 卡片
- 保持旧 telemetry API 向后兼容


### CodeGraph 集成

完成 CodeGraph + Codex CLI 工作流接入：

- 成功建立 memory-engine 局部代码图谱
- 验证 symbol / call graph / dependency tracing 工作正常
- 建立 lightweight graph indexing 工作流

新增：

- `.codegraph/` gitignore 保护
- graph scope 控制流程（避免 node_modules 污染）


### Runtime / 基础设施改进

更新 `session-checkpoint.js`：

- LLM timeout：
  - `45s → 120s`
- Cron timeout：
  - `120s → 300s`
- Cron 时间：
  - `03:55 → 03:30`

新增：

- `getDSKey()`
- `getDSBaseUrl()`
- DeepSeek fallback 支持
- provider 抽象能力
- `quickHealthCheck()`
- `writeLLMTimeoutEpisode()`

并将密钥独立迁移至：

```txt
credentials/deepseek-api-key
```

---

## v0.7 (2026-05-26) Retrieval 稳定化修复

### 已修复

- 修复了降级重排序（fallback rerank）中允许零依据候选进入 `post_rerank_topK` 的问题
- 为降级候选添加了词汇依据过滤器：
  - 满足以下条件时丢弃候选：
    - `token_coverage <= 0`
    - `exact_bonus <= 0`
- 防止 `category_boost` / `recency_boost` 将无关记忆推到结果前列

### 已改进

- 查询规范化现在能够正确去除 OpenClaw 时间戳污染
- `version_5_20` 的词元归一化（token normalization）现已正常工作
- 注入门控（injection gate）现已接入运行时管线
- smart-add ingestion / indexing 已恢复正常
- session-checkpoint dedup 已修复
- FTS fallback 已恢复工作

### 效果

- `5.20+ compatibility` 情景召回现可正确解析
- 旧原始日志 / 定价类记忆噪音明显下降
- 降级重排序不再将语义较弱但时间较近的记忆推向高位
- 检索精度明显提升

### 设计变化

本次修改为 fallback semantic retrieval 建立了 lexical grounding floor：

semantic recall 不再允许完全脱离 token overlap / exact anchor。
- **Task classifier** — `scripts/task-classifier.js` 按输入关键词路由 coding

---

## v0.7.1 (2026-05-27) 修复 daily episode / smart-add 日期计算的时区错位问题

新增 dateStrInTimeZone(offsetDays, timeZone) 统一日期工具，按业务时区
Asia/Shanghai 计算自然日，并使用 UTC Date 执行纯日历偏移，避免 UTC
日期与本地业务日期错位。

session-checkpoint / smart-add daily 路径已切换到该工具，并新增测试覆盖

---

## v0.8 (2026-05-27) - Memory Engine 架构整理 Major Refactor

memory-engine 完成第一轮结构化重构。

### Architecture

- index.js 从 ~1900 行下降至 ~880 行
- recall / db / sync / tools / adapters 已拆分到 lib/
- hybridSearch 已独立为 recall 内核
- memory_engine action handlers 已模块化
- console 已拆分为 app/server + cli

### Stability & Compatibility

- 新增 hybridSearch snapshot compatibility tests
- 新增 memory_engine action snapshot tests
- 新增 autoRecall debug metadata snapshot tests
- 新增 console API snapshot tests

### Runtime & Testing

- OpenClaw runtime integration tests 现在支持 runtime-aware skip
- 在缺失 openclaw runtime 的环境下：
  - unit tests 可独立运行
  - integration tests 自动 skip
- npm test 现已整体通过

### Internal Improvements

- DB schema / event writer / index sync helper 已统一抽象
- index sync 逻辑已去重
- console DB helper 已统一
- 移除了失效测试与历史路径耦合

### Notes

本次重构目标为：
- 降低 index.js 耦合
- 建立长期可维护结构
- 为后续 retrieval quality / telemetry / KG / rerank 调优提供稳定基础

未修改：
- memory_engine tool schema
- console API contract
- debug metadata 字段
- 既有 memory 行为

## (2026-05-28) Bug Fix

- 修复 LanceDB 主路径 embedding 阶段因为 SiliconFlow API key 在 definePluginEntry bundle 上下文不可读而被跳过的问题
- resolveSFKey 优先从 api.config 获取 key，保证 generateEmbeddingRuntime 在 runtime bundle 中可用
- 完整透传 vector debug 字段：vector_backend_attempted、vector_stage、vector_error
- 保持 autoRecall 回退和 FTS/recent fallback 逻辑不变
- 测试覆盖 key 注入、fallback、embedding 失败及 metadata 安全性
2026-05-27 03:30 CST 运行时应处理 2026-05-26 的场景，防止凌晨任务
误处理前两天数据。

workspace/scripts/session-checkpoint.js 已本地修复为 Asia/Shanghai business date，低耦合，不纳入 memory-engine CodeGraph。

## (2026-06-27) P0 Shadow Entrypoint Bypass

- 事故性质确认：这不是 `plugins/memory-engine/bin/session-checkpoint.js` 修复失效，而是 `workspace/scripts/session-checkpoint.js` 作为 shadow entrypoint 继续被 cron 调用，绕过了插件版 `lib/checkpoint/*` 的 targetDate 过滤、reset direct parse 默认关闭，以及 smart-add provenance gating。
- canonical checkpoint implementation 继续定义为：
  - `bin/session-checkpoint.js`
  - `lib/checkpoint/raw-log.js`
  - `lib/checkpoint/episode-writer.js`
  - `lib/checkpoint/runtime.js`
- `workspace/scripts/session-checkpoint.js` 的职责应收缩为 thin shim：
  - 保留 shebang
  - 透传 `process.argv.slice(2)`
  - 透传 `stdio`
  - 透传 `env`
  - 使用插件入口 exit code
- 新增静态保护，避免 legacy script 再次携带以下实现细节：
  - `WHERE mc.category = 'raw_log'`
  - `ORDER BY c.updated_at DESC`
  - `LIMIT 100`
  - `.jsonl.reset.`
  - raw evidence collection / LLM prompt assembly
- 入口审计范围补充为：
  - crontab
  - systemd user timers
  - package scripts
  - docs 中旧命令
  - `workspace/scripts` 下其他 checkpoint 复制品
- 本地审计结果：
  - 用户 `crontab -l` 当前未见 `session-checkpoint` 条目，仅有 agentmemory `@reboot` 项。
  - `systemctl --user list-timers --all` 当前未见 checkpoint 相关 user timer，仅有 `launchpadlib-cache-clean.timer`。
  - 插件仓库 `package.json` 当前没有 checkpoint npm script，避免了 package script 层绕路。
  - `workspace/scripts` 目录内仅发现一个 `session-checkpoint.js` 和一个引用它的 `checkpoint-fallback-episode.sh`，未发现第二个 JS 复制品。
  - `workspace/docs/openclaw_memory_v0.1.md` 与 `workspace/docs/devlog.md` 仍保留旧命令/旧实现描述，属于文档陈旧，不代表 canonical 运行路径正确。

## (2026-05-29) Bug Fixed
- 修复 OpenClaw core memory 缺失 confidence 时在 vector / LanceDB / FTS5 / fallback 检索链路中被误过滤的问题。
- 统一 external memory metadata normalize，新增 confidence_mode、source_type、category、decay_eligible、archive_eligible 等字段。
- 补齐 MEMORY.md、memory/projects、daily journal、dreaming、stats-history 等路径分类推断。
- 调整 hybrid recall 计分，使 external 候选可参与 rerank，但不污染 managed memory 的 confidence、decay、archive 机制。
- 控制台补充 external memory 标识与调试字段展示。

## v0.8.1 (2026-05-30) 

本次更新主要修复 memory-engine 与 OpenClaw core DB 混用导致的 SQLite/WAL 冲突问题，并补强时间语义相关回归测试。

### 主要改动

- 将 memory-engine 插件自有数据迁移到独立数据库：
  - 新增 `ENGINE_DB_PATH`
  - 保留 `CORE_DB_PATH` 只读访问
  - 避免 `better-sqlite3` 与 OpenClaw gateway 的 `node:sqlite` 同时写同一数据库

- 新增统一连接层：
  - `lib/db/engine-db.js`
  - 插件主库读写
  - OpenClaw core DB 通过 `ATTACH core` 只读访问
  - 增加写保护，阻止误写 `core/chunks/chunks_fts`

- `memory_events` 改为写入插件独立数据库
  - 启动时迁移旧 core DB 中的 legacy events
  - 保持历史 telemetry / recall trace 连续

- Console DB 读取切换到插件库
  - `console/services/db.js`
  - `console/services/memory-service.js`
  - 删除记忆改为 tombstone，不再直接删除 core chunks

- 修复 nightly episode 日期语义
  - 区分 `targetDate` 与 `generatedAt`
  - episode ID 使用格式：
    - `{targetDate}_{category}_nightly_generated_{HHmmss}`
  - 示例：
    - `2026-05-28_episodic_nightly_generated_033000`

- 新增回归测试
  - DB 隔离与 core 只读保护
  - Asia/Shanghai business timezone
  - nightly episode targetDate/generatedAt 语义

## v0.8.2 (2026-05-31) 可观测性与运行时稳定性

本版本完成了 memory-engine 的首个可观测性里程碑，并将项目过渡到数据驱动的调优阶段。

### 运行时稳定性

#### SQLite 隔离

*   引入了专用的插件数据库 (`memory-engine.sqlite`)
*   将 memory-engine 的写入路径与 OpenClaw 核心数据库分离
*   增加了对核心数据库的只读挂载
*   将 `memory_events` 迁移到插件数据库
*   降低了 `node:sqlite` 和 `better-sqlite3` 之间 WAL 损坏的风险

#### 业务时区支持

*   增加了可配置的业务时区支持
*   默认时区：`亚洲/上海`
*   修复了基于 UTC 计算导致的每日剧集日期偏移问题
*   为夜间剧集分离了 `targetDate` 和 `generatedAt` 语义

### 配置集中化

添加了统一的运行时配置系统：

*   `lib/config/defaults.js`
*   `lib/config/runtime.js`
*   `lib/config/helpers.js`

配置现在驱动：

*   召回设置
*   排序参数
*   时区处理
*   指标窗口
*   遥测默认值

运维层脚本现在共享同一个配置源。

### 召回可观测性

实现了一个完整的召回可观测性管道。

#### 检索多样性

跟踪：

*   类别分布
*   来源类型分布
*   路径前缀分布
*   熵
*   归一化熵
*   最高分项占比

#### 强化集中度

跟踪：

*   赫芬达尔-赫希曼指数 (HHI)
*   最高分 / 前5 / 前10 项占比
*   独特记忆数量
*   记忆复用集中度

#### 响应后召回遗漏

跟踪：

*   召回机会
*   错过的注入
*   遗漏率
*   最常遗漏的记忆

#### 自动召回注入率

跟踪：

*   候选数量
*   门控通过率
*   注入数量
*   注入率

### 指标控制台改进

为控制台精简版添加了新的部分：

*   检索多样性
*   强化集中度
*   响应后召回遗漏
*   自动召回注入率
*   热门记忆

指标现在支持跨 engine/core 数据库的统一事件溯源，并具有自动去重功能。

### 测试

当前测试状态：

*   22 通过
*   0 失败

覆盖范围包括：

*   运行时配置
*   时区辅助函数
*   夜间剧集语义
*   数据库隔离
*   检索多样性
*   强化集中度
*   召回遗漏跟踪
*   注入率指标
*   统一事件源聚合

## 项目状态

memory-engine 已进入观测与调优阶段。

未来的工作将聚焦于：

*   检索多样性调优
*   强化集中度分析
*   减少召回遗漏
*   门控参数优化
*   长期遥测数据收集

下一阶段暂无重大架构变更计划。

## (2026-06-01) 更新

### Added

- **文档** — architecture.txt / dataflow.txt / 参数调优指南 / devlog
- **测试覆盖率** — nightly episode targetDate 语义测试、config helpers/runtime 测试
- **Runtime helper** — `scripts/lib/memory-engine-config-runtime.js`，提供 `getSmartAddTimeZoneRuntime()` / `getMemoryEngineRuntimeConfig()`
- **P2 周报脚本** — `scripts/memory-weekly-stats.js`，每周采集 entropy / HHI / miss_rate，附速览趋势行

### Fixed

- **Episode 摘要幻觉** — session-checkpoint 三层防护：区分 smart-add(note) 与 DB raw_log(conversation)，无对话数据时跳过 LLM 生成
- **统计脚本重构** — memory-stats.js：废品回收率→记忆总览，抢救成功率→健康度，时区修复，触发分类简化
- **Session-checkpoint 兼容** — `require.main === module` guard + 导出测试函数

## (2026-06-02) 更新

### Added
- autoRecall 支持 tiered retrieval：KG/FTS5 优先，vector 仅在 lexical confidence 不足时触发。
- 新增 lexical confidence debug metadata，用于观察 vector skip 决策。

### Changed
- 降低 LanceDB vector pipeline 默认开销。
- 保留 existing RRF fusion、fallback rerank 和 external memory 兼容逻辑。

## (2026-06-08) 更新

### 安全加固

- 关闭 Memory Console 的写接口：
  - `POST /api/memories/:id/archive`
  - `POST /api/memories/:id/delete`
  - `POST /api/memories/:id/confidence`
- 上述接口现在统一返回 `403`，避免控制台在无鉴权状态下修改记忆数据。
- 新增受限 JSON body 读取工具，默认最大 64KB。
  - 超过限制返回 `413 payload too large`
  - 非法 JSON 返回 `400 invalid json`
  - 超限后会停止继续读取后续 chunk，降低内存耗尽风险。

### 稳定性修复

- 修复 `runMemoryIndexSyncCli()` 空实现问题。
  - 现在会真实调用 `scripts/sync-memory-index.js`
  - 使用 `spawnSync`，避免 shell 注入
  - 返回真实 `ok/status/signal/stdout/stderr/error`
  - 同步失败时不再伪造 `ok: true`
- 新增 `session-checkpoint.js` 兼容导出层，保留旧调用路径。

### 跨平台路径修复

- 新增 `safeRelativePath()` 工具，使用 `path.relative()` 计算相对路径。
- 统一将内部相对路径规范化为 POSIX `/` 风格。
- 修复以下路径处理场景：
  - root 带尾斜杠或不带尾斜杠结果一致
  - Windows 风格路径可稳定转换
  - `collectIndexedFiles()` 返回稳定 `relPath`
  - `memory_engine.add` 查询 `chunks.path` 时使用稳定相对路径
- 明确约定：
  - target 不在 root 内时返回 `null`
  - root 和 target 完全相同时返回空字符串 `""`

### 测试修复

- 修复 `retrievalMetrics` 的日期敏感测试。
- `retrievalMetrics()` 新增可选 `{ nowMs }` 参数，默认仍使用 `Date.now()`，线上行为不变。
- 测试中注入固定时间，避免 fixture 随当前日期漂移导致失败。

### 新增测试

- 控制台写接口禁用测试
- JSON body 限制测试
- `runMemoryIndexSyncCli` 成功/失败/无状态返回测试
- 跨平台路径归一化测试
- `memory_engine.add` 稳定 `chunks.path` 查询测试

### 验证结果

```text
npm test
tests 115
pass 110
fail 0
skipped 5
```
## v0.8.2 围绕 Memory Engine 的可维护性、稳定性和测试网做了整理 (2026-06-08) 

### 分类推断共享模块

新增 `lib/category-inference.js`，统一管理 memory path / chunk text 的分类推断规则。

本次替换了以下位置中的重复分类逻辑：

- `index.js`
- `lib/recall/hybrid-search.js`
- `console/services/memory-service.js`

同时保留各调用点原有 fallback 语义，没有强行统一行为。

### 轻量静态检查

新增 `npm run check`，并加入 `scripts/static-check.js`。

检查方式使用 Node 原生 `node --check`，覆盖受控 `.js` 文件，不引入 ESLint 或新依赖，避免 lint 噪音和格式化扩散。

### 拆分 index.js runtime/helper 逻辑

从 `index.js` 中拆出低风险 runtime/helper 模块：

- `lib/lancedb-runtime.js`
  - LanceDB 初始化
  - ready state
  - 超时等待
  - disable env 处理

- `lib/memory-confidence.js`
  - confidence 参数
  - category routing
  - realtime confidence 计算
  - reinforce
  - recall metadata helper
  - gate threshold

- `lib/index-sync-runtime.js`
  - index sync state
  - 文件扫描
  - indexed path state 读取
  - 是否需要 `manager.sync()` 的判定
  - `fresh` / `manager_unavailable` / `synced` 返回路径
  - indexed chunks confidence backfill

`index.js` 保留插件入口、register 编排和 hook wiring，行数从约 942 行降到 653 行。

### 新增测试

- `test/category-inference.test.js`
- `test/category-inference-consumers.test.js`
- `test/index-sync-runtime.test.js`

### Verified

- Gateway 重启后插件正常加载。
- LanceDB 初始化正常。
- Console API 返回 HTTP 200。
- autoRecall `memory_search` 正常返回 5 条结果，vectorScore / textScore / RRF 融合正常。
- Console 字段正常：`confidence_mode`、`source_type`、`external_badge`、`decay_eligible`、`archive_eligible` 等字段均有值。
- index sync 状态正常：100 chunks / 39 paths，无异常。

覆盖内容：

- 共享分类规则
- hybrid-search 与 console consumer 的分类一致性
- index sync 首次同步后无变化走 `fresh`
- indexed chunks 缺失 confidence 时执行 backfill

### 提交拆分

- `3c7f21d Share-memory-category-inference`
- `c17a5fc Add-static-check-script`
- `443930a Split-memory-runtime-helpers`

### 验证结果

```text
npm run check
static check passed: 67 files
npm test
tests 122
pass 117
fail 0
skipped 5
```
说明
skipped 5 为既有条件跳过测试：

- 3 个测试依赖完整 OpenClaw runtime，当前环境报 ERR_MODULE_NOT_FOUND 时跳过。
- 2 个 index sync 集成测试需要显式设置 OPENCLAW_RUN_MEMORY_SYNC_TEST=1 才会运行。

## 2026-06-15

### 修复

- 修复 `hybrid-search` 中 `LIMIT ${...}` 字符串插值的反模式，改为 SQLite 绑定参数。
- 移除 `hybrid-search` 中多个裸 `catch {}`，降级路径现在会记录 debug 字段并输出一次性 warning。
- 移除已禁用但仍对外暴露的 `image_vision` 工具，并从 `openclaw.plugin.json` 的 `contracts.tools` 中删除。
- 清理 autoRecall hook 中大量默认 `console.log` 调试噪声，保留结构化 `memory_events` 记录。
- 修复 `resolvePrefixes` 前缀匹配不确定问题，现在只匹配未归档记忆，并按更新时间、命中数、ID 稳定排序。
- 修复 `batchReinforce` 会强化已归档记忆的问题；引用强化现在只作用于未归档项，并会清除 stale `conflict_flag`。
- 降低 `detect-conflicts` 误判率：冲突检测现在会比较关联 chunk 文本/路径的 token 重叠，不再只靠同分类、置信度差和命中差。
- 优化 `withEngineDb` 热路径开销，新增 session/scoped DB 复用能力，`hybridSearch` 单次检索内可复用连接并在结束后关闭。
- 优化 `smart-add` 索引同步路径，正常工具调用优先走 async/in-process runner，避免 `spawnSync` 阻塞工具线程；CLI fallback 保留。
- 统一配置默认值来源，集中管理 `archive.threshold`、`confidence.min` 和分类 gate threshold，兼容旧的 `archiveThreshold` 配置。
- 治理插件目录运行时产物，新增 `.gitignore` 规则忽略 `.memory-console.log` 和 `memory-engine.sqlite` 等本地生成文件。
- 更新 checkpoint 抽取的 LLM fallback 顺序，优先使用 DeepSeek，SiliconFlow 作为 fallback。

### 新增测试

- 新增 review regression 测试，覆盖 SQL 参数化、死工具移除、autoRecall 日志降噪、前缀解析、强化归档项、冲突误判等问题。
- 新增 DB session 复用测试，验证 scoped session 内连接复用和关闭行为。
- 新增 smart-add async sync runner 相关测试。
- 新增配置默认值漂移检测，确保 JS defaults 与 `openclaw.plugin.json` 保持一致。
- 新增 runtime path 测试，防止 engine DB 或 console DB 路径回退到插件项目根。

## 2026-06-30

### 质量治理 / Smart-Add 重复清理确认清单校验

- 新增只读 CLI：`bin/validate-smart-add-duplicate-cleanup-manifest.js`，用于校验人工确认的 smart-add duplicate cleanup manifest。
- 新增测试：`test/smart-add-duplicate-cleanup-manifest.test.js`，覆盖 manifest shape 校验、group/hash 匹配、keep/delete candidate 校验、skip/manual-review 分支、unsafe current group 拒绝、mixed valid/invalid 场景、CLI JSON/Markdown 输出和非零退出码。
- manifest 必须满足 `version === 1`、`kind === "smart_add_duplicate_cleanup_manifest"`、`mode === "dry_run_only"`，并只能使用 `approve_delete_candidates`、`skip`、`manual_review_required` 三种 decision。
- validator 只接受当前 preview 中仍然安全的候选组：`cleanup_eligibility === true`、`classification === "ingestion_bug_candidate"`、retrieved/injected 均为 0、且仅属于 lifecycle-owned smart_add。
- 输出 dry-run 报告，包括 `would_keep`、`would_delete`、approved/skipped/manual-review/rejected 计数、errors/warnings 和完整 side-effect false 合约。
- 修正 mixed manifest 场景下的局部错误计数：一个坏 group 不会污染后续合法 group 的 `would_keep` / `would_delete` 产出。
- manifest shape 校验统一由 `validateCleanupManifestAgainstPreview()` 负责，避免 file-based 路径重复追加同一类 shape error。
- 本阶段仍不引入任何 cleanup/apply 行为；CLI 只读，不写 DB、不修改真实 memory 文件、不 archive/quarantine/reinforce/backfill、不调用 LLM、不访问网络、不写 runtime report 文件。

## 2026-07-08

### P34: full test failure triage and baseline repair

- 先按要求执行 `git status --short --branch`、`git log -1 --oneline --decorate`、`npm test`，初始 full test 为 `116 pass / 13 fail`。
- 本轮失败分类结论：
  - `archived-raw-log-rescue-*`、`report-archived-raw-log-rescue-*`、`export-turn-gold-set-replay-report`、`auto-recall-*smoke`、`auto-recall-turn-gold-set-observation`：
    主要是 CLI 在 `spawnSync`/pipe 场景下 stdout 未稳定 flush，测试读到空字符串，不是 production safety 回归。
  - `memory-process-boundary-audit`：
    fixture 已设置 env，但 `engine-db` 读取 DB 路径时受导入期常量影响，导致仍试图打开默认路径，属于 env/path 解析问题。
  - `memory-quality-baseline-smoke`、`smart-add-duplicate-baseline-smoke`、`smart-add-duplicate-cleanup-preview`、`smart-add-duplicate-cleanup-manifest`：
    默认依赖 live DB 或 live baseline 数字，属于 data-dependent smoke / baseline drift，不适合阻塞默认 `npm test`。

### 本轮修复

- `lib/db/engine-db.js`
  - 改为在调用时动态解析 `CORE_DB_PATH` / `MEMORY_ENGINE_CORE_DB` / `MEMORY_ENGINE_CORE_DB_PATH` 与 `ENGINE_DB_PATH` / `MEMORY_ENGINE_DB` / `MEMORY_ENGINE_DB_PATH`。
  - 修复测试 fixture 已设置 env 但 runtime 仍落回默认 DB 路径的问题。
- 多个只读 CLI 改为同步写 stdout/stderr，避免在子进程 pipe 下出现空输出：
  - `bin/run-auto-recall-long-input-smoke.js`
  - `bin/run-auto-recall-card-runtime-smoke.js`
  - `bin/run-turn-gold-set-replay.js`
  - `bin/observe-turn-gold-set-dataset.js`
  - `bin/export-turn-gold-set-replay-report.js`
  - `bin/preview-smart-add-duplicate-cleanup-candidates.js`
  - `bin/run-memory-quality-baseline-smoke.js`
  - `bin/audit-memory-process-boundary.js`
  - `bin/validate-smart-add-duplicate-cleanup-manifest.js`
  - `bin/run-smart-add-duplicate-baseline-smoke.js`
  - `bin/v4-active-sampler.cjs`
  - `bin/build-archived-raw-log-rescue-review-queue.cjs`
  - `bin/report-archived-raw-log-rescue-labels.cjs`
  - `bin/report-archived-raw-log-rescue-review-queue-labels.cjs`
- 新增 fixture helper，去掉默认 `npm test` 对真实 DB 当前状态的依赖：
  - `test/helpers/smart-add-duplicate-fixture.js`
  - `test/helpers/memory-quality-baseline-fixture.js`
- 将以下测试改为 fixture-based 或语义断言，不再绑定本机 live baseline 数量：
  - `test/smart-add-duplicate-cleanup-preview.test.js`
  - `test/smart-add-duplicate-cleanup-manifest.test.js`
  - `test/smart-add-duplicate-baseline-smoke.test.js`
  - `test/memory-quality-baseline-smoke.test.js`
  - `test/memory-process-boundary-audit.test.js`
  - `test/auto-recall-long-input-smoke.test.js`
  - `test/auto-recall-card-runtime-smoke.test.js`
- `bin/run-smart-add-duplicate-baseline-smoke.js`
  - 将硬编码 live baseline 数字断言改为内部一致性 / safety 语义断言。
  - 保留核心 safety 约束：cleanup eligible 组必须无 retrieval/injection、必须是 lifecycle-owned smart-add、usage 组不得 cleanup。

### data-dependent 结论

- 原先依赖真实 DB / 本地状态的默认 smoke 已改成 fixture-based，不再阻塞默认 `npm test`。
- smart-add duplicate baseline 不再要求当前机器必须正好有 `10/27/37` 这样的历史数字。
- 未把任何 live smoke 删除为 silent skip；而是保留了只读 CLI 行为验证与 fixture 语义验证。

### 最终结果

```text
npm test
tests 116
pass 116
fail 0
```

### 安全声明

- 未修改真实 core DB：`~/.openclaw/memory/main.sqlite`
- 未修改真实 engine DB
- 未 apply core chunk time migration
- 未放宽 `event_at` / `created_at` / `updated_at` 语义约束
- 未重新放开 raw_log / archived raw_log 的低质量 autoRecall 注入

### P35: event_at migration impact preview

- 新增只读 preview CLI：`bin/preview-core-chunk-event-time-migration-impact.js`，用于在不 apply migration 的前提下，预估 core DB `raw_log` 在未来引入 `event_at` schema 后对 checkpoint reader 输入池的影响。
- preview 复用 `lib/db/core-chunk-time-migration.js` 里的 diagnostics / recovery 逻辑，并新增 `previewCoreChunkEventTimeMigrationImpact()` 导出，统一输出 dry-run 聚合结果。
- preview 明确只读：
  - `mode: dry_run`
  - `writes_db: false`
  - 不新增 `event_at` / `created_at`
  - 不修改真实 core DB / engine DB
  - 不 apply migration
- `updated_at` 仅用于估算“当前迁移前 checkpoint reader 的 legacy 行为基线”，帮助比较 before / after impact；它被明确标注为 untrusted legacy-only comparison basis，不作为 `event_at` backfill source。
- 当 schema 未来具备 `event_at` 后，checkpoint reader 将严格按 confirmed / recovered `event_at` 读取，`event_at NULL` 不再 fallback 到 `updated_at`；preview 的目标就是提前量化这部分 drop impact。

### P35 live preview 数字

```text
raw_log_total_count: 7048
recoverable_event_at_count: 1738
unrecoverable_event_at_null_count: 5310
estimated_rows_dropped_from_db_raw_log_pool_after_migration: 5310
```

- 当前 live preview 中，可信恢复来源全部来自 `session_transcript_exact_chunk_id`，数量为 `1738`；`updated_at` 没有被当作恢复来源使用。
- top impacted dates：
  - `2026-06-21`: `legacy_rows=3306`, `unrecoverable_rows=2776`, `estimated_drop_ratio=0.84`
  - `2026-06-15`: `legacy_rows=2433`, `unrecoverable_rows=2433`, `estimated_drop_ratio=1`
  - `2026-06-22`: `legacy_rows=143`, `unrecoverable_rows=25`, `estimated_drop_ratio=0.175`
  - `2026-06-23`: `legacy_rows=82`, `unrecoverable_rows=22`, `estimated_drop_ratio=0.268`
- 受影响最大的 path 主要集中在历史 `memory/smart-add/*.md` raw_log chunk，例如：
  - `memory/smart-add/2026-06-01.md`
  - `memory/smart-add/2026-05-24.md`
  - `memory/smart-add/2026-05-29.md`
  - `memory/smart-add/2026-05-27.md`

### P35 测试与结果

- 新增测试：`test/core-chunk-event-time-migration-impact-preview.test.js`
- 覆盖：
  - 默认 dry-run 且不写 DB
  - text timestamp recovery
  - transcript exact-id recovery
  - 无可信 `event_at` 时计入 estimated dropped
  - `updated_at` 仅用于 legacy grouping，不作为 recovery source
  - `impact_by_legacy_updated_at_date` / `impact_by_path` 输出
  - CLI `--json` 正常运行
  - CLI 拒绝 `--apply` / `--force` / `--write-db` / `--no-backup`

```text
node --test test/core-chunk-event-time-migration-impact-preview.test.js test/core-chunk-event-time-recovery-audit.test.js test/core-chunk-time-migration.test.js test/checkpoint-raw-log.test.js
tests 4
pass 4
fail 0
```

- full `npm test` 结果：本轮改动后再次验证为全绿。
- 是否修改真实 DB：no
- 是否 apply migration：no

### P36: high-impact event_at NULL raw_log forensic preview

- 新增只读 forensic preview CLI：`bin/inspect-unrecoverable-event-at-raw-log.js`，用于按单个 legacy `updated_at` 日期聚焦分析 unrecoverable `raw_log`。
- 新增 `inspectUnrecoverableEventAtRawLog()`，在不输出 raw_log 全文的前提下，只产出安全摘要字段：
  - `id` / `path` / `legacy_updated_at`
  - `text_length`
  - `text_sha256_16`
  - `role_hint`
  - tag / tool / checkpoint / path-date / file-existence hints
  - `recommended_action`
- `updated_at` 仍然只用于 legacy behavior grouping / forensic clue，不作为 `event_at` source。
- smart-add 文件检查只做 workspace `memory/` 下的 file existence，不读取大文件全文，不写任何真实 DB。

### P36 live forensic: 2026-06-21

```text
legacy_rows: 3306
recoverable_rows: 530
unrecoverable_rows: 2776
available_in_smart_add_file_count: 0
looks_like_tool_output_count: 266
looks_like_checkpoint_generated_count: 9
```

- `role_breakdown`：
  - `unknown=2766`
  - `metadata_header=10`
- `text_length_distribution`：
  - `0-79=1514`
  - `80-199=445`
  - `200-499=497`
  - `500-999=244`
  - `1000+=76`
- `recommended_action_breakdown`：
  - `needs_review=2492`
  - `ignore_low_value=284`
- 结论：
  - 这一天的 unrecoverable 数据主要不是明确 user/assistant 对话，而是大量短小 `unknown` 片段。
  - 在当前 workspace `memory/` 下，对应 smart-add 文件覆盖数是 `0`，不能证明这些 raw_log 仍可由 workspace smart-add 文件替代。
  - 存在一部分低价值/tool/checkpoint-like 数据，但不足以单独解释全部 drop impact。

### P36 live forensic: 2026-06-15

```text
legacy_rows: 2433
recoverable_rows: 0
unrecoverable_rows: 2433
available_in_smart_add_file_count: 0
looks_like_tool_output_count: 936
looks_like_checkpoint_generated_count: 19
```

- `role_breakdown`：
  - `user=1619`
  - `assistant=175`
  - `metadata_header=314`
  - `unknown=325`
- `text_length_distribution`：
  - `500-999=1661`
  - `1000+=754`
  - `200-499=17`
- `recommended_action_breakdown`：
  - `ignore_low_value=1228`
  - `manual_recovery_candidate=942`
  - `needs_review=263`
- 结论：
  - 这一天与 `2026-06-21` 不同，包含大量长文本 `user/assistant` raw_log。
  - 同时也有显著的 tool-like / metadata-like 低价值部分，但并不能覆盖全部风险。
  - `manual_recovery_candidate=942`，说明这一天更适合下一阶段做人工恢复候选导出，而不是直接忽略。

### P36 判断与建议

- 是否大多数数据仍可由 smart-add 文件覆盖：
  - 基于当前 workspace `memory/` existence 检查，`2026-06-15` / `2026-06-21` 两天的 `available_in_smart_add_file_count` 都是 `0`，没有证据表明大多数 unrecoverable raw_log 已被 workspace smart-add 文件覆盖。
- 是否存在大量低价值/tool/checkpoint-generated raw_log：
  - yes，尤其是 `2026-06-15` 有 `936` 条 tool-like，`2026-06-21` 也有 `266` 条。
  - 但 `2026-06-15` 仍残留大量 user/assistant 长文本，不应把全部高影响都视为低价值噪声。
- 是否建议继续做 manual recovery candidate export：
  - yes，优先针对 `2026-06-15`。
  - `2026-06-21` 更适合先做进一步规则细分或 path cluster 分层，再决定是否导出人工恢复候选。

### P36 测试与结果

- 新增测试：`test/unrecoverable-event-at-raw-log-inspector.test.js`
- 覆盖：
  - 默认 dry-run，不写 DB
  - 按 legacy `updated_at` 日期过滤
  - recoverable rows 不进入 unrecoverable sample
  - role/tag/tool/checkpoint hints 聚合
  - smart-add 文件存在性只做 file existence
  - CLI `--json` 可运行
  - CLI 拒绝 `--apply` / `--force` / `--write-db` / `--no-backup`
  - 不输出 raw_log 全文

```text
node --test test/unrecoverable-event-at-raw-log-inspector.test.js test/core-chunk-event-time-migration-impact-preview.test.js test/core-chunk-event-time-recovery-audit.test.js
tests 3
pass 3
fail 0
```

- full `npm test`：本轮开发开始时基线仍为 `117 pass / 0 fail`，P36 完成后再次验证通过。
- 是否修改真实 DB：no
- 是否 apply migration：no

### P37: 2026-06-15 manual event_at recovery candidate export

- 新增只读导出 CLI：`bin/export-event-at-manual-recovery-candidates.js`
- 目标：把 `2026-06-15` forensic 结果中 `recommended_action=manual_recovery_candidate` 的 rows 导出给人工审核，明确下一步是人工标注，而不是自动 backfill。
- 复用 P36 的 inspector 分类逻辑，不再重复维护另一套规则。
- 默认行为：
  - 只导出 `manual_recovery_candidate`
  - 不导出 `ignore_low_value`
  - 不导出 raw_log 全文
  - 只导出 capped preview，默认 `240` 字符、单行化
  - 支持 `--no-preview`
  - 默认输出到 `/tmp/memory-engine-reports/`

### P37 live export 结果

```text
date: 2026-06-15
candidate_count: 942
raw_text_exported: false
preview_chars: 240
```

- JSONL 输出路径：
  - `/tmp/memory-engine-reports/event-at-manual-recovery-2026-06-15.jsonl`
- Markdown 输出路径：
  - `/tmp/memory-engine-reports/event-at-manual-recovery-2026-06-15.md`
- live summary：
  - `role_breakdown`：
    - `user=825`
    - `assistant=117`
  - `tag_breakdown`：
    - `preference=45`
    - `decision=4`
    - `todo=2`
  - `text_length_distribution`：
    - `500-999=808`
    - `1000+=127`
    - `200-499=7`

### P37 测试与验证

- 新增测试：`test/event-at-manual-recovery-export.test.js`
- 覆盖：
  - 默认 dry-run，不写 DB
  - 只导出 `manual_recovery_candidate`
  - 默认 preview 截断，不导出全文
  - `--no-preview` 不输出 preview
  - JSONL / Markdown 输出格式
  - `/tmp` 风格输出路径
  - CLI 拒绝 `--apply` / `--force` / `--write-db` / `--no-backup`
  - full export 不新增 `event_at` / `created_at`

```text
node --test test/event-at-manual-recovery-export.test.js test/unrecoverable-event-at-raw-log-inspector.test.js test/core-chunk-event-time-migration-impact-preview.test.js
tests 3
pass 3
fail 0
```

- 是否包含 raw text：默认 no，仅含 capped preview。
- 是否修改真实 DB：no
- 是否 apply migration：no
- full `npm test`：本轮改动后再次验证通过。
- 下一步建议：
  - 对导出的 `942` 条 candidate 做人工标注。
  - 先区分 `recover_event_at` / `keep_null` / `ignore_low_value` / `needs_more_evidence`。
  - 不要自动 backfill `event_at`。

### P38: event_at manual recovery label loop

- 目的：在 P37 导出的 `2026-06-15` manual recovery candidates 基础上，建立人工标注闭环，但本阶段仍保持纯只读和 dry-run。
- 新增 CLI：
  - `bin/init-event-at-manual-recovery-labels.js`
  - `bin/summarize-event-at-manual-recovery-labels.js`
  - `bin/preview-event-at-manual-recovery-apply.js`
- 本阶段边界：
  - 不修改真实 DB：no
  - 不 apply migration：no
  - 不自动 backfill：no
  - preview 仅输出未来可能更新的 row id / event_at / source / confidence，不写 DB

- label schema：

```json
{
  "id": "chunk id",
  "date": "2026-06-15",
  "text_sha256_16": "abcdef1234567890",
  "manual_review_status": "unreviewed|reviewed",
  "review_action": "recover_event_at|keep_null|ignore_low_value|needs_more_evidence",
  "event_at": null,
  "event_at_source": "session_transcript|external_note|manual_timestamp|other|null",
  "confidence": null,
  "reviewer_note": ""
}
```

- 规则：
  - `recover_event_at` 必须同时提供：
    - `event_at`
    - `event_at_source`
    - `confidence`
  - `event_at` 仅接受：
    - timezone-explicit ISO timestamp
    - Unix seconds
  - 没有明确证据时，只能标：
    - `keep_null`
    - `ignore_low_value`
    - `needs_more_evidence`
  - `updated_at` 不能作为 `event_at_source`
  - `legacy_updated_at` 也不能作为 `event_at_source`
  - 禁止从 `updated_at` 推导 `event_at`

- future apply preview 仅接受：
  - `review_action=recover_event_at`
  - 且 label 校验通过
- 其余 action：
  - `keep_null`
  - `ignore_low_value`
  - `needs_more_evidence`
  只参与 summary，不进入 preview apply `would_update`

- seed/template 生成行为：
  - 与 P37 candidate 一一对应
  - 默认：
    - `manual_review_status=unreviewed`
    - `review_action=needs_more_evidence`
    - `event_at=null`
    - `event_at_source=null`
    - `confidence=null`
  - 不复制 raw_log 全文
  - 不复制 preview 到 label template

- summary 输出重点：
  - `review_status_breakdown`
  - `review_action_breakdown`
  - `recover_event_at_count`
  - `invalid_label_count`

- preview 输出重点：
  - `mode=dry_run`
  - `writes_db=false`
  - `migration_applied=false`
  - `candidate_updates_count`
  - `valid_recover_event_at_count`
  - `invalid_recover_event_at_count`
  - `would_update`
  - `blocked_reasons`

- 新增测试：`test/event-at-manual-recovery-label-loop.test.js`
- 覆盖：
  - init labels 与 candidates 一一对应
  - 默认 label 为 `unreviewed` 且不含 raw_log 全文
  - summary 正确统计 action/status
  - preview 只接受合法 `recover_event_at`
  - 缺少 timezone 的 `event_at` 会被拒绝
  - `event_at_source=updated_at` 会被拒绝
  - preview 不写 DB
  - CLI 拒绝 `--apply` / `--force` / `--write-db` / `--no-backup`

- 验证：

```text
node --test test/event-at-manual-recovery-label-loop.test.js test/event-at-manual-recovery-export.test.js
node --check bin/init-event-at-manual-recovery-labels.js
node --check bin/summarize-event-at-manual-recovery-labels.js
node --check bin/preview-event-at-manual-recovery-apply.js
npm test
git diff --check
```

- full `npm test`：P38 改动后再次验证通过。

### P39: event_at recovery label pilot sampling

- 目的：从 P38 的 `942` 条 manual recovery labels 中抽一个小样本 pilot，先做人审试跑，再决定后续更大规模标注节奏。
- 新增只读 CLI：`bin/sample-event-at-manual-recovery-labels.js`
- 默认 sample count：`50`
- 默认输出路径：
  - `/tmp/memory-engine-reports/event-at-manual-recovery-labels-2026-06-15-pilot50.jsonl`
- 输出仍保留 label schema，并额外增加：
  - `pilot_sample: true`
  - `pilot_reason`

- sampling strategy：
  - deterministic sampling，默认固定 seed，支持 `--seed`
  - 先保证覆盖：
    - `role=user`
    - `role=assistant`
    - `tag=preference|decision|todo|no_tag`
    - `length_bucket=500-999|1000+`
  - 再按 `seed + chunk id` 的稳定顺序补齐到目标 sample count
  - sampler 需要读取同目录下匹配日期的 P37 candidate JSONL，用于恢复 `role/tag/length` 覆盖维度；输出文件本身仍不带 raw candidate preview

- sample artifact 约束：
  - 只写 `/tmp/memory-engine-reports/` 下 sample artifact
  - 是否包含 raw text：no
  - 是否修改真实 DB：no
  - 是否 apply migration：no

- 新增测试：`test/event-at-manual-recovery-label-sampler.test.js`
- 覆盖：
  - sample 输出数量正确
  - 同 seed 输出一致
  - 不输出 raw_log 全文
  - 保留 label schema
  - 覆盖 role/tag/length bucket
  - CLI 拒绝 `--apply` / `--force` / `--write-db` / `--no-backup`
  - 不写 DB

- 验证：

```text
node --test test/event-at-manual-recovery-label-sampler.test.js test/event-at-manual-recovery-label-loop.test.js
node --check bin/sample-event-at-manual-recovery-labels.js
node bin/sample-event-at-manual-recovery-labels.js --labels /tmp/memory-engine-reports/event-at-manual-recovery-labels-2026-06-15.jsonl --count 50 --out /tmp/memory-engine-reports/event-at-manual-recovery-labels-2026-06-15-pilot50.jsonl
npm test
git diff --check
```

- full `npm test`：P39 改动后再次验证通过。

### P40: event_at recovery pilot review packet

- 目的：把 P39 pilot labels 与 P37 candidate metadata / capped preview join 成一个人工审核 packet，方便 reviewer 在不接触 raw_log 全文的前提下完成小样本试审。
- 新增只读 CLI：`bin/build-event-at-pilot-review-packet.js`
- 输入路径：
  - labels: `/tmp/memory-engine-reports/event-at-manual-recovery-labels-2026-06-15-pilot50.jsonl`
  - candidates: `/tmp/memory-engine-reports/event-at-manual-recovery-2026-06-15.jsonl`
- 输出路径：
  - `/tmp/memory-engine-reports/event-at-manual-recovery-pilot50-review.md`
- packet count：`50`

- packet 内容：
  - `id`
  - `date`
  - `text_sha256_16`
  - `role_hint`
  - tag hints
  - `text_length`
  - `pilot_reason`
  - capped preview
  - 当前 label fields
  - reviewer 可填写字段模板

- 安全边界：
  - raw_text_exported: false
  - capped preview only
  - 不修改真实 DB：no
  - 不 apply migration：no
  - 不自动 backfill：no

- 行为约束：
  - 只使用 P37 candidate 中已有的 capped preview
  - 如果 label id 在 candidates 中找不到，不静默跳过
  - 输出 `missing_candidate_count` 和 `missing_candidate_ids`
  - `updated_at` 仍明确禁止作为 `event_at_source`

- 新增测试：`test/event-at-pilot-review-packet.test.js`
- 覆盖：
  - review packet join labels + candidates
  - 输出 count 正确
  - missing candidate 会被报告
  - 不输出 raw_log 全文，只输出 capped preview
  - Markdown 包含 label rules
  - CLI 拒绝 `--apply` / `--force` / `--write-db` / `--no-backup`
  - 不写 DB

- 验证：

```text
node --test test/event-at-pilot-review-packet.test.js test/event-at-manual-recovery-label-sampler.test.js
node --check bin/build-event-at-pilot-review-packet.js
node bin/build-event-at-pilot-review-packet.js --labels /tmp/memory-engine-reports/event-at-manual-recovery-labels-2026-06-15-pilot50.jsonl --candidates /tmp/memory-engine-reports/event-at-manual-recovery-2026-06-15.jsonl --out /tmp/memory-engine-reports/event-at-manual-recovery-pilot50-review.md
npm test
git diff --check
```

- full `npm test`：P40 改动后再次验证通过。

### P41: event_at recovery web annotator

- 目的：用 Web GUI 替代手改 JSONL 和 Markdown review packet 标注，继续保持 event_at manual recovery 流程只读、browser-local、无真实 DB 变更。
- 新增静态工具：`tools/event-at-recovery-annotator.html`
- 输入文件：
  - candidates：`/tmp/memory-engine-reports/event-at-manual-recovery-2026-06-15.jsonl`
  - labels：`/tmp/memory-engine-reports/event-at-manual-recovery-labels-2026-06-15-pilot50.jsonl`
  - labels：`/tmp/memory-engine-reports/event-at-manual-recovery-labels-2026-06-15.jsonl`
- 输出文件：
  - browser 导出的 labels JSONL
  - 保持兼容：
    - `bin/summarize-event-at-manual-recovery-labels.js`
    - `bin/preview-event-at-manual-recovery-apply.js`

- GUI 行为：
  - 通过浏览器 File API 读取本地 candidates JSONL 和 labels JSONL。
  - 按 `id + text_sha256_16` join candidate 与 label。
  - 展示：
    - `id / id prefix`
    - `date`
    - `text_sha256_16`
    - `role_hint`
    - tag hints
    - `text_length`
    - `pilot_reason`
    - capped preview
    - current review fields
  - 不显示 raw_log 全文，只显示 candidate 中已有 capped preview。
  - 支持逐条标注：
    - `recover_event_at`
    - `keep_null`
    - `ignore_low_value`
    - `needs_more_evidence`
  - `recover_event_at` 时要求填写：
    - `event_at`
    - `event_at_source`
    - `confidence`
  - `event_at` 校验：
    - 允许 timezone-explicit ISO timestamp
    - 允许 Unix seconds
    - 不允许无 timezone 的本地时间
  - `event_at_source` 允许：
    - `session_transcript`
    - `external_note`
    - `manual_timestamp`
    - `other`
    - `null`
  - 明确禁止：
    - `updated_at`
    - `legacy_updated_at`
  - 支持 `reviewer_note`。
  - 支持过滤：
    - `unreviewed`
    - `reviewed`
    - `recover_event_at`
    - `keep_null`
    - `ignore_low_value`
    - `needs_more_evidence`
    - `invalid`
    - `role=user`
    - `role=assistant`
    - `tag=preference|decision|todo|no_tag`
  - 支持快捷键：
    - `1/2/3/4` 选择 review action
    - `j/k` 或 `←/→` 切换记录
  - 页面实时显示：
    - `total`
    - `reviewed`
    - `unreviewed`
    - action breakdown
    - invalid count

- export schema：
  - 每行保留 P38 label schema：
    - `id`
    - `date`
    - `text_sha256_16`
    - `manual_review_status`
    - `review_action`
    - `event_at`
    - `event_at_source`
    - `confidence`
    - `reviewer_note`

- 安全边界：
  - 页面显式提示：
    - `Do not use updated_at / legacy_updated_at as event_at.`
    - `Only choose recover_event_at when there is reliable external or transcript evidence.`
    - `When unsure, choose needs_more_evidence.`
  - `raw_text_exported: false`
  - `capped preview only`
  - `real DB modified: no`
  - `migration applied: no`
  - 不做 server upload，不写真实 DB，不 apply migration，不自动 backfill。

- 新增测试：`test/event-at-recovery-annotator-static.test.js`
- 覆盖：
  - HTML 文件存在
  - 四个 review action 存在
  - `event_at / event_at_source / confidence / reviewer_note` 存在
  - 禁止 `updated_at` 作为 source 的提示存在
  - File API input 存在
  - export JSONL 文本与函数存在
  - 页面不包含 DB write / migration apply 调用
  - 页面不包含 server upload 逻辑
  - 页面明确 `raw_text_exported: false` 与 capped preview only

- 验证：

```text
node --test test/event-at-recovery-annotator-static.test.js test/event-at-manual-recovery-label-loop.test.js
npm test
git diff --check
```

- full `npm test`：P41 改动后再次验证通过。

### P46 closure: rejected-source evidence semantics

- 修正 `unknown` sidecar evidence 边界：存在 `evidence_ref` 时必须显式使用 `evidence_type=rejected_source`。
- `rejected_source` 只能用于 `precision=unknown`、`source=unknown` 且 `event_at/event_date=NULL`；exact/date_only 和任何带时间的记录均拒绝。
- 因此可以结构化记录 `core.updated_at`、file mtime、import timestamp 等被拒绝的来源，但不会把它们当作 event-time evidence。
- `resolveEffectiveEventTime` 对 rejected evidence 仍返回 `unknown`，不读取 core `updated_at`。

### P46: engine-side event-time sidecar schema MVP

- 新增 `lib/db/memory-event-times.js` 与 `bin/preview-memory-event-times-schema.js`。
- sidecar 表名：`memory_event_times`；不建立到 core DB 的 foreign key，不接入 recall、checkpoint 或排序。
- schema 支持：
  - `event_at`：Unix seconds，仅 exact 使用。
  - `event_date`：`YYYY-MM-DD`，date_only 使用。
  - `precision`：`exact` / `date_only` / `unknown`。
  - `source`：session transcript、external note、manual timestamp、smart-add path、import metadata、unknown。
  - `confidence`、evidence fields，以及 sidecar row lifecycle `created_at` / `updated_at`。
- validator 不变量：
  - exact 必须有 event_at，可推导业务时区 event_date；拒绝毫秒值、smart_add_path/import_metadata/unknown source；high confidence 必须有 evidence_ref。
  - date_only 只保留 event_date，event_at 必须 NULL，不补当天午夜。
  - unknown 的 event_at/event_date 必须 NULL，source 必须 unknown。
  - updated_at、file mtime、import time 不能作为 event-time source。
- repository API：`validateMemoryEventTime`、`normalizeMemoryEventTime`、`getMemoryEventTime`、`listMemoryEventTimes`、`upsertMemoryEventTime`、`resolveEffectiveEventTime`。upsert 默认以 `denied_by_default_write_guard` 拒绝，只有 fixture 显式 `allowWrite: true` 才能写入临时 DB。
- `resolveEffectiveEventTime` 只读取 sidecar：exact 返回 exact timestamp，date_only 返回日期，unknown/缺失返回 unknown；永远不 fallback 到 core `updated_at`。
- 真实 engine DB schema preview：`exists=false`、`would_create=true`、`writes_db=false`；本阶段未执行 CREATE TABLE。real engine DB modified=no；core DB modified=no；core migration applied=no。
- P45 的 `denied_by_provenance_audit` core migration suspension 继续有效。
- targeted tests：P46 sidecar/schema-preview/suspension tests 通过。
- full `npm test`：P46 改动后待最终验收。

### P45: event_at migration decision closure and audit reconciliation

- P45 reconciliation CLI：`bin/reconcile-event-at-audit-counts.js`。
- 3306 与 3229 的差异已对账：
  - migration impact preview：`chunks JOIN engine.memory_confidence`，严格 `mc.category='raw_log'`，按 `updated_at` 的 UTC calendar date 分组，不过滤 archived；历史 session scope 使用任意 `*.jsonl.*` 变体，排除 `.deleted.` 与 `.trajectory.`。
  - provenance audit：同样严格 `raw_log` join、无 archived 过滤，按 Asia/Shanghai `+08:00` 日期范围匹配秒/毫秒 `updated_at`；session scope 为 base `.jsonl`、`.reset.*`、`.deleted.*`，排除 trajectory。
  - `row_difference=77`，全部来自 UTC calendar grouping 与 +08:00 local-day predicate 的边界差异，不是通过修改数字对齐。
- 530 与 267 的差异已对账：历史 migration report 的 `recoverable=530` 是历史 union/recoverability 口径；P44 `session_formula_match=267` 只统计当前严格 session scope 中的 exact `sha256(message_text + raw_session_timestamp + local_date_string)` chunk-id match，不包含 text timestamp recovery。当前保留的历史 session variant 只能重放 396 条，另有 134 条历史 recoverable 无法从当前 session corpus 重建。`match_difference=263`。
- session scope reconciliation：当前扫描 485 个文件；migration wildcard scope 202 个非 deleted 文件，包含 `.reset.*` 与其他 `.jsonl.*` 变体；P44 scope 含 283 个 `.deleted.*` 文件；两者均排除 trajectory。
- reconciliation report：`reconciled=true`；`raw_text_exported=false`；`writes_db=false`；`migration_applied=false`。
- 新增 ADR：`docs/adr/event-time-ownership.md`，状态 `Accepted`，标题为 Memory-engine owns event-time metadata in an engine-side sidecar。
- 决策关闭：
  - 不执行当前 core `chunks.event_at` migration。
  - 不使用 `updated_at`、file mtime、batch-write time、import time 或 smart-add path date 作为 event_at。
  - smart-add 路径日期最多是 `date_only`，旧数据允许 `exact` / `date_only` / `unknown`，`unknown` 是合法状态。
  - 后续 event-time metadata 放入 memory-engine 自有 sidecar，不修改 OpenClaw core schema。
- `applyCoreChunkTimeMigration()` 已加入不可绕过的 `denied_by_provenance_audit` gate；即使提供旧 token 也拒绝 apply。dry-run、audit、preview、evidence 工具仍可运行。
- pilot 结论：pilot50 已完成；人工无法可靠回忆精确时间；P43 的 12 条全部 `no_match`；P44 识别 smart-add import/reindex 与 flush batch-write；剩余 892 条停止标注；当前唯一 `recover_event_at` 无证据，应降级为 `needs_more_evidence`。
- 当前不建议继续标剩余 892 条；不建议 apply migration，建议后续实现 engine-side event-time sidecar。
- `real DB modified=no`；`migration applied=no`。
- targeted tests：P45 reconciliation/suspension/provenance tests 通过。
- full `npm test`：P45 改动后待最终验收。

### P44: 2026-06-15 raw_log provenance and generation-chain audit

- P43 已证明 pilot evidence 中符合取证条件的 12 条全部 `no_match`，session transcript 不能解释当前人工标注的 recover event_at；本阶段不再降低 fuzzy threshold，不恢复 event_at，不 backfill，不 apply migration。
- 新增只读 CLI：`bin/audit-raw-log-provenance.js`，按 legacy `updated_at` 日期同时支持秒/毫秒过滤，聚合 path/source/model、line range、hash/id、文本长度、confidence 时间、session chunk-id 公式、memory 文件匹配和批量写入时间；不输出 raw text。
- writer/generation chain inventory：
  - `bin/flush-session-rawlog.js`：session JSONL -> raw_log chunk；公式为 `sha256(message_text + raw_session_timestamp + local_date_string)`。legacy schema 将可解析 session timestamp 写入 `updated_at`，缺 timestamp 时 fallback 为 flush/write time；当前 schema 则写 `event_at` 并保留 `updated_at` 为 write time。证据：git `3b84412`、`430a042`、`44b2edd`，文件 `bin/flush-session-rawlog.js:134-267`。
  - OpenClaw memory index/reindex：`memory/smart-add/*.md` -> indexed chunks；06-15 的 `model=Qwen/Qwen3-Embedding-4B`、smart-add path、session formula 命中 0，说明这批主要是 smart-add 文件导入/索引链，而非可由 session 反推的原始消息链。
  - `lib/index-sync-runtime.js` 只为已索引 smart-add/episodes 补 `memory_confidence`，其 `last_confidence_update` 是维护时间，不是 event time。
- 2026-06-15 审计：`row_count=2433`；全部 `path_family=smart-add`、`source=memory`、`model=Qwen/Qwen3-Embedding-4B`；`hash_matches_sha256_text=2433/2433`；session formula match `0/2433`；exact file-content match `0`，normalized line/block match `2`；文本长度 `min=193, p50=885, p95=1464, max=3108`；duplicate hash/text groups `98`。
- 06-15 `updated_at`：全为毫秒；归一化后仅 36 个秒值，最大同秒 199，最大同分钟 1280，窗口跨度 112 秒。结论：`updated_at` 很可能是批量索引/导入写入时间，不是 2433 条事件同时发生的时间；`legacy_updated_at_date=2026-06-15` 不能当作真实 event date。判断：`likely_batch_write_date`，并存在 timestamp pollution 风险。
- 2026-06-21 对照：`row_count=3229`；全部 `path_family=smart-add`、`source=memory`、`model=flush-script`；hash/text 完全匹配 `3229/3229`；session formula match `267/3229`；exact file-content match `22`，normalized match `22`；文本长度 `min=1, p50=61, p95=757, max=10302`；duplicate groups `255`。
- 06-21 `updated_at`：全为秒；只有 5 个秒值，最大同秒 1038，最大同分钟 3229，跨度 4 秒。结论同样是强批量写入特征。06-15 与 06-21 共享 smart-add/raw_log 大类，但不是同一精确生成链：06-15 偏 reindex/import，06-21 偏 flush-script/mixed session linkage。
- 由于 06-15 的时间字段是批量导入时间、session evidence 命中为 0、文件正文也无法逐条对应，不建议继续人工标注剩余 892 条；建议延期或取消当前 core `event_at` migration，直到获得可靠外部/原始 session 证据。
- `raw_text_exported=false`；`real DB modified=no`；`migration applied=no`。
- targeted tests：`node --test test/raw-log-provenance-audit.test.js test/event-at-session-evidence-resolver.test.js` 通过；CLI syntax check 通过。
- full `npm test`：P44 改动后待最终验收。

### P43: OpenClaw session raw log event_at evidence resolver

- 人工不应凭记忆填写精确 `event_at`。人工负责价值判断，session evidence resolver 负责从 OpenClaw 每日 session raw log 做时间取证。
- 新增只读 CLI：
  - `bin/resolve-event-at-session-evidence.js`
  - `bin/preview-event-at-labels-from-session-evidence.js`
  - `lib/event-at-session-evidence.js`
- resolver 只扫描 `*.jsonl`、`*.jsonl.reset.*`、`*.jsonl.deleted.*`，排除 trajectory、toolResult-only 和非 user/assistant message；文件读取错误与 malformed line 会计数，不静默吞掉。
- 四级证据边界：
  - exact chunk-id：复用 `sha256(text + timestamp + dateStr)`，唯一时为 high confidence。
  - exact normalized text：只做 CRLF/LF、trim、空白、已知 timestamp wrapper 和 role wrapper 归一化，并记录 steps。
  - substring：最小长度与覆盖率限制，仅为 medium、必须人工确认，不可直接 apply。
  - fuzzy：仅 low confidence、必须人工确认，永远不进入 apply suggestion。
- 只有无冲突、唯一、timestamp 合法且 exact chunk-id 或 exact normalized text 的证据，才可在 label preview 中建议 `recover_event_at`；preview 不覆盖 labels。
- pilot50 evidence 运行：
  - candidates：`/tmp/memory-engine-reports/event-at-manual-recovery-2026-06-15.jsonl`
  - labels：`/tmp/memory-engine-reports/event-at-manual-recovery-labels-2026-06-15-pilot50-annotated.jsonl`
  - evidence：`/tmp/memory-engine-reports/event-at-session-evidence-pilot50.jsonl`
  - session files scanned：475；messages indexed：2145；malformed line count：0；file read errors：0。
  - 50 条人工 reviewed labels 中，按 needs_more_evidence / keep_null / recover_event_at 选择 12 条；resolution breakdown：`no_match=12`、`ambiguous=0`、`conflict=0`、`unique_match=0`。
  - unique high-confidence match count：0；label enrichment preview 的 `suggested_label_updates_count=0`。
  - 当前唯一 `recover_event_at` 未找到 session transcript evidence，event_at 无法验证，应降级为 `needs_more_evidence`；原 labels 未修改。
- CLI 拒绝 `--apply`、`--force`、`--write-db`、`--no-backup`；不使用 updated_at、file mtime 或 filename date 作为 event_at source。
- `raw_text_exported=false`；`real DB modified=no`；`migration applied=no`；不自动 backfill。
- targeted tests：`node --test test/event-at-session-evidence-resolver.test.js test/event-at-manual-recovery-label-loop.test.js` 通过。
- full `npm test`：待 P43 改动后最终验收。

### P42: event_at recovery annotator manual smoke record

- GUI manual smoke：成功。用户已加载 candidates 与 pilot labels，并导出 annotated labels。
- 输入文件：
  - candidates：`/tmp/memory-engine-reports/event-at-manual-recovery-2026-06-15.jsonl`
  - labels：`/tmp/memory-engine-reports/event-at-manual-recovery-labels-2026-06-15-pilot50.jsonl`
- 输出文件：`/tmp/memory-engine-reports/event-at-manual-recovery-labels-2026-06-15-pilot50-annotated.jsonl`
- summary JSON 摘要：`label_count=942`，`reviewed=2`，`unreviewed=940`，`recover_event_at_count=0`，`keep_null_count=1`，`ignore_low_value_count=1`，`needs_more_evidence_count=940`，`invalid_label_count=0`。
- preview JSON 摘要：`candidate_updates_count=0`，`valid_recover_event_at_count=0`，`invalid_recover_event_at_count=0`，`blocked_reasons=[]`。
- `raw_text_exported: false`
- `real DB modified: no`
- `migration applied: no`
- 两个命令均为 `dry_run=true`，`writes_db=false`，`migration_applied=false`。
- full `npm test`：通过。

### B8-A7.1 final compatibility and closure guard fixes: 2026-07-19

- malformed higher-priority `autoRecall` objects now fail closed and no longer fall through to lower-priority configuration; safe runtime defaults are used and the rollout fingerprint is invalidated.
- Recent canary normalization preserves the supported single-value `token` alias without expanding KG token scope behavior; malformed token aliases remain invalid.
- runtime identity closure now includes the declared `bin/sync-memory-index.js` dependency, validates all declared root runtime files for injected `fileEntries`, and rejects duplicate injected paths.
- dependency-closure validation follows the actual `index.js` runtime import closure and rejects reachable local dependencies outside `lib/` or the declared root runtime scope.
- status: `B8-A7.1 FINAL REVIEW FIXES IMPLEMENTED / REVIEW PENDING`; A7.2, sustained runtime authorization, and B8-B remain unauthorized.
## 2026-07-20

### F1-D-B8-A7: sustained runtime authorization withheld after real-environment review

- Reviewed source checkpoint: `e8140c2` on `main`.
- `openclaw plugins inspect memory-engine --runtime --json` identified OpenClaw `2026.6.9`, installed plugin `0.8.22`, and install root `~/.openclaw/extensions/memory-engine`.
- Source/runtime parity failed: `difference_count=25`, source build `3a3dc277...`, runtime build `86d04dd7...`; the installed runtime lacks the A7.4 preflight and scheduled-healthcheck gateway methods.
- Inspection exposed a native ABI mismatch: installed `better-sqlite3` uses `NODE_MODULE_VERSION 137`, while the OpenClaw CLI process requires `127`. No rebuild or reinstall was executed.
- The current config remains valid and pre-activation: AutoRecall disabled, KG/Recent `legacy_fallback`, production evidence disabled, no epoch.
- Runtime boundary failed because active-memory is absent from config and therefore resolves enabled by OpenClaw default semantics.
- Read-only 30-day observation export produced 35 rows but zero qualifying natural observations: 34 invalid origin-evidence rows and one invalid-provenance row. Forecast status: `blocked`.
- AutoRecall product health status: `not_evaluated`; 24-hour telemetry had 65 events, zero injections, p95 latency 4094 ms, max latency 7300 ms, and no exact-key quality review.
- Authorization decision: `WITHHELD / REMEDIATION REQUIRED`.
- No config backup, authorization plan, install/reload, config mutation, scheduler, evidence epoch, active baseline, rollback, memory mutation, push, tag, or release was performed.
- Decision record: `docs/smoke-tests/sustained-runtime-authorization-decision-20260720.md`.
- Current boundaries: `B8-A7 sustained runtime window=NOT AUTHORIZED`; `B8-B removal=NOT AUTHORIZED`.

### F1-D-B8-A7.3: final evidence status fixes implemented

Implemented the final A7.3 review fixes: scheduled-healthcheck evidence is now limited to tool surfaces, canonical UTC timestamps reject surrounding whitespace, parity health is distinct from parity freshness, and monitor freshness includes all canonical surfaces plus healthcheck, parity, and product-health evidence. `B8-A7.3 FINAL REVIEW FIXES IMPLEMENTED / REVIEW PENDING`; sustained runtime remains unauthorized and B8-B remains unauthorized.

### F1-D-B8-A7.3: temporal evidence fixes implemented

Implemented the review fixes for authorized evidence boundaries and scheduled-healthcheck provenance. The monitor now uses one canonical UTC ISO timestamp contract, partitions active-epoch observations by `authorized_at` and explicit `asOf`, rejects future evidence as a stop condition, and feeds the same authorized set to identity, continuity, fallback-window, and full-rollout evaluators. Healthcheck freshness now requires the registration-owned wrapper identity fields. `B8-A7.3 REVIEW FIXES IMPLEMENTED / REVIEW PENDING`; the sustained runtime window and B8-B remain unauthorized.

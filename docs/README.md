# Memory-engine 架构与治理文档索引

> **Status: Current documentation index**
>
> 本文件是文档导航与权威层级入口，不替代代码、测试、ADR 或专项契约。

本文档是仓库内架构、契约、治理规则和运行手册的统一入口。

它不替代各专项文档，而是回答三个问题：

1. 当前系统由哪些边界和流程组成？
2. 哪些文档是现行约束，哪些只是设计、审计或历史记录？
3. 修改某个子系统前，应先阅读哪些文档？

## 文档权威层级

发生冲突时，按以下顺序判断：

1. **代码与自动化测试**：当前实际行为的最终证据。
2. **Accepted ADR / Current contract / Policy**：已接受的架构决策、当前契约与治理规则。
3. **Runbook**：在既定架构下执行、验证和回滚的操作步骤。
4. **Design-only / Plan**：尚未完全落地或仅用于阶段设计的目标状态。
5. **Audit / Baseline**：某个时间点的盘点、风险清单或迁移基线。
6. **Historical**：保留用于理解演进过程，不应直接作为当前实现依据。

根目录 [`AGENTS.md`](../AGENTS.md) 规定仓库边界、数据库安全不变量、运行时同步要求、验证规则和 Git 工作纪律，属于所有开发工作的前置约束。

## 总体架构入口

### 当前系统边界

| 主题 | 文档 | 状态 | 用途 |
| --- | --- | --- | --- |
| OpenClaw 与 memory-engine 分工 | [`agent-memory-tool-strategy.md`](agent-memory-tool-strategy.md) | Current contract | 明确 memory-core 是标准 memory substrate，memory-engine 是增强与治理层；定义 agent 工具边界和双重召回禁忌 |
| OpenClaw 兼容性与插件契约 | [`openclaw-memory-contract-compat.md`](openclaw-memory-contract-compat.md) | Contract analysis | 解释 slot、工具命名空间、DB 隔离、prompt supplement 和兼容策略 |
| 运行入口与 action/service 边界 | [`memory-entry-boundary-audit.md`](memory-entry-boundary-audit.md) | Audit + governance baseline | 盘点 canonical、shim、legacy 和 unsafe entrypoints，约束业务逻辑不得绕过 canonical action/service layer |
| 事件时间归属 | [`adr/event-time-ownership.md`](adr/event-time-ownership.md) | Accepted ADR | 确定 event-time 元数据由 engine-side sidecar 持有，禁止伪造或回写 core schema |
| 个人部署安全配置 | [`adr/personal-deployment-safety-profile.md`](adr/personal-deployment-safety-profile.md) | Passed / closed current ADR | 当前单用户路线：保留数据安全、运行副本身份、冲突插件禁用、测试和回滚硬门；接受 operator cold inspection 与 post-load runtime evidence，不要求 OpenClaw host publisher |
| 个人部署只读基线 | [`smoke-tests/personal-deployment-read-only-baseline.md`](smoke-tests/personal-deployment-read-only-baseline.md) | R6.1 current audit contract | 在不改配置、不安装、不 reload 的前提下关联 CLI、Gateway、cold inspect、installed runtime、ABI、active-memory、方法注册和测试证据；禁止 CLI-local `plugins inspect --runtime` |
| 个人部署只读基线决策 | [`smoke-tests/personal-deployment-read-only-baseline-decision-20260721.md`](smoke-tests/personal-deployment-read-only-baseline-decision-20260721.md) | R6.1 baseline blocked | 记录 2026-07-21 真实基线：Gateway/安全配置通过，runtime drift=28、A7.4 方法缺失、active-memory boundary resolver 未建模 host allowlist |
| Host activation boundary 兼容 | [`smoke-tests/host-activation-boundary-compatibility.md`](smoke-tests/host-activation-boundary-compatibility.md) | R6.2 passed / closed | 使 active-memory boundary resolver 匹配 OpenClaw 2026.6.9 的 global disable、deny、entry、non-empty allowlist 和 bundled default 顺序 |
| 个人运行副本修复授权设计 | [`smoke-tests/personal-runtime-remediation-authorization.md`](smoke-tests/personal-runtime-remediation-authorization.md) | R6.3 passed / closed | 选择 npm-pack source + exact lock + Node 24 dependency-complete candidate；定义 C0/R0/H0/D0、停机安装、数据身份门、Gateway RPC 验证和 rollback 分支，但不授权 live execution |
| 离线 candidate 与 rollback rehearsal | [`smoke-tests/personal-runtime-candidate-rehearsal-decision-20260721.md`](smoke-tests/personal-runtime-candidate-rehearsal-decision-20260721.md) | R6.4 passed / closed | 记录 frozen candidate、native smokes、parity=0、独立 C0/R0、隔离 OpenClaw forward→rollback→forward 演练，以及 install-time plugin import 与 stable-cwd 新约束 |
| Live runtime remediation 授权包 | [`smoke-tests/personal-runtime-live-remediation-authorization-20260721.md`](smoke-tests/personal-runtime-live-remediation-authorization-20260721.md) | R6.5 passed / closed | 绑定 canonical artifact manifest、fresh C0/R0/D0、精确 stop/install/start、安装前后数据身份门、Gateway RPC 验证及条件 rollback |
| Live runtime remediation 执行决策 | [`smoke-tests/personal-runtime-live-remediation-decision-20260721.md`](smoke-tests/personal-runtime-live-remediation-decision-20260721.md) | Rolled back / safe | candidate 安装与数据门通过，但 exact-byte config gate 因 host `meta.lastTouchedAt` 更新时间触发；candidate 未启动，fresh R0/C0 安全恢复，Gateway 与数据身份正常 |
| 配置语义等价门 | [`../bin/build-config-semantic-equivalence-report.js`](../bin/build-config-semantic-equivalence-report.js) | R6.5.1 implemented / verification pending | 只允许规范、单调递增的 `meta.lastTouchedAt` 单路径变化；任何其他 JSON 路径变化继续 fail closed，且不输出配置秘密值 |
| 插件元数据发布归属 | [`adr/host-plugin-metadata-ownership.md`](adr/host-plugin-metadata-ownership.md) | Strict-profile reference ADR | 若未来恢复平台级 no-load authority profile，权威安装元数据及普通文件发布只能由 OpenClaw host core 持有；拒绝 memory-engine shadow publisher 与直接 SQLite 消费 |
| OpenClaw host publisher 集成设计 | [`openclaw-host-plugin-metadata-publisher-integration-design.md`](openclaw-host-plugin-metadata-publisher-integration-design.md) | Strict-profile R5 reference | 保留 required plugin ids、durable outbox、v2 manifest、语义提交和启动屏障设计；当前个人部署不实施、不提 PR、不维护 fork |
| 发布与版本身份 | [`release-version-policy.md`](release-version-policy.md) | Current release policy | 区分可达发布标签、manifest version、unreleased commits 和精确 build identity |
| 检索结果到回答的证据规则 | [`retrieval-answering-policy.md`](retrieval-answering-policy.md) | Current policy | 规定按日期回顾等场景的证据优先级，防止把派生摘要当成原始事实 |
| Hybrid fail-closed rollout 当前状态 | [`hybrid-fail-closed-rollout-status.md`](hybrid-fail-closed-rollout-status.md) | Current rollout ledger | 记录 F1-D-B8-A5/A6/A7 阶段、真实 observation 证据、持续窗口治理与 B8-B 禁止边界 |
| Hybrid 持续生产证据窗口 | [`smoke-tests/full-fail-closed-production-evidence-window.md`](smoke-tests/full-fail-closed-production-evidence-window.md) | B8-A7 design contract | 定义 evidence epoch、runtime/config identity、窗口连续性、traffic origin、健康监控与停止条件；当前不授权长期 full mode |

### 架构速览图

- [`architecture.txt`](architecture.txt)：分层、源码/运行时/数据库关系的简略速览。
- [`dataflow.txt`](dataflow.txt)：Recall、Write、Lifecycle 三条主流程的简略速览。

这两个文件只用于快速导航，**不是完整或唯一的架构事实源**。涉及具体边界时，应回到上表中的 contract、ADR、policy 以及代码和测试。

### AutoRecall 与渐进披露

| 文档 | 状态 | 用途 |
| --- | --- | --- |
| [`auto-recall-memory-card-object-model.md`](auto-recall-memory-card-object-model.md) | Design-only P4 contract | 定义 memory object、memory card、风险标记、披露级别和强化边界 |
| [`auto-recall-memory-card-runtime-runbook.md`](auto-recall-memory-card-runtime-runbook.md) | P4 closeout runbook | 描述 gated card-first runtime、观测、验证和回滚 |
| [`auto-recall-card-runtime-canary-plan.md`](auto-recall-card-runtime-canary-plan.md) | P5 opt-in canary plan | 定义本地 canary 的前置条件、通过/失败标准和决策记录 |
| [`superpowers/specs/2026-05-24-memory-engine-auto-recall-design.md`](superpowers/specs/2026-05-24-memory-engine-auto-recall-design.md) | Historical design | 早期 autoRecall 设计背景 |
| [`superpowers/plans/2026-05-24-memory-engine-auto-recall.md`](superpowers/plans/2026-05-24-memory-engine-auto-recall.md) | Historical implementation plan | 早期实施拆解，不作为当前运行契约 |

## 治理文档入口

### 数据与存储治理

- **Core DB 只读不变量**：见 [`AGENTS.md`](../AGENTS.md) 的 Database safety。memory-engine 可以读取显式 attach 的 `core.*`，不得写入。
- **事件时间治理**：见 [`adr/event-time-ownership.md`](adr/event-time-ownership.md)。不允许用 `updated_at`、文件 mtime、批量写入时间或路径日期推断精确事件时间。
- **当前个人部署安全配置**：见 [`adr/personal-deployment-safety-profile.md`](adr/personal-deployment-safety-profile.md)。当前路线不要求 OpenClaw PR、private fork、host publisher 或 no-load authority proof；状态不确定时关闭 AutoRecall、自动强化、full mode 和 evidence window，而不是阻止全部插件加载。
- **个人部署 remediation**：见 [`smoke-tests/personal-deployment-sustained-runtime-remediation.md`](smoke-tests/personal-deployment-sustained-runtime-remediation.md)。通过 operator cold inspection、精确 installed-runtime identity、already-running Gateway RPC、有效 host activation policy、测试、备份和 rollback 形成当前授权证据。
- **R6.1 只读基线审计**：见 [`smoke-tests/personal-deployment-read-only-baseline.md`](smoke-tests/personal-deployment-read-only-baseline.md) 与 [`smoke-tests/personal-deployment-read-only-baseline-decision-20260721.md`](smoke-tests/personal-deployment-read-only-baseline-decision-20260721.md)。真实执行确认 Gateway 与安全配置正常，但 runtime drift、缺失 A7.4 方法和 stale active-memory boundary tooling 阻塞后续 mutation authorization。
- **R6.2 host activation boundary compatibility**：见 [`smoke-tests/host-activation-boundary-compatibility.md`](smoke-tests/host-activation-boundary-compatibility.md)。源码解析器现已识别非空 `plugins.allow` 排除、deny、global disable 和 entry/config disable；live config 只读复核返回 `disabled_by_plugins_allowlist`。
- **R6.3 runtime remediation authorization design**：见 [`smoke-tests/personal-runtime-remediation-authorization.md`](smoke-tests/personal-runtime-remediation-authorization.md) 与 [`runtime-sync.md`](runtime-sync.md)。禁止直接复制开发仓库和直接 archive install；live install 必须使用 Node 24、稳定 cwd、停机后的 D0 与安装前后数据身份门。
- **R6.4 offline candidate and rollback rehearsal**：见 [`smoke-tests/personal-runtime-candidate-rehearsal-decision-20260721.md`](smoke-tests/personal-runtime-candidate-rehearsal-decision-20260721.md)。candidate build identity `dc459f5…d718`、source/candidate parity=0、C0/R0 独立性和 sandbox forward→rollback→forward 已验证；`/tmp` artifact 仍属 ephemeral，R6.5 前必须重验或重建。
- **R6.5 live remediation execution**：授权包见 [`smoke-tests/personal-runtime-live-remediation-authorization-20260721.md`](smoke-tests/personal-runtime-live-remediation-authorization-20260721.md)，真实执行决策见 [`smoke-tests/personal-runtime-live-remediation-decision-20260721.md`](smoke-tests/personal-runtime-live-remediation-decision-20260721.md)。candidate 未经 Gateway 启动即因 exact-byte config gate 触发 rollback；旧 runtime、exact C0 和数据身份已恢复，A5 smoke 10/10。
- **R6.5.1 config semantic equivalence**：`bin/build-config-semantic-equivalence-report.js` 只批准 `meta.lastTouchedAt` 的规范单调更新时间；所有其他路径变化继续阻塞。源码实现待 EDI 独立验证，live retry 未授权。
- **严格平台级插件元数据发布治理**：见 [`adr/host-plugin-metadata-ownership.md`](adr/host-plugin-metadata-ownership.md) 与 [`openclaw-host-plugin-metadata-publisher-integration-design.md`](openclaw-host-plugin-metadata-publisher-integration-design.md)。如果未来恢复多用户、无人值守或外部控制场景，权威发布必须由 OpenClaw host core 持有；memory-engine 仍不得 shadow publish 或直接消费共享 SQLite。
- **运行时副本同步**：见 [`runtime-sync.md`](runtime-sync.md)。源码修改只有重新安装或 reload 后才会影响 OpenClaw 实际运行插件。
- **版本与发布身份**：见 [`release-version-policy.md`](release-version-policy.md)。只使用当前提交可达的最近发布标签；非祖先历史上的更大版本号不得覆盖当前 release line。
- [`hybrid-observation-provenance.md`](hybrid-observation-provenance.md)：Hybrid production observation 的 canonical envelope、surface-specific provenance、无效记录隔离和 removal-gate 阻塞契约。
- [`smoke-tests/full-fail-closed-production-evidence-window.md`](smoke-tests/full-fail-closed-production-evidence-window.md)：B8-A7 evidence epoch、installed-runtime/config identity、continuity、traffic-origin 和 sustained-window 授权边界。
- [`smoke-tests/sustained-runtime-authorization-tooling.md`](smoke-tests/sustained-runtime-authorization-tooling.md)：B8-A7.4 parity、可审计 product-health、双 surface scheduled healthcheck、epoch projection、自然流量 forecast、精确配置备份、授权计划、post-apply baseline finalizer、单周期 monitor 和 rollback verifier；保持 dry-run / report-only。
- `bin/audit-production-evidence-continuity.js`：只读读取 JSON/JSONL observation，评估 A7.2 natural-origin denominator、active UTC days、gap 和 per-surface continuity；不授权 sustained runtime。
- `bin/audit-production-evidence-health.js`：只读组合 A7.1/A7.2 identity、continuity、full-rollout、fallback、parity 和 product-health 报告，输出 stop/rollback 与 removal-gate readiness；不启动 sustained runtime。
- `bin/build-runtime-source-parity-report.js`、`bin/build-effective-hybrid-runtime-config-report.js`、`bin/build-auto-recall-product-health-report.js`、`bin/project-production-evidence-epoch.js`、`bin/audit-natural-traffic-forecast.js`、`bin/build-sustained-runtime-boundary-report.js`、`bin/build-sustained-runtime-config-backup-manifest.js`、`bin/build-sustained-runtime-authorization-plan.js`、`bin/finalize-sustained-runtime-activation-baseline.js`、`bin/run-production-evidence-monitor-cycle.js`、`bin/verify-sustained-runtime-rollback.js`：A7.4 只读授权、activation baseline、监控和 rollback 证据验证工具链；不修改配置、不 install/reload、不创建 scheduler、不执行 rollback。
- [Legacy fallback code inventory](legacy-fallback-code-inventory.md)：说明 legacy fallback 静态扫描范围、finding 分类、计数语义、完整性规则及 removal-gate 集成方式。

### 质量评估与人工治理

| 文档 | 状态 | 用途 |
| --- | --- | --- |
| [`memory-quality-eval-mvp-v4.md`](memory-quality-eval-mvp-v4.md) | Current evaluation contract | 规定只读、确定性、可审计的质量评估边界、数据源、join 和 diagnostics |
| [`human-annotation-gold-set.md`](human-annotation-gold-set.md) | Current annotation policy | 定义 memory / turn / injection 标注 schema、安全规则和 autoRecall eligibility 策略 |
| [`orphan-confidence-cleanup.md`](orphan-confidence-cleanup.md) | Cleanup protocol | 规定 orphan confidence 清理的 dry-run、apply、备份与回滚边界 |
| [`smart-add-duplicate-cleanup-apply-design.md`](smart-add-duplicate-cleanup-apply-design.md) | Apply design | 规定 smart-add 重复项清理的 manifest、guardrail、mutation boundary 和验证要求 |

### 运行验证与烟雾测试

- [`smoke-tests/README.md`](smoke-tests/README.md)：所有人工 smoke runbook 的目录入口。
- [`hybrid-fail-closed-rollout-status.md`](hybrid-fail-closed-rollout-status.md)：F1-D-B8 当前阶段、证据和下一门禁台账。
- [`smoke-tests/full-fail-closed-runtime-rollout.md`](smoke-tests/full-fail-closed-runtime-rollout.md)：F1-D-B8-A6 受控插件 reload、逐通道 full rollout、回滚和生产 evidence window 流程。
- [`smoke-tests/tool-surface-runtime-access-audit.md`](smoke-tests/tool-surface-runtime-access-audit.md)：registry、effective tool policy 与真实 production tool wrapper 执行的分层审计。
- [`smoke-tests/openclaw-memory-tools.md`](smoke-tests/openclaw-memory-tools.md)：memory-core / memory-engine 工具暴露和路由边界。
- [`smoke-tests/console-annotation-report-handoff.md`](smoke-tests/console-annotation-report-handoff.md)：Console `/reports` 与 `/annotations` 的只读 handoff 验证。

### 变更历史与背景材料

- [`devlog.md`](devlog.md)：开发流水和阶段结果，适合追溯“为什么变成现在这样”，不应单独作为当前契约。
- [`openclaw_memory_v0.1.md`](openclaw_memory_v0.1.md)：早期总体设计与演进记录，属于 Historical 文档。
- 根 [`README.md`](../README.md)：项目概览和快速介绍。README 中的版本号、公式或架构图可能滞后，具体实现应以当前 contract、ADR、代码和测试为准。

## 按任务选择阅读路径

| 准备修改的区域 | 最少应先阅读 |
| --- | --- |
| 插件注册、工具命名或 OpenClaw 集成 | `AGENTS.md` → `agent-memory-tool-strategy.md` → `openclaw-memory-contract-compat.md` |
| CLI、tool、checkpoint、maintenance 入口 | `AGENTS.md` → `memory-entry-boundary-audit.md` |
| DB attach、schema、写路径或迁移 | `AGENTS.md` → `adr/event-time-ownership.md` → 相关代码与 DB safety tests |
| hybrid search、autoRecall、注入或强化 | `agent-memory-tool-strategy.md` → `retrieval-answering-policy.md` → `hybrid-observation-provenance.md` → `hybrid-fail-closed-rollout-status.md` → AutoRecall object model / runbook |
| 质量评分、污染审计或标注 | `memory-quality-eval-mvp-v4.md` → `human-annotation-gold-set.md` |
| 数据清理或 apply 工具 | 对应 cleanup/apply design → 备份与 rollback 规则 → targeted tests |
| Console reports / annotations | `human-annotation-gold-set.md` → `smoke-tests/console-annotation-report-handoff.md` |
| 运行时行为验证 | `runtime-sync.md` → 对应 runbook / smoke test |
| 发布、打 tag 或核对版本 | `release-version-policy.md` → `npm run version:status` → `npm run version:check` |

## 文档维护规则

新增或修改架构、治理文档时：

1. 在文档开头声明状态，例如 `Accepted ADR`、`Current policy`、`Runbook`、`Design-only`、`Audit` 或 `Historical`。
2. 涉及系统边界、数据所有权、安全不变量或默认行为的文档，必须加入本索引。
3. 设计文档落地后，应更新其状态或新增 closeout/runbook，不能让“计划”长期冒充“现状”。
4. README、架构速览与实际代码不一致时，不应只修图；应先确认 current contract 和测试，再更新导航材料。
5. 删除或移动文档时，同步修复本索引和相关静态测试链接。

## 2026-06-30

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

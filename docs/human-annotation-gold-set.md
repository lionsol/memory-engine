# Human Annotation Gold Set MVP

## Goal

Human Annotation Gold Set 的目标是给 memory-engine 提供一批人工复核样本，用于后续评估：

- 哪些 memory 质量足够好。
- 哪些 memory 不该被 auto recall。
- 哪些 recall injection 实际有帮助。
- 哪些 turn 场景根本不该回忆历史 memory。

本阶段只做只读导出，不做自动修复，不做自动打分回写。

## Sample Types

第一版 schema 固定保留三类样本：

- `memory`
- `turn`
- `injection`

第一版 CLI 只导出 `memory` 样本。

## Memory-Level Schema

memory-level 样本字段至少包含：

- `sample_type`
- `memory_id`
- `path`
- `path_family`
- `quality_scope_family`
- `quality_scope_owner`
- `category`
- `has_confidence_record`
- `confidence`
- `retrieved_count`
- `injected_count`
- `updated_at`
- `risk_signals`
- `quality_flags`
- `priority_score`
- `content_preview`
- `annotation`

`annotation` 子字段固定为：

- `quality`
- `currency`
- `auto_recall_eligible`
- `preferred_action`
- `notes`

memory-level 标签枚举：

```text
quality:
  good
  usable
  low_quality
  polluted

currency:
  current
  superseded
  unknown

auto_recall_eligible:
  yes
  no
  unsure

preferred_action:
  keep
  demote
  quarantine
  archive
  delete
```

## Turn-Level Schema

turn-level 样本保留以下字段：

- `sample_type`
- `turn_id`
- `thread_id`
- `query_text`
- `retrieved_memory_ids`
- `injected_memory_ids`
- `annotation`

`annotation` 子字段固定为：

- `should_recall`
- `task_intent`
- `disclosure_level`
- `notes`

turn-level 标签枚举：

```text
should_recall:
  yes
  no
  unsure

task_intent:
  answer_question
  continue_prior_work
  review_plan
  debug_error
  summarize_current_text
  rewrite_current_text
  translate_current_text
  extract_structured_info
  write_artifact
  plan_project
  make_decision
  operate_tool
  casual_chat

disclosure_level:
  none
  memory_card
  short_summary
  full_content_on_get
```

## Injection-Level Schema

injection-level 样本保留以下字段：

- `sample_type`
- `injection_id`
- `turn_id`
- `memory_id`
- `query_text`
- `injected_text_preview`
- `annotation`

`annotation` 子字段固定为：

- `injection_quality`
- `error_type`
- `notes`

injection-level 标签枚举：

```text
injection_quality:
  helpful
  acceptable
  unnecessary
  irrelevant
  harmful

error_type:
  no_error
  should_not_recall
  query_drift
  weak_relevance
  duplicate
  stale_memory
  polluted_memory
  wrong_category
```

## Export Priorities

第一版 memory-level 导出优先包含：

- `missing_category`
- `missing_confidence`
- `duplicate_exact`
- 疑似 `raw_log`
- 疑似 `tool_output`
- 疑似 `metadata_header`
- `dreaming` 来源
- `episode` 来源
- `smart-add` 来源

这些只是人工复核优先级，不等于自动判定结果。

## Safety Rules

MVP 阶段禁止：

- `INSERT`
- `UPDATE`
- `DELETE`
- `ALTER`
- `DROP`
- `VACUUM`
- 自动设置 `auto_recall_eligible`
- 自动 quarantine
- 自动 archive
- 自动 reinforcement

人工标注结果也不直接触发 reinforcement。

人工标注只用于后续：

- 评估 recall 策略
- 训练或校准 judge
- 设计更严格的 write / retrieval guard

## Prohibited Shortcuts

禁止把人工标注当成自动执行指令：

- `preferred_action=delete` 不代表系统可以直接删除。
- `preferred_action=quarantine` 不代表系统可以直接 quarantine。
- `auto_recall_eligible=no` 不代表系统立即改写召回 gating。
- `polluted` 不代表系统可以跳过人工 review。

## Annotation Workflow

推荐流程：

1. 先导出候选。
2. 在 standalone reviewer 页面中加载 JSONL。
3. 人工逐条标注。
4. 单独 review 标注一致性。
5. 再决定是否做 reinforcement、demotion、quarantine 或 schema 改造。

## Standalone Reviewer

当前提供一个纯静态 reviewer：

- `tools/annotation-reviewer.html`

使用方式：

1. 用浏览器打开 `tools/annotation-reviewer.html`
2. 通过页面内的 File API 选择本地 `reports/annotation-candidates-*.jsonl`
3. 按 bucket / path prefix / unlabeled only 过滤
4. 填写 annotation 字段
5. 导出 labels JSONL

页面当前支持显示：

- `sample_id`
- `memory_id`
- `chunk_id`
- `primary_bucket`
- `sample_buckets`
- `source_path`
- `risk_score`
- `content_preview`

页面当前支持填写：

- `quality`
- `currency`
- `auto_recall_eligible`
- `preferred_action`
- `reason`

导出 labels JSONL 字段：

- `schema_version`
- `sample_id`
- `sample_type`
- `memory_id`
- `chunk_id`
- `primary_bucket`
- `source_path`
- `annotation`
- `annotator`
- `labeled_at`

安全边界：

- 不联网
- 不访问 DB
- 不写 DB
- 不调用 API
- 不修改 candidate 文件
- 不修改 `auto_recall_eligible`
- 不直接触发 reinforcement

## 基于人工标注的 autoRecall 安全策略 v1

本版本策略只用于约束 autoRecall 的自动注入与自动强化资格，不直接修改数据库，不直接改写记忆文件，也不自动执行 quarantine、archive、delete。

### 一、`suspected_tool_output` 作为硬拒绝信号

当候选记忆满足以下任一条件时，autoRecall 直接拒绝：

- `primary_bucket = suspected_tool_output`
- `sample_buckets` 包含 `suspected_tool_output`
- `quality_flags` 包含 `suspected_tool_output`

拒绝效果：

- 不允许进入 autoRecall 自动注入
- 不允许进入 autoRecall 自动强化
- gate reason 固定记录为 `denied_by_suspected_tool_output`

这样做的原因是：第一批人工标注已经显示，`suspected_tool_output` 具有很高的污染概率，继续允许自动注入或自动强化，会把生成物、工具输出、转录残留再次反馈回记忆链路。

### 二、`raw_log_leak` 只作为风险信号

`raw_log_leak` 目前不能作为整桶硬拒绝条件。

原因是：人工标注显示这一桶存在明显误伤，不能因为命中 `raw_log_leak` 就自动判定为污染，也不能直接触发 quarantine、delete、archive。

本版本对 `raw_log_leak` 的处理方式是：

- 单独命中 `raw_log_leak` 时，不自动拒绝 autoRecall
- 只记录风险原因 `risk_raw_log_leak_review_required`
- 保留后续人工复核空间

也就是说，`raw_log_leak` 在 v1 里是“需要谨慎”的风险提示，不是“自动封禁”的执行信号。

### 三、`delete` 必须人工确认

人工标注中的 `preferred_action = delete` 不等于系统可以直接删除。

无论 preview 还是后续策略推导，只要出现 `delete` 建议，都必须保留人工确认要求。系统不能因为标签里写了 `delete`，就自动删候选、删记忆、删索引。

这一点的目的，是防止把人工标注的策略意图误当成破坏性执行指令。

### 四、`demote_only` 不等于删除或隔离

人工标注中的 `preferred_action = demote`，以及派生建议里的 `demote_only`，只表示：

- 该记忆不应继续享有当前的自动召回优先级
- 可能需要降低信任、降低可见性、降低强化资格

它不表示：

- 删除该记忆
- 隔离该记忆
- 归档该记忆

因此，`demote_only` 不能被实现成 delete 或 quarantine 的别名。

### 五、策略影响范围

本版本策略只影响以下两条自动链路：

- autoRecall 自动注入
- autoRecall 自动强化

本版本明确不影响以下手动能力：

- `memory_engine_search`
- `memory_engine_get`

也就是说，即使某条记忆因为 `suspected_tool_output` 被 autoRecall 硬拒绝，人工仍然可以通过手动 search/get 检索到它，用于排查、审计、对照和后续人工处理。

这样可以把“自动安全收紧”和“人工可见性保留”同时成立，避免因为安全策略把调查入口也一并封死。

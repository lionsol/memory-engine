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

# Orphan Confidence Cleanup

## Goal

cleanup 目标是清理 `memory_confidence` 中无对应 `core.chunks` 的 stale confidence rows。

当前确认边界：

- 本阶段只做 `dry-run`。
- `dry-run` 不写 DB。
- `dry-run` 不删除 chunks。
- `dry-run` 不删除 memory files。
- `dry-run` 不修改 `memory_events`。
- `dry-run` 不修改 `memory_confidence`。
- 后续 `--apply` 必须单独实现、单独 review、单独提交。
- 执行 apply 前必须先备份 engine DB。

## Scope

orphan confidence 定义：

- `memory_confidence.chunk_id` 在 `core.chunks.id` 中找不到对应记录。

`dry-run` 仅生成诊断报告，用于回答：

- 当前 orphan confidence 总量是多少。
- 占全部 confidence 的比例是多少。
- orphan ids 的长度分布是什么。
- orphan 主要集中在哪些月份。
- 是否还能看到相关 event prefix。
- 如果未来执行 apply，哪些记录会成为删除候选。

## Dry-Run Output

`dry-run` 输出字段固定为：

- `would_delete_count`
- `orphan_confidence_count`
- `confidence_total_count`
- `chunks_total_count`
- `orphan_ratio`
- `id_length_distribution`
- `month_distribution`
- `event_prefix_seen_count`
- `sample_orphan_chunk_ids`
- `engine_db_path`
- `core_db_path`
- `generated_at`
- `mode`

字段语义：

- `mode`: 固定为 `dry-run`
- `would_delete_count`: 如果未来实现 `--apply`，本次会删除的 orphan confidence 行数
- `orphan_confidence_count`: 当前 orphan confidence 行数
- `confidence_total_count`: `memory_confidence` 总行数
- `chunks_total_count`: `core.chunks` 总行数
- `orphan_ratio`: `orphan_confidence_count / confidence_total_count`
- `id_length_distribution`: orphan `chunk_id` 长度分布
- `month_distribution`: orphan confidence 按 `last_confidence_update` 聚合的月份分布
- `event_prefix_seen_count`: orphan `chunk_id` 前 16 位仍能在 `memory_events.memory_id` 中看到的数量
- `sample_orphan_chunk_ids`: orphan 删除候选样本，仅用于诊断，不是 apply
- `engine_db_path`: engine DB 路径
- `core_db_path`: core DB 路径
- `generated_at`: 报告生成时间

## Safety Rules

`dry-run` 阶段禁止：

- `DELETE`
- `UPDATE`
- `INSERT`
- `DROP`
- `CREATE`
- `ALTER`
- `VACUUM`

本阶段也不引入：

- CLI 删除入口
- `--apply`
- 自动备份逻辑
- LLM / 网络调用
- DB schema 变更

## CLI

当前 dry-run CLI:

```bash
node bin/cleanup-orphan-confidence.js
```

支持参数：

- `--help`
- `--json`
- `--sample-limit <n>`
- `--engine-db <path>`
- `--core-db <path>`

支持环境变量：

- `ENGINE_DB_PATH`
- `CORE_DB_PATH`

拒绝参数：

- `--apply`
- `--delete`
- `--write-db`
- `--force`

报告输出：

- `tmp/memory-quality/orphan-confidence-cleanup-dry-run.md`
- `tmp/memory-quality/orphan-confidence-cleanup-dry-run.json`

## Apply Safety Protocol

`--apply` 目前仍未实现。下面的协议是后续实现约束，不是当前行为。

### Execution Gate

- 默认行为必须始终是 `dry-run`。
- 只有显式传入 `--apply` 才允许进入写 DB 路径。
- `--apply` 还必须同时传入二次确认参数：
  - `--confirm-delete-orphan-confidence`
- 如果只有 `--apply`，没有确认参数，必须拒绝执行。
- 拒绝信息必须明确提示：
  - 当前操作将写 DB。
  - 请先运行 dry-run。
  - 真实删除必须显式确认。

### Backup Requirement

- apply 前必须自动备份 engine DB。
- 建议备份路径：
  - `~/.openclaw/memory/memory-engine/backups/memory-engine-before-orphan-confidence-cleanup-<timestamp>.sqlite`
- 如果项目后续形成统一 backup 目录惯例，可以落到统一目录，但必须保持“cleanup 前、带时间戳、独立文件”。
- 备份必须先于任何 `DELETE` 执行。
- 备份失败必须直接中止 apply。
- 备份失败时不得进入 transaction 删除阶段。

### Deletion Boundary

- apply 允许删除的唯一目标：
  - `memory_confidence` 中 `chunk_id` 在 `core.chunks.id` 中找不到对应记录的 rows。
- orphan 定义必须仍然是：
  - `memory_confidence LEFT JOIN core.chunks ON core.chunks.id = memory_confidence.chunk_id`
  - 且 `core.chunks.id IS NULL`

严禁删除以下对象：

- `core.chunks`
- `memory_events`
- memory files
- LanceDB / vector data
- 任何 core DB table

### Preflight And Recompute

- apply 开始前必须重新计算一次 dry-run result。
- 不允许直接复用旧报告中的 `would_delete_count` 作为删除依据。
- 需要重新计算的最少字段：
  - `before orphan count`
  - `would_delete_count`
  - `confidence_total_count`

### Transaction Requirement

- apply 必须使用 transaction。
- transaction 内只允许执行针对 `memory_confidence` orphan rows 的删除。
- 不允许在 transaction 内附带 schema 变更。
- 不允许在 apply 中执行：
  - `DROP`
  - `CREATE`
  - `ALTER`
  - `VACUUM`

### Post-Apply Verification

- apply 完成后必须重新计算：
  - `remaining orphan count`
  - `deleted count`
  - `before count`
  - `after count`
- `deleted count` 应等于 precomputed `would_delete_count`。
- 如果 `deleted count` 与 precomputed `would_delete_count` 不一致，结果报告必须明确输出 warning。
- 即使出现 warning，也必须把 before/after count 和 backup path 完整写入报告，便于审计。

### Apply Report

后续 apply 报告必须同时输出 JSON 和 Markdown，并至少包含：

- `mode: apply`
- `backup path`
- `before orphan count`
- `deleted count`
- `remaining orphan count`
- `started_at`
- `finished_at`

建议同时补充：

- `engine_db_path`
- `core_db_path`
- `precomputed_would_delete_count`
- `warning`, 如果实际删除数和预计算不一致

### Operator Guidance

- apply 成功后，建议用户运行：
  - `node bin/memory-quality-eval.js --top 20`
- 该命令用于确认 orphan diagnostics 是否下降，并复核是否出现新的质量异常。

### Required Tests For Future Apply

`--apply` 后续实现前，必须先补测试覆盖：

- 无 `--confirm-delete-orphan-confidence` 时拒绝
- 备份失败时拒绝
- apply 只删除 orphan confidence
- apply 不删除 live confidence
- apply 不删除 `core.chunks`
- apply 不删除 `memory_events`
- transaction 生效
- apply report 包含 backup path 和 counts

### Current Status

- 当前版本仍然只有 `dry-run`。
- 当前 CLI 继续拒绝：
  - `--apply`
  - `--delete`
  - `--write-db`
  - `--force`
- 本文档只是下一步实现 `--apply` 的安全协议，不代表该功能已经存在。

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

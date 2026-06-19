# Memory Quality Eval MVP v4

## 目标

Memory Quality Eval MVP v4 是一个只读、确定性、可审计的 memory quality evaluator。

该 MVP 的职责是：

* 基于真实数据库 schema 读取 memory 相关数据。
* 生成稳定、可复现的评估结果。
* 输出面向人工审阅和后续实现的 diagnostics / report。

该 MVP 不负责修复、归档、改写或增强任何线上数据。

## 默认 CLI 与输出

默认 CLI：

```bash
node bin/memory-quality-eval.js
```

默认输出：

* `tmp/memory-quality/latest.md`
* `tmp/memory-quality/latest.json`

输出要求：

* `latest.md` 面向人工审阅，便于快速查看总体结果、分项统计、flags 与 diagnostics。
* `latest.json` 面向程序消费，保留可审计的原始统计、派生字段、分数、flags 与全局 diagnostics。
* 在相同输入下，输出必须稳定且可复现。

## MVP 边界

本 MVP 是只读评估器，不是修复器，也不是在线决策器。

明确禁止项：

* 不写 OpenClaw core DB
* 不写 memory-engine DB
* 不调用 LLM
* 不联网
* 不自动 archive
* 不自动 repair
* 不删除数据
* 不改 `memory_confidence`
* 不接入 autoRecall gate
* 不接入 LTR

额外边界：

* 不修改 `package.json`
* 不修改 DB schema
* 不在本 MVP 内实现 orphan confidence cleanup

## 数据源与真实 Schema

MVP 必须使用真实 schema，而不是临时映射表或理想化字段。

涉及的表：

* core DB: `chunks`
* engine DB: `memory_confidence`
* engine DB: `memory_events`

数据语义约束：

* `chunks` 是 memory 的主事实来源。
* `memory_confidence` 提供 engine 侧 confidence 相关状态。
* `memory_events` 提供事件历史统计来源。

## ID 与 Join 规则

`memory_events.memory_id` 不是完整 `chunks.id`，而是 16 位前缀。

因此 event stats 的关联规则必须固定为：

* 使用 `chunks.id.slice(0, 16)` 与 `memory_events.memory_id` 做 prefix join。

这条规则是 MVP v4 的硬约束：

* 不允许把 `memory_events.memory_id` 当成完整 chunk id 使用。
* 不允许依赖模糊推断或非确定性匹配。
* 所有 event stats 都必须通过该 prefix join 得出。

## Scope 默认值

默认 scope 名称为 `active-memory`。

该 scope 用于定义 MVP 默认评估对象范围。若后续扩展出更多 scope，本 MVP 仍以 `active-memory` 作为默认入口和默认输出语义。

## 路径族默认规则

默认路径族规则如下：

* `stats-history` path family 默认排除。
* `MEMORY.md` 归类为 `memory-root`。
* `memory-root` 默认纳入评估范围。

这意味着：

* 历史统计类路径默认不参与 active-memory 质量评分。
* `MEMORY.md` 不应因其文件名特殊而被默认排除。

## 评分与 Diagnostics 约束

MVP v4 区分：

* per-memory score / flag
* diagnostics-only 全局或旁路观察项

### orphan confidence

`orphan_confidence` 被视为 confirmed stale data。

但在 MVP v4 中，它的定位是：

* diagnostics-only
* 不进入 per-memory score

也就是说：

* 可以在报告中展示 orphan confidence 的数量、样本、风险说明。
* 不能把它直接并入单条 memory 的质量得分。
* 后续 cleanup orphan confidence 不属于本 MVP。

### chunks without confidence

`chunks_without_confidence` 可以进入 per-memory flag。

该项约束为：

* 可以作为单条 memory 的异常标记来源。
* 对应 hard cap 70。

这里的含义是：

* 若某条 memory 命中 `chunks_without_confidence` 相关条件，则其 per-memory score 可被封顶到 70。
* 该封顶规则属于 MVP v4 允许的 score-side 约束。

## 审计与确定性要求

该 MVP 必须满足以下工程属性：

* 只读：仅读取 core DB / engine DB / 本地文件输入，不向任一 DB 写回。
* 确定性：相同输入产生相同输出，不依赖 LLM、不依赖网络、不依赖人工交互。
* 可审计：报告中应能追溯关键统计的来源、join 规则、排除规则和 score/flag 判定依据。

最低审计要求包括：

* 明确记录使用的默认 scope：`active-memory`
* 明确记录默认排除的 path family：`stats-history`
* 明确记录 `MEMORY.md -> memory-root -> included`
* 明确记录 event stats 基于 `chunks.id.slice(0, 16)` 的 prefix join
* 明确区分 diagnostics-only 项与会进入 per-memory score/flag 的项

## 非目标

以下内容不属于 Memory Quality Eval MVP v4：

* orphan confidence cleanup
* 自动数据修复
* 自动归档决策执行
* confidence 回写
* recall gating
* LTR 接入
* 任何需要联网或调用外部模型的能力

## 结论

Memory Quality Eval MVP v4 的定位是一个保守、只读、确定性、可审计的评估基线。

它的核心价值不在于“自动处理问题”，而在于先用真实 schema、稳定 join 规则和明确边界，把 memory quality 的观测口径固定下来，作为后续实现与验证依据。

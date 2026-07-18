# Legacy Fallback Code Inventory

> **Status: Current audit contract**

## Purpose

该 inventory 用于识别 Hybrid legacy fallback 的静态代码影响面，为 `F1-D-B8 Legacy Fallback Removal` 提供删除前静态证据。

权威实现：

```text
lib/recall/hybrid/legacy-fallback-code-inventory.js
bin/audit-legacy-fallback-code-inventory.js
```

inventory 只扫描仓库内允许的源码、测试、文档和配置文件。它不执行 Hybrid Search，不访问数据库，不修改配置，不删除 legacy fallback，也不自动授权代码删除。

## Counter Semantics

> Top-level inventory counters represent classified findings, not unique files, source files, test files, or test cases.

中文含义是：顶层 inventory 计数表示分类后的 finding 数量，不表示唯一文件数、源码文件数、测试文件数或测试用例数。

同一个文件可能产生多个 finding。同一代码行也可能因为多个 symbol 或不同 category 产生多个 finding。例如：

```js
const forbidden = [
  "withLegacyDb",
  "collectLegacyRecentCandidates",
];
```

可以产生两个独立 finding，但仍只是同一个测试文件中的一处 contract assertion。因此，`tests_requiring_legacy_fallback: 72` 不能解释为 72 个测试文件或测试用例。

## Finding Identity and Deduplication

finding 的逻辑唯一键为：

```text
category
path
line
symbol
match
```

只有上述字段全部相同，两个 finding 才视为重复并只计一次。因此同一路径不同 line、同一 line 不同 symbol、同一 symbol 不同 category，都分别计数；相同五字段只计一次。

## Top-Level Counter Derivation

所有顶层计数必须从 category finding 数组推导，不得独立维护。顶层计数是 finding 数量，不是 unique path 数量。

```text
legacy_query_definitions = recent_query_definitions.length + kg_query_definitions.length
legacy_query_call_sites = recent_query_call_sites.length + kg_query_call_sites.length
legacy_db_entrypoints = legacy_db_entrypoints category length
config_modes_referencing_legacy_fallback = runtime_mode_references.length
tests_requiring_legacy_fallback = tests_requiring_legacy_fallback category length
docs_requiring_legacy_fallback = docs_requiring_legacy_fallback category length
known_dynamic_references = dynamic_or_ambiguous_references.length
```

需要 unique file 数量时，应对对应 category 的 `path` 字段另行去重，不能直接使用顶层计数。

## Category Model

### Executable Categories

以下 category 表示生产路径中可能执行或控制 legacy fallback：

```text
recent_query_definitions
recent_query_call_sites
kg_query_definitions
kg_query_call_sites
legacy_db_entrypoints
runtime_mode_references
```

这些 finding 用于规划实际删除影响面。

### Non-Executable Categories

以下 category 会被记录，但不代表可执行 fallback：

```text
observation_only_references
metrics_only_references
tests_forbidding_legacy_dependencies
docs_historical_only
```

它们主要用于保持 telemetry 兼容、识别 Console metrics、防止 contract-test 假阳性和记录历史迁移文档。

### Ambiguous Categories

```text
dynamic_or_ambiguous_references
```

表示 inventory 已发现引用，但无法仅通过静态词法分析确认目标。这些 finding 会阻塞 removal gate，直到完成解释、消除或显式治理。

## Definitions and Call Sites

query definition 与 query call site 必须分别统计，定义行不能重复计为 call site：

```js
async function collectLegacyRecentCandidates(ctx) {
  // executable definition
}

return collectLegacyRecentCandidates(ctx); // call site
```

前者属于 `recent_query_definition`，后者属于 `recent_query_call_site`。KG query 使用相同的定义与调用区分。

## Legacy DB Entrypoints

生产代码中的以下行为应分类为 `legacy_db_entrypoint`：

```text
withLegacyDb
withLegacyDb: withDb
createIsolatedHybridDbAccessScope({ withLegacyDb })
Hybrid runtime 对 legacy combined DB accessor 的注入与消费
```

测试 fixture 中模拟的 `withLegacyDb` 不属于生产 DB entrypoint。

## Runtime Mode References

生产配置或执行分支中的以下引用属于 `runtime_mode_reference`：

```text
legacy_fallback
KG_FAIL_CLOSED_DEFAULT_MODE
RECENT_FAIL_CLOSED_DEFAULT_MODE
kgFailClosedMode
kgFailClosedCanary
recentFailClosedMode
recentFailClosedCanary
```

仅用于 observation、metrics、audit report 解析或历史兼容的引用，不计入 runtime mode reference。

## Observation and Metrics References

`observation_only_references` 和 `metrics_only_references` 不代表 fallback 会被执行。例如：

```js
debug.kg_access_mode === "legacy_fallback"
```

若该引用仅用于生成 observation channel 或统计指标，应分类为 observation/metrics finding，而不是 executable runtime dependency。这些引用在删除 legacy fallback 后可能仍需暂时保留，用于读取历史 observation。

## Test Classification

### Tests Requiring Legacy Fallback

`tests_requiring_legacy_fallback` 表示测试实际构造 `legacy_fallback` mode、执行 fallback 路径、断言 fallback 被调用、断言 runtime mode 为 legacy，或使用 legacy DB accessor fixture 验证行为。

### Tests Forbidding Legacy Dependencies

`tests_forbidding_legacy_dependencies` 表示测试只把以下字符串作为 forbidden dependency：

```text
withLegacyDb
collectLegacyRecentCandidates
legacy_fallback
```

例如：

```js
assert.doesNotMatch(
  source,
  /withLegacyDb|collectLegacyRecentCandidates/,
);
```

这种引用不能计入 `tests_requiring_legacy_fallback`，否则会产生 contract-test 假阳性。

## Documentation Classification

文档引用分为：

```text
docs_requiring_legacy_fallback
docs_historical_only
```

仍在指导用户配置 legacy fallback、启用 legacy mode、依赖 legacy DB accessor，或把 fallback 作为当前操作流程一部分的文档，属于 `docs_requiring_legacy_fallback`。

迁移历史、已完成阶段记录、deprecated path、旧版本说明、已删除行为的审计记录，以及 removal plan 或 devlog，属于 `docs_historical_only`。Historical documentation 不应阻塞代码删除。

## Dynamic and Ambiguous References

以下情况不得静默忽略：computed property access、动态 config key、template string 生成 mode、动态 import、无法确认 caller 的 dependency injection、无法确认 `withDb` 指向哪个 DB accessor，或 source parse failure 后无法可靠分类。

这些 finding 应进入 `dynamic_or_ambiguous_references`，并计入 `known_dynamic_references`。

## Inventory Completeness

`inventory_complete = true` 只表示：

- repository root 已确认；
- 允许范围文件已完成扫描；
- 没有 read/parse error；
- 没有意外跳过的源码文件；
- 所有匹配均已分类；
- 所有 ambiguous finding 均已显式记录。

它不表示 legacy fallback 已删除、runtime 已不依赖 fallback、removal gate 已通过、query definition/call site 数量为零，或 `known_dynamic_references` 必须为零。以下组合是合法的：

```text
inventory_complete = true
known_dynamic_references > 0
```

含义是 inventory 已完整发现动态引用，但动态引用仍未解决，因此代码删除会被阻塞。

## Skipped Files

预期排除范围包括：

```text
.git/
node_modules/
reports/
coverage/
dist/
build/
tmp/
*.sqlite
*.sqlite-wal
*.sqlite-shm
*.jsonl
generated runtime reports
```

预期排除不会令 `inventory_complete = false`。以下情况才会导致 incomplete：允许范围源码读取失败、parse error、扫描中断、repository root 非法、未知源码文件被意外跳过，或 finding 命中但无法进入任何 category。

## Deterministic Output

为保证报告可比较：

- 输入文件按 path 排序；
- category findings 按 path、line、symbol、category、match 排序；
- skipped files 排序；
- parse errors 排序；
- 顶层计数由排序后的 category 数组推导。

除 `generated_at` 外，同一代码树应产生稳定结果。

## Removal Gate Integration

B8-A removal gate 对静态 inventory 的关键要求是：

```text
inventory_complete === true
known_dynamic_references === 0
```

其他计数主要用于描述删除影响面、规划 B8-B 删除步骤、定位残留 runtime/config/test dependencies、比较删除前后 inventory，以及验证 query、call site 和 DB entrypoint 是否逐步归零。高计数本身不直接构成 blocker；例如 `legacy_query_call_sites = 10` 说明当前仍有 10 个分类后的 call-site findings，但不表示 inventory 不完整。

真正进入代码删除阶段前，removal gate 还必须同时满足：full fail-closed rollout 已完成、production evidence window 达标、KG/Recent fallback event 为零、replacement rollback strategy 已测试，以及没有 observation/schema blocker。

## Current Snapshot

当前曾生成的 inventory 快照为：

```text
legacy_query_definitions: 4
legacy_query_call_sites: 10
legacy_db_entrypoints: 16
config_modes_referencing_legacy_fallback: 48
tests_requiring_legacy_fallback: 72
docs_requiring_legacy_fallback: 0
known_dynamic_references: 0
inventory_complete: true
```

这些数字只是一份阶段性快照，不是永久 contract，也不得写入测试作为固定总数。源码发生变化后，以以下 CLI 的最新输出为事实来源：

```bash
~/.local/node24/bin/node \
  bin/audit-legacy-fallback-code-inventory.js \
  --root /home/lionsol/.openclaw/workspace/plugins/memory-engine \
  --pretty
```

## Safety Boundary

该 inventory 及其 CLI：

- 不访问真实 DB；
- 不执行 SQL；
- 不调用 Hybrid Search；
- 不启动 OpenClaw；
- 不启动 Console；
- 不修改扫描文件；
- 不删除 legacy fallback；
- 不自动修改配置；
- 不自动执行 removal。

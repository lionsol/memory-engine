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
2026-05-27 03:30 CST 运行时应处理 2026-05-26 的场景，防止凌晨任务
误处理前两天数据。

workspace/scripts/session-checkpoint.js 已本地修复为 Asia/Shanghai business date，低耦合，不纳入 memory-engine CodeGraph。

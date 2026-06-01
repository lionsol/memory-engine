# Changelog

All notable changes to the OpenClaw Memory System.

---

## [v0.8.2] — 2026-06-01

### Added

- **DB 隔离** — memory-engine SQLite DB 从 OpenClaw 核心 DB 独立，不再混用
- **配置集中化** — settings 统一重构进 `lib/config/` 目录（defaults.js / helpers.js / runtime.js），采用 env > config > fallback 三层获取
- **指标系统**
  - retrieval diversity + reinforcement concentration 指标
  - recall 可观测性指标（miss rate, injection rate 等）
  - 统一 recall 事件源，所有召回路径使用相同采样点
- **文档** — architecture.txt / dataflow.txt / 参数调优指南 / devlog
- **测试覆盖率** — nightly episode targetDate 语义测试、config helpers/runtime 测试
- **Runtime helper** — `scripts/lib/memory-engine-config-runtime.js`，提供 `getSmartAddTimeZoneRuntime()` / `getMemoryEngineRuntimeConfig()`
- **P2 周报脚本** — `scripts/memory-weekly-stats.js`，每周采集 entropy / HHI / miss_rate，附速览趋势行

### Fixed

- **Episode 摘要幻觉** — session-checkpoint 三层防护：区分 smart-add(note) 与 DB raw_log(conversation)，无对话数据时跳过 LLM 生成
- **统计脚本重构** — memory-stats.js：废品回收率→记忆总览，抢救成功率→健康度，时区修复，触发分类简化
- **Session-checkpoint 兼容** — `require.main === module` guard + 导出测试函数

### Changed

- 版本号 1.0.0 → 0.8.2（package.json）

---

## [v1.7] — 2026-05-27

### Fixed

- **Daily episode / smart-add 日期计算时区错位** — `yesterdayDateStr()` 使用 UTC `setDate(getDate()-1)` 导致凌晨任务（03:30 CST = 前一日 19:30 UTC）误处理前两天数据。
  - 新增 `dateStrInTimeZone(offsetDays, timeZone)` 统一日期工具，按业务时区 Asia/Shanghai 计算自然日，使用 UTC Date 执行纯日历偏移
  - session-checkpoint / smart-add daily 路径已切换到该工具
  - 新增测试覆盖 2026-05-27 03:30 CST 运行时应处理 2026-05-26 的场景

### Changed

- 插件索引 sync-memory-index.js 已使用新的日期工具，确保 daily memory 索引路径正确

---

## [v1.6] — 2026-05-25

### Added

- **query-utils** — 新增 telemetry 质量指标模块
- **Console 指标服务增强** — 新增 Metrics 页面和更多 telemetry 端点

### Changed

- **autoRecall 优化** — 提升召回精度和自适应逻辑

---

## [v1.5] — 2026-05-24

### Added

- **autoRecall 自动注入** — 在 `before_prompt_build` hook 中注册混合检索，每轮回复前自动注入 topK 相关记忆。
  - 自适应跳过：问候、斜杠命令、短确认不检索
  - 记忆关键词强制检索（如「记得」「记忆」「之前」）
  - 默认关闭，配置 `autoRecall.enabled: true` 开启
- **Memory Console Lite V1** — 独立 Node.js 控制台，运行指标可视化：
  - 新增 `memory_events` 表，记录 autoRecall、候选、注入、创建、引用、强化、归档
  - Dashboard / Session Trace / Memory Inspector / Telemetry / Metrics 页面
  - API: `/api/sessions`, `/api/memories`, `/api/telemetry/*`, `/api/metrics/*`
  - 启动: `npm run console` → `http://localhost:8787/`
- **Task classifier** — `scripts/task-classifier.js`：根据输入关键词判断任务类型（coding 或 default）
- **Coding agent profile** — 新增 `coding` agent，使用 Codex runtime（`openai/gpt-5.5`）

### Fixed

- **插件不启动** — `openclaw.plugin.json` 缺少 `activation.onStartup: true`，gateway 只加载 7 个插件，memory-engine 不被启动
- **autoRecall 配置读不到** — 代码读 `api.config?.autoRecall`，实际插件配置在 `api.pluginConfig`，修正为兼容读取
- **Dashboard JSON 渲染** — `<script type="application/json">` 内 JSON 被 HTML escape 转成 `&quot;`，`JSON.parse()` 失败。新增 `jsonForScript()` 只转 `<>&` 不转引号
- **SQLite 数据库损坏** — `PRAGMA quick_check` 检测到 malformed，Console API 查询索引时崩溃。降级为无排序查询避免触发损坏路径
- **peer dependency 缺失** — `import from "openclaw/plugin-sdk/plugin-entry"` 找不到模块，需手动 symlink 到 `/usr/lib/node_modules/openclaw`

### Changed

- GitHub 仓库 `openclaw_memory` → `memory-engine`，filter-repo 清洗历史（109 → 19 文件）
- `auto-recall.js`：`shouldSkipAutoRecall` / `shouldForceAutoRecall` / `formatAutoRecallContext` 逻辑独立抽取

---

## [v1.4] — 2026-05-20

### Added

- **autoRouteCategory 规则引擎** — `smart_add` 入口新增实时分类路由。6 组正则规则自动识别身份信息、临时内容、偏好习惯、决策结论、配置密钥，无需等待夜间 cron。显式传 category 时尊重原值，不覆盖。

- **LanceDB 双引擎存储** — 在 `memory-confidence` 新增 LanceDB 向量数据库，与 SQLite 并行存储：
  - 写入：`add` 时异步写 LanceDB（vector + text），不阻塞返回
  - 检索：Search 新增 Channel 1b (LanceDB 向量召回)，与 OpenClaw Manager、FTS5、KG 组成 4 通道 RRF 融合
  - 初始化：插件启动时异步 init，fire-and-forget 不阻塞启动

- **迁移脚本** — `scripts/migrate-to-lancedb.js`：从 SQLite 读取所有未归档 chunks，写入 LanceDB。

- **LanceDB 端到端测试** — `scripts/e2e-lancedb-test.js`：验证 autoRouteCategory → generateEmbedding → LanceDB 写入/查询 → RRF 融合全链路。

### Changed

- **session-checkpoint.js** — 夜间检查点升级为 Unified Nightly Smart Extraction：
  - 3 个独立 LLM 调用 → 合并为 1 次 LLM 调用
  - 4 类输出：smart_memories(6类) + episode_summary + configs
  - FTS5 去重检测（`isDuplicate`），避免重复写入
  - 写入全部 6 种 category，含 confidence 记录
  - 保留原有冲突标记逻辑

- **Embedding 维度修正** — LanceDB schema 使用 2560 维（Qwen3-Embedding-4B 实际输出），修正之前误用的 1024 维。

### Fixed

- **session-checkpoint cron 超时** — 从默认超时 → 120s，避免 SiliconFlow LLM 请求被 SIGTERM。

---

## [v1.3] — 2026-05-18

### Added

- **Plugin contracts declarations** — `plugins/memory-engine/index.js` now declares `contracts: { tools: true }`; `openclaw.plugin.json` declares tool names `["memory_engine", "image_vision"]` for proper OpenClaw plugin registration.

- **image_vision tool** — New `image_vision` agent tool registered in memory-engine plugin. Calls `Qwen3-VL-32B-Instruct` via SiliconFlow for image recognition. Supports custom questions; defaults to detailed Chinese description.

- **session-checkpoint.js** — New daily checkpoint script (`scripts/session-checkpoint.js`):
  - Reads raw_log from DB and extracts configuration patterns using SiliconFlow LLM
  - Writes extracted configs as `preference` memories (conf=0.80, tau=90 days)
  - Generates daily episode summary for warm-start injection
  - Auto-marks config conflicts: same-key configs keep the newest, set old ones to `conflict_flag=1`
  - Cron: daily at 03:55 CST (isolated session)

- **detectConfig() auto-promotion** — `smart_add` now detects configuration keywords (API keys, voice IDs, model names, file paths, Chinese config patterns) and auto-promotes `raw_log` → `preference` category.

- **Memory Prompt Supplement** — `registerMemoryPromptSupplement` dynamically injects yesterday's episode + protected memory list into session startup context for warm-start recall.

- **Conflict auto-resolution** — Session-checkpoint includes `autoResolveConfigConflicts()` step that scans all `preference` entries, groups by config key, retains the newest, marks old ones `conflict_flag=1`.

### Changed

- **Memory Engine Nightly Maintenance** cron job timeout increased from 120s → 300s to prevent model-call timeout at 2 AM.
- **Nightly maintenance message** streamlined — direct step-by-step tool calls without intermediate reporting.

### Fixed

- **Nightly maintenance timeout** — Previously timed out at 120s (120.7s actual). Tool execution was completing but the model response phase just barely exceeded the limit.

---

## [v1.2] — 2026-05-16

### Added

- **FTS5 parallel recall** — BM25 full-text search via OpenClaw native `chunks_fts` virtual table. Precise keyword matching for proper nouns, API names, code identifiers.
- **RRF three-channel fusion** — Parallel search across Vector (30 candidates) + FTS5 (20) + KG Concept Bridge (15). Results fused via Reciprocal Rank Fusion (k=60).
- **Episodic Memory layer** — New `episodic` category (conf=0.70, τ=30 days). `summarize` command aggregates raw_log into LLM summaries (keyword fallback). `kg_data` stores `episode_of` links to source chunks. `drill` command for original text expansion. Time-intent words auto-weight +0.1 in RRF.
- **KG Concept Bridge channel** — Knowledge Graph concept names → FTS5 → chunk mapping. Enables concept-driven recall.
- **episodic + kg_node categories** in category routing table.

### Changed

- Search pipeline: single-channel (v1.0) → dual (v1.1) → **triple (v1.2)**.
- RRF short-channel padding (<5 items, unranked items get rank=k+100).
- Weak citation cold-start transition logic.

---

## [v1.1] — 2026-05-15

### Added

- `memory_confidence` parallel table in SQLite.
- Category-based confidence routing: initial confidence + base tau per category.
- Hybrid search (vector similarity + confidence weighting).
- `smart_add` file → reindex → confidence workflow.
- `update --hit` for citation reinforcement.
- `archive` for low-confidence chunk archival.
- `diagnose` for tracking untracked chunks.
- `status` for summary statistics.
- Embedding via `Qwen/Qwen3-Embedding-4B` (SiliconFlow).

---

## [v1.0] — 2026-05-10

### Initial Implementation

- Schema migration with confidence, lifecycle, and status columns on `chunks` table.
- Smart add gateway with category routing.
- Hybrid search with dynamic threshold gating + exponential decay + weighted scoring.
- Update hook for citation reinforcement (hit+1, conf+0.1).
- Pure heartbeat compaction (zero-write to active confidence).
- KG bridge with subgraph packing (`kg_data` column).
- Diagnostic logging and parameter tuning guidance.

# OpenClaw 记忆系统契约 vs memory-engine 兼容性分析

> 调研日期：2026-06-22
> 范围：锁定 OpenClaw 自带记忆系统的工作机制契约（memory slot / 工具 / 配置 / 运行路径），映射到 memory-engine 当前实现，输出「必须改 / 建议改 / 暂不改」兼容项。
> 证据来源：
>
> - OpenClaw 运行时源码：`~/.local/lib/node_modules/openclaw/dist/`
> - memory-engine 源码：`~/.openclaw/workspace/plugins/memory-engine/`
> - 运行配置：`~/.openclaw/openclaw.json`

---

## 一、OpenClaw 自带记忆系统工作机制（契约锁定）

### 1.1 三个内置记忆插件，分工明确

| 插件 | `kind` | 注册工具 | 职责 |
| --- | --- | --- | --- |
| **memory-core** | `"memory"` | `memory_get`, `memory_search` | `plugins.slots.memory` 的默认实现。slot 为空或等于 `"memory-core"` 即生效（`loader-CUGwG1IR.js:530`） |
| **active-memory** | （编排器，非记忆插件） | 不注册工具，**派生子代理**调用上面的工具 | 召回编排。默认 `toolsAllow=["memory_search","memory_get"]`；当 `slots.memory="memory-lancedb"` 时自动切换为 `["memory_recall"]`（`active-memory/index.js:54-55, 231-236`） |
| **memory-wiki** | （语料） | wiki 维护 skills | 提供 `corpus=wiki` 补充语料 |

### 1.2 memory-core 的存储契约（与 memory-engine 强相关）

- **工具索引的文件根**：`MEMORY.md` + `memory/*.md`（workspace 下，`manager-DSlpKV0A.js:333, 1674`）
- **DB 位置**：嵌入在 **agent core DB 内**（`~/.openclaw/memory/main.sqlite`），使用 `memory_index_sources` / `memory_index_chunks` / `memory_index_chunks_vec`（sqlite-vec）等表，通过 `memory_reindex` schema 做影子重建（`manager-DSlpKV0A.js:602-680`）
- **检索 API**：`getMemorySearchManager`（`plugin-sdk/memory-core-engine-runtime`）—— 这正是 memory-engine 复用的桥

### 1.3 slot 契约（`runtime-schema-BMjFjwwY.js:801-803`）

- **`plugins.slots.memory`**：选记忆插件 by id，`"none"` 关闭。
  - 匹配条件：**插件 `kind` 必须含 `"memory"`**（`loader-CUGwG1IR.js:547, 1879-1882`）。
  - 不匹配会丢出诊断：`memory slot plugin not found or not marked as memory: <id>`（`loader-CUGwG1IR.js:2296-2298`）。
- **`plugins.slots.contextEngine`**：选上下文引擎 by id。
  - 合法值含 `"legacy"`（默认/兜底，`context-engine-lifecycle-jL8pUpkL.js:567`）。
  - **该 slot 不认 `kind`，要求插件通过专门 registry 注册**（`registry-D6EXS38s.js` 的 `resolveContextEngine` / `getContextEngineFactory`）。

### 1.4 工具命名空间契约（`tool-catalog-CJ8FQUeU.js:197-206`）

内置工具表只认 `memory_search` / `memory_get` / `memory_recall`。active-memory 子代理、`tools.deny`、profiles 全部按这些名字寻址。

---

## 二、memory-engine 当前实现的关键契约点

证据：`memory-engine/openclaw.plugin.json` + `index.js` + `memory-manager-runtime.js` + `lib/db/engine-db.js`

| 维度 | 当前实现 |
| --- | --- |
| 工具注册 | **`memory_engine`**（单一工具，内部 `action` 路由 add / search / cite / update / status / archive / detect-conflicts） |
| `kind` 字段 | **缺失** |
| `contracts.tools` | `["memory_engine"]` |
| slot 占用 | **不占任何 slot**（既不声明 memory kind，也没进 contextEngine registry） |
| 存储 DB | 独立 `~/.openclaw/memory/memory-engine/memory-engine.sqlite`，通过 `ATTACH ... AS core` 只读挂载 `main.sqlite`（`engine-db.js:21`），写 guard 拦截 `core.*` 写入 |
| 向量库 | 独立 LanceDB `~/.openclaw/memory/lancedb` |
| 召回注入 | `before_prompt_build` 钩子 + `api.registerMemoryPromptSupplement`（autoRecall，当前 `enabled:false`） |
| 引用强化 | `before_agent_finalize` 钩子，解析 `cited_memory_ids` → `batchReinforce` |
| 对 memory-core 的依赖 | **硬依赖**：`hybrid-search.js:89` 与 `index.js:2` 均 `import getMemorySearchManager from "openclaw/plugin-sdk/memory-core-engine-runtime"`，召回时复用 memory-core 索引做 lexical 通道 |

**定位结论**：memory-engine 是 memory-core 之上的**增强层**（置信度生命周期 + 混合检索重排 + 引用强化），不是替代品。`memory-core` 继续作为 substrate；memory-engine 只暴露自己的增强工具，不占用 OpenClaw memory slot。

补充：

- 对 agent 暴露的窄包装工具应使用 `memory_engine_search` 与 `memory_engine_get`。
- 这两个工具是对现有 hybrid-search / memory read path 的薄包装，不注册标准名 `memory_search` / `memory_get`，避免 shadow OpenClaw 自带 memory namespace。
- `active-memory` 与 memory-engine `autoRecall` 不应同时启用，除非显式做结果去重，否则同一查询可能被双重注入。

---

## 三、契约映射与冲突

| 契约点 | OpenClaw 期望 | memory-engine 现状 | 冲突 / 缺口 |
| --- | --- | --- | --- |
| 工具命名 | `memory_search` / `memory_get`（active-memory 子代理按此寻址） | `memory_engine` | **命名不兼容** —— active-memory 子代理永远调不到 memory-engine |
| memory `kind` | slot 插件需 `kind:"memory"` | 无 kind | 无法被选为 `slots.memory` |
| `tools.deny` | 命中 `memory_search`/`memory_get`（当前配置） | 注册的是别的工具 | deny 命中了**错误的工具** —— 拦掉了 memory-core，却没拦 memory-engine |
| `slots.contextEngine="legacy"` | `"legacy"` 是合法兜底值 | memory-engine 未注册为 contextEngine | slot 指向 legacy，与 memory-engine **完全无关**，配置意图落空 |
| DB 写隔离 | core DB 写受保护 | `ATTACH AS core` + write guard | **符合**契约（AGENTS.md 已固化此不变量） |
| 复用 memory-core | `getMemorySearchManager` 是公开 SDK | 已正确复用 | **符合** |
| prompt supplement | `registerMemoryPromptSupplement` 公开 API | 已用 | **符合** |

---

## 四、兼容项清单

### 🔴 必须改（破坏性 / 配置意图与实际行为背离）

#### 1. `tools.deny` 指错了对象

当前配置 `deny: ["memory_search","memory_get"]` 拦的是 **memory-core**（即 active-memory 子代理的默认工具），却完全没碰 memory-engine 的 `memory_engine`。

**实际后果**：内置召回链路被掐断，增强层照样跑 —— 与「用 memory-engine 取代默认记忆」的意图相反。

**决策点**（二选一）：

- **(a) memory-core 作为底座 + memory-engine 做增强**（推荐）：从 `tools.deny` 移除这两个工具，恢复内置召回。
- **(b) 确实想全量走 memory-engine**：见下一条，需补 `kind` 并接管 slot。

#### 2. memory-engine 拿不到 memory slot，永远是非首选记忆插件

`openclaw.plugin.json` 没有 `kind:"memory"`，因此 `plugins.slots.memory="memory-engine"` 会被 loader 判为 `not marked as memory` 而忽略。

若目标是让 memory-engine 成为唯一记忆来源：

1. **plugin.json 加 `kind:"memory"`**。
2. ⚠️ 一旦它独占 memory slot，active-memory 子代理默认仍只认 `memory_search`/`memory_get`，需同步设 `active-memory.config.toolsAllow=["memory_engine"]`，否则子代理会报 `No callable tools remain`。

### 🟡 建议改（提升一致性 / 可观测性，不阻塞运行）

#### 3. 工具命名收敛或显式别名

memory-engine 的 `memory_engine search` 与 memory-core 的 `memory_search` 语义重叠却不同名，agent 提示里得教两套。两条路径：

- 在 plugin.json `contracts.tools` 里同时声明 `memory_search`（提供兼容入口转发到 hybrid-search），或
- 在 supplement 里写清「本环境记忆工具是 `memory_engine`」。

当前 supplement 已做后者（`index.js:491-498`），可接受但脆弱。

#### 4. `slots.contextEngine="legacy"` 是死配置

memory-engine 没注册 contextEngine，这个值实际等同于「不设」。

- 若原意是想让 memory-engine 接管上下文编排 → 需走 contextEngine registry（`registry-D6EXS38s.js` 的 `getContextEngineFactory`）注册一个 engine，这是另一条较大的改造线。
- 若只是历史遗留 → 建议清掉避免误读。

#### 5. autoRecall 与 active-memory 双轨召回会重复注入

memory-engine 的 `before_prompt_build`（autoRecall，现 disabled）与 active-memory 的阻塞子代理是**两条独立召回路径**。若未来同时开启，同一查询可能注入两份记忆。

建议：开启 autoRecall 前先确认 active-memory 对目标 agent 已关，或在 supplement 里做去重。**当前 disabled 是安全的。**

### 🟢 暂不改（已符合契约或属于设计边界）

#### 6. DB 隔离（core 只读 + engine 独立库）

符合 OpenClaw 对第三方记忆插件的隐含约束，AGENTS.md 已固化为不变量，保持现状。

#### 7. 复用 `getMemorySearchManager` 做 lexical 通道

这是正确做法，让 memory-engine 能检索 memory-core 索引到的 `MEMORY.md` / `memory/*.md`，无需重建索引。保留。

#### 8. LanceDB 独立路径 `~/.openclaw/memory/lancedb`

与 memory-core 的 sqlite-vec 互不干扰，双轨向量存储可接受。

#### 9. `registerMemoryPromptSupplement` 引导 cite

用的是公开 SDK 契约，合规。

#### 10. `activation.onStartup:true`

memory-core 是 `false`（按需激活），memory-engine 设 `true` 用于启动建表，合理。

---

## 五、结论与速查

**一句话结论**：memory-engine 当前是 **memory-core 的增强旁路**而非 slot 内的合法竞争者 —— 它的工具名、kind、slot 注册都没对齐 OpenClaw 契约，所以 `tools.deny` 和 `slots.contextEngine` 这两个配置**实际上都没作用于它**。

**必须改**只有两项：

| # | 项 | 动作 |
| --- | --- | --- |
| 1 | `tools.deny` 指错对象 | 移除 `memory_search`/`memory_get`（保留底座），或确认走方案 (b) |
| 2 | 缺 `kind:"memory"` | 若要进 slot 则补；并同步 `active-memory.toolsAllow` |

其余为收敛性与防重复注入的改进。

### 速查表：当前配置实际效果

| 配置项 | 当前值 | 实际作用于 | 是否符合意图 |
| --- | --- | --- | --- |
| `tools.deny` | `["memory_search","memory_get"]` | memory-core（拦掉内置召回） | ❌ 想拦的是 memory-engine 却没拦到 |
| `plugins.slots.memory` | 未设 | 默认走 memory-core | ✅ 但 memory-engine 因此是旁路 |
| `plugins.slots.contextEngine` | `"legacy"` | 兜底，等于不设 | ❌ 与 memory-engine 无关 |
| `plugins.entries.memory-engine.enabled` | `true` | memory-engine 插件加载 | ✅ |
| `plugins.entries.memory-engine.config.autoRecall.enabled` | `false` | autoRecall 钩子不跑 | ✅ 暂安全 |

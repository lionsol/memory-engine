

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

## (2026-05-28) Bug Fix

- 修复 LanceDB 主路径 embedding 阶段因为 SiliconFlow API key 在 definePluginEntry bundle 上下文不可读而被跳过的问题
- resolveSFKey 优先从 api.config 获取 key，保证 generateEmbeddingRuntime 在 runtime bundle 中可用
- 完整透传 vector debug 字段：vector_backend_attempted、vector_stage、vector_error
- 保持 autoRecall 回退和 FTS/recent fallback 逻辑不变
- 测试覆盖 key 注入、fallback、embedding 失败及 metadata 安全性
2026-05-27 03:30 CST 运行时应处理 2026-05-26 的场景，防止凌晨任务
误处理前两天数据。

workspace/scripts/session-checkpoint.js 已本地修复为 Asia/Shanghai business date，低耦合，不纳入 memory-engine CodeGraph。

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

### 配置中心化

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

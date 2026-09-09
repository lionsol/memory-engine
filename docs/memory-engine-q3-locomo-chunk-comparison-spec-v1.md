# Q3 LoCoMo Canonical Chunk 对照实验规格 v1

日期：2026-09-09
状态：`FROZEN_SPEC / NOT_AUTHORIZED / NOT_EXECUTED`
范围：仅冻结离线 control/rerank 对照口径；本文件不授权 provider、retrieval 或生产运行。

## 1. 目的与比较边界

本实验只回答一个局部问题：在同一批 canonical chunk 候选、同一文本投影和同一 top3 chunk 预算下，独立 rerank 相对于同 profile control 是否改变 LoCoMo evidence coverage。

control 与 rerank 的候选池、候选顺序、canonical 有效性检查、文本投影、query、top3 预算和评分人口必须完全相同。历史 session-level Q1 分数不复用，也不把 session/chunk 的指标差异直接解释为架构收益。

本实验不修改 production runtime、hybridSearch、public result、gold 或 scorer 的既有 Q1 语义；不运行 retrieval，不读取 live Core/Engine/LanceDB。

## 2. 固定评分人口

人口来源为离线对齐报告中的 `new_frozen_material.scoreable === true`，共 1970 个案例：

- `common_scoreable`：1969；
- `new_only_scoreable`：1；
- 不因旧 Q1 结果缺失而排除 `new_only_scoreable`；
- `old_only_scoreable`：3 和 `both_unknown`：13 只进入完整人口审计及历史对齐，不进入 chunk control/rerank 主分母。

三种用途固定分开：

| 用途 | 固定人口 | 说明 |
| --- | ---: | --- |
| chunk control ↔ rerank 主比较 | 1970 | 新材料可评分人口，唯一主比较分母 |
| 与历史 session 结果对齐 | 1969 | 仅共同可评分案例，描述性桥接 |
| 完整人口审计 | 1986 | 保留四类人口及逐案例原因 |

人口在运行前从冻结 manifest 生成一次。运行中的 selection unknown、provider fallback 或响应失败不得改变 1970 人口；不得删除案例、缩小分母或把 unknown 转为 miss/零分。

若某一臂出现 selection unknown，该臂必须报告固定人口 1970、unknown 案例数、逐案例原因，并将该臂标为证据不完整。不得以“只统计另一臂可评分案例”的方式修复对照；任何已知案例子集上的诊断值必须明确标为非主结果。

## 3. 冻结输入与隔离路径

### 3.1 输入材料

使用以下持久材料，并在执行前逐项验证 SHA256；不得从 live 存储重建：

- 官方 LoCoMo：`/home/lionsol/.openclaw/workspace/q3-locomo-v1.2/material/locomo10.json`，SHA256：`79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4`；
- canonical chunk 材料目录：`/home/lionsol/.openclaw/workspace/q3-locomo-v1.2/material/canonical-chunk-v1/`，以其中 `manifest.json` 和 `SHA256SUMS` 为身份锚；
- 人口对齐 manifest：`/home/lionsol/.openclaw/workspace/q3-locomo-v1.2/reports/q3-locomo-chunk-population-alignment-v1.json`，SHA256：`e087c36547e7bd52e970594fb9ab096a0567e398050116876195f10e3633c149`；
- 旧 Q1 case rows：`/home/lionsol/.openclaw/workspace/q3-locomo-v1.2/material/locomo-lexical-case-rows.json`，只用于 1969 桥接和 1986 审计，不作为 chunk 候选输入。

执行所需文件应复制到持久实验目录后再使用。`/tmp` 只可用于临时工作副本，不能作为长任务唯一落盘位置。报告不得写入大量原始正文；内部请求材料与结果应与公开摘要分离并带完整哈希清单。

### 3.2 候选生成 profile 与离线索引

候选 profile 固定为 `q3_locomo_chunk_fts_only_v1`。它复用现有 Hybrid 的 FTS 查询、规范化、过滤和 fusion 实现语义，但不是旧 Q1 session 结果，也不是生产 runtime 的新默认值。

| 项 | 冻结值 |
| --- | --- |
| FTS | 开启；使用 `lib/recall/hybrid/channels/fts.js` 与 `fts-query.js` 的 strict query、bounded fallback 和 FTS probe 规则 |
| KG | 关闭；不读取或生成 `kg_data` |
| Recent family | 关闭；`like`、`recent`、`episode`、`recent_fallback` 均不参与 |
| vector | 关闭；`vectorQueryPlan = null`，不调用 embedding，不读取 LanceDB |
| FTS candidate limit | `ftsTopK = 50` |
| fusion | 单 FTS channel 的现有 `fuseChannels` 路径；`rrfK = 60`，稳定 tie order 保持不变 |
| confidence/filter | `effectiveMinConfidence = 0.15`；归档和有效性过滤使用冻结 canonical lifecycle，不临时放宽 |
| lexical gate | 记录 `lexicalConfidenceThreshold = 0.7`；因 vector 关闭，不产生 skip/enable 分支 |
| ranking clock | `materializationNowSec = searchNowSec = benchmarkNowSec = 1705066861`；禁止读取 wall clock |
| source identity | Hybrid/FTS source commit `aa2e65ffa2f04d991026d03bc97aebecce944412` |

离线索引固定为隔离 SQLite FTS5 快照：从冻结 `chunks.jsonl` 按原始 chunk ID、`source.path`、`source.text` 和记录时间构造 `chunks`/`chunks_fts`；查询 SQL 使用现有 `buildIsolatedFtsSql` 语义。每个 chunk 一行，使用完整 canonical text，不使用 240 字符 preview。只 materialize 评分所需的 archived/confidence 过滤字段；不构造 KG、Recent 或 vector 表，不下载或生成 embedding。

索引身份必须记录：输入 `chunks.jsonl` 哈希、行数、SQLite/FTS schema 哈希、FTS tokenizer/配置、生成器 source commit、固定时钟以及最终隔离 DB 哈希。所有哈希统一写入外部 `SHA256SUMS`，哈希文件自身不包含在自己的哈希条目中；manifest 内不写 self-hash 字段，也不采用会递归改变序列化内容的自哈希规则。

候选 manifest 必须在两个臂运行前一次性生成并冻结，之后两个臂读取同一份文件：

1. 对 1970 固定人口，在上述隔离 FTS 快照上运行一次 `q3_locomo_chunk_fts_only_v1`；不接触 live Core、Engine、LanceDB 或 session；
2. 取 fusion 后 `fusedSorted` 前 `candidateDepth = 50`，保持顺序及稳定 tie order；不得从第 51 名追加候选；
3. 每个候选必须是完整 canonical `memory_id`，并能在冻结 chunk 材料中解析到同一 chunk；不得把旧 session ID 直接填入 chunk ID，也不得做 session→chunk 临时包装；
4. 在 adapter 调用前执行该路径已有的可见性、归档和有效性检查。control 与 rerank 使用同一批有效 canonical 候选，并记录原始池、有效池、排除数量和原因；
5. gold/evidence 只在独立评分阶段读取，不参与候选生成、排序、截断、文本投影或 adapter 请求。

candidate manifest 至少包含：`question_id`、`sample_id`、`qa_index`、query 哈希、完整有序 candidate IDs、候选 profile/version、candidateDepth、有效性结果、材料 manifest 哈希、离线索引哈希和固定时钟。manifest 的 SHA256 放在外部 `SHA256SUMS`，不放入 manifest 自身。

当前冻结 chunk 材料目录尚未包含该 candidate manifest 或上述隔离 FTS 快照。因此本规格冻结了唯一候选 profile、通道、索引方案和输入契约，但执行前置条件仍未满足；不得用旧 Q1 session candidate rows 冒充该文件，也不得在本步骤生成或运行 retrieval。

## 4. 两个实验臂

### 4.1 共同参数

- `topK = 3`，单位为完整 chunk ID；
- `candidateDepth = 50`；
- `maxCodePointsPerCandidate = 8000`；
- `maxTotalCodePoints = 400000`；
- `deadlineMs = 2000`，仅为本离线实验的显式失败边界，不是 production SLA；
- query 使用官方 `qa.question` 原文，不加 prompt、不加 gold、不拼 session；
- model identity：`BAAI/bge-reranker-v2-m3`；provider/model 参数沿用既有冻结 rerank 参数，但新 chunk 文本必须重新请求，禁止复用 session-level 分数；
- request parameters：`top_n = 非空候选数`、`return_documents = false`、`max_chunks_per_doc = 1`、`overlap_tokens = 0`；
- provider 返回校验、index 映射、稳定排序和迟到响应处理遵循已验收 `relevance-reranker.js` 契约；不重试、不切模型、不切 endpoint。

### 4.2 control

使用同一有效 canonical 候选池，`executeRerank = false`，保持候选原顺序后取 top3。control 不调用 provider；它是同 profile 的无重排对照，不宣称等同于旧生产路径。

### 4.3 rerank

使用完全相同的有效 canonical 候选池和顺序，按 canonical text contract 投影后调用 adapter。成功时按有限分数降序、原顺序稳定并列；失败、超时、缺分、重复/越界 index 或落盘错误时整批回到同 profile control 顺序，所有 rerank scores 为 `null`，保留已返回 usage，迟到响应不得修改结果。

canonical 投影规则固定为：每个候选只取 `canonical.source.text`；按 Unicode code points 做头部截断；严格保留空文本，不拼接邻近 chunk、session 或 preview。总预算超限整批显式失败，不偷偷删除候选。

adapter 请求只发送非空文本；空文本候选保留原身份并置于排序尾部。若全为空或候选为空，不调用 provider，记录 bypass。

接口 fallback 与实验停止是两个层级：接口返回 control 顺序只用于调用方安全返回和保存诊断，不能把该案例标成成功 rerank。实验 runner 遇到 HTTP 错误、超时、响应不完整/非法、index/分数校验失败时，必须先保存原始请求身份、失败信息、fallback 诊断和 attempt，再停止整个 run；不得继续下一个案例，不得产生全量质量结论。落盘失败时不能用排序 fallback 恢复证据；若失败记录未确认持久化，当前请求及 run 结果均为 unknown，并立即停止。只有完整响应校验通过且相关产物成功落盘的案例才可记录为 rerank completed。

## 5. 评分契约

对两个臂分别调用 `locomo_canonical_chunk_evidence_v1`，只使用官方 evidence turn ID 和冻结 source offsets：

- `recall-any@3`：top3 chunk 的覆盖并集完整覆盖至少一条 evidence；
- `recall-all@3`：top3 chunk 的覆盖并集完整覆盖全部 evidence；
- `evidence-coverage@3`：完整覆盖 evidence 数 / evidence 总数；
- `completion-dcg@3`：未归一化诊断值，按前缀实际完成增量计算；
- `ndcg@3 = null`，原因固定为跨 chunk completion gain 不支持当前 IDCG 定义；
- budget feasibility 固定为 `unknown`；观察到的 top3 是否完整覆盖不能称为“存在任意 ≤3 chunk cover”。

同一 evidence 被多个重叠 chunk 覆盖时按 source offset 并集去重；partial 不计 full；unknown 单独记录，不转为 miss 或零分。control 与 rerank 逐案例 paired transition 只在两臂均有可解释结果时展示；selection unknown、材料 unknown、provider failure 和 fallback 分别列出，不能混为一个 miss 类别。

历史 1969 案例上的 session-level Q1 分数只可作为描述性桥接。它与 chunk 指标使用不同 evidence/unit，不进入 chunk control↔rerank 主差值，也不得复用旧请求分数。

## 6. 记录、成本与停止条件

每案例记录：人口身份、candidate manifest hash、完整有序候选 ID、有效/排除计数及原因、文本投影长度和截断 metadata、control/rerank 顺序、status/reason、有限分数或 null、usage、adapter identity、rerank elapsedMs、selection unknown、三项主指标、completion DCG 及材料/运行 unknown 原因。公开报告不得包含完整 canonical 正文。

成本上限按一次 rerank 请求/案例计算：

| 项目 | 计划上限 | 本步骤实际执行 |
| --- | ---: | ---: |
| availability probe | 0 | 0 |
| pre-sentinel | 0 | 0 |
| control provider calls | 0 | 0 |
| rerank provider calls（主运行） | 1970 | 0 |
| post-sentinel | 0 | 0 |
| 自动重试 | 0 | 0 |
| retrieval runs | 0 | 0 |
| provider calls 合计 | 1970 | 0 |

本实验明确不验证 provider availability 或前后 sentinel 稳定性；既有 session-level probe/sentinel 不作为 canonical chunk 稳定性证据。`1970` 是未来一次性主运行的请求上限，包含唯一的 rerank request，不包含任何隐藏 probe、sentinel 或 retry，也不是本文件授予的新增授权。provider stability 结论保持 unknown；若未来要验证，必须另行冻结请求身份、sentinel 人口和独立预算。

已有 provider budget `2523/2523` 已消耗。任何未来 provider 执行必须获得独立授权，且失败即停、未确认结果标记 unknown，不静默重发。

停止条件：候选 manifest 缺失或哈希不符、输入材料哈希不符、canonical 映射失败、投影/落盘失败、HTTP 错误、响应不完整、非法 index/分数、请求身份不一致，均停止，不自动修复或重试。

## 7. 交付与禁止结论

执行完成后才可产生：1970 固定人口上的 control/rerank paired transitions、三项 @3 指标、fallback/unknown 统计、请求及延迟统计和产物哈希。1969 session bridge 与 1986 人口审计单独报告。

本规格不允许：

- 运行 provider 或 retrieval；
- 把历史 session 分数复用到 canonical chunk；
- 把 `new_only_scoreable` 因旧结果缺失而排除；
- 选择性缩小主分母；
- 填充 NDCG 或预算 feasibility；
- 将 chunk 与 session 指标直接作架构收益归因；
- 修改生产 runtime、部署、tag 或 push。

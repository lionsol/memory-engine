# 普通 checkpoint：来源事实提取与发布门禁

日期：2026-10-24（Asia/Shanghai）。
基线：d6fec1c920c0e031db4c8df4d70a6dc9b684bb6b。
当前修复基线：2f6827527c0523622f3e390295831ca1fe36b1a2。
范围：普通摘要协议 v3 及离线测试；本次未新增模型调用、未部署或重写历史记录。
v1 的真实验证被 token 截断；v2 通过预算但复制全文，摘要质量仍 STOPPED；详见末尾。

## 问题与行为变化

10-20 样例的四条输入完整送入普通提取器，摘要仍遗漏三次健康检查，
并把不同日期的占位现象合并为同一根因。旧代码仅凭非空摘要及发布成功返回 valid_summary，
结构化记忆也可能在摘要内容检查前写入。

新路径为 buildFactInput → llmNightlyExtract → validateAndRenderFacts → 既有写入/发布。
来源数据以独立 JSON 消息发送，指令置于 system 消息；不再保留未替换的占位符，
也不再用 substring 静默截断或要求一段 300 字自由叙述。

## 协议与来源

普通提取器现在接收结构化输入对象，不再接收 combinedText 字符串。
注入的测试提取器也必须返回新协议；旧 episode_summary/smart_memories/configs 响应会被拒绝。

~~~json
{
  "protocol": "checkpoint-source-facts-v3",
  "target_date": "2026-10-20",
  "facts": [0, {"unit": 1, "span": [0, 1], "kind": "decision"}],
  "summary": ["f2"],
  "skipped": []
}
~~~

facts 的整数表示请求中全局零基 unit.index，完整选择该段原文。
对象 {unit:n,span:[a,b]} 选择该段 parts 数组中 a 至 b（含）的连续片段；
省略 span 则完整选择。parts 按标点和换行机械划分，保留 CRLF、空格及全部字符，
不保证语义独立。模型不计算字符偏移，也不回写 quote/source_ref。
v1/v2 响应不能复用于 v3 请求；旧协议、缺少 summary 或不认识的字段都会被拒绝。
每个来源按对话轮次和段落划分，
保留 entry ID、来源哈希、角色标记及原文 UTF-16 范围；来源元数据优先复用
收集器已有的私有证据，不改变普通 rawLogs 对象形状或持久身份规则。
没有来源 ID 时使用内容摘要作为本次证据定位信息，不生成新的持久身份。

覆盖由经过匹配的事实引用直接推导，不接受模型声明的 included/covered IDs。
只有明确的 heartbeat 控制标记，或同一来源、同一轮内完全相同的段落可以跳过。
OK、收到及问候也可能包含检查结果或确认，因此不自动归为噪声。
不同轮次的相同运行结果仍是不同观察。未覆盖任何一段均拒绝。
紧凑协议省略重复覆盖清单和空字段：事实 ID 默认为数组位置 f1、f2…，
kind 默认 report，其余时间、日期、纠正和因果字段有需要才填写。

程序检查段落编号及连续片段范围，再从绑定的原文提取引文和 UTF-16 偏移。
原文中重复出现的相同句子也通过片段位置精确定位，不依赖字符串唯一匹配。
可选时间、日期、因果引文及配置 key/value 必须来自选中引文；
类别、纠正引用及重复/噪声处置保留独立检查。
facts 是整批证据清单；summary 通过 fact ID 选择正文使用的摘录，两者不再混为一谈。
每个有事实的来源必须在正文有代表；有尚未被纠正的助手报告时，
至少选择助手记录或明确标注的 decision/correction，不能仅用用户检查请求代表运行结果。
事实正文按来源和原文位置排序，保留说话者归属，不进行第二次自由改写。

kind=correction 必须有 supersedes；已被纠正的事实不能进入正文，
未被后继覆盖的最终纠正必须进入正文。旧事实及纠正关系保留为证据定位。
元数据 evidence_columns 声明 [fact_id,source_id,start,end,supersedes] 的列含义，
evidence 保存整批引用，sources 保存 entry ID 和来源哈希；不复制全文到元数据。
原文继续保留在原始记录，不新增快照或 sidecar；若原始 entry 后来改变或消失，
定位元数据本身不能重建旧全文。纠正关联仍是模型标注，不是独立事实认证。
summary_unit_coverage_complete 单独说明正文是否逐段覆盖，不把证据覆盖冒充正文完整性。

## 写入与失败

整批事实及配置检查通过前，不允许本轮提取生成的 smart-add、confidence 或 episode 写入。
结构化记忆和配置从同一批已检查引文派生，排除明确被 supersedes 覆盖的旧事实，
保留来源归属；原有最多 10 条限制沿用。
episode 继续使用既有版本检查、合作锁和原子发布。

| 情况 | 普通提取结果 |
| --- | --- |
| 输入预算、格式或 Unicode 无法完整保留 | input_incomplete |
| 引文、覆盖、结构、范围等检查失败 | summary_invalid |
| 正文选择、来源代表、纠正关系或正文字符上限失败 | summary_invalid |
| provider 不可用 | summary_invalid / summary_llm_unavailable |
| 模型返回截断或输出超过上限 | summary_invalid / output_budget |
| 合格事实完成发布 | valid_summary，语义仍未独立验证 |

提取或事实校验失败时保留旧 episode；旧文件不存在时也不创建替代失败 marker。
这些失败发生时，本轮生成目录及 confidence 写入保持为零。
main 单独报告 ordinary_summary_validation 和 summary_input_complete；
输入预检失败不能同时宣称摘要输入完整。
成功 episode 的 ordinarySummary 元数据记录来源哈希、机械检查及语义未验证状态。

此门禁不是跨存储事务。Core ingress、Engine reconciliation、pending 恢复、
向量及冲突处理仍保留原有职责；既有 late source/episode conflict 可能发生于
结构化写入之后，此时 episode 受保护，但已经完成的结构化写入不会自动回滚。

## 预算和验证边界

沿用现有输入、max_tokens、超时与 provider 配置，不增加重试。
v3 新增摘要正文 3000 UTF-16 字符上限，计入标题、归属、引文和纠正说明；
超限拒绝整批响应，绝不截断。上限不含定位元数据或既有配置附节，也不是 provider token 预算。
输入上限现在计入 system 指令和序列化数据的字符总量；超过即停止。
普通 HTTP 输出字符上限为现有 max_tokens × 8，finish_reason=length 必须失败；
该字符上限不能替代 provider 的 token 上限。
仅传输失败沿用至多一次 fallback；无效 JSON、截断或无效事实不进行质量重试。

引用有效、段落覆盖完整不等于事实完整或推断正确。
单一段落中的短摘录仍可能遗漏该段其他信息，测试明确保留这一边界。
用户和助手记录均未由本补丁与原始 transcript 或外部事实重新核实。
semantic_quality 始终为 not_independently_verified，不能据此声称真实模型质量通过。

分段摘要协议未修改；历史错误摘要及派生记忆未自动清理。
v1 的真实 10-20 验证因输出预算失败，尚未进入完整语义验收。
v2 的真实调用完成，但结果是全文摘录，未通过摘要质量验收。
v3 尚未经过真实模型的自动选择质量验收；fake HTTP、程序构造候选与静态预算不能代替它。
模型若不标注纠正，或选择同一长来源中的错误重点，程序不能仅凭编号发现全部语义问题。

## 离线验证

回归采用脱敏合成样例和假 HTTP，不是原始模型输出重放。
覆盖三次检查、maintenance dry-run、daily stats、日期根因范围、纠正、
整批检查前零写入、源/目标版本冲突、并发发布及身份/pending 恢复。
三项旧集成测试的 Core 索引入口夹具缺失在基线可复现，
本次补齐明确的离线入口 stub；没有放宽产品 Core 门禁。

~~~bash
cd /home/lionsol/.devspace/worktrees/memory-engine-cff493d1
env MEMORY_ENGINE_TEST_DEPENDENCIES=/home/lionsol/.openclaw/extensions/memory-engine \
/home/lionsol/.local/node24/bin/node \
  --require ./test/checkpoint-dependency-loader.cjs --test --test-concurrency=2 \
  test/checkpoint-summary-view.test.cjs \
  test/checkpoint-fact-selections.test.cjs \
  test/checkpoint-ordinary-summary-facts.test.cjs \
  test/checkpoint-fact-publication.test.cjs \
  test/checkpoint-llm.test.js \
  test/checkpoint-ordinary-publication-guard.test.cjs \
  test/session-checkpoint.integration.test.js \
  test/session-flush-reconciliation.test.js
~~~

### e965365 首轮离线结果（历史）

- Node v24.19.0，六文件定向回归：133/133，通过；fail/cancelled/skipped/todo 均为 0。
- checkpoint 共享范围：32 文件、476 项，合并验证结果为 469 通过、4 跳过、3 基线失败。
  此为一次共享执行及新增夹具修正后定向复验的合并统计，并非夹具修正后重新整套运行：
  共享执行中新增短回复用例因换行转义失败，修正夹具后最终 133 项定向回归全部通过。
  三项失败均在未修改的 d6fec1c 基线同环境逐项复现：
  orphan runtime override 夹具未满足既有 Core ingress 前置条件；
  DB collector 旧夹具无预期行；legacy shim 测试在隔离 worktree 推导出不存在的路径。
  未修改这三处无关产品逻辑或测试来消除失败。
- 全仓测试尝试未取得通过：初次执行通道超时；
  随后 412 个实际测试文件的有界运行在 180 秒内未形成完整 TAP 结束报告。
  观察到 2871 个顶层结果及 46 个顶层失败条目，不能当作整套最终计数。
  其中 AML 子进程缺少 better-sqlite3 已在原基线单例复现；
  其他全仓失败没有在本轮逐项归因，不声称全部属于环境或全部已验证无回归。
- git diff --check 及变更入口/新模块语法检查通过。
- 真实源文件只读静态检查：SHA256
  9b119fdc8c72918cbdc97d2000200b6d14cf71fc3c9b75c0827b2c33e903dbf6；
  4 条来源、197 段；早期未带 provenance 的探测为 39998 字符，
  后续真实请求绑定完整元数据后为 40042 字符，低于 45000 上限。
  这只证明请求字符预算可容纳，不证明 4096 token 的真实输出能完整覆盖。
- 首轮离线结束后已提交 e965365，随后单次真实验证失败；没有部署，
  没有修订既有历史 episode、数据库、配置或调度。

全仓结果仍不合格；当前结论限于本次定向行为及已列明的共享测试范围。
真实模型验证与部署分别需要后续授权；本补丁及此文档不授权执行。

## 单次真实失败及 v2 修复

e965365 的授权请求只执行一次，无 fallback，HTTP 200，约 13.2 秒；
请求模型 deepseek-chat，响应 metadata 的模型字段为 deepseek-flash。
completion_tokens=4096、finish_reason=length，JSON 在第 50 条事实中截断。
前 49 条完整引文匹配原文，但输入要求覆盖 197 段，不能视为完整候选。
产品以 output_budget 拒绝输出，未发布；本次失败属于协议输出量导致的产品问题。
原始输出与复核记录位于 ops/memory-engine/
session-checkpoint-e965365-isolated-quality-once-20261024-evidence。

v2 用段落编号及连续 parts 范围取代模型逐字复写。
整批校验、来源归属、受限 skip、既有发布门禁、token/超时/请求次数配置均保留。
本轮没有新增重试、provider 切换或预算提升。

### v2 离线结果

- 七个文件定向回归：159/159 通过，fail/cancelled/skipped 均为 0，约 14.3 秒。
  覆盖数值编号、范围、重复原文位置、CRLF、配置范围、旧协议拒绝，
  以及非法编号/范围发生在末条时整批零派生写入；原有来源/目标冲突与并发发布回归通过。
- 固定 10-20 源 SHA256 未变（同上），4 来源、197 段、569 个机械片段。
  v2 system+数据 39158 字符；全部整段编号响应为 769 字符，
  等价完整回引文的 v1 响应为 31023 字符。此为程序构造的离线响应大小，
  不是实际模型输出，也不换算或保证 provider token 数量。
- 全选原文的渲染结果仍有 36636 字符；修复的是模型回传开销，
  不宣称已实现高质量压缩。片段选择仍可能遗漏同段限制或其他断言，
  semantic_quality 继续为 not_independently_verified。
- 组合执行最初未取得完整报告；拆分日志定位到假 HTTP 夹具仍检查旧 u.text，
  改为检查 parts 拼回的完整原文后，最终七文件一起执行通过。
- 本轮未重跑全仓；上面的全仓/共享范围历史失败不因此消除。
  v2 随后已提交 2f68275，并执行一次新的授权模型验证；未部署或修订历史记录。

## v2 真实结果与 v3 离线修复

v2 的单次请求 HTTP 200、约 3.5 秒、finish_reason=stop，completion_tokens=457。
197 段全部机械覆盖，192 个整数选择及 5 个分类标注；没有 span 或 supersedes。
三次健康检查、不同日期的原始差异和纠正文字都保留，但 24014 字符正文被渲染成
36640 字符摘录，未归纳当前状态。因此预算通过，摘要质量仍为 STOPPED。
候选及复核证据在 ops/memory-engine/
session-checkpoint-2f68275-isolated-quality-once-20261024-evidence。

v3 保留整批证据校验，新增显式 summary 选择、正文大小和来源代表检查，
仅将选中事实写入正文；明确纠正的旧事实也不再派生记忆或配置。
没有新增发布文件、数据库机制、配置项、provider 调用或部署步骤。

- 八文件定向回归：185/185 通过，fail/cancelled/skipped 均为 0，约 14.6 秒。
- 固定原文只读离线检查：4 来源、197 段，请求 system+数据 39605 字符。
  将 v2 的真实选择适配为 v3 并全选正文时，明确以 summary_budget 拒绝。
- 人工指定 7 条引用及一条纠正关系的离线构造结果：正文 1277 字符，
  定位元数据 6390 字符，保留 197 条证据定位；没有将原文移入元数据。
  此结果只说明表示与门禁可用，不证明模型会自动作出相同选择或摘要已完整。
- 原始 10-20 来源与既有 episode 的 SHA 均未变；v3 代码未提交。
  本轮未重跑全仓，历史全仓失败仍未消除；未增加模型调用或改动运行环境。
  两次单次调用授权均已消耗，本次离线结果不授权第三次调用。

# 普通 checkpoint：来源事实提取与发布门禁

日期：2026-10-24（Asia/Shanghai）。
基线：d6fec1c920c0e031db4c8df4d70a6dc9b684bb6b。
范围：普通摘要源码及离线测试；未部署、未调用真实模型，未执行真实 checkpoint 或重写历史记录。

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
  "protocol": "checkpoint-source-facts-v1",
  "target_date": "2026-10-20",
  "facts": [{"source_ref": "s0.t0.p0", "quote": "该段连续原文摘录"}],
  "skipped": []
}
~~~

source_ref 必须使用请求提供的 unit.id。每个来源按对话轮次和段落划分，
保留 entry ID、来源哈希、角色标记及原文 UTF-16 范围；来源元数据优先复用
收集器已有的私有证据，不改变普通 rawLogs 对象形状或持久身份规则。
没有来源 ID 时使用内容摘要作为本次证据定位信息，不生成新的持久身份。

覆盖由经过匹配的事实引用直接推导，不接受模型声明的 included/covered IDs。
只有明确的 heartbeat 控制标记，或同一来源、同一轮内完全相同的段落可以跳过。
OK、收到及问候也可能包含检查结果或确认，因此不自动归为噪声。
不同轮次的相同运行结果仍是不同观察。未覆盖任何一段均拒绝。
紧凑协议省略重复覆盖清单和空字段：事实 ID 默认为数组位置 f1、f2…，
kind 默认 report，其余时间、日期、纠正和因果字段有需要才填写。

每条 quote 必须在该段唯一、逐字、连续匹配。可选时间、日期、因果引文及配置 key/value
必须来自该 quote；类别、纠正引用及重复/噪声处置都有独立检查。
最终正文由程序按照来源顺序及原文位置排列摘录，保留说话者归属，
不再进行第二次自由改写，也不从收集时间推断全局事件时间。
纠正关联标为模型标注，且保留旧记录，不把关联本身当成独立事实认证。

## 写入与失败

整批事实及配置检查通过前，不允许本轮提取生成的 smart-add、confidence 或 episode 写入。
结构化记忆和配置从同一批已检查引文派生，保留来源归属；原有最多 10 条限制沿用。
episode 继续使用既有版本检查、合作锁和原子发布。

| 情况 | 普通提取结果 |
| --- | --- |
| 输入预算、格式或 Unicode 无法完整保留 | input_incomplete |
| 引文、覆盖、结构、范围等检查失败 | summary_invalid |
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
输入上限现在计入 system 指令和序列化数据的字符总量；超过即停止。
普通 HTTP 输出字符上限为现有 max_tokens × 8，finish_reason=length 必须失败；
该字符上限不能替代 provider 的 token 上限。
仅传输失败沿用至多一次 fallback；无效 JSON、截断或无效事实不进行质量重试。

引用有效、段落覆盖完整不等于事实完整或推断正确。
单一段落中的短摘录仍可能遗漏该段其他信息，测试明确保留这一边界。
用户和助手记录均未由本补丁与原始 transcript 或外部事实重新核实。
semantic_quality 始终为 not_independently_verified，不能据此声称真实模型质量通过。

分段摘要协议未修改；历史错误摘要及派生记忆未自动清理。
真实 10-20 样例的 provider 输出合规、4096 token 预算适配及人工逐项质量审阅仍待隔离验证，
不能以 fake HTTP、结构覆盖或静态请求大小代替该验收。

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
  test/checkpoint-ordinary-summary-facts.test.cjs \
  test/checkpoint-fact-publication.test.cjs \
  test/checkpoint-llm.test.js \
  test/checkpoint-ordinary-publication-guard.test.cjs \
  test/session-checkpoint.integration.test.js \
  test/session-flush-reconciliation.test.js
~~~

### 本轮结果

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
  4 条来源、197 段，当前 system+JSON 数据共 39998 UTF-16 字符，低于 45000 上限。
  这只证明请求字符预算可容纳，不证明 4096 token 的真实输出能完整覆盖。
- 代码位于隔离 worktree，尚未提交或部署。未安装本候选、未执行真实模型验证，
  没有修订既有历史 episode、数据库、配置或调度。

全仓结果仍不合格；当前结论限于本次定向行为及已列明的共享测试范围。
真实模型验证与部署分别需要后续授权；本补丁及此文档不授权执行。

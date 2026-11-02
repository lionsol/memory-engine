# 自动摘要实验流水线

状态：开发实验，未接入生产checkpoint。语义正确性与质量改善均未认证。

## 调用边界

`lib/checkpoint/summary-pipeline.cjs`提供`runSummaryPipeline(input, invoke, settings)`，
顺序执行一次片段命题提取、一次显式条件合成、一次不限事项的局部审核。
前两阶段host输出合同固定为claim_ledger_fragments、scoped_summary。
第三阶段默认scoped_summary_repair；可选reviewMode="claim_audit"使用claim_audit_review。
不接受reviewScope、additionScope、重试次数、手工参考答案或额外生成阶段配置。

invoke接收system、prompt、pipelineStage、outputContract、outputBindings及signal，返回模型原始最终JSON字符串。
提取阶段还提供冻结的evidenceIds，内容来自SOURCE片段目录。
CLI适配器须把request.outputContract与request.outputBindings传入createCodexSummaryGenerator的构造参数；
outputBindings不是模型可覆盖的请求选项。
片段提取的CLI适配器还须把request.evidenceIds传入构造参数evidenceIds，
将claims[].evidence[]限制为源片段目录；其他阶段不使用此选项。
流水线本身不选模型、不读取凭据、不调用DB或publisher；transport与原始CLI事件保存由调用方负责。
默认输入上限200000字符、中间清单正文上限200000、最终正文上限20000，
源绑定、引文范围和最终预算继续严格验证。

onStage可逐阶段持久化结果；拿到的是副本，不能修改内部候选。
持久化失败、取消、源并发变更或阶段结构失败都会停止后续调用。
失败时保留此前结果及lastValidCandidate，但不会把旧候选改名为已审核成功。
最终保留合成前后两份候选；自动审核后的版本只是最新模型提案，不保证更优。
所有结果publishable=false、publisherCalls=0、semantic_correctness=NOT_CERTIFIED。

## 非命题处置与事实引文

独立summary-claim-ledger默认仍严格拒收无效dispositions。
自动流水线显式选择dispositionPolicy=quality_findings：
语法仍须合规；未知片段、已引用片段又标背景、重复处置等只影响非命题覆盖记账，
不删除或改写claims，不猜测来源ID，不放宽命题evidence、精确引文、source绑定或corrects图验证。

ledger始终保留原模型对象；effective_ledger仅排除无法用于记账的disposition，
disposition_findings逐条保存原声明及原因。下一阶段使用这一明确派生视图，
原字节、原失败及全部claims仍可核对。缺口和未知状态继续保留为质量发现，
不能将“已被引用/已解释”当作事实完整认证。

## 实验约束

2026-11-02基于83811f3，源SHA-256：
9b119fdc8c72918cbdc97d2000200b6d14cf71fc3c9b75c0827b2c33e903dbf6。
4条原始记录、197个归档unit、193个模型可见unit、435个片段。
这是反复调试过的开发样本，不是fresh或holdout；源为对话和助手报告，没有独立工具执行事件。

第一次自动调用返回208条claims及86条dispositions。严格检查以claim_disposition拒收，
自动流程正确停止，未调用合成或审核。
实际无效处置为7条：1条未知片段s0.t9.p7.l? ，6条已经作为命题证据又被标为背景/重复。
全部命题引文及更正图此前已通过相应检查；拒收由非命题记账造成。

修复后明确复用这一次未改的原响应，先逐字比较原/续行请求；
不调用模型重提、不替换旧290条清单或手工修订答案。
有效记账视图保留208条原claims及79条有效dispositions，
原86条声明和7条发现全部保存。续行只新增合成、审核两次模型调用。
这不是一次全新三调用实验，也不是对原失败的静默改写。

私有前缀：
/home/lionsol/.openclaw/ops/memory-engine/checkpoint-pipeline-83811f3-20261102。
-r1保留原严格拒收；-r2-resume保留显式复用、各阶段请求/原始输出/派生视图和有效的合成候选。
本次审核拒收，没有已审核候选，不把lastValidCandidate当作审核成功。
对应.cjs执行器提供plan-only和--start：单个后台进程最多3个逻辑阶段，
各CLI期限270秒、整体900秒；逐阶段保存状态，不因MCP通道超时重新启动。

## 本次续行结果与修复边界

实际调用合计3次：原始提取1次，续行新增合成与审核各1次。
合成得到25项、12803个UTF-16字符，141处字面引用回溯通过。
完整原始记录与候选保存于composed-archives，archive_id为：
0aee3d7f2b22b3c5580bf0e07614a71bf09cd71b541ae0e30d1a9336e6965b3c。

审核响应包含3处替换与1处追加，但summary_sha256抄错一个字符，
以scoped_repair_binding拒收，未应用任何补丁、未手改哈希、未追加第4次调用。
这份候选不是此前人工定向补齐的26项版本。

后续实现host绑定schema：仅将version、target_date、binding、summary_sha256的已知值
在私有临时schema中约束为单值enum，并在返回后再次逐项比较。
静态合同、源绑定和摘要哈希检查仍保留；不自动纠正模型响应。
生成目录0700、schema文件0600，结束后清理，元数据记录实际schema哈希及绑定字段。
此改动发生在三阶段实验调用结束后，当时仅单元/mock CLI验证。
后续一次独立原生审核验证见下节；不能用原失败回放声称当时已使用新约束。

## 语义问题定位

人工后验审阅记录为-r2-resume/manual-semantic-review.json，不是完整语义验收，也不增加硬门槛。

| 发现 | 阶段定位及边界 |
| --- | --- |
| 独立报告修订事项与“仅改报告”未保留；“永远进不了Lance”断言撤回也未明确呈现 | c65/c72已提取，合成阶段遗漏；合成prompt已有保留报告修订指令 |
| 未运行/未改配置/未重启被合入日期级Gateway事项，可能误读为整日限制 | c43/c72的阶段scope已有偏宽倾向，合成未恢复独立核对及报告修订两阶段边界；早先重跑仍是独立报告 |
| valid=true被改成traffic_origin_valid=true | c181及原文正确，合成新增无依据字段别名；审核注意到了，但补丁因绑定失败未应用 |
| 894/1908/908/47.6的待复核关系表达不充分 | 保留数值与公式未知仍不等于明确提示关系待复核；此为后验分析，不能推导新残差；审核同样提出了补充 |

这不是原文丢失或提取完全失败：已知遗漏有一部分在清单中保留，却在最终合成中丢失。
字段名与小型独立结果在既有明确指令下仍会出错，不能把再加同义prompt当作已证实的修复。
一次不限事项审核发现了字段名/残差问题，但未补齐报告修订或阶段scope；
哈希自由复制又使整份审核无法应用。因此本轮只证实流水线与机械故障修复进展，
未建立自动语义改善或泛化结论。保留原文和回溯仍是错误发生后的恢复保障。

## 独立host绑定原生审核（2026-11-02）

新增1次真实CLI/model调用，仅审核此前冻结的25项自动候选。
system/prompt与原失败审核逐字一致；不输入旧修订响应、人工答案或选定事项/来源scope，
唯一请求机制变化是在host生成的私有schema中绑定四个已知值。
代码来自未提交工作树，已逐文件快照并记录SHA；不是远端83811f3提交已包含这些实现。
该分支已推送，但push不包括未提交的修改。

原生CLI接受单值enum，最终四个字段逐值匹配；结构审核成功，
2处替换、3处追加、0移动、0新增事项、0findings。
候选仍25项，13121字符，142处字面引用回溯通过；完整原始记录保留。
archive_id为c2aa158b99c985d283fcc87608374379a9036e7314b2e70dcdc7f500ef4e1869。
证据目录：
/home/lionsol/.openclaw/ops/memory-engine/checkpoint-bound-review-83811f3-20261102-r1。
目录保存实际schema字节/哈希、请求、原始CLI事件、最终响应、应用结果、冻结基线和回溯产物。
实际私有schema权限0600、目录0700；生成后临时文件由transport清理。

人工后验核对：本次恢复valid=true，并把用户要求的traffic_origin_valid与报告简写分开。
还补全49条互斥分类、p95分层抽样建议和用户要求完成报告后停止的性质。
报告修订事项、仅改报告的阶段边界仍遗漏；日期级“未运行/未改配置/未重启”范围仍有歧义；
894/1908/908/47.6的待复核关系未新增限定。详细记录见同目录manual-semantic-review.json。

这只证实本次host绑定机制能在真实审核调用中工作，不估计失败率改善。
不是全新三阶段成功，也不是holdout；inventory/compose使用绑定schema的原生验证仍待执行。
不同审核对问题的发现不稳定；已被引用的s0.t9.p4仍有报告修订事实被漏掉，
因此按原文unit计覆盖不能作为最终事实完整的判据。
现有局部协议禁止改scope/conclusion，范围过宽只能追加限定或记finding；
本次两者均未发生。没有因此新增语义硬门槛或声称bug已经解决。

## 逐命题审核后续实验

新增[逐命题审核模式](checkpoint-claim-audit.md)，在局部补丁之外记录每条清单命题对冻结摘要的具体去向。
其覆盖声明、遗漏与主动省略均是模型判断和质量发现，不是完整认证或新增硬门槛。
原三阶段流水线默认行为不变；reviewMode="claim_audit"仅替换第三阶段，仍三次生成，不接受人工scope。
独立真实审核在同一208条清单/25项候选上完成：28项、14507字符、154处回溯；
报告修订事项补回，但仅改报告的阶段边界仍遗漏。新模式流水线接入只有集成测试，未做新的完整真实运行。

## 145962d完整流程验证与片段引用约束

使用已推送145962d重新运行完整流程：新提取、新合成、逐命题审核，最多三次调用，
没有历史模型响应、修好候选、人工参考或指定scope作为输入；仍是已知开发样本。
三阶段使用root单值schema，但当时尚无片段ID枚举。

实际第1次提取返回267条claims和133条dispositions，以claim_reference拒收，
后续合成/审核调用均为0。c005/c006的evidence分别写成不存在的s3.t1.p1.l1/l2；
原文Embedding/Vision在s3.t1.p0.l2/l3。未修正这份原始响应，也未换旧清单续行。
证据目录：
/home/lionsol/.openclaw/ops/memory-engine/checkpoint-pipeline-145962d-20261102-r1。
它是一次完整流程尝试的提取失败，不是端到端成功。

原因可定位为程序已有有限来源目录，却让模型自由填写可计算形状的片段ID。
后续为claim_ledger_fragments增加可选host evidenceIds：
把claims.items.properties.evidence.items.enum约束为冻结源目录，并在CLI返回后再次验证。
只约束命题证据；dispositions的非阻断质量政策保留。不自动猜ID、改原响应或放宽精确回溯。
合法ID不证明语义支持关系正确，选错合法片段仍可能形成事实错误。
原默认transport和静态schema保持兼容；不支持其他合同或任意schema路径使用evidenceIds。

单独再做1次提取对照，system/prompt与上述失败请求逐字一致，仅改变schema证据词表。
目录：
/home/lionsol/.openclaw/ops/memory-engine/checkpoint-fragment-vocabulary-145962d-20261102-r1。
这不是原失败续行，没有新合成/审核。
实际CLI期限270秒触发derived_cli_timeout；总执行290.353秒，只有thread.started/turn.started，
无最终JSON、无stderr。原始输出、实际schema及超时拒收保持原样，不推断超时原因或schema质量收益。

另新增1次短合同检查，使用相同435项枚举回传一条已给定测试命题，
不作完整提取或语义质量评价：
/home/lionsol/.openclaw/ops/memory-engine/checkpoint-fragment-enum-contract-145962d-20261102-r1。
实际CLI退出0，返回一条合法引用，generator记录435项词表。
最初检查脚本误用JSON.stringify比较键顺序，result.json仍保留REJECTED/contract_smoke_failed；
offline-verification.json采用深对象比较，确认原始响应等值、schema/事件哈希匹配，
标记VERIFIED_CONTRACT_ONLY。没有重试模型或改写原JSON。
因此只验证435项枚举schema的原生合同可用，完整提取成功和端到端成功仍未建立。
本轮实际调用共3次：完整流程尝试1次、完整提取词表对照1次、短合同检查1次。

原失败267条草稿还有独立语义发现：c109引用s0.t9.p9.l0，
却在text/conditions中漏掉“唯一动过的文件是那份报告”，scope仅写“2026-10-20 后续操作状态”。
上一208条清单曾保留此事实，随后被合成/审核省略；本次则在提取草稿中就已丢失。
这不表示原文从归档删除，也不能归咎于本次未调用的合成阶段。
具体失败与阶段追踪见原实验目录failure-analysis.json；仍未解决限定归属的语义保留。

新增回放环境变量：
MEMORY_ENGINE_TEST_CLAIM_AUDIT_PIPELINE_DIRECTORY、
MEMORY_ENGINE_TEST_REFERENCE_BOUND_INVENTORY_DIRECTORY、
MEMORY_ENGINE_TEST_REFERENCE_ENUM_CONTRACT_DIRECTORY。
所有私有记录启用后的相关回归297/297通过、0跳过；测试不调用模型，
不以拒收回放或短合同输出冒充完整提取成功。

## 回放

test/checkpoint-summary-pipeline.test.cjs验证固定阶段/合同、失败停止、取消、
源并发变更、checkpoint失败、候选保留和禁止手工scope配置。
test/checkpoint-claim-disposition-policy.test.cjs验证默认严格行为、显式质量发现模式、
仍严格的命题引用/更正/绑定及真实208条响应。
私有用例由MEMORY_ENGINE_TEST_AUTOMATIC_INVENTORY_DIRECTORY启用；
完整流水线回放由MEMORY_ENGINE_TEST_SUMMARY_PIPELINE_DIRECTORY启用，未提供时明确跳过。
2026-11-02：包含全部私有响应的相关回归281/281通过，0跳过；没有新增模型调用。
新增test/checkpoint-scoped-repair-bound-capture.test.cjs回放实际schema约束、原始输出及全部回溯；
通过MEMORY_ENGINE_TEST_BOUND_REVIEW_DIRECTORY启用。
包含这次原生审核后的相关回归282/282通过，0跳过；回放未新增模型调用。
测试只验证机械行为与证据保存，不认证事实完整、语义正确或泛化。

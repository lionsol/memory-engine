# Checkpoint 摘要方案对照

日期：2026-10-28（Asia/Shanghai）。状态：已新增分类多次摘要及可配置20000字实验预算，仅离线机制验证；既有真实语义失败不变，摘要事实错误尚未解决。
v2直接摘要历史执行HEAD：`411bd1e65e5d7b463bc06bbd9c4375b7cda95889`。
实验源码提交：`9991345e314afd19cafd833eacabc59fec29f686`；完整样本执行HEAD：`7fa781a6aaff447cd261a85e52a42ad2372d3c64`。
三个合成开发案例的通过只限短输入；holdout仍未执行。
用户已同意“原文保留＋事项最终状态＋带引用的生成式摘要”方向。
当前普通checkpoint仍为v15，既有真实验收失败裁决不变。

## 分类多次摘要候选：提示词与流程已实现，尚未真实验证

用户明确要求优化提示词并允许分类多次摘要后，新增隔离入口
`lib/checkpoint/summary-categorized-lab.cjs`。此前单次提示词和Pro对照原样保留，
生产普通checkpoint仍走v15，没有接入本候选。

流程为“完整落盘对话分类1次 → 每类分别摘要1次 → 程序按类拼接”。
默认最多4类、合计最多5次请求，顺序执行、不自动重试；可配置最多8类/9次请求。
分类只返回类别、任务范围和阅读锚点，不先生成一份可能错误的事实ledger。
每类都得到完整可见SOURCE，锚点不截断输入，避免把后文更正留在另一类之外。
分类按对象/任务分工，不按时间位置机械切块；一个类别内仍区分独立事项。

注意这里“完整”只指smart-add落盘的用户/助手对话文本。
真实样本193可见段落中user=61、assistant=132，不含独立tool call/tool result事件。
工具结果的助手转述不是独立核实证据，本轮也未补入完整执行轨迹。

### 提示词调整

两套实际system提示词分别由buildCategoryPlanPrompt/buildCategorySummaryPrompt生成，原文在新模块内。

- 分类提示只要求划分任务范围，将同一事项的旧判断、质疑、更正和最终结果放在同一类别，
  不在分类阶段裁决事实；阅读锚点允许跨类重叠，不能被当作唯一取证范围。
- 分类摘要提示先要求沿同一事项核对“旧判断→明确更正→最后有效结论”，
  特别说明不能在正文确定断言旧判断、再附相反条件；无法裁决才保留冲突。
- 每类输出沿用简洁的topic/text/evidence/corrects结构，将结论、必要限定、未决写在同一text，
  不再强制conclusion/conditions/unresolved三栏。
  数字、资格具体值、统计口径、执行阶段和证据不足仍须保留；
  hash、路径、代码行和重复核对一般留在原始引用中。
- 保留用户请求/规则、助手报告与独立核实的区别，不把较晚陈述自动当更正，
  不把缺字段/零事件当机制生效，不扩大局部只读的范围。
- 两阶段均要求仅返回JSON、不加围栏；请求元数据提供
  `responseFormat: {type: "json_object"}`，调用方适配为provider的response_format。
  未新增宽松解析或自动补字段。

### 放宽实验预算

新候选默认总正文预算20000 UTF-16字符，可由summaryMaxChars配置，
计入类别标题、正文、全局引用编号和更正标记。
不继承旧单次候选5000硬限；生产5000和旧候选限制不变。
20000是便于先检查正确性的实验起点，不是经产品需求证明的最佳值。
每类只给总预算/类别数的篇幅参考，不设逐类硬配额；
完成全部类别后统一计算实际总长，超出仍保留全部原始输出，不能截断或静默删类。

最终正文由程序拼接所有类别及其原始text，统一引用编号，不再调用模型重写。
缺类别、分类失败、任一类别失败或最终超预算都没有有效最终正文；
此前已完成的类别、失败原始回复、完整结构化输入和分类原文保留在record。
达到请求上限后不会补发。所有分类请求的输入长度在第一份分类摘要发送前预检。

接口示例：

```js
const {runCategorized} = require("./lib/checkpoint/summary-categorized-lab.cjs");
const result = await runCategorized(input, invoke, {
  maxCategories: 4,
  maxRequests: 5,
  summaryMaxChars: 20000,
  maxInputChars: 45000
});
// invoke接收stage/categoryId/system/prompt/responseFormat，返回模型content字符串。
// 调用方负责模型、温度、输出tokens、超时、原始HTTP证据及response_format适配。
// 入口本身不读取凭证，不调用provider或publisher。
```

### 本轮验证与边界

新增11项机制测试，与原有相关测试共86项通过。
验证完整更正仍可见、共享锚点、引用/更正原样保留、无最终重写、
超过5000的正文可在新预算内保留、含标题及Unicode的准确边界、
部分失败保留原始输出、请求次数上限和输入/配置快照。
特意验证相互矛盾的模型文字仍可能通过结构检查：
semantic_correctness、correction_resolution、category_ownership、coverage始终NOT_EVALUATED，
publishable=false，不能把机制通过当成事实错误已解决。
静态检查通过887个已跟踪文件，test-integrity通过408个已跟踪测试；
新增文件另由上述实际测试加载执行，未计入git索引扫描。

固定193段样本仅离线构造请求：分类31915字符；
4个占位类别的单类请求各32587字符，都小于45000。
这些类别只是测量占位符，不是模型分类结果，不作为人工答案发送。
每类都重读完整对话，最多5次调用会增加输入tokens、时延和费用；
这一版优先保证更正可见，未宣称降低上下文成本。

本轮外部请求0次，尚未真实测试新提示词，未部署或写运行配置。
下一次真实试验需冻结新源码和实际分类/摘要请求，逐项复核前后更正、独立事项及必要限定；
正文在20000内只表示预算通过，不能替代事实裁决。
本轮同时改变提示词、调用流程和实验预算，后续即使改善也不能单独归因于分类。

## 仅更换模型的受控对照：Pro 仍未通过

执行HEAD：`4e5b61c8a6e96a7eb8415733f2ef62099f9a4c61`；工作区请求前后干净。
2026-10-28 07:27:36–07:28:02（Asia/Shanghai）实际请求1次，无重试、回退或第二阶段。
9项执行器离线自检通过（0次外部请求），不计模型质量。

依据[官方 Chat Completions 文档](https://api-docs.deepseek.com/api/create-chat-completion/)选用同一服务的
`deepseek-v4-pro`，响应也报告该模型。实际请求与上一轮 Flash 请求逐字段比较，
唯一变化是model；messages的JSON序列化SHA-256保持
`b429c9dffde6f2f4d467ad7a50b85b7e8fc0f383a0503d52645c3899ab547a5e`。
完整193可见units、32851输入字符、temperature 0.1、thinking disabled、
max_tokens 16384、timeout 120000ms、正文5000硬限/3500软目标均未变。
原文、episode、代码、测试及执行器均有哈希绑定；未输入人工参考、旧ledger或人工答案。
请求前复制上一轮review-spec，保持复核标准不变。
不同模型的分词、缓存及请求时刻未控制；这里只是一次历史对照和一次新请求，不是重复随机试验。

HTTP 200、finish_reason stop；prompt/completion/total tokens为15679/5107/20786。
原始回复12158字符，外有Markdown JSON围栏，实际runFinalState返回
`REJECTED/comparison_response_json`，ledger为空，没有有效正文。

### 诊断与事实复核

以下数据来自单独离线诊断，未修改原始回复、程序解析器或请求，也不视为有效结果：
去掉围栏后仍因多余顶层stage而报comparison_schema；
另移除stage，才可校验16项ledger的结构、绑定及引用ID。
原样投影为7636字符，仍报comparison_summary_budget。

| 诊断渲染组成 | UTF-16字符 |
| --- | ---: |
| conclusion | 2032 |
| 条件/未决文字及分隔符 | 4577 |
| 标题/引用等 | 1027 |
| 合计 | 7636 |

条件栏仍复制大量代码行、清单hash、路径及审计细节，正文包含独立signal核对事项。
上述开销不是全部都可删的必要条件，不能靠清空条件栏或删句规则宣称修复。

人工裁决：FAIL_FORMAT_BUDGET_AND_RETRACTED_DEPLOYMENT_TIME。

- e5保留新entryId与共享identity路径的更正，e6保留每日10条及旧欠账限制；
  本次未发现Flash上一轮e11那种ID/identity误判复活。
- e4仍断言“部署副本于10:51:54被整体替换（全新安装）”，同时在conditions写
  “mtime不能单独作为部署时刻证据”，corrects为空。
  原文s0.t8.p6已反驳mtime能确定时点，s0.t9.p3明确撤回“10:51:54部署”。
  所以这是另一项已撤回判断仍被写成当前事实，附加相反限制没有完成撤回。
- e15保留自然样本窗口/资格/source/trigger、n=15统计、max非p95、
  FTS不可得、14→15未确证以及取消PENDING；显式无效样本排除未保留。
  残差908ms/47.6%仍来自源报告，统计定义未澄清，不能认证为独立核实数据。
- 632与1241最终结果、49条未观察自然修复不能判产品失败、A/B验收边界保留。
  误建0字节文件删除这一辅助事件遗漏。复核只比对源报告，不新增运行时核验。

### 结论与证据

更换模型使这一次输出更短，但仍有格式、预算和明确撤回处理失败。
“换模型即可解决”在这一已知样本上未成立；也不能据单次失败认定所有模型无效，
或认定某个协议/JSON格式是语义错误根因。holdout仍未执行，生产v15裁决不变。
本轮只新增对照记录，未更改实现、提示词、参数、验收上限、发布或部署。
下一步先据这两份冻结结果界定更正归并和正文/审计信息分工；
不自动追加模型重试或宽松解析，将是否需要分阶段处理留待明确方案后验证。

私有操作证据位于 `/home/lionsol/.openclaw/ops/memory-engine/`：

- 执行器：`checkpoint-model-pro-4e5b61c-20261028.cjs`，
  SHA-256 `18c584b4e74dbd2de0982e9602656250da6342ca152a76fe2364aeb31c656e43`。
- 证据目录：`checkpoint-model-pro-4e5b61c-20261028-evidence/`；
  source/request/review-spec/comparison-spec/provider-response/provider-content/pipeline-result/result原样归档，
  audit记录仅model变化；diagnostic文件明确不属于有效正文。
- 人工复核：`checkpoint-model-pro-4e5b61c-20261028-review.json`。
- request序列化SHA-256：
  `56da5a08a4083da83274499231e799b165480c91fc87caaead5c2b1888bd21a0`。
- 原始HTTP回复SHA-256：
  `ead6dfb6d3c23f4c3e0ad7ff24b44b9d14e6f44d21d303bc6983fb73e9f2d020`。
- 原始content SHA-256：
  `a865a0dc7c0d86aefdcbc10139b559b9691ead0d17caad3f1710724eb883bc18`。

## 单次最终事项真实验证：预算失败并复活已撤回判断

执行HEAD：`79bd568a3de3986cfba460fa3d00e3fa8d2ee628`。
2026-10-27 22:01:48–22:02:17（Asia/Shanghai）实际请求1次，无重试、回退或第二阶段。
9项执行器离线自检通过（0次外部请求），不计为模型质量证据。

固定完整原文193可见units、32851字符；未提供人工参考、旧ledger或预设事项数。
请求使用已提交的buildFinalStatePrompt/runFinalState，模型与上轮设置一致：
deepseek-flash、temperature 0.1、thinking disabled、max_tokens 16384、timeout 120000ms。
HTTP 200、finish_reason stop；prompt/completion/total tokens为15680/7273/22953。

原始回复16397字符、32项，结构/来源绑定/引用ID通过。
程序原样投影后12441字符，返回REJECTED/comparison_summary_budget，
没有有效最终正文。仅conclusion就有9547字符，因此只精简引用或标签不足以解决超长。

| 渲染组成 | UTF-16字符 |
| --- | ---: |
| conclusion | 9547 |
| 条件/未决文字及分隔符 | 1422 |
| 标题/引用等 | 1472 |
| 合计 | 12441 |

相比此前40项原样投影13697字符，本次短约9.17%；
两轮提示词不同，这只是输出描述，不能作因果效果或泛化结论。

### 事实裁决

人工裁决：FAIL_BUDGET_AND_FINAL_STATE_CONTRADICTION。

- e10明确撤回“旧ID规则仍在使用”和“无INSERT所以identity未修复”两项判断，
  corrects指向旧原文s0.t5.p6。
  e11却又把“AMBIGUOUS每晚仍复现、新版只是延后而非修复”
  和“全流程仍无INSERT INTO memory_identity，结构问题还在”列为当前结论，
  没有历史、撤回或未决标记。其依据仍是同一旧原文。
  用户更正s0.t8.p1与助手复核s0.t9.p1/p2均在完整输入内，因此这是明确的已撤回判断复活。
- e29的正文为15样本，却附“14个样本的最大值”条件；其所引p3–p6不支持14。
  这是口径/引用混杂，不能概括为整项均声称n=14。
- 自然样本具体资格、时间窗口、取消证据不足等仍保留，说明原样呈现避免了第二次改写丢字段；
  但该机制不能修正模型已产生的错误或冗余，也不能据字段保留宣称事实正确。

已保存模型原条目及对应原文，引用重叠只用来定位问题，不新增“相同引用即拒绝”的自动规则：
同一原段可能既有被撤回判断，也有仍有效的每日10条限制。
mtime撤回表达及残差统计口径另列审查意见，未将源报告中的数值认证为正确。

### 本轮收尾与下一步

新增开发案例partial_correction_preserves_valid_constraint：
同一旧段包含ID/identity误判和仍有效的10条限额，后文只撤回前两项，
49条仍为空但未观察到自然运行，不能判产品失败。
案例总数由5增至6；这是从已知失败人工缩写的开发输入，
本轮未用模型执行该短案例，不证明其单独复现失败，更不是holdout。
75项定向机制测试通过，语义失败裁决不变。

当前代码与提示词冻结，不再追加Flash重试、协议门禁或规则删句。
下一步优先进行同一服务的受控模型对照：保持原文、实际messages、温度、thinking模式、
输出上限、超时及正文/事实标准，只更换模型。
当前结果只证明这一模型/请求组合未满足完整样本要求，不能单独归因到模型，
也不能预先宣称换模型会通过。

证据位于`/home/lionsol/.openclaw/ops/memory-engine/`：

- 执行器：`checkpoint-final-state-79bd568-20261027.cjs`；
  SHA-256：`28d8b4964fc2ac311ec740f1c84893a9497f06075024db10a8308555263dc879`。
- 同前缀`-evidence/`保留输入、请求前复核清单、原始请求/响应、ledger、pipeline结果、
  仅供诊断的超限正文、audit及review-evidence。
- 审计脚本：同前缀`-audit.cjs`；人工复核：同前缀`-review.json`。
- request：`b67312506467dfa525944e03bc1a25ded12aba7fe277f7454ba9cc01729c74a8`。
- response：`d75c3ba96aa05ae07c88e56aba2a2b36e1a887392b5eb77e2ee339fda269bd71`。
- content：`cf83df8437e85e5b86c28fa4a41f4f2c1c6698c87bba56905913bdf1a1325e11`。

请求已与提交构建器逐字核对，源码/原文/episode快照一致，未补改原回复。
未发布、部署、改变runtime/DB/配置；生产4096 token保持不变。
摘要事实错误仍未解决，holdout未执行。

## 候选实现与离线记录：一次最终事项整理，随后直接呈现

基线HEAD：`ec4dfc48b034f9f357c9b3730211abf5943b1d8b`。
本轮仅隔离源码与离线验证，真实模型请求0次，未部署。

新增`summary-comparison-lab.cjs`独立入口
`buildFinalStatePrompt/projectFinalState/runFinalState`，复用现有v2事项响应结构，
不改变原direct/organize/compose或生产普通checkpoint入口。

### 实际变化

完整可见原文 → 一次模型整理紧凑的逻辑事项最终状态 → 程序直接呈现。
语义归并由模型完成；程序不按标题关键词或时间先后猜测关联，
也不自动把旧40条记录裁成21条。新提示明确区分误判更正、实际状态变化、独立结果和局部执行阶段，
把过程、路径和审计细项留在原始证据中，保留具体资格值、否定与未决限制。

投影把每项scope作为标题，逐字显示conclusion、conditions、unresolved及引用/更正标记。
不会再调用compose或预算重写来压缩这些文字。
必要条件即使仍写在conclusion中，也会保留在最终正文；本入口减少了对“模型必须正确分栏”的依赖，
没有证明此前分栏行为已修好。真实验收仍须检查最终正文是否包含并明确限定全部关键事实。

结构化原文输入（含未发送的独立控制行）、整理结果及原始回复保留在record；
引用原文保留角色和来源信息。预算失败时也保留有效ledger与原回复供审查，不截断或补写。
输入默认上限45000字符；正文目标3500是软目标，5000是硬上限，
包含标题、各文字字段、分隔符、引用与更正标记。4000字正文不会因未达到软目标而被要求重写。
run最多调用一次invoke；解析、引用、绑定或预算失败停止，不进入第二阶段。

### 离线验证

75项定向测试通过（原64项＋新增11项），包括原样保留全部文字字段、
conclusion中的资格值、原文/控制行归档、精确5000边界、软目标、错误结果留存、输入与预算参数快照及一次调用。
静态检查887个已跟踪文件通过；test-integrity扫描408个已跟踪测试、invalid=0；
新增测试文件已由上述定向命令实际执行。未把结构检查当成语义核查。

完整固定原文193可见units的新请求为32851字符，低于45000，
未附旧40条ledger、人工参考或预设事项数。
旧organize请求与此前冻结的真实请求逐字一致，验证公共source打包重构没有改变旧路径。

把人工参考21项作为预先给定的开发ledger输入，仅做呈现兼容性演示：
正文仍为2990字符，SHA不变。该输入由人工提供，不是本轮自动提取/归并或模型质量结果。
此前真实40项ledger原样投影为13697字符，被5000硬上限拒绝，原记录保持完整。

源码SHA-256：`350bb7591173944a4828db97b3bec8db0b4cf5170464143086dea6599becafab`；
新增测试：`2c8a476a766ca6b583725e23a1e5dd2339873158db37a0d71d4110adfda915b1`。
离线执行器：`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-final-state-ec4dfc4-20261027-offline-r2.cjs`，
SHA-256为`eea434a8d8a4c719ac78317f22f2cbe6b0c9900ba65741a15fd02e57538ae9e3`；
同目录的`checkpoint-final-state-ec4dfc4-20261027-offline-r2/`保存prompt、人工供给ledger、模拟结果和report，真实请求0次。

此候选尚未真实验证模型能否正确归并、压缩和完整引用；
错误或遗漏的模型事项仍可能通过结构检查，semantic_correctness/coverage保持NOT_EVALUATED，
publishable=false。完整摘要Bug仍未通过真实验收。
下一步冻结源码后，仅对完整原文执行一次新入口，按原文和人工参考核查实际正文，
不把人工答案发送给模型，再决定后续独立样本验收；当前未接线或部署。

## 完整原文真实提取：条件取值仍错放，固定正文预算失败

执行HEAD：`e70595acc84aa1a952d194a007aebebcf1a9ece7`。
2026-10-27 20:30:37–20:31:11（Asia/Shanghai）实际organize请求1次，
重试0、回退none、写作请求0。8项执行器离线自检通过（0次外部请求）。

输入固定2026-10-20全部193可见units，32344字符；只使用已提交organize构建器，
没有输入人工ledger或参考答案。模型设置与上轮一致：
deepseek-flash、temperature 0.1、thinking disabled、max_tokens 16384、timeout 120000ms。
HTTP 200、finish_reason stop；prompt/completion/total tokens为15396/9141/24537。
模型原始JSON 22227字符、40项，通过结构/来源绑定/引用ID检查，机械状态READY_FOR_REVIEW。
该状态不表示提取内容或最终摘要通过。

### 原文复核

人工裁决：FAIL_REQUIRED_QUALIFIER_EXTRACTION_AND_LAYOUT。

- e35仍把UTC时间窗口、natural_user_turn、valid=true、source=before_prompt_build、
  trigger=user等具体资格放在conclusion；conditions只有查询上限、去重和
  “来源/触发/有效性字段决定样本资格”等泛化描述。
  因而新增固定呈现机制依然保护不到必要取值，不能认定提取分栏已修复。
- e36同时保留15样本口径，又在conditions写“不将14个样本的最大值冒充稳定的生产p95”；
  其引用的p3–p6描述15样本，不支持14。这里是口径/引用失配，不能概括成整项都宣称n=14。
- e40的“全程只读”只引用报告路径p11，支持该阶段只读的是p10。
  更正和统计大部分仍保留，但引用ID存在不能证明对应文字被所引片段支持。
- e24/e30/e33/e40四项仅为报告路径；辅助核验、过程和旧判断也分占多个事项。
  丰富记录可留作证据，不应无差别强制渲染为同数量的最终摘要段落。
- 原报告的894、1908与残差908/47.6%统计关系未解释，不认证该残差，
  也不把两个中位数直接相减认定为真实残差。

### 预算结果

固定条件/未决文字与分隔符2844字符，标题/引用等2094，合计固定4938。
即使40项结论各仅1字，最低正文也为4978，无法满足4500目标。
5000硬上限下全部结论合计只剩62字；机械最低值低于5000不证明语义可行。
另作未发送的输入长度诊断：即使目标取5000，写作输入仍51086字符，超过45000上限。
放宽函数内部的测量上限仅用于计算该长度，没有提交请求或改变实际请求配置。
默认候选在写作前停止，本轮未截断、合并或补改原响应，没有新增写作调用。

### 可评审的人工参考与下一步

[人工开发参考](checkpoint-summary-reference-20261020.md)已按原文及用户规则整理为21项，
现有渲染器测得正文2990字符（含标题、引用、更正），保留已列关键检查点。
它是在失败后人工撰写，不是模型输出、holdout、穷尽覆盖或修复PASS；
残差口径待复核也明确标为人工分析，不冒充原报告已更正。

该参考支持已列检查点可以在预算内呈现。
本轮不接受“把所有丰富ledger记录固定进摘要正文”的候选，不再追加逐项提示词探针或协议门禁。
下一步以参考为开发目标，实现按逻辑事项归并最终状态的投影：
过程/路径/审计留在证据记录，真正决定最终结论的具体条件随正文保留，
然后对完整样本作语义与覆盖验收。仍不接入生产。

证据位于`/home/lionsol/.openclaw/ops/memory-engine/`：

- 执行器：`checkpoint-ledger-extract-e70595a-20261027.cjs`；
  输入、请求前复核清单、原始响应、ledger、预算及审计：同前缀`-evidence/`。
- 审计脚本：同前缀`-audit.cjs`；人工复核：同前缀`-review.json`；
  人工参考输入及构建器：同前缀`-manual-reference-input.json`和`-reference-build.cjs`。
- 执行器SHA-256：`d472323273e44968acc89ebe1f409966d8b9c049f185750a02209156439b8610`。
- request：`061e615a26d78f210ec525a9e0d043d35ddd45d135e8da041cfec677acfe99dc`。
- response：`4ca34186456f184f8da55f80e44fb434de54841c74faa37b3b9d7d416c5a51b8`。
- content：`c5682e085a62019e878fc1c88bda4973b5f48345f285a4c4b3a87156e740ea20`。
- 人工参考正文：`abfa8e2a8b7021af1c8996b2a86acefffa55f502638a0c2306f8de4f904950aa`。

未调用publisher/scheduler、未部署或改变runtime/DB/配置，生产4096 token保持不变。
完整摘要Bug仍未通过真实验收，holdout未执行。

## 历史隔离实现：固定呈现事项条件与未决限制

基线HEAD：`a579afdcaf3ce238e7b60fe66518d97892f1c788`，仅源码和开发验证，真实请求0次。

条件密集探针超限并丢失source值，说明必要限定不能继续完全依赖最后一次文字改写。
复核历史45项organize原始响应又发现：e40的`source=before_prompt_build`在conclusion内，
conditions只有“仅只读核验 memory_events 元数据，未读取消息正文”。
所以固定呈现只保护已经放入对应数组的内容，不能自动修正前一阶段的错放或遗漏。
该历史响应是v1，未迁移、改写或作为新模型结果使用。

### 实现

复用`summary-budgeted-rewrite.cjs`及现有ledger字段，新增
`planLedgerRewrite/buildLedgerRewritePrompt/completeLedgerRewrite/runLedgerRewrite`独立入口：

- scope作为标题，conditions与unresolved由程序按原序原样附加；模型只改写conclusion。
- 固定字段、分隔符、标题、引用、更正标记和换行先计入实际UTF-16预算，再分配可改写文字额度。
  固定开销已不容纳正文时，在调用前停止；不删条件、不截断、不提高5000上限。
- 可改写部分沿用现有按conclusion长度分配的启发式，尚未证明额度足够表达所有结论。
- 回复仍是现有version/binding/texts结构；绑定覆盖ledger内容，固定字段等长改动也使旧回复失效。
  原普通写作入口与生产checkpoint调用路径均未接入这个候选。
- organize提示同时明确：时间窗口、筛选资格、来源/触发/有效性、截断、统计口径、阶段与证据限制
  必须进入conditions，不能仅埋在conclusion；条件和未决事项也需引用支持。
  这项提示修改尚无新真实模型验证。

### 离线证据与边界

64项定向检查通过（原54项＋新增10项），静态检查887文件通过，test-integrity扫描408、invalid=0。
覆盖固定条件/未决文字保留、精确总预算、Unicode、引用更正、预算不可能时0次调用、
条件变更绑定失效、一次调用无重试及调用方/plan修改。
反例测试明确展示：条件仅留在conclusion仍可丢失，编造的条件与矛盾结论也不会被结构检查自动识别；
semantic_correctness/coverage仍为NOT_EVALUATED，publishable=false。

固定2026-10-20完整原文193可见units的离线演示使用人工整理的单项ledger和人工8字结论：
输入32674字符；273字符总目标中，条件/未决固定230、标题引用等19，剩余结论24；
最终257字符，所给条件均保留。
此273包括标题和引用，上轮273仅是text上限，不能据此比较模型压缩表现。
这是人工输入的机制演示，不是模型输出、自动提取、完整17项验收或holdout；Bug尚未解决。

证据目录：`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-ledger-layout-a579afd-20261027-offline/`；
执行器：同目录上级的`checkpoint-ledger-layout-a579afd-20261027-offline.cjs`。
report.json记录原文/episode、候选源码、测试、执行器及历史响应SHA-256；
执行器SHA-256为`d118af4c9d9113193bb51d6d1219b87415a4ba340878dbd38b3f3cfecfc915a5`。
源码检查及离线演示未调用provider、publisher、scheduler，未部署或改变runtime/DB/配置。

下一步回到完整原文，单次验证新的organize输出，逐项复核条件与结论分栏是否正确、有来源支持，
并计算整份ledger的真实固定开销与写作输入预算，再决定是否进入写作验收。
不能先假设条件已被正确提取，也不继续增加单事项提示词探针。

## 历史候选：按实际版式分配逐项写作预算

本轮基于已提交失败记录 `00e37319b79ea50f22534e25cd807289a4773ac3`。
新增隔离模块 `lib/checkpoint/summary-budgeted-rewrite.cjs`，
协议为 `checkpoint-summary-budget-rewrite-v1`；未修改普通checkpoint或runDirect调用路径。

已知问题不是引用标记太长：上轮text本身5636字符，已超过5000。
本候选把“草稿整理”和“受预算约束的最终文字”分开：
先使用已冻结v2模型草稿，下一次仅验证一次写作阶段，不重新生成direct草稿，
因此这不是完整端到端成功或生产自动重试。

### 实际预算规则

1. 验证草稿结构、来源绑定和引用；允许把超正文预算的草稿作为写作输入，
   但不称其为有效最终摘要。
2. 用同一渲染器，把每项text暂置1字符，精确测出标题、引用、更正标记和换行开销。
3. 默认目标4500字符、硬上限5000；扣除固定版式后分配正文。
   每项至少1字符，剩余按草稿原文字数比例以累计取整分配，所有上限之和精确等于正文预算。
4. 写作模型只返回version、binding、texts数组；原序、数量固定。
   标题、evidence与corrects由程序复制，不允许模型改引用或合并、删除、增加结构项。
5. 逐项校验UTF-16长度、非空和合法Unicode；单项超限即拒绝，
   即使其他项省出了空间也不自动借用。不截断文字，不静默删项。
6. 重建完整摘要，再经原5000字符校验及目标4500字符校验。
   只有这些机械检查通过才进入人工评审，publishable仍为false。

绑定包含原始输入、完整草稿、分配表、目标和上限。
写作回复处理时重新计算计划，不能通过修改传输plan来放大限额。
完整原文始终随请求发送，模型可按证据改正文中的范围错误，
但无法修补草稿已漏掉的结构项或错误引用；遇到此类问题应拒绝选型，不能宣称全覆盖。
按原长度分配是启发式，并不代表事实重要性或必要最小表达长度。
结构项数不变也不能证明每项含义未被删掉，仍需人工复核事实、否定、条件和不确定性。
无法保真压缩时模型可返回空texts，使本次写作停止；不追加重试。

### 离线验证结果

新增10项测试，加既有19项实验与25项catalog测试，共54项通过。
测试覆盖1/2/17/37项、UTF-16与更正标记开销，
各项填满时恰好4500字符、单项超限但总长可容纳时仍拒绝、
无法容纳固定版式时停止、草稿/来源/预算绑定、字段注入/缺项、
全原文保留、单次写作失败不回退及传输plan篡改拒绝。
测试明确展示短的错误结论也能通过字数检查，因此没有自动语义PASS。

| 冻结真实草稿离线实测 | 值 |
| --- | ---: |
| 来源 / 原始可见单元 / 草稿项 | 4 / 193 / 17 |
| 完整写作输入字符 | 40548 |
| 标题/引用等固定版式 | 772字符 |
| 分配给texts总额 | 3728字符 |
| 目标 / 硬上限 | 4500 / 5000字符 |
| 每项字数上限范围 | 64–464 |
| 真实请求 / 发布 / 部署 | 0 / 0 / 0 |

容量测试使用占满各项上限的合成x文本，仅证明排版与预算恒等式，
不是人工参考摘要或模型质量结果；未保存为有效正文交付。
把原5636字符texts原样返回会触发rewrite_item_budget，不能靠新协议放行旧超长输出。
原始草稿、源样本和episode的SHA-256复核不变。

离线脚本：`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-summary-budget-rewrite-20261027-offline.cjs`。
请求与report：同目录 `checkpoint-summary-budget-rewrite-20261027-offline/`。
草稿content SHA-256：`bdfa7941e1fa834a16de078cdf462e8b6a4c619394dcd6155a70f7cc46e850f3`。
模块SHA-256：`ac08e454e19f2f9f78c8179cc1915c065855907e05cf7f126b83ec095932f194`。

上述为提交前离线记录；提交后的冻结草稿单次真实写作验证已失败，详见下节。
完整新输入端到端和holdout仍待后续验证。
本候选改变了失败后的开发方向，不把过去“暂不追加阶段”的历史决策改写为已验证成功。

## 预算写作真实验证：17项逐字照抄，未执行压缩

执行HEAD：`9e2da3fb5fe282c44d36b80e797c872f0976b721`。
2026-10-27 19:28:30–19:28:40（Asia/Shanghai）。
执行器自检7种模拟场景通过，模拟阶段外部请求0。
随后仅执行冻结草稿写作1次；没有重新调用direct，没有重试、回退、发布或部署。
HEAD/干净工作树、模块、执行器、源样本、episode和冻结草稿哈希复核全部通过。

请求仍使用官方DeepSeek端点、deepseek-flash、temperature=0.1、thinking disabled，
max_tokens=16384、timeout=120000ms、输入上限45000字符。
响应HTTP200、finish_reason=stop，provider_model=deepseek-flash，不是token截断或传输失败。

| 项目 | 实测 |
| --- | ---: |
| 输入字符 | 40548 |
| prompt / completion / total tokens | 19115 / 2670 / 21785 |
| 原始JSON内容字符 | 5824 |
| 返回texts数量 | 17 |
| 与草稿text逐字相同 | 17 / 17 |
| 超过各自max_text_chars | 17 / 17 |
| 仅texts合计 / 固定版式 | 5636 / 772字符 |
| 诊断总正文长度 | 6408字符 |
| 目标 / 硬上限 | 4500 / 5000字符 |
| 请求 / 重试 / 发布 | 1 / 0 / 0 |

首个拒绝为rewrite_item_budget。
回复version、binding和texts数量均正确，但没有改写任何一项正文。
因此5824字符的JSON响应比旧响应更短，来自省掉重复标题与引用字段，
不代表摘要正文缩短；原5636字符正文完整照抄。

例如第1项244/161、第5项95/64、第12项702/464、
第14项414/273字符（实际/上限）；全部17项超限。
这不是个别项稍微超限、其他项留有余量导致的过严拒绝：
合计仍超过5000硬上限1408字符，不能通过允许项间借用解决。
未修补、截断或重新分配后放行本次输出；没有有效候选正文文件。

### 请求与响应审计

审计重新从冻结输入/草稿调用buildRewritePrompt，逐字核对实际发送的system和user内容，
并核对plan、请求/响应/内容哈希以及provider envelope中的原始content。
实际使用的是已提交预算写作构建器；没有误用direct提示词或fake响应。
17条逐字相同由数组全等断言确认，不是人工观感。
原始result.json保留semantic_review=NOT_EVALUATED；
独立review记录本次任务执行失败及全部逐项长度。

没有新的改写文字可评估：原草稿核验阶段范围不够明确、残差算术等问题原样保留。
引用与事项结构固定只能保证结构未变，不能迫使模型执行压缩。
离线容量证明和54项回归仍证明程序预算与拒绝机制正确，
不能作为模型能完成任务的证据。

### 裁决与下一步

BUDGET_WRITE_FAIL_NO_REWRITE。摘要事实Bug未修复，未取得生产发布资格。
目前只能确认：这一次完整输入、该模型与设置下，模型遵循了回复结构但未执行正文改写。
不能据一次失败断言所有模型都无法处理，也不能直接归因到上下文长度、模型能力、
提示词歧义或输入干扰中的任一项。

暂停继续扩展协议和门禁。下一步先准备一个短输入、单事项的有界压缩探针，
检验相同模型/设置是否能执行基本改写，再决定是否比较长输入干扰或其他模型设置。
不把又一轮完整重跑当作定位，不以修改上限或放行旧输出获得PASS。
本轮唯一请求已结束，不追加调用。端到端与holdout仍未完成。

证据位于 `/home/lionsol/.openclaw/ops/memory-engine/`：

- 执行器：`checkpoint-budget-write-9e2da3f-20261027.cjs`。
- 原始请求、响应、输入、草稿、plan、结果：`checkpoint-budget-write-9e2da3f-20261027-evidence/`。
- 审计：`checkpoint-budget-write-9e2da3f-20261027-audit.cjs`。
- 复核：`checkpoint-budget-write-9e2da3f-20261027-review.json`。
- 执行器SHA-256：`14722c556b6965ba3c98bb11bcc17815e07ace5da1f7d7d633d260422bb8c0d0`。
- request：`5294b1b86b0a10a860ba918eb45fb229736e0e771c29cb6959ce3e6d75de83c1`。
- response：`9ad30bf32000e01cdf980858ebc3aa51d2f50b0a6c42e95dc293df679da4eee3`。
- content：`1df3a351aaf16d300dec2112fc632b57228917643db44f77380d156bf2864a4e`。

## 短输入单事项探针：95字只缩为92字

执行HEAD：`b8cb1e7a0a7f5d1fae4a5fa083188ce168dc1131`。
2026-10-27 19:35:52–19:35:53（Asia/Shanghai）。
未修改产品代码；执行前工作树干净，原文/episode/冻结草稿/构建器/执行器哈希检查均通过。

从冻结v2草稿中取第5项“部署时刻mtime证据撤回”，保留原95字正文。
按原始顺序取该项evidence/corrects指向的3段原文，逐字保留及原User/Assistant角色。
引用重编号有origin-mapping.json记录，保留父source_hash、unit id和偏移，
不把短输入重新编号当作原文发生变化。
沿用相同预算写作系统提示词，题目从17项减为1项；模型/temperature/thinking设置与上一轮相同。

固定正文64字符上限，与全输入时该项预算相同。
短输入版式开销30字符，因此探针目标94字符；硬上限仍5000。
这只是单事项执行能力定位，不是把生产正文预算改为94。

执行器先通过7项模拟检查，外部请求0；
随后仅执行1次真实请求，无重试/回退/发布或部署。
HTTP200、finish_reason=stop，输入2784字符、prompt1292 tokens、
completion108 tokens、total1400 tokens。

| 项目 | 实测 |
| --- | ---: |
| 原始可见证据段落 / 写作项 | 3 / 1 |
| 原草稿正文 | 95字符 |
| 返回正文 | 92字符 |
| 正文上限 | 64字符 |
| 诊断版式长度 / 探针目标 | 122 / 94字符 |

原始返回：
> “10:51:54 部署”已从报告撤掉：目录 mtime 可被 git archive 或保留时间戳的复制继承，不能单独作为部署时刻证据，实际启用时刻以 Gateway 加载记录为准。

回复结构和绑定正确，人工核查仍表达了撤回、mtime继承不确定性及加载记录依据；
但仅删去“的说法”3字符，触发rewrite_item_budget。
因此本轮不是逐字全等照抄，也没有满足压缩目标。
没有截断文字、修改上限或生成有效候选。

为诊断是否确有更短表达，助手另写了56字人工参考：
> 已撤回10:51:54部署断言；mtime可被复制继承，不能证明部署时刻，实际启用以Gateway加载记录为准。

该参考未发送给本轮模型，不是模型结果、不是质量PASS或holdout；
它只提供了保留所关注含义且少于64字的人工可行性例子。

### 诊断结论

SHORT_SINGLE_ITEM_FAIL_LENGTH。
相同模型/设置/请求形式在短输入也失败，所以长上下文不是这种字数失败的必要条件。
仍不能单独归因到模型能力、提示词表述、结构化输出或字数估算中的某一项。
短探针同时减少了输入长度和事项数量，也不是仅改变上下文长度的严格因果实验。
原始请求/响应哈希及实际system/user内容均与同一构建器核对一致。

下一步准备1次更直接的纯文本探针：
在指令中直接写“64字以内”，去掉嵌套plan、binding和JSON输出要求，
沿用这3段原文与95字草稿、相同模型设置；不提供人工参考答案。
先判断简化请求后能否压缩，再决定后续长输入或模型设置比较。
这项比较会同时改变字数指令表达和输出格式，不能据其结果单独断言某一个因素是根因。
本轮只用了既定1次请求，没有追加纯文本调用；不再增加产品协议和门禁。

证据位于 `/home/lionsol/.openclaw/ops/memory-engine/`：

- 执行器：`checkpoint-budget-short-b8cb1e7-20261027.cjs`。
- 原文映射、输入、草稿、plan及请求/响应：`checkpoint-budget-short-b8cb1e7-20261027-evidence/`。
- 审计：`checkpoint-budget-short-b8cb1e7-20261027-audit.cjs`。
- 人工复核及56字参考：`checkpoint-budget-short-b8cb1e7-20261027-review.json`。
- 执行器SHA-256：`59573553e39a4f2db830dd1d16c1c0f47a14451c7a3831d43647bff50222a601`。
- request：`9ba08889300258d0af265b5da3bb14b0fdead84ae44ff9de052b00fdda7adbd3`。
- response：`946f04fe9e9ab51815eb1079020260f78b505bca89a518efe5a76cf7b565b5f7`。
- content：`d20af699fdfdc292e764e33ca43a825dee6df43fe56dd2e3ae20af7db7f8797e`。

## 纯文本单事项探针：95字压到59字，局部通过

执行HEAD：`5ea95d65eafc2eef8b51e70bb6bdcfecfed550f5`。
2026-10-27 19:44:58–19:44:59（Asia/Shanghai）实际请求1次，重试0、回退none。
执行器7项离线自检通过（0次外部请求），不计入模型语义验收。

沿用上轮同一事项的3段原文、95字符草稿和模型设置；
审计确认输入原文、草稿及原文映射与短结构化探针完全一致。
本轮指令直接要求64字符以内的纯文本摘要，说明标点、数字、英文字母均按UTF-16计数，
去掉plan、binding和JSON输出要求；未提供56字人工参考答案。
输入645字符，使用deepseek-flash、temperature 0.1、thinking disabled、
max_tokens 16384、timeout 120000ms；未改变生产4096 token配置。

### 实际输出与复核

HTTP 200、finish_reason stop；prompt/completion/total tokens为346/33/379。
模型原始正文为59字符，未裁剪、修补、去除包装或重新生成：

> 已撤回“10:51:54部署”说法；mtime可被继承，不能单独作部署时刻证据，启用时刻以Gateway加载记录为准。

机械检查为READY_FOR_REVIEW；单独人工复核裁决为PASS_SINGLE_KNOWN_ITEM_ONLY：
旧部署说法已撤回、mtime不能单独证明部署时刻、启用时刻以Gateway加载记录为准三点均保留，
未编造已核实的部署时刻，59字符满足64字符上限。

| 请求 | 输入字符 | 输出正文字符 | 64字符限制 |
| --- | ---: | ---: | --- |
| 上轮短结构化探针 | 2784 | 92 | 失败 |
| 本轮纯文本探针 | 645 | 59 | 通过 |

这证明该模型在简化请求下能完成这个已知单项的压缩。
指令表述、字数表达、输入长度和输出格式同时改变，不能认定JSON单独导致此前失败。
只有1个已知事项；未验证复杂资格条件、全部17项、端到端流程或holdout。
完整摘要Bug仍未解决，未发布、部署或接入生产。

下一步使用同样的简化请求模式，验证资格条件更密集的单项，
先检查压缩是否丢失有效样本条件，再考虑多项执行或产品改造。

### 证据

证据位于 `/home/lionsol/.openclaw/ops/memory-engine/`：

- 执行器：`checkpoint-budget-plain-5ea95d6-20261027.cjs`。
- 原文映射、输入、草稿、请求/响应及机械结果：`checkpoint-budget-plain-5ea95d6-20261027-evidence/`。
- 审计：`checkpoint-budget-plain-5ea95d6-20261027-audit.cjs`。
- 人工复核：`checkpoint-budget-plain-5ea95d6-20261027-review.json`。
- 执行器SHA-256：`2752f84510299ca4193703fd1618317c83c1cba771301c222ac4a99af1be3625`。
- request：`14b5eb9dd2405b8c8501493b5c26d35b3e4912798546aabb284b836ecba47ccc`。
- response：`3fb896bb76fbf4419b4f2fb5908b7c5ca9fe7da967e2660b8ddfae85bcad0dd7`。
- content：`830450c555ec708ae8c33f861ba1a343bdfe79258d308fff2bb3679ccfde2cd4`。

## 条件密集单事项探针：317字超限且遗漏source值

执行HEAD：`1ab74c40d5410e90af62d9df442ddeba0274a707`。
2026-10-27 20:01:11–20:01:12（Asia/Shanghai）实际请求1次，重试0、回退none。
7项执行器离线自检通过（0次外部请求），不作为模型质量证据。

使用冻结v2草稿第13项“AutoRecall 自然样本身份核验”：
414字符草稿及其引用的2段原文，未改原文内容或角色。
沿用上轮纯文本指令模式，仅将64字符上限换成此前全稿分配的273字符；
模型、temperature 0.1、thinking disabled、max_tokens 16384、timeout 120000ms均不变。
请求前保存独立review-spec，规定时间窗口、筛选条件、去重计数、完整状态及不确定归因必须保留；
全表/窗口/历史辅助计数可省略。该复核清单未加入模型请求，未提供人工参考答案。

### 实际结果

输入1202字符，HTTP 200、finish_reason stop，prompt/completion/total tokens为644/159/803。
原始输出317字符，比273上限多44，机械检查REJECTED/plain_length；未裁剪或修补：

> PASS：LIMIT 200取200行达上限（全表4168行），窗口UTC 2026-10-19 08:57:33至2026-10-20 12:27:18内63个trace去重得自然请求15条；natural_user_turn且valid=true为15/15，source、agent_id/run_id/session_id、trigger=user均15/15；15/15有started与completed，另1条unknown/valid=false已排除；全历史1652个trace中0个有started无completed。较上轮14条差1条，初步归因最新请求完成于12:27:18Z，但缺上轮报告运行时刻，无法确证。

人工复核为FAIL_LENGTH_AND_REQUIRED_CONDITION：
`source=before_prompt_build`被压缩为只有字段名的`source`，具体资格条件丢失。
时间窗口、LIMIT已满、15条去重自然请求、natural_user_turn/valid=true、
trigger=user、身份字段、started/completed、无效样本排除及“初步归因/无法确证”仍保留。
输出保留了允许省略的辅助计数，却遗漏必要source值；长度超限与语义遗漏同时发生。
这里审查的是对原报告的改写，没有独立核验其运行时事实。

简单mtime事项的59字成功不能推广到条件密集事项。
本轮没有证明简化请求可以稳定满足字数和条件保真；完整摘要Bug仍未解决。
不再追加单事项提示词探针。下一步复用现有ledger.conditions/unresolved，
验证由程序固定呈现必要条件、先扣除固定开销、只压缩解释文字的隔离候选。
条件提取正确性仍须对照原文复核，这不是语义自动保证，也不增加生产协议或门禁。
本轮未发布、部署或改变生产配置，holdout及完整端到端验收未执行。

证据位于 `/home/lionsol/.openclaw/ops/memory-engine/`：

- 执行器：`checkpoint-budget-qual-1ab74c4-20261027.cjs`。
- 原文映射、草稿、请求前复核清单、请求/响应及机械结果：`checkpoint-budget-qual-1ab74c4-20261027-evidence/`。
- 审计：`checkpoint-budget-qual-1ab74c4-20261027-audit.cjs`；人工复核：`checkpoint-budget-qual-1ab74c4-20261027-review.json`。
- 执行器SHA-256：`ea015b93d0ec91a14140eb7ef9f4e6447e615a600777399c05e678083d98a4d3`。
- request：`de1f8efe74f4dcab4319e6e109c5e63d1ba5d57622798ac8c2cb8050b081c6bd`。
- response：`2e72aa37c763c68e630883be178c4b6a4ba9090f3c3ea3201cbd633bfd792ec5`。
- content：`d9954213ce809ca2a9576612298fba16eccacc66a8d2b9292ee93b032f1012a9`。

## v2直接摘要（历史）

本轮基于已提交失败记录 `c354c40d730e5d03de98e3795889fc2925eba24c`。
新协议 `checkpoint-summary-comparison-v2`，不自动转换v1响应。
未修改普通checkpoint调用路径，不将实验候选接入生产。

- 局部范围：要求每项文字限定对象、日期和执行阶段。
  某次只读核验的“未运行/未写入/只改报告”不能归纳为全天；
  同一天先执行后核验不矛盾，缺少跨阶段依据时分别叙述。
- 样本资格：要求保留时间窗口、截断上限、来源/触发/有效性及统计口径。
- 正文压缩：目标3500字符（配置正文上限的70%，仅生成目标），硬上限仍5000。
  优先结果、决定、更正、未决问题；通常每项1–2句，必要条件保留。
  原始输入不裁剪；清单哈希、报告路径、信号ID、代码行号和逐行明细留在引用原文。
- 引用语义：evidence可支持整项文字，包括旧判断的历史描述；
  corrects标记被撤回的判断。允许部分交集，但必须另有未被标为撤回的支持引用。
  例如evidence=[旧断言,更正原文]、corrects=[旧断言]可通过结构校验；
  仅有旧断言且全部标为撤回仍拒绝。此规则不证明引用支持当前结论。
  证据对象referencedAs保留双重用途，不重复存放同一原文。
- 新增runDirect入口：只发direct1次，无organize/compose或传输/结构失败后的补偿调用；
  输入超预算时0次。runComparison继续作为历史方法对照接口保留。

新增2个合成开发案例：先重跑后只读核验的阶段边界；
自然样本完整窗口/资格/上限和FTS/max口径。
当前共5个开发案例；新增案例尚无真实模型结果，也不是holdout。
范围、资格和冗余改进目前属于提示词要求及评审清单，没有被程序自动证明。
19项实验测试与25项既有catalog测试，共44项通过。
覆盖部分交集引用保留双用途、仅撤回支持拒绝、v1响应拒绝、单次路径失败不回退、
全部开发输入正文/来源元数据逐字保留；原有输入漂移和预算检查继续通过。

### 固定样本离线诊断

脚本：`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-summary-direct-v2-20261027-offline.cjs`。
材料：同目录 `checkpoint-summary-direct-v2-20261027-offline/`。

完整4来源/193单元输入32351字符，目标3500、硬上限5000。
原文、episode和上轮原始模型输出的哈希核对未变。
原始v1响应被拒绝；显式离线只适配版本头、不改文字或引用的回放，
在新引用规则下到达预算校验，仍以7166字符被拒绝。
runDirect假模型调用1次、无重试，结果同为预算拒绝。
没有保存“修补成功正文”，不把诊断回放称为模型生成或语义PASS。
该次离线预检真实请求0、发布0、部署0；提交后单次完整样本真实验证结果见下节。
未完成的整日事项覆盖、语义正确性和holdout仍是开放问题。

## v2完整样本真实验证：引用通过，正文仍超限

2026-10-27 17:25:28–17:25:43（Asia/Shanghai）。
执行前工作树干净，HEAD、模块、fixture、源样本、episode与执行器按哈希绑定；
结束后复核未变。仅使用runDirect，实际外部请求1次，
无organize/compose、无回退、无重试。
官方DeepSeek端点、deepseek-flash、temperature=0.1、thinking disabled，
max_tokens=16384、timeout=120000ms；生产默认4096不变。

执行器先完成7个模拟场景，包括成功、JSON/绑定/引用/预算错误、
传输错误及token截断；模拟阶段外部请求0。
真实响应HTTP200、finish_reason=stop，不是token截断。

| 项目 | 实测 |
| --- | ---: |
| 来源 / 可见原始单元 | 4 / 193 |
| 完整输入字符 | 32351 |
| prompt / completion / total tokens | 15417 / 3706 / 19123 |
| 原始JSON响应内容字符 | 8057 |
| 摘要items | 17 |
| 正文目标 / 硬上限 | 3500 / 5000 |
| 校验报告正文字符 | 6408 |
| 仅topic / 仅text字符 | 420 / 5636 |
| 真实请求 / 重试 / 发布 | 1 / 0 / 0 |

首个拒绝为comparison_summary_budget，observedChars=6408。
结构、绑定与引用检查已通过，没有再遇到v1的引用角色交集拒绝。
仅text字段5636字符已超过上限；不能通过删除引用标记或少量排版解决。
相对v1的7166诊断长度下降758字符（约10.6%），仍超过硬上限1408字符。
没有输出有效候选文件、没有修补原响应或发布。

### 原始17项的定向人工复核

- 主要更正保留：mtime部署断言撤回、ID/identity旧诊断更正；
  每日10条与1830旧legacy统计口径区分。
- 保留独立维护/Daily Stats、01/02/03健康结果、632/1241验收和49仍空但不据此判修复失败。
- 恢复了v1遗漏的source=before_prompt_build和trigger=user；
  自然样本窗口、LIMIT200已达上限、traffic_origin/valid及started/completed也保留。
- 保留取消PENDING/INSUFFICIENT_EVIDENCE与“零事件不能证明触发或生效”，FTS采集缺口和max非p95。
- 第7条“Gateway健康与未执行操作”不再明确声称“全程”，
  但“未运行checkpoint、唯一改动是报告”仍未限定核验阶段。
  这属于范围表达仍不充分，不把它等同于已经再次明确断言“全天未执行”。
- 清单逐行指标、signal ID、报告绝对路径等仍大量进入正文，
  没有可靠遵守精简目标，且topic与text仍有重复。
- 原文残差908ms/47.6%的算术问题仍被转述；本轮不认证其计算正确性。

审查为已知重点的人工定向复核，不是所有原子事实的穷尽评分。
所有模型PASS表述均来自原始对话报告，本次没有读live DB或独立认证这些运行事实。

### 裁决与下一步约束

V2_FULL_SAMPLE_FAIL_BUDGET，Bug未修复，未取得发布资格。
有来源限定改善的证据，但没有预算内完整覆盖的成功结果。
这次也说明单次请求中的3500目标与5000硬上限提示没有形成可靠预算控制。
下一候选应先离线明确正文与审计明细的边界，验证实际可执行的写作预算；
不能只增强长度提示、删除引用或降低输出token上限造成截断后称成功。
任何进一步压缩都须复核更正、执行阶段、样本资格和独立事项，不能用预算达标掩盖遗漏。
本轮请求已结束，不用剩余的历史实验配额重试；holdout及产品接线仍未执行。

证据位于 `/home/lionsol/.openclaw/ops/memory-engine/`：

- 执行器：`checkpoint-summary-direct-v2-411bd1e-20261027.cjs`。
- 原始材料：`checkpoint-summary-direct-v2-411bd1e-20261027-evidence/`。
- 审计：`checkpoint-summary-direct-v2-411bd1e-20261027-audit.cjs`。
- 人工复核：`checkpoint-summary-direct-v2-411bd1e-20261027-review.json`。
- 执行器SHA-256：`3946f14f14f9463a43799b43655c97526f843acede0499c2cc07174254218eda`。
- request：`28134d08a725d46a06b394faa15308195ae3c7c87dcc14807a4e3c4c2f48ea17`。
- response：`fb9cde06a803caaa4fb687624fff5a53b01fa6cc2fabf220a91a8831fc95dd32`。
- content：`bdfa7941e1fa834a16de078cdf462e8b6a4c619394dcd6155a70f7cc46e850f3`。

## 实验范围

模块 `lib/checkpoint/summary-comparison-lab.cjs` 不接入生产入口，不读取密钥、
不调用provider、DB或publisher。调用方显式注入模型传输。
没有安装Hindsight或引入图数据库。
本实验仅验证摘要方法，不建立长期画像、长期observations或跨日知识库。

| 路径 | 模型任务 | 请求次数/样本 |
| --- | --- | ---: |
| direct | 完整原文直接生成带引用摘要 | 1 |
| organize → compose | 整理范围/结论/条件/未决问题/更正关系，再生成摘要 | 2 |

两条路径使用相同原文、共同事实要求和5000字符正文上限。
compose同时拿到完整原文及不可信事项草稿，允许核查并纠正草稿。
一次对照最多3请求，错误不重试、不修补；organize失败则不发compose。
direct失败仍独立评估staged；两阶段路径总成本按两次请求计，不伪称同等调用成本。

## 输出与证据

summary输出items：topic、text、evidence、corrects。
ledger输出items：id、scope、conclusion、conditions、unresolved、evidence、corrects。
evidence指向支持当前结论的原始unit；corrects指向被明确撤回的旧判断。
不使用v15的facet/kind字段，不再要求模型输出逐字引文或计算片段组合成本。
跨范围不能机械采用最新陈述，无依据的冲突应保留为未决。

渲染正文允许忠实改写和合并，并使用短证据编号。
独立审查对象保存完整引用单元、原始偏移、角色、来源和source_hash。
正文5000字符包含条目标记与引用编号；证据审查对象不计入正文。
这改变的是实验输出职责，不改变生产发布器。

sourcePacket绑定目标日、原文单元及来源元数据的SHA-256。
模型传输使用unit_columns及数组行，正文逐字保留一次；原始偏移留在可信input。
只有独立heartbeat控制文本被排除。
模型输入system+JSON合计45000字符，超限即停，compose以实际ledger计量。
v2拒绝未知/重复引用、空支持证据及所有支持引用均被标为撤回的条目；部分双重用途按上节定义保留。
当前引用粒度是原始段落，不能表达同段内精确相反范围；必要时应审查为范围不足，
不能在未评测时直接增加复杂定位协议。

程序只检查结构、绑定、引用和预算，不认证结论受引用支持。
测试特意展示：一条错误部署断言仍可能有合法引用，因此语义始终NOT_EVALUATED。
结果固定publishable=false；来源有引用不代表独立事项完整覆盖。
uncitedSourceIds仅供审查，不是质量分数。

## v1离线验证（历史）

15项实验测试，加25项既有catalog测试，共40项通过，0失败/取消/跳过/todo。
包括两路径共同输入、compose原文核查、来源漂移、引用/字段注入、
正文独立预算、两条路径失败隔离、无重试和语义检查边界。

3个合成开发案例位于 `test/fixtures/checkpoint-summary-comparison.json`：

1. mtime部署断言被明确撤回，不能写成一次真实状态变化。
2. 不同日期恢复结果有别；维护dry-run与Daily Stats失败独立。
3. 自然样本max不等于p95；取消零事件只能判证据不足。

这些案例及required/forbidden清单用于后续人工审查；
当前测试没有证明模型通过这些语义要求。它们不是holdout。

固定2026-10-20样本预检：
4个来源、193个可见单元；direct输入31969字符，organize输入31998字符。
compose输入依赖真实ledger，尚未测量。输入字符不是token计量。
源样本SHA-256：
`9b119fdc8c72918cbdc97d2000200b6d14cf71fc3c9b75c0827b2c33e903dbf6`。
episode SHA-256：
`9d97282da2e9e3a8480d0a1b0264f54a15bd209b345f8cc6584738ce704f8f33`。
两者预检后均未变化。

预检脚本：`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-summary-comparison-20261027-preflight.cjs`。
最终预检材料：同目录 `checkpoint-summary-comparison-20261027-preflight-r2/`。
其中有两条首轮请求、3个开发案例的请求、审查清单和report.json。
较早preflight目录保留了压缩字段前的测量，不覆盖历史证据。
该次离线预检真实请求0，发布0，部署0；提交后的真实对照见下节。

## 三个开发案例真实对照结果

执行时间：2026-10-27 16:53:54–16:54:32（Asia/Shanghai）。
仅使用已冻结的3个合成开发案例，没有将required/forbidden评审清单发送给模型。
官方DeepSeek端点，deepseek-flash，temperature=0.1，thinking disabled；
每阶段max_tokens=16384、输入45000字符、timeout=120000ms、正文5000字符。
调用独立实验模块，不修改生产配置，不调用普通checkpoint或publisher。

执行器先完成9次模拟请求和异常envelope检查，外部请求0。
随后每例direct/organize/compose各1次，共9次真实请求，全部HTTP200、finish_reason=stop。
无重试、无响应修补、无发布或部署。
执行前、每次发请求前及执行后检查固定HEAD/干净工作树、fixture/模块哈希、
固定源样本与episode哈希；检查全部通过。

以下是助手逐项人工复核，不是程序自动事实评分：

| 开发案例 | 直接摘要 | 两阶段摘要 | 正文字符：直接 / 两阶段 |
| --- | --- | --- | ---: |
| mtime错误更正 | PASS_WITH_FINDINGS | PASS | 79 / 70 |
| 不同日期与维护/统计独立结果 | PASS | PASS_WITH_FINDINGS | 195 / 226 |
| 取消证据不足及max非p95 | PASS | PASS_WITH_FINDINGS | 220 / 234 |

更正案例两条路径都没有确认10:51:54为部署时刻，
corrects都引用被撤回的原始判断，并保留需要加载日志确认的限制。
直接摘要保留mtime观测值，用“不能证明部署时刻”和渲染的“更正”标记表达撤回；
这不构成部署时间错误，但表达不如两阶段直接。

日期案例两条路径都保留了10-18/19恢复、10-15/16无数据及原因未知，
没有把维护dry-run无写入与Daily Stats失败/未修复合并。
两阶段输出在topic与text中重复日期，没有增加已要求的事实。

证据不足案例两条路径都保留15/15 valid及started/completed、p50/max和max非p95，
取消事件0条及字段缺失保持PENDING/INSUFFICIENT_EVIDENCE；
没有把“无迟到事件”解释成取消机制已生效。
两阶段正文重复了取消不确定性。原fixture没有具体UTC起止日期，因此不能据此声称
真实自然样本的完整时间窗口已被保留。

| 实测总成本（3个案例） | 直接摘要 | 两阶段合计 |
| --- | ---: | ---: |
| 请求次数 | 3 | 6 |
| prompt tokens | 2052 | 4964 |
| completion tokens | 546 | 1293 |
| total tokens | 2598 | 6257 |
| 请求耗时累计ms | 4298 | 9649 |

两阶段总tokens约为直接摘要的2.41倍，尚无关键事实正确性优势证据。
耗时为顺序执行时的描述性测量；请求存在缓存命中，未随机化顺序，
不作为独立延迟基准或货币成本对比。
9次请求总tokens=8855。

审计重新验证请求/响应/内容SHA-256、引用绑定、ledger及正文渲染结果。
原始result.json保留semantic_review=NOT_EVALUATED；
人工结论独立写入review.json，不覆盖原始响应。
3个案例均只有2段输入，不能检验长输入注意力、全天事项覆盖或5000字符压缩压力，
也不是未见holdout。当前裁决只支持进入完整样本对照，不能宣称摘要事实Bug已修复。
基于当前证据，优先保留direct作为更简单的候选，不预先决定接入两阶段。

证据位于 `/home/lionsol/.openclaw/ops/memory-engine/`：

- 执行器：`checkpoint-summary-compare-9991345-20261027.cjs`。
- 原始材料：`checkpoint-summary-compare-9991345-20261027-case0/`、`case1/`、`case2/`（后两者同一完整前缀）。
- 审计：`checkpoint-summary-compare-9991345-20261027-audit.cjs`。
- 人工复核及成本：`checkpoint-summary-compare-9991345-20261027-review.json`。
- 执行器SHA-256：`4c6463f8e639801efd5008f87a3caf9083e93a8f8824c6bcd43f698b454ccf10`。
- fixture SHA-256：`9cb80c45e31a7086ffda0896cfe5f41ce4e98f48ec4676412a3d67cfeb7b4a3d`。
- 模块SHA-256：`b2a9a91a46449133456451266d5417b6681dd9a4d8ae22cbf2caa0cbaea2c8ca`。
- 每阶段request/response/content哈希在各case的result.json中。

## 完整2026-10-20样本：两条路径均未产出有效正文

2026-10-27 17:05:50–17:06:38（Asia/Shanghai）。
在已提交且干净的工作树执行，模型与请求参数同开发对照；
完整4来源/193个可见原始单元，原始全局编号与来源信息保留。
执行器自检3次模拟请求通过，实际外部请求共2次。
direct与organize均HTTP200、finish_reason=stop，无token截断。
compose在本地输入预算检查被拒，未发送第3次请求；未使用剩余配额重试。
无发布、部署、生产配置或DB变更，源样本/episode与代码绑定检查全部通过。

| 项目 | direct | organize / staged |
| --- | ---: | ---: |
| 实际请求输入字符 | 31969 | 31998 |
| prompt tokens | 15190 | 15207 |
| completion tokens | 4197 | 8046 |
| total tokens | 19387 | 23253 |
| 原始响应内容字符 | 9192 | 18240 |
| 返回items | 23 | 45 |
| 首个拒绝 | comparison_reference | comparison_input_budget |
| 诊断性排版/输入测量 | 正文7166字符 | compose输入50269字符 |
| 对应预算 | 正文5000 | 输入45000 |

总tokens42640；实际只完成direct和organize，不能拿两者成本当作完整两路径成本比较。

### 直接摘要拒绝及定向语义审查

首个拒绝是第8条（零基index7，mtime撤回事项）的
`s0.t5.p1`同时出现在evidence和corrects。
全部引用均为已知ID，无单数组重复；审计确认只有这一处交集。
该事项正文明确撤回mtime部署推断，因此这一拒绝首先说明引用角色契约不匹配，
不能把它直接当作“模型再次确认了旧部署时间”的语义失败。
本轮不修改响应、不绕过校验生成有效候选。

独立按原始23项计算版式长度为7166字符，比5000多2166。
这里只作诊断性长度计算，没有保存修补后的正文、没有通过validateSummary。
所以即使解决交集问题，本次输出仍不能直接满足正文预算。

人工逐项阅读23项输出并针对既有重点对照原文，发现：

- 改善：明确撤回mtime断言；更正ID/identity旧诊断；每日10条与1830旧legacy口径有区分。
- 保留：维护与Daily Stats独立结果、01/02/03健康检查；632与1241验收、49仍空及修复路径未获运行验证；自然15条窗口、LIMIT200、max非p95、FTS缺口和取消PENDING。
- 范围错误：第23条“执行边界”把多个核验阶段局部的“未运行checkpoint、唯一改动是报告”等声明归纳成“全程”。原文`s0.t1.p3`和第2条又明确报告10-18/19 episode已重跑；`s0.t5.p0`、`s0.t9.p9`中的限制只适用于各自阶段，不能扩为全天。
- 限定遗漏：第21条自然样本核验保留valid和started/completed，但省略原文`s0.t27.p1`中的source=before_prompt_build、trigger=user资格依据。
- 数值边界：原文残差908ms/47.6%的算术不一致仍被转述，本轮不将它认证为正确计算。
- 以上为有明确定位的定向复核，不是全天所有原子事实的穷尽评分；已足以否决发布资格。

### 两阶段停止位置

organize返回45项，结构和引用校验通过。
草稿包含清单哈希、逐项计数、报告路径、前置可见性等大量明细。
与完整原文一起构建compose输入时，实际需要50269字符，超过45000约5269字符。
诊断测量只在本地扩大计数上限以取得准确长度；没有发送超限请求或改变执行预算。
未删除原文、未静默裁剪草稿，也没有最终staged摘要可供质量比较。
因此不能声称“两阶段语义失败”或“direct最终质量优于staged”；
能确认的是当前两阶段设计在该完整样本上无法完成预算内执行。

### 裁决与后续开发重点

FULL_SAMPLE_FAIL。小样本成功不能外推到长输入。
继续保留原文、证据与生成式摘要分开的方向，优先收敛direct路径：
明确限定每项结论的执行范围，保留自然样本资格条件，
将报告路径、清单哈希与重复审计明细放在证据记录中，减少正文负担。
引用中“支持当前结论”与“交代被撤回历史”的关系需要澄清，不能靠任意删除一个引用修补响应。
下一次源码候选应以本轮范围错误和实际超预算输出作为失败回归；
暂不追加模型阶段，也不以提高上限替代解决冗余。
完整选型与holdout仍未完成，摘要事实Bug未解决。

证据目录均在 `/home/lionsol/.openclaw/ops/memory-engine/`：

- 执行器：`checkpoint-summary-full-7fa781a-20261027.cjs`。
- 请求、响应、原始内容、comparison/result/source：`checkpoint-summary-full-7fa781a-20261027-evidence/`。
- 审计：`checkpoint-summary-full-7fa781a-20261027-audit.cjs`。
- 独立人工复核记录：`checkpoint-summary-full-7fa781a-20261027-review.json`。
- 执行器SHA-256：`54a76fc78bdd9be7e60c1b71d20c618515b1ed2ae107e2e12883fb398ecef7cf`。
- direct request：`f2e35e4ffc7d8ff58589abcab53a23cb486a7bd11bc3e6a58afa46a0dc82d358`。
- direct content：`7648221e462cab0196f78db49aa46a064d5b507e8f8a61927408dff5dfe7300f`。
- organize request：`187bf0a5e279a24eaaad85e43bde67a4953ed9d2ef82395e723a33fd35ca0dd5`。
- organize content：`6f53880d19c34033fc34890550bffb093bf435bb29a5bfbcd283dd7dcc158602`。
- 各完整envelope哈希、usage与时间保留在result.json。

## 历史：完整样本执行前的既定评审方法

开发案例阶段后，完整样本另行冻结direct1次、organize1次、compose最多1次，最多3请求且不重试。
该完整样本执行已完成并失败，实际请求2次，详见上一节；以下保留原评审方法。

以下为既定评审方法：

真实对照使用已提交实验代码，并绑定执行器与每阶段预算。
三个开发案例已比较direct与staged，共执行9请求，无重试。
模型、temperature、thinking设置与每阶段输出预算须一致并记录；
完整对照的总tokens、调用次数、耗时分别报告。
这不是复用旧v15“最多1请求”验收执行器；真实对照有独立执行范围。

逐项人工核对：无依据断言、已撤回判断冒充现状、关键事项遗漏、
数字/日期/否定/条件/不确定性丢失、正文长度。
任何关键事实错误都不能用“引用合法”抵消。
2026-10-20完整样本已检查并发现预算与范围问题。
该完整样本已用于多轮调试，不能充当holdout。
在选型前还需要未用于调试的独立样本；目前holdout选择与执行均未完成。

若direct质量相当或更好，采用更简单路径；只有staged的改善有实际证据时才接入两阶段。
若两者均失败，保留失败材料并重新定位，不追加一轮提示词后重复宣称已修复。

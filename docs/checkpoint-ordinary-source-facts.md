# 普通 checkpoint：证据选择与验收记录

日期：2026-10-27（Asia/Shanghai）。
当前v15源码已提交：`db0fc3d39a5386d4ea0c7bcc008c54e969a8ef90`。
本轮固定样本真实验收仅请求1次，裁决失败：选中429条，渲染预算校验报告48192字符，超过5000上限。
原始选择同时保留已撤回判断与更正，全部使用默认outcome/report。没有有效正文、发布或部署。
此前离线与历史记录保留在后文；编号绑定通过及输出缩短不等于摘要质量PASS。

用户已同意转向原文保留、事项最终状态整理及带引用的生成式摘要。
隔离对照候选与验证边界见 [摘要方案对照](checkpoint-summary-comparison.md)。
三个合成开发案例的真实对照已完成：两条路径均保留关键事实，两阶段尚无质量优势且总tokens约2.41倍。
完整2026-10-20样本对照已失败：direct引用角色交集且诊断正文7166字符；staged的compose输入50269字符超限，未发送。
另发现局部执行边界被归纳成全天、自然样本source/trigger条件遗漏。
v2直接摘要已单次真实验证：引用通过但正文6408字符超5000；自然样本source/trigger已恢复，核验范围仍需明确。
44项离线检查不能代替质量验收；本轮未重试、未发布或部署。
holdout未执行，未接入生产，Bug未解决。

## 当前v15：编号及标签选择

普通调用路径为“完整原文候选目录 → 一次编号/标签选择 → 程序取回原文 → 绑定与渲染 → 既有发布门禁”。
正常成功请求1次；仅传输不可用时沿用既有provider回退，最多2次传输。
JSON、结构、编号、标签、重叠、来源覆盖或预算失败立即停止，不修补响应、不追加选择。
生产默认4096 token、正文5000字符及既有配置保持不变，无新runtime或DB行为。

协议为 `checkpoint-source-facts-v15`，输入stage为 `catalog_select`。
模型只返回以下结构，不再复制引文：

~~~json
{
  "protocol": "checkpoint-source-facts-v15",
  "target_date": "2026-10-20",
  "selected": [
    ["u12_0"],
    ["u13", "cause", "correction"]
  ]
}
~~~

selected每行固定1至3列：[候选id,facet?,kind?]，默认outcome/report。
facet为outcome|constraint|uncertainty|cause；
kind为observation|report|decision|hypothesis|correction|request。
非默认kind必须显式给出facet，不接受null占位、换列、对象行、额外列或任意额外字段。
最多512个选中项；空选择、未知/重复id、重叠整段与片段均拒绝。
旧v14引文响应、旧预览selected_ids及旧候选selected_candidate_ids不转换。

程序从可信input重新生成目录来解析id，模型不能指定quote、source、unit或偏移。
按照原始unit及范围排序，逐字取回引文并保留返回的kind/facet。
每个原单元形成程序分组，元数据明确event_grouping=source_unit_not_semantic，
不把它当作模型已经识别出的独立事项。归组、标签和最终选择均未独立核验。

目录仍包括整段及语法片段备选，每个unit.parts逐字回拼为原始内容，整段不重复传输。
source的entry_id、source_hash、source、provenance和collected_timestamp_ms等元数据保留，
连同role、标题所在unit及可见表格列名一起供模型判断。
只排除既有独立heartbeat控制内容，保留原始全局编号；无候选时在发请求前停止。
目录最多2048项，达到上限时停止生成并报错，不截断原文或静默删候选。

成本由既有渲染器计算，使用最长kind“observation”及c512编号作保守上界，
不再假设全部为report；context、表头及source/role组切换成本均包含。
实际正文仍由渲染器按选中标签计算并校验5000字符，不使用估算替代硬门禁。
全部来源须有代表；需要助手结果时，用户检查请求仍不能替代助手证据或明确用户decision/correction。

不可枚举CATALOG_SELECTION保存冻结的独立选择副本；FINAL_EVIDENCE保留最终原文范围。
发布前再次按input生成目录、解析编号，并核对最终事实的引文、范围和标签是否一致。
即使输出facts和FINAL_EVIDENCE同时被改动，固定编号绑定仍会拒绝另一段原文。
同时保留原始输入/episode版本检查及写入失败保护；全部该路径事实不派生长期记忆或配置。
新增catalog_candidate_count、catalog_selected_ids及候选id到原文范围的审计表。
这些字段不证明语义完整性；仍没有omissions账本或“所有独立事项已覆盖”的新保证。

## v15离线验证与限制

19个相关测试文件419项通过，0失败/取消/跳过/todo；新编号契约测试25项。
覆盖编号/标签形状、未知/重复/重叠、旧协议和字段注入拒绝、原文重绑定、
最长标签成本、重复source/role切换成本、单次调用和传输回退、
长段短摘录、表格完整行、来源覆盖及实际临时目录发布保护。
旧引文与候选选择内部接口继续保留测试，但普通llmNightlyExtract只走新编号路径。

固定样本离线脚本与结果：
`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-v15-catalog-selection-offline-20261027.cjs`
及同名 `.json`。
脚本使用fake HTTPS经过实际llmNightlyExtract和发布前校验函数，不调用实际publisher。

| 项目 | 离线实测 |
| --- | ---: |
| 可见原始单元 / 目录候选 | 193 / 587 |
| system / JSON / 完整输入字符 | 1065 / 38311 / 39376 |
| 人工参考选择 | 30条 |
| 原参考范围完全相同 / 扩大 | 25 / 5 |
| 原参考非默认标签保留 | 13 / 13 |
| 人工构造编号及标签响应 | 543字符 |
| 实际正文 / 保守成本 | 4444 / 4627字符 |
| 模拟请求 / 真实请求 / 发布 | 1 / 0 / 0 |

诊断映射仍将既有人工参考引文映射到包含它的最小候选；
5处扩大仍为4处列表标记及1处mtime标题，不是30条引文完全等价回放。
与原型不同，kind/facet不再中性化，13条非默认标签逐项断言一致。
原文逐字回拼、source元数据、source/episode及v11/v14原始响应哈希均通过核对。
543字符不是实际模型token数；人工参考也不是全天完整性基准或自动模型结果。

语法分段仍可能把跨片段的条件/否定分开，整段仍可能同时含旧判断和更正。
程序能核验编号、原文和成本，不能证明模型选全了限定或排除了旧推断。
提交后的真实验收已完成，结果见下节；不能仅凭编号响应更短就判定Bug已解决。

## v15真实验收：编号有效，但预算与最终状态筛选失败

2026-10-27 08:47:43–08:47:51（Asia/Shanghai），在已提交且干净的工作树上执行。
固定2026-10-20样本与既有episode均按SHA-256绑定；执行后再次核验未变。
官方DeepSeek端点、deepseek-flash、thinking disabled、temperature 0.1；
仅本进程覆盖max_tokens=16384、输入45000字符、timeout=120000ms。
fallback=none、retries=0、最多1请求；结束后恢复进程配置，生产默认4096未变。
执行器先通过12项fake HTTPS自检，真实外部请求为0；随后单独执行唯一真实请求。

| 项目 | 真实实测 |
| --- | ---: |
| HTTP / finish_reason | 200 / stop |
| 完整输入字符 / 可见单元 / 候选 | 39376 / 193 / 587 |
| prompt / completion / total tokens | 18659 / 2529 / 21188 |
| 原始响应内容字符 | 4516 |
| 选中项 / 原文单元分组 | 429 / 159 |
| 整段 / 片段选择 | 35 / 394 |
| 非默认facet或kind | 0 |
| 仅选中引文字符合计 | 21365 |
| 渲染校验报告字符 / 上限 | 48192 / 5000 |
| 真实请求 / 重试 / 发布 | 1 / 0 / 0 |

首个产品拒绝为 `summary_budget`，observedSummaryChars=48192；
不是token截断、未知编号、重复编号、范围重叠或表格末尾竖线遗漏。
只读复核通过真实decodeCatalogSelection：编号、逐字范围、表格与来源覆盖契约有效。
159是原文单元分组，不是159个经语义核验的独立事项。
原始内容4516字符是编号响应长度，不是最终正文长度；
仅引文已达21365字符，单靠减少渲染标记也无法使这次选择满足5000字符。
未绕过门禁生成可发布正文，未缩减、修补或再次请求模型。

### 原始选择的定向语义复核

- u26_2仍选“永远追不上”，u35_1仍选1830欠账推断；与此同时又选u43_0/u43_1的每日10条保留限制及unknown_legacy口径更正。
- u35_0/u35_2保留旧的ID/identity未修复判断，又选u41表格及u42修复路径更正。
- u30_0保留“10:51:54整体替换”的mtime部署断言，又选u46与u51_2撤回该说法。
- 429行均未提供facet/kind；更正、限制与证据不足均落入默认outcome/report。接口保留标签的离线能力没有转化为本次模型输出中的标签辨别。
- 自然15条样本的窗口、LIMIT 200、valid/source/trigger、started/completed限定均在u176选择中；u178完整数据行、u179的FTS采集缺口、u181的max非p95及u182取消证据不足说明也被选中。
- u180保留原文“无法归因”，但原文残差算术本身不一致；本次不认证其数值正确性。

这些是最终选择中的旧判断与更正并存，不是等待第二轮筛选的临时候选池。
定向复核足以否决最终状态筛选，不代表已完成全天逐项完整性审计。
未产生有效正文，因此不作正文可读性或发布质量PASS声明。

### 裁决与下一步

v15降低了复制原文的输出开销，也避免了本次范围格式错误，但没有完成预算内的证据取舍。
本轮实际选中429条；不能把离线人工30条/4444字符当成模型可以自动做出的选择。
下一步先在离线环境定位为何目录提示导致广泛枚举，并设计可检验的预算分配和最终状态选择约束；
同时保留关键限定与更正，不能用固定条数截断或按原文顺序删减掩盖遗漏。
再次真实验收前应先形成可审查的源码候选与失败回归。本轮不再请求、不部署。

证据保存在 `/home/lionsol/.openclaw/ops/memory-engine/`：

- 执行器：`checkpoint-v15-db0fc3d-20261027.cjs`。
- 原始请求、响应、内容及运行结果：`checkpoint-v15-db0fc3d-20261027-evidence/`。
- 只读复核：`checkpoint-v15-db0fc3d-20261027-audit.cjs`；不修补、不渲染、不请求provider、不发布。

| 绑定对象 | SHA-256 |
| --- | --- |
| 源样本 | `9b119fdc8c72918cbdc97d2000200b6d14cf71fc3c9b75c0827b2c33e903dbf6` |
| 原episode | `9d97282da2e9e3a8480d0a1b0264f54a15bd209b345f8cc6584738ce704f8f33` |
| 执行器 | `6f061c8701e32c4365a873e5309ec8096da4603f78a5c97e62d4939a3c144ee1` |
| messages | `9cf8141c28bbd2b15baba8c6f8d7ede6f6560c57641d1abe746fbd0bf392b9fb` |
| request | `23f0f0b69091f4cac7c432d1945c8e806e93f7d9cd6b76ea1ef4827f334c7258` |
| provider response | `691a0f484e697cd640fe24743eddad655aa9de33d6c2493a49cde03f4d035fd8` |
| provider content | `70eb23bdb2c45498303d08a8682698ba9d1f7821909c25707789f5701616baa0` |

## 历史：2026-10-26细粒度候选目录离线原型（当时未接入）

本轮基于 `5a38248`，新增 `ordinary-evidence-catalog.js` 与20项定向测试。
仅验证“原文一次传输、程序编号片段及整段备选”的可表示性和预算。
没有修改llmNightlyExtract调用路径、v14协议或生产默认预算；没有真实模型请求、发布或部署。
这不是新的已接线修复，不应对这个预览协议直接运行现有验收执行器。

语法分段保留原始偏移：按中文句末标点和换行提供短片段，原段始终有完整备选。
不按ASCII小数点拆分；匹配的括号/中文引号内部、行内代码内部不拆；
检测到代码围栏或未闭合括号/行内代码时保守保留整段。
表格复用既有tableCells解析，数据行保持完整，表头/分隔行只作上下文。
重复出现而无法满足现有唯一定位要求的短引文不单独编号，其文本仍在原段中。
这不是完整Markdown或语义解析器；不能保证任意源码、引号、嵌套结构都得到理想粒度。
每个单元parts逐字拼接必须等于原始unit.text，未缩写、裁切、改写或删除业务文本；
只有既有独立heartbeat控制单元不进入目录，原始全局编号不变。

完整备选id为u加原始单元编号，短片段为u编号_分段序号。
预览数据包按列传unit、source_id、role、整段成本、标题所在unit和parts；
parts为[text,id?,cost?]。整段引用这些parts，不再次复制整段文本。
标题所在单元和同段表头已包含在原文中；各片段渲染成本仍包括必要标题/列名。
目录最多2048候选，超限报错而非截断；这没有提高现有事实输出512条上限。

成本探针 `previewLiteralCost` 复用当前渲染器。
当前实验仅按report/outcome中性标签计费；c512编号长度为最多512个最终事实提供保守上界，
并按原文顺序增加来源/角色组切换成本。它不是任意标签下的精确报价。
`buildCatalogPreview` 校验完整system+JSON长度，协议为
`checkpoint-evidence-catalog-preview-v1`；当前产品拒绝其selected_ids响应。
尚无生产ID解码、选择范围重验或发布接线，也没有把单元筛选结果冒充语义完整性。

固定样本只读诊断脚本：
`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-catalog-preview-offline-20261026.cjs`。

| 项目 | 离线实测 |
| --- | ---: |
| 原始可见单元 / 逐字回拼 | 193 / 完全一致 |
| 整段 / 短片段 / 总候选 | 193 / 394 / 587 |
| system / JSON / 合计输入字符 | 592 / 37676 / 38268 |
| 人工30条参考中范围完全相同 / 扩大 | 25 / 5 |
| 诊断选择 / 正文字符 / 保守成本 | 30 / 4438 / 4477 |
| 诊断selected_ids响应字符 | 230 |
| 被中性化的非默认标签事实 | 13 |

诊断映射只用于可表示性检查：将既有人工30条参考逐条映射到包含它的最小候选，
再移除已被更大范围包含的重复选择。5处扩大为4条补回原文列表标记 `- `，另1条补回mtime标题。
该映射不是生产响应修补，也不是模型选择；13条原参考的非默认kind或facet改为report/outcome，
所以4438字符不能声称与原人工参考等价。230是字符数，不是token计量或真实模型输出。
source、episode和v11原始响应哈希已断言匹配既有记录。
未改写任何原始响应；未调用provider或publisher。

18个相关测试文件394项通过，0失败/取消/跳过/todo；其中新目录测试20项。
覆盖长段短结果、混合旧/新判断可分选、CRLF、转义/代码中的管道符、完整表格行、
括号/行内代码/围栏保守处理、重复引文、全文逐字回拼、完整输入预算和目录上限。
也保留一个明确反例：只选“样本15条。”在结构上仍可通过，
而同段“只有valid=true才算有效”不会自动带入。
因此该原型证明输入预算和短编号表达可行，未证明限定不会遗漏或旧判断不会误选。

下一步接线前还须解决：保留kind/facet的编号响应契约及相应成本、
严格ID/重复/重叠与范围绑定、来源覆盖、最终正文预算和发布重验。
之后才可接入一次选择调用，并以真实固定样本检验最终状态及限定条件。
该原型提交时，工作树的LLM调用路径仍为下述v14路径，v14真实失败裁决不变。

## v14历史路径及边界

普通路径改为“完整来源 → 单次最终证据提取 → 程序绑定/渲染 → 既有发布门禁”。
移除活动路径的临时候选池、完整原段备选扩张及第二轮编号选择。
正常1次请求；仅传输不可用时沿用既有provider回退，最多2次传输。
成功响应若JSON、结构、原文或正文预算无效，立即失败，不回退、重试或追加选择。
生产默认4096 token、正文5000字符不变，无新配置或部署、runtime、DB、AutoRecall变更。

新协议为 `checkpoint-source-facts-v14`，输入stage为 `final_evidence`。
响应仍采用紧凑events数组，但其含义已改为最终证据，所有返回引文均进入正文：

~~~json
{
  "protocol": "checkpoint-source-facts-v14",
  "target_date": "2026-10-20",
  "events": [["s0", [
    [12, "完整原文结果"],
    [13, "仍有效限制", "constraint"],
    [14, "最终确认：令牌过期。", "cause", "correction"]
  ]]]
}
~~~

每个事项为[来源id,引用数组]；每条引用为[unit,quote,facet?,kind?]。
默认outcome/report；非默认标签必须显式保留。程序生成事项和事实编号。
v13响应、旧对象事项、编号选择响应及额外派生字段均拒绝，不做生产协议转换。
来源全文、原始全局段号及哈希仍保留；只排除既有独立heartbeat控制标记。
短引文必须在同来源指定原段连续、精确、唯一，彼此不重叠；表格必须保留完整数据行，
程序补充原文标题与列名。每个来源仍须有代表，助手结果不能用用户检查请求替代。

提示要求先通读后文核对最终状态，再共同提取结果、限定、日期范围和不确定性；
被明确撤回的判断不选，不跨任务合并原因，不逐段登记日志等待下一轮压缩。
这只是模型任务要求，机械校验仍不能证明没有漏掉限定或选错最终状态。
整段候选不是唯一允许形式：长段中的短结果和混合段中的有效判断仍可单独摘取。
否则超过5000字符的单段会使可摘要来源不可用，且可能把同段旧判断重新带回正文。

程序以不可枚举FINAL_EVIDENCE注记保存经过校验的最终范围及标签；
发布前重新核对输出事实是否精确一致，禁止修改quote/kind/facet、加记忆或配置字段、
再挂旧候选规划或二次摘要选择。所有该路径事实均禁止派生长期记忆/配置。
元数据新增final_evidence_selection_applied及final_evidence_count；
model_final_selection_verified仍为false，semantic_quality仍为not_independently_verified。

**移除账本的实际边界：** 新路径没有临时候选集，因此不返回旧omissions，
也不声称candidate_omissions_complete或候选池完整覆盖。
原始单元范围、选中范围和来源哈希仍写入审计元数据，但不能说明每个未选单元为何被省略，
更不能证明所有重要事实已覆盖。旧账本的范围校验不会在这条新路径运行；
旧两轮构建器、选择器及其测试仅保留为历史内部接口，llmNightlyExtract不再调用它们。
取舍是去掉重复生成/选择和未核验的遗漏理由，真实语义验收仍是必需步骤。

## v14真实验收：表格范围、预算与最终状态筛选均未解决

代码提交：`2e4dd58336058051e5c621bff07a4b0df4b50436`，调用前工作树干净。
时间：2026-10-26 22:48:38至22:49:04（Asia/Shanghai）。
仍使用2026-10-20固定来源；4个来源、197个原始审计单元、193个可见单元。
官方DeepSeek端点、deepseek-flash、temperature=0.1、thinking=disabled、stream=false。
进程内验收额度：max_tokens=16384、maxInputChars=45000、timeout=120000ms；
本轮上限1次请求，fallback=none、retries=0。生产默认4096 token、正文5000字符未改。

执行器13项离线自测通过后，实际发送1次请求；HTTP 200、finish_reason=stop。
产品拒绝码为 `summary_plan_table_row_scope`；未生成有效candidate.md或validated-candidate.json。
没有修补模型响应、追加选择或再次调用。publisher/checkpoint/scheduler均为0。

| 项目 | 真实实测 |
| --- | ---: |
| 请求输入 | 40305字符 |
| prompt / completion tokens | 17497 / 7693 |
| 原始响应内容 | 16535字符 |
| 事项组 / 引文 | 21 / 89 |
| 仅引文原文合计 | 14667字符 |
| 正文上限 | 5000字符 |

首个机械错误是event 6、unit 41的表格引文：它是完整原段的精确前缀，
只漏掉末尾空格及管道符 ` |`。这不是漏掉一个数据单元格，但违反当前完整原文行范围要求。
逐条离线检查显示89条引用均可在声明来源原段唯一定位、没有重叠，
仅此1条触发表格范围错误。未放宽校验，也没有自动补齐或修改原始响应。

**预算是独立失败。** 89条引文自身共14667字符，且均无CR换行；
按当前渲染规则再加标记、归属和上下文只会增加长度，已经证明所有返回证据不可能装入5000字符。
14667是原文长度下界，不是实际渲染正文长度；产品在表格范围处就已停止。
即使补齐那两个尾字符也不能让这批选择通过预算。
实际输出7693 token也超过生产默认4096；没有额外发起4096额度请求。

**原始最终选择的定向语义复核也失败。** 以下是源单元编号，不是已发布摘要：

| 旧判断与后续纠正 | 原始返回中同时存在 |
| --- | --- |
| unit 26“永远追不上”与unit 43说明旧1830统计不能作为新版可回填队列 | 是 |
| unit 35“不是修复”的身份诊断与unit 42确认已有修复路径 | 是 |
| unit 30依据mtime认定10:51:54整体替换与unit 46否认mtime能确定准确部署时刻 | 是 |

v14要求每条返回引文都进入最终正文，所以这不是尚待下一轮取舍的候选并存。
结构拒绝阻止了发布，但原始选择本身没有达到“只保留最终有效判断”的要求。
同时，定向复核确认unit 176的自然样本窗口与valid=true、unit 178的n/p50/max列名、
unit 179的FTS观测缺口、unit 181的max不能当p95、unit 182的取消证据限制均有保留。
这些局部保留不能抵消旧判断并存，也不构成全天完整性证明；源记录中的残差算术未被认证。

### 裁决与下一步边界

v14减少了调用次数，却没有解决输出规模和最终状态选择。
与v13的7745输出token相比，本轮仍为7693；单个样本不证明一般趋势，
但足以拒绝“换成单轮就能满足默认预算或保证最终状态”的结论。
此前人工30条夹具能生成4448字符，只证明那组人工选择可行，不能预测模型会这样选择。

不以补表格尾符、放宽完整行校验、抬高预算或再添一句提示当作已完成修复。
下一步应先离线评估程序预编号的细粒度原文片段与整段备选，
让模型选择可见成本的编号而不重复抄录；必须同时处理长段、混合旧/新判断、
表格行和跨片段限定，不能直接退回“整段唯一候选”。
此方向尚未实现，也未证明能解决语义取舍；验证粒度和预算前不追加真实调用。

执行证据位于 `/home/lionsol/.openclaw/ops/memory-engine/`：

- 执行器：`checkpoint-v14-2e4dd58-20261026.cjs`。
- 原始证据目录：`checkpoint-v14-2e4dd58-20261026-evidence/`。
- 只读复核：`checkpoint-v14-2e4dd58-20261026-audit.cjs`，不修补、不渲染、不发布、不请求provider。
- 执行器SHA256：`d6dc2d8b4d1c77e9c2fc7f541f9aec58cf63b999dcc4a07766e5dc02ef4cfcf0`。
- 请求SHA256：`ba19bc775e116a30306e4684663376d8c34d56731ce2a4c3b81efd7c8620bf8f`。
- 原始响应SHA256：`21c60a7722d877a156b33a8afb8376561158da5d22c143f674ec4f0c083e2f66`。
- 原始内容SHA256：`cbb45ab3d1e1d54495494c87e7de5d09d0a2dcd665d0700f4256d1e93e5168fd`。
- source SHA256：`9b119fdc8c72918cbdc97d2000200b6d14cf71fc3c9b75c0827b2c33e903dbf6`。
- episode SHA256：`9d97282da2e9e3a8480d0a1b0264f54a15bd209b345f8cc6584738ce704f8f33`。

source/episode和原始响应未变；无部署、runtime配置或DB写入。
本轮只更新验收文档，不改源码，因此未重跑提交前374项回归。
执行器原始result.json中的semantic_review=not_performed保持原样；
本节及只读审计记录的是后续针对原始选择的定向复核，不是有效正文的完整语义验收。

## v14提交前离线验证与限制

17个相关测试文件共374项通过，0失败/取消/跳过/todo；包含新的7项最终证据测试。
HTTP及实际临时目录发布测试覆盖：单次成功调用、同输入传输回退、
无效输出不重试、长段短摘录、同段旧判断排除、限定保留、表格列名/完整行、
篡改标签或引文拒绝、来源覆盖、源文件和episode版本变化、正文超限时不覆盖旧摘要。
旧候选选择及遗漏账本校验仍有独立历史单元测试，不将其通过算作新路径的模型质量证据。

固定样本离线脚本：
`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-v14-final-evidence-offline-20261026.cjs`。
结果：
`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-v14-final-evidence-offline-20261026.json`。

| 项目 | 离线实测 |
| --- | ---: |
| 可见原始单元 | 193 |
| 唯一请求输入（system + JSON） | 40305字符 |
| system / JSON | 1088 / 39217字符 |
| 人工参考最终证据 | 30条 |
| 人工构造响应 | 3314字符 |
| 渲染正文 | 4448字符 |
| 模拟HTTP调用 / 真实请求 / 发布 | 1 / 0 / 0 |

该夹具显式复用既有v11候选池上的人工30条选择，保留每条unit/quote/facet/kind，
仅重建v14传输结构及程序编号；旧协议原始响应先验证为拒绝。
source、episode及v11/v13原始响应哈希均未变。
程序默认4096 token未改；3314字符不是token计量，也不是实际模型输出。
该人工选择不证明完整日覆盖；检查通过的样本限定和更正不是模型质量PASS。
下一步应对已提交候选进行固定样本真实验收：检查实际输出token、5000字符预算、
最终状态/限定条件与独立结果遗漏；不能仅因请求次数减少便宣称Bug已解决。

## v13历史路径及边界

普通提取仍为“完整来源提出候选 → 最终编号及遗漏理由 → 程序生成事实及正文 → 既有发布门禁”。
正常两次逻辑调用；第一轮仅传输不可用时沿用一次既有provider回退，
第二轮固定成功provider/model，无重试、回退或第三轮，实际传输上限仍为三次。
正文5000字符、生产默认4096 token不变；无新配置、runtime、DB schema或AutoRecall变更。
只生成来源日报及既有episodic记录，不派生长期记忆/配置。

第一轮输入保留完整来源、原始全局段号及哈希，输出使用v13的紧凑数组格式（见下节）。
仅排除两种既有独立heartbeat控制标记。引文必须在同来源指定原段连续、精确、唯一，
模型引文之间不能重叠；表格保留完整数据行，列名由程序定位。
各非控制来源须有代表，有助手结果时不能仅保留用户检查请求。
第一轮归组及标签未独立核验，不将所有候选或所有旧constraint自动冻结为必选。

## 两轮传输仅压缩表示，不删证据

第一轮模型回复：

~~~json
{
  "protocol": "checkpoint-source-facts-v13",
  "target_date": "2026-10-20",
  "events": [
    ["s0", [
      [12, "完整结果原文"],
      [13, "仍有效的限制", "constraint"],
      [14, "最终确认：令牌过期。", "cause", "correction"]
    ]]
  ]
}
~~~

每个事项行固定两列：[source_id, evidence_rows]。
事项id由程序按行序生成为e1/e2等，不要求模型重复输出id字段。
引用行固定2至4列：[unit, quote, facet?, kind?]，默认facet=outcome、kind=report。
默认尾列可省，非默认值必须保留；顺序错、列数错、null占位、非法枚举和旧对象格式均拒绝。
顶层仅protocol/target_date/events，事项/引用总量仍有限制。
llm在首轮成功回复后先decodeEventPlan，再执行既有规范对象校验；
不计算或猜测偏移，不改写quote，不把对象响应静默转为合法数组。
语义归组仍未核验，程序生成e编号也不证明归组正确。
内部EVENT_PLAN仍使用规范对象，供原文校验和发布重验；这不是第二套provider格式。

第二轮请求以candidate_columns声明字段顺序，candidate_rows逐行保留相应值；
不再发送每项重复完整字段名的candidates对象数组。列顺序为：

~~~text
id, unit, source_id, role, origin, event_id, facet, kind,
quote, context, cost, group_key, group_cost
~~~

每行均保留这些值，包括全部引文、完整原段备选、原始上下文及范围、实际渲染成本。
来源覆盖标志、预算、候选顺序与原文排序不变；提示明确按列名读取，不把列位置当候选编号。
完整system+JSON长度仍计入maxInputChars，超限仍停止，不删除行、缩短引文或抬高上限。
第二轮回复继续为selected_candidate_ids与完整omissions，不增加一次模型调用。
模型对数组位置/默认标签的理解仍待真实验收；结构更短不能作为语义质量证据。

## 完整原段是可选证据，不是自动扩写

模型引文按第一轮顺序分配c1/c2等编号，原文字段及标签保持不变。
对于被引用但尚无完整原段候选的unit，程序另生成p加原始段号的备选，
如p176。其quote严格等于该原段全文；没有补写、拼接、推断或跨段搜索。
这使第二轮能选择短摘录漏掉的同段限定，例如有效性、窗口、仍待验证的说明。
完全未进入第一轮的段落仍无法补回，原段之外没有自动新增证据。

p编号使用中性report/outcome及paragraph_段号归组，origin为original_paragraph；
它不是继承某一短摘录的correction标签或新增的模型判断。
c编号origin为model_excerpt。所有标签及原文范围在程序生成时固定，发布前重新核对。
两种候选都显示实际渲染cost及来源角色。程序不会因模型选择c编号而自动替换为p编号。
选择有范围重叠的长短候选会拒绝，不能以重复引文扩大覆盖声明。
原段可能混合已撤回说法或其他事项，不能机械优先最长备选。

模型引文与完整原段备选合计最多512项，超过报summary_candidate_pool_budget。
完整候选、上下文与指令全部计入maxInputChars，超限报summary_plan_input_budget，不裁切或静默去掉备选。

## 最终选择必须交代所有未选项

第二轮stage仍为select，不复制引文、标签或facts。回复形状为：

~~~json
{
  "selected_candidate_ids": ["c1", "p12"],
  "omissions": [
    {"ids": ["c2"], "reason": "superseded", "by": ["p12"]}
  ]
}
~~~

每个候选只能且必须出现一次：已选数组或omissions.ids。即使全选，omissions也须为数组。
空/重复/未知已选编号、遗漏未交代项、重复交代、同时选中又排除、额外字段均拒绝。
遗漏可以按相同理由和by分组；理由仅允许：

| reason | 程序检查 |
|---|---|
| covered | by非空且均已选、同来源，至少一项原文范围完整包含该未选项 |
| superseded | by非空且均已选、同来源，每项范围都在旧项结束之后或从其结束处开始 |
| redundant | by非空且均已选、同来源；语义重复尚未独立核验 |
| background | 不得有by；重要性判断尚未独立核验 |
| budget | 不得有by；逐项加入当前已选正文后确实超过5000字符，否则拒绝 |

budget不能用来交代与已选范围重叠的备选，范围冲突应通过选择本身处理。
计算使用原文、标题/表格列名、转义、编号及来源/角色切换的实际渲染，
不是估算token，也不是把整批未选项一次加入后借总额超限解释每一项。
遗漏结构错误为summary_candidate_omissions，越界/跨来源/倒序等引用为summary_candidate_omission_scope，
虚假预算理由为summary_candidate_budget_reason，已选范围重叠为summary_candidate_overlap。

提示要求先比较对象、日期、运行的最终状态，结论与必要条件共同选择，
保留独立结果、明确更正及未解决限制，再删重复过程/路径；不能把预算误解为越短越好。
这些语义要求仍由模型执行。程序**不能**证明superseded真的构成更正，
也不能证明background确实不重要；模型仍可能错误标理由，或选中矛盾双方而不声明纠正。
完整交代、来源覆盖与预算通过均不等于语义PASS，不恢复所有候选全必选规则。

## 渲染、内部审计与发布保护

实际正文成本仍为header_chars + 已选cost之和 +
已选序列首次或相对前一已选项group_key改变时的group_cost。
相同来源/角色组被其他组隔开后再次出现仍收费；按原文排序，不按回复编号顺序。
cost包含完整引文、HTML转义、事实标记、标题及表格列名。
表格整行/列名及CRLF、代码竖线、多表格隔离等范围规则沿用ordinary-evidence-context。
最终实际渲染仍严格核对5000字符，失败不裁切、不重写或追加调用。

EVENT_PLAN的Symbol注解保留规范候选池与复制后的选择/遗漏数组，
程序完成后及发布前重新核对。JSON不能伪造Symbol，也不能注入派生字段或改变已选文字/标签。
元数据新增paragraph_candidate_ids、candidate_omissions_complete、candidate_omissions，
model_omission_reasons_verified恒为false。candidate_evidence记录全部备选，plan_evidence记录已选范围。
selected_candidate_coverage_complete仅说明输出与声明编号一致，
candidate_pool_coverage_complete仅说明是否全选；存在重叠备选时通常不能全选，不是质量指标。
model_final_selection_verified及model_event_plan_verified仍为false；所有已选事实仍禁止长期派生。
旧required-all的buildSummarySelection/SUMMARY_SELECTION只是历史离线工具，不进入当前路径。

来源/旧episode快照、合作锁、版本检查及原子发布逻辑沿用；
episodic写入后的late conflict仍可能留下已写记录，并非跨存储事务。
旧protocol在请求前拒绝；生产中没有历史对象协议转换器或模型响应修复路径。

## v13真实验收：候选规模仍使第二轮超限

验收代码：`a077e27f83ca6984e23621afe2a586eb37da4770`，发请求时工作树干净。
执行时间：2026-10-26 20:50:45至20:51:11（Asia/Shanghai）。
固定2026-10-20样本，4个来源、197个原始审计单元、193个可见单元。
官方DeepSeek端点、deepseek-flash、temperature=0.1、thinking=disabled、stream=false；
每请求max_tokens=16384、输入45000字符、超时120000ms，最多2次请求，fallback=none、retries=0。
这些是本次进程内验收设置；生产默认4096 token、正文5000字符未改。

实际只发送首轮1次请求，HTTP 200、finish_reason=stop。
首轮紧凑数组通过产品decodeEventPlan结构和原文校验，但不代表归组或语义正确。
产品第二轮构建器报 `summary_plan_input_budget`，未创建或发送第二轮请求。
没有最终选择、遗漏账本或正文，语义审查标记为not_performed；不能将临时候选中的旧说法判为最终摘要错误。

| 项目 | 本轮实测 |
| --- | ---: |
| 首轮输入字符 | 40542 |
| 首轮输出字符 | 17624 |
| 首轮prompt/completion tokens | 17552 / 7745 |
| 首轮事项组 / 模型引文 | 4 / 140 |
| 完整原段备选 / 总候选 | 52 / 192 |
| 第二轮system / JSON字符 | 1189 / 61632 |
| 第二轮合计 / 超出45000上限 | 62821 / 17821 |
| 模型引文 / 原段备选引文字符 | 13436 / 11258 |
| 各候选context的JSON长度之和 | 17202 |

第二轮长度由离线审计调用原产品构建器、以1000000诊断上限构造未发送数据包测量；
同时断言45000真实上限仍拒绝。没有修改响应、裁剪候选或改变实际请求预算。
context计数是单独JSON序列化长度之和，不与引文字符混作完整包的互斥成本分解。
输出7745 token也高于生产默认4096，故本次不能证明默认预算可用；没有在4096下额外发请求。

v12真实候选为96条引文+31条原段备选，v13增至140+52。
此前将同一旧候选池离线紧凑编码为40343字符，证明的只是表示节省；
新模型输出改变了池大小，真实第二轮仍超限。不能据此声称数组编码本身增大候选数，
也不能继续把固定旧池的压缩结果当作真实可用性证据。
下一步应先评估由程序生成、受输入边界约束的原段候选及编号选择，
减少模型重复输出引文和两轮重复携带文本；仍须保留原文绑定、限定条件与最终状态更正。
这是待验证的设计方向，不是已实现修复，不以抬高预算或静默删候选替代。

执行器及证据均位于 `/home/lionsol/.openclaw/ops/memory-engine/`：

- 执行器：`checkpoint-v13-a077e27-20261026.cjs`。
- 原始证据目录：`checkpoint-v13-a077e27-20261026-evidence/`，包含result.json、首轮请求、HTTP响应及原始内容。
- 只读审计：`checkpoint-v13-a077e27-20261026-audit.cjs`；额外外部请求0，复验来源/episode/原始内容哈希、默认4096及预算拒绝。
- 执行器SHA256：`881b525fb63da002e42d5289aa4bd175f9cc10901f497f7010cb386a98f95549`。
- 首轮请求SHA256：`7bea7d1ea75d753ffe5bbd46e64ddda9d34af9f56ba7a37f980ab361ffcaf0b5`。
- 首轮原始内容SHA256：`10d79250d5284232b17b2a1ed813907e54500b4c47d28a65ccb106ca12677172`。
- 首轮响应SHA256：`31ba5bdeee66e2f8a61f657b064e762fdd186863d0bc0534200e86dc70f94577`。
- source SHA256：`9b119fdc8c72918cbdc97d2000200b6d14cf71fc3c9b75c0827b2c33e903dbf6`。
- episode SHA256：`9d97282da2e9e3a8480d0a1b0264f54a15bd209b345f8cc6584738ce704f8f33`。

执行器离线自测18项通过后才运行本次验收。提交前定向测试383项通过的记录仍保留，
但这两者都不是模型语义质量PASS。本轮仅更新验收文档，不改源码，不重复运行383项。
source/episode快照未变，publisher/checkpoint/scheduler调用均为0；无部署、DB或运行时配置修改。

## v13提交前离线验证与限制

16个相关测试文件383/383通过，fail/cancelled/skipped/todo=0。
新增紧凑格式默认值、非默认correction/cause、非法列数/null/对象、原文范围、
总量上限、表格整行和来源检查；验证HTTP入口拒绝同版本旧对象格式且不追加调用。
继续覆盖完整候选成本、发布前重验、遗漏理由、来源/episode冲突和失败零派生写入。
生产默认4096、正文5000、来源输入边界及传输失败策略没有改变。

对**未修改的v12真实96引文池**仅在测试内构造v13协议头并编码新格式，
旧v12响应先被明确拒绝。解码结果逐项等于原事实的规范表示，
保留38组、96引文及31完整原段备选，共127个候选。
列式JSON往返重建保留全部字段；展开后对象数据仍为53744字符，与原v12相同数据长度一致。

| 固定池诊断 | 字符数 |
|---|---:|
| 原v12第一轮响应 | 13542 |
| 同一事实的v13紧凑夹具 | 9363 |
| 第一轮完整请求 | 40542 |
| 第二轮JSON/system | 39154 / 1189 |
| 第二轮完整请求 | 40343 |

第一轮夹具缩短4179字符，第二轮在45000以内且没有删掉127项中的任何一项。
这些是字符串长度，不是新的真实completion token统计，更不是4096-token保证。
首轮事实数量仍可能增多；任意更大样本仍可能触及输入或输出门限。

另将未修改的v11真实55引文池显式构造为v13夹具，
沿用之前人工30编号/遗漏理由，通过两次假HTTPS重放真实llmNightlyExtract路径，
83个候选、30个已选、正文4453字符，关键同段资格与取消限制仍在。
fake请求设置4096 tokens不测tokenizer；人工选择不是自动模型结果或全日完整参考。
所有长期记忆/配置输出及publisher调用为0，原来源、历史episode和两份原始provider文件哈希未变。

脚本与JSON报告：
`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-v13-compact-wire-offline-20261026.cjs`，
以及同名.json。重编码仅发生在测试构造的新对象中，没有修改历史provider响应。
下一步须在已提交v13上核验真实首轮tokens、数组格式及最终选择质量；
旧判断排除、必要限定共同保留、错误background/冗余声明和原延迟算术仍未得到自动质量认证。

## 2026-10-26 v12真实验收：第二轮输入超限

验收绑定源码提交 `f5577f3111d53c2ea10c7fca7bd8c71a73d0fb26`，启动前工作区干净。
2026-10-26 19:57 CST 执行；执行器先通过16种假传输检查，外部请求0。
真实执行仅1次请求，DeepSeek Flash、thinking disabled、temperature0.1、
每次上限16384 token/45000字符/120秒，回退none、重试0。
第一轮HTTP200、finish_reason=stop，合法v12候选通过原文/枚举/来源/表格等校验，
但构造第二轮时触发summary_plan_input_budget并停止。没有发送第二轮，也没有补测或更换协议后重试。

| 项目 | 观察值 |
|---|---:|
| 首轮完整输入字符 | 40412 |
| 首轮prompt/completion tokens | 17491 / 5669 |
| 首轮事项/引文 | 38 / 96 |
| 新增完整原段备选/合计候选 | 31 / 127 |
| 第二轮system/JSON字符 | 1147 / 53744 |
| 第二轮完整字符/上限 | 54891 / 45000 |
| 超限字符 | 9891 |

技术裁决为**INPUT_BUDGET_FAIL**；最终选择及其遗漏理由没有执行，
没有最终正文、5000字符测量或自动语义质量结论，不能记为v12质量PASS。
本次首轮5669 completion tokens还超过未改变的生产默认4096，
所以首轮token可行性仍是独立未解决项，不能用上一轮3250的观察替代本次结果。

候选池仍包含unit26/35旧“永远追不上”及unit80暂时缺少产物的说法；
本轮池中也含自然样本valid/source/trigger和取消证据限制。
这些只是可选材料，尚不能判定最终是否正确剔除旧判断或保留必要限定。
上一轮人工55候选池可放入输入，不证明本轮96候选池也能放入。

### 离线无损表示诊断

仅对纯构建函数使用显式较高诊断上限，量出被拒绝的数据包；
未改生产配置、未发送超限请求、未修复或回写provider原文。
127候选的引文共15207字符，其中完整原段7513字符，
候选context对象JSON累计10731字符，整个candidates数组53308字符。
若只删除原段备选，数据包为38932字符，但这会撤掉v12用来补回同段限定的能力，
因此没有把删备选当作本次通过或重试方案。

进一步仅将每条候选反复出现的字段名提取为candidate_columns，
候选值按同一顺序放入candidate_rows；其余元数据、全部文字、标签、范围、上下文和成本不变。
JSON序列化后反序列化，并按列名重建，assert.deepEqual与原始完整wire一致。
使用现有system时总长度为**40301字符**，节省14590字符，不删除127项中的任何一项。
这仅证明传输表示存在可去除的重复开销；当前产品仍使用对象格式，
新格式的解码指令开销、模型理解能力、选择质量和完整输入限制尚未验证。

下一源码步骤应先实现并验证保留全部候选的无损紧凑表示，
再独立处理首轮输出长度；不能继续仅追加提示词或提高输入上限来认定问题已解。
不得硬编码本次编号、删除限定或把全部候选重新强制保留。

执行器：
`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-v12-f5577f3-20261026.cjs`
（SHA256 `1975fa088ee74e45439721a1b3abe39986a7982ef973e85f5237d2a7f34d6c23`）。
证据目录：
`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-v12-f5577f3-20261026-evidence/`，
包含result.json、第一轮request/provider-response/content、source-snapshot及独立review.json；
不存在select-request.json或candidate.md。
离线复核：
`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-v12-f5577f3-offline-audit-20261026.cjs`。
它只写独立审计报告，不新增外部请求或生成可发布摘要。

| 绑定内容 | SHA256 |
|---|---|
| 来源 | `9b119fdc8c72918cbdc97d2000200b6d14cf71fc3c9b75c0827b2c33e903dbf6` |
| 历史episode | `9d97282da2e9e3a8480d0a1b0264f54a15bd209b345f8cc6584738ce704f8f33` |
| 第一轮请求 | `35b1b81284b99c5884046cdd229cfc5dc1e7cab0b7f0e25b42bcb6f8fc45dda3` |
| 第一轮provider响应 | `f1231e041dc62051bab338ec8b32833e57f3063baacd53b2fa24353898f91cde` |
| 第一轮模型content | `90e820e0b71aa17e2c82b0dc0c70d38ba18cc0785c76e3a5f8a84022fad8a3a3` |

来源、历史episode、原始provider文件及生产4096配置复核未变，
publisher/checkpoint/scheduler调用均为0；本轮仅验收证据及本文档变更，未部署。

## v12提交前离线验证与限制

15个相关测试文件362/362通过，fail/cancelled/skipped/todo=0。
覆盖完整原段的原文和限定、重叠拒绝、候选上限及完整输入成本、遗漏全交代、
同来源/后续/包含范围、真实与虚假预算理由、发布前再次检查，
以及非法选择保留旧episode且派生写入为0。
原有来源冲突、并发episode、表格、传输、token预算及reconciliation回归继续通过。

固定来源使用未修改的v11真实55引文池作为诊断：
先断言原v11协议被拒绝，仅在测试内构造v12协议头，不改任何模型文字/标签。
程序增加28个完整原段备选，共83项；完整首轮输入40412字符，第二轮35735字符。
人工选择30项，预测成本=实际正文=4453字符；编号及遗漏回复834字符。
示例使用p42/p176/p182保留实际恢复尚待自然首跑验证、自然样本窗口/资格以及取消证据限制，
以c14标注c13旧1830推断被后文纠正，并补回独立Daily Stats及延迟限制。
未选项的人工background分类不是认定它们不重要，更不是全日完整性证明。

诊断脚本及JSON报告：
`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-v12-qualified-candidates-offline-20261026.cjs`，
以及同名.json。脚本复核原始来源、历史episode、v11两轮响应及candidate.md哈希未变，
外部请求、publisher及长期记忆/配置输出均为0。

这是人工选择的可行性诊断，不是v12自动模型质量或4096-token实测。
原始延迟数字的算术不一致仍未认证。更长的候选输入可能触及预算，
新的完整遗漏回复也可能增加输出token；两者都须由提交后的真实验收检查。
全日关键覆盖、旧判断是否正确剔除、必要限定是否共同保留，仍待自动模型输出核验。

## 2026-10-26 v11 真实验收：预算通过，语义仍失败

验收绑定源码提交 `958c4b091fb5d6270714f7f25c8135d00fcd5899`，工作区干净；
固定来源和历史episode使用前述原始哈希。2026-10-26 18:48 CST 执行，
真实请求恰好2次，均HTTP200、finish_reason=stop，无回退、重试或第三轮。
执行器先通过11种假传输成功/拒绝/失败测试，测试外部请求为0。
模型DeepSeek Flash、thinking disabled、temperature0.1；验收每次上限16384 token、
输入45000字符、超时120秒。生产默认4096及正文5000字符未改。

| 阶段 | 输入字符（含system） | completion tokens | 结果 |
|---|---:|---:|---|
| plan | 40412 | 3250 | 24组、55个合法候选，4个来源、193段可见原文 |
| select | 20072 | 80 | 24个合法编号，31个候选未选 |
| 程序渲染 | — | — | 2714字符，预测成本与实际完全一致 |

程序技术结果为CANDIDATE_READY_FOR_REVIEW；人工语义审计为**SEMANTIC_FAIL**。
本次观察输出token均低于4096，但实际请求上限是16384，
未另跑4096上限，也不据此证明其他样本的首轮token预算。

保留正确的部分：01/02/03健康检查、maintenance dry-run、
10-18/19已恢复与10-15/16无可恢复数据的区别、04:10撤回/无03:45、
632与1241的PASS原述、49条未绑定及尚无路径运行证据、取消PENDING和0事件。
模型第二轮只返回编号，程序沿用原文和标签；长期记忆/配置均为0。

具体失败分开定位如下：

| 阶段 | 原始证据 | 问题 |
|---|---|---|
| 候选与选择 | c13/unit35，c14/unit43 | 旧“1830条按10条/日仍追不上”与后续明确反驳同时进入最终正文，未标出旧结论已撤回 |
| 选择 | c2/unit2 | 独立Daily Stats正常写入已在池中，却被丢弃 |
| 选择 | c8/unit32、c12/unit42、c15/unit51 | 最终flush→reconcile→collect、ID/identity更正、mtime不能证明启用时间的更正被丢弃 |
| 选择 | c46–c50/unit178/180/181 | 延迟、FTS不可得、无法归因与max不能当p95等观察/限制全部被丢弃 |
| 候选 | unit176 | 只收15条及started/completed，漏明确UTC窗口、LIMIT200已达上限、valid/source/trigger证明 |
| 候选 | c12/unit42 | 截取正面修复状态时漏掉同段“实际恢复数量仍等自然首跑验证” |
| 候选 | unit182 | 只有PENDING标题和0事件，漏“不能证明生效或路径触发”的证据限制 |
| 归属 | c22、c32 | 保留632/1241数字，但内部event_id不展示，正文未充分说明验收对象/任务范围 |

正文仍余2286字符，不能把上述遗漏归因为5000预算必然不足。
独立离线反例只从**未修改的本次候选池**移除c13，补入c2/c8/c12/c15/c46–c50，
共32个编号，预测=实际4107字符。它不是模型结果、修复后的验收或全日完备参考；
仍无法补回首轮不存在的资格条件，且延迟原文算术不一致保持未核验。
没有回写原始模型响应或candidate.md，也没有为补测追加请求。

后续应修复“最终状态及其必要限定如何共同进入选择”的契约，
同时处理候选缺失和选择丢弃；单纯来源覆盖、合法编号和预算无法判定语义正确。
不要硬编码此样本编号/关键词，不恢复所有候选强制保留，也不把提示词修改直接记为质量PASS。

执行器：
`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-v11-958c4b0-20261026.cjs`
（SHA256 `1cb3825827d712e4744cfbd14fb74ec2ab0c0db5431807ebe343c074d9dc3a85`）。
证据目录：
`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-v11-958c4b0-20261026-evidence/`，
含result.json、两轮原始request/provider响应/content、event-plan.json、
extracted-facts.json、validated-candidate.json、candidate.md及独立review.json。
离线复核脚本为同ops目录的`checkpoint-v11-958c4b0-offline-audit-20261026.cjs`。

| 绑定内容 | SHA256 |
|---|---|
| 第一轮请求 | `041872b25e8dee95efe241a4850b1e47597f01ca78f0732f8fe610344c03bbdf` |
| 第一轮模型content | `92d704310a76682fb9a094298b0dd5e0254231f693cc70e96539bc69cfde476e` |
| 第二轮请求 | `0b6624d5609822df506103a59cf42f7a98ec6fa27dba9849d24c7c8f20bff185` |
| 第二轮模型content | `bb824f7132e041722752eba9dc8be883d17a2da06b33391e902bfe3fb1e2c8f3` |
| 未修改的程序正文 | `fe9fbb747c7fd80c187686d13a46e93e3d4fb6020fab7f44d930adea795ceffa` |

原始来源、历史episode及生产4096配置复核未变；publisher/checkpoint/scheduler调用均为0。
本轮仅验收证据和本文档变更，无部署或运行时修改。

## v11 提交前离线验证

14文件定向回归337/337通过，fail/cancelled/skipped/todo=0。
验证候选可不全选、重要标签由程序保留、选证超过实际预算拒绝、非法编号/额外字段拒绝、
多来源覆盖、表格结构，以及任何派生/发布前的事实重验和旧摘要保护。
对子集枚举验证角色切换、重复group、转义、标题和表格上下文的显示成本等于真实渲染长度。

原v10池用于显式诊断材料：生产代码直接拒绝原v10协议，
测试仅另行构造v11协议头，98条候选的文字/标签不变，原模型文件不回写。
98条全选为15506字符并被拒绝（沿用正确kind，区别于v10漏kind原响应的15492字符）。
人工挑选27个ID后，成本预测=实际正文=3735字符；第二轮模拟回复185字符。
真实完整来源为193段可见，模拟首轮请求40412字符、第二轮36555字符，
候选审计98、选中27、未选71，长期记忆/配置输出均为0。
脚本、报告及人工预览：
`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-v11-budget-selection-offline-20261026.cjs`、
同名.json，以及`checkpoint-v11-manual-selection-diagnostic-20261026.md`。

这是人工选择和假HTTPS重放，不是v11自动模型结果、全日完整性证明或语义质量PASS。
旧池仍缺自然样本的明确UTC窗口和valid/source/trigger证据；第二轮无法补回不存在的候选。
原始延迟数字的算术不一致没有改写或认证。假请求4096设置不测真实输出token，
第一轮4096是否足够仍待实测；不能用第二轮编号简短来宣称整个流程预算已通过。
原始来源、历史episode及v10两轮模型原文哈希未变，真实请求/发布为0。

## 历史 v10 离线验证

14 文件定向回归 327/327 通过，fail/cancelled/skipped/todo=0。
覆盖旧字段拒绝、无退役清单的混合段落/跨事项澄清、片段越界、精确/歧义引用、
普通 report 也禁止长期派生、完整表格行/列名原文范围、CRLF/竖线、多表格隔离、
输入/正文预算，以及发布前零写入和旧摘要保护。

固定样本仅使用手工参考做假 HTTPS 重放：193 段可见，首轮40377字符，第二轮10319字符，
27个原段编号记录、11个程序上下文（含1个额外表头），14个手工事项、25个选择片段，
25条事实渲染4339字符，长期记忆/配置派生均为0。
手工参考中的 unit32/code-order 引文按新整行约束从92字符扩为221字符；这是显式手工测试材料调整，
没有处理或修正任何真实模型响应。其余已含完整表格的参考不重复补表头。
脚本及报告：
`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-v10-selected-scopes-offline-replay-20261026.cjs` 和同名 .json。
假请求使用4096 token设置，但不测量真实 tokenizer 或模型输出，不能证明生产 token 预算足够。
该参考只覆盖冻结重点，不是全日穷尽证明或自动质量通过。
原始来源、历史episode、v8/v9原始响应哈希未变，真实请求/发布为0，生产参数未变。

## 2026-10-26 v10 真实验收：选证过多与重复复制

绑定源码 01b032a1b21cf39662d5b5990b678d2abf27a11c，固定原始来源/episode 哈希不变。
执行器：
`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-v10-01b032a-20261026.cjs`
（SHA-256 `bcf2c019a88bbaab0ef113488f8679096b4ac6e454926ba4c78bb7e186a17f1a`）。
执行器9个假HTTPS场景通过后，真实执行最多2次请求，无重试/回退/发布。
两轮均 deepseek-flash、thinking=disabled、max_tokens=16384、timeout=120000ms、输入上限45000字符，
HTTP200、finish_reason=stop，没有截断。

| 阶段 | 请求字符 | prompt tokens | completion tokens |
|---|---:|---:|---:|
| 规划 | 40377 | 17470 | 5593 |
| 摘录 | 26480 | 10487 | 5697 |

两轮完成token均超过未变的生产默认4096；16K验收不证明生产预算可完成。
首轮请求SHA-256：
`e1348040de0c1d968e23214eec1a5ba120c0e0614f7c09dd8bcd21115e32e256`；
第二轮请求SHA-256：
`56beaf0127d8c24323596fec0921c00ebcf14392ed486a225976a8ccc6aafa76`。
证据目录：`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-v10-01b032a-20261026-evidence/`，
包含两轮原始HTTP/模型文本、result.json、review.json及offline-selection-audit.json。
原规划/摘录文本SHA-256分别为
`748f644bd0c6caf9dc537065858a303b0e405079ad3f1ac91516636348781a52` 和
`28b12471b1cf57640ecdef0c413438e58ff7ac13391c73882042f7ffa9c77637`。

第一轮通过结构、来源、逐字范围及整行表格检查，选出31个事项、98个必选片段。
第二轮返回98条事实，98段引文均原样复制，共7678字符，无字面错误、没有压缩。
首先触发summary_plan_fact_scope：f24/f25(unit41)漏掉kind=correction，
f29(unit47)漏掉kind=decision，f32(unit51)漏掉kind=correction，均落为默认report。
原始响应未补字段或放行。即使只修这4个字段，下面的预算和语义问题仍然成立。

### 这份固定规划已证明不可行

逐字不变的第二轮事实单独走通用渲染器（不附EVENT_PLAN、仅作成本诊断）报summary_budget，
观察正文15492字符；这不是通过规划验证或接受的摘要。
更强的保守下界只使用当前规划与v10格式的必要成本：

| 必要成本 | 最乐观字符数 |
|---|---:|
| 固定正文头 | 59 |
| 25个不可拆数据行及各自必需的原始表头、事实标记 | 4027 |
| 其余73条事实：每条引文缩至1字符，ID也按1字符 | 1320 |
| 合计 | **5406 > 5000** |

98个不重叠范围每个至少需要一条事实；单数据行范围不能缩成单个数字，不能扩出范围来包含表头以避免程序表头。
上表已省略全部来源/角色标题、节标题、条目间隔、更长且唯一的ID，以及多行表格的额外约束。
因此它是偏低的下界，不是完整原文成本；即使第二轮尽力缩短，冻结这98个范围也无法通过。
该结论只绑定本规划及当前渲染格式，不证明原始一天没有更小的忠实摘要，
也不把4339字符手工重点参考当成全日完整性证明。
可复查脚本：
`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-v10-01b032a-offline-audit-20261026.cjs`。
脚本核对源码/原文/原始响应，保留完整计算项，不修改或修复模型输出；无API/发布。

### 最终状态选择也未解决

unit26的“183天、永远追不上”和unit35的旧1830追不上判断仍被选为独立constraint，
尽管unit43已澄清每日10条明确保留、旧总量不等于新版可恢复队列。
unit80的“查不到任务/无可核对产物”仍作为独立事项，
而原用户unit79、后续unit98指令绑定的是同一632验收，最终PASS位于unit102。
维护/统计、日期恢复、三次健康检查、代码顺序/撤回、632/1241结果及取消限制都有代表，
但存在这些结果不等于选对最终态。unit176的明确UTC窗口和valid/source/trigger证据仍未选择。
原始unit180的894/1908/908ms算术不一致保留为未核验来源问题，不改写原文。

裁决：MODEL_OUTPUT_REJECTED，无合格摘要，真实请求2、发布/调度/checkpoint调用0，未部署。
本次不是再加一条kind提示词即可解决的问题：必须在冻结必选证据之前纳入真实渲染预算，
由程序沿用已经确定的标签/引文，避免第二次模型仅复制第一轮结果。
后续先做预算内最终选证的最小离线实现，不靠扩大预算、修好本次响应或追加第三轮来宣布通过。

## 历史 v9 离线验证

13 文件定向回归 311/311 通过，fail/cancelled/skipped/todo=0。
覆盖同段部分退役、片段越界/退役复活、跨事项重叠、重复片段、精确/歧义/非法 Unicode 引文、
原始范围元数据、每个片段独立覆盖、标题后正文不下发、topic 不下发、
第二步失败后停止、退役事项禁止派生，以及发布前零写入与旧摘要保护。
首轮完整输入断言继续保留，第二轮断言改为只发送规划片段，未放宽来源完整性检查。

固定真实来源使用既有手工参考做假 HTTP 重放：197 段审计、193 段可见，
第一轮 40657 字符，第二轮 9792 字符、27 个原段编号记录、15 个标题，
14 个手工事项、25 个保留范围、4 个退役范围，25 条参考事实渲染 4160 字符。
脚本及报告：
`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-v9-scoped-offline-replay-20261026.cjs` 和同名 .json。
这只覆盖既定验收重点，不是全日穷尽证明，也不是自动模型输出或语义质量通过。
原始来源、历史 episode、v8 原始响应哈希未变；外部请求/发布为零，生产 maxTokens=4096 未变。

## 2026-10-26 v9 真实验收：片段正确定位，退役分组拒绝

绑定提交 573e8b8694330dce08f64fdd8e921377df316116。
首轮 40657 字符、193 段可见，deepseek-flash、thinking=disabled，
单次 max_tokens=16384、timeout=120000ms；最多两次请求，无重试/回退/发布。
首轮 HTTP 200、finish_reason=stop，prompt/completion tokens=17585/4895，
返回 12 个事项、76 个保留片段、11 个退役片段，实际只调用 1 次。

执行器：
`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-v9-573e8b8-20261026.cjs`
（SHA-256 `cbbf41a83a585b79280970e659882e65b4e1d16ebf1f8b538aa135fe8d6d1616`）。
首轮请求 SHA-256：
`b14e569ac3a2f4c6ea1f5bf6c2fbd669cf902185deefda12992a3ee8bcc09238`；
原始规划 SHA-256：
`d3c9e2a91e9427fffc190752216fe55d40d0c8e772bfff0d83bc3df85ae1a54f`。
证据目录：`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-v9-573e8b8-20261026-evidence/`，
保留请求、原始 HTTP/模型响应、result.json 及独立 review.json。
执行器先通过 7 个假 HTTP 场景，没有用修正过的模型响应推进第二轮。

87 个引用均能在指定原段精确且唯一定位，枚举错误、保留/退役交叉重叠均为 0。
实际拒绝为 summary_plan_retired：e5 在 unit26 中退役“但按 10 条/日要 183 天，每天还新增，永远追不上。”，
但该事项的所有保留范围都在旧句之前；后续 unit43 的每日10条/旧1830作用域澄清被放在 e3。
因此“本事项中存在后续保留证据”的条件不满足。响应未改写、未搬运字段，第二轮没有发送。

这次结果也暴露了规划任务之间的牵制：范围白名单已不允许摘录未选旧句，
退役清单却还要求模型独立维护同事项分组/后继关系。
不能仅取消时间顺序检查后放行；e2 退役 unit11 的代码顺序结论、e7 退役 unit122 的信号阶段辨别，
也混淆了去重/过程信息与真正被撤回的判断。

独立内容阻断仍在：units109/113/130/134/138/178 的表格数值行没有附列名。
例如 unit178 的 1908/4572、333/3139 缺少 p50/max 表头；
当前程序只补节标题，第二轮又不能扩展到未选范围，无法自行补回这些列含义。
unit176 的15条自然请求有代表，但明确 UTC 窗口、valid=true/source/trigger 证据未选；
unit182 的 PENDING/INSUFFICIENT_EVIDENCE 及零事件有代表，不能证明取消成功或路径触发的明确限制未选。
这些都是规划层检查，不是已经生成或接受的摘录正文。

保留片段共 5645 原文字符，含重复计数和报告路径；第二轮可以缩短，不能据此宣称预算必然无解。
但本次首轮完成实际用了4895 token，高于未变的生产默认4096；
本轮16K上限验收不构成生产预算可完成的证明。
来源 unit180 的894/1908/908ms算术不一致仍按未核验原文保留，未改写来源。

裁决：MODEL_OUTPUT_REJECTED，无合格摘要；摘录/重试/回退/发布/调度/checkpoint调用均为0。
原始来源、历史episode和v8原始响应哈希未变，生产maxTokens仍为4096，未部署。
后续先审视片段白名单与模型退役标注的重复职责，并恢复原文表头上下文；
不能仅修分组、增加更多标签，或把本次响应自动修好后追加真实请求。

## 历史 v8 离线验证

13 文件定向回归 294/294 通过，fail/cancelled/skipped=0。
覆盖非法/跨来源引用、退役冲突、旧标题复活、漏选规划证据、字段改写、第二步失败后停止、
退役事项禁止派生、规划自由文字不进入历史，以及发布前零写入和旧摘要保护。

真实来源手工核对版本经过假 HTTP 两步重放：
第一步 197 段审计/193 段可见、40356 字符；第二步 27 段可见、11152 字符，
14 个手工事项、25 个证据引用、4 个退役引用，25 条参考事实渲染 4160 字符。
它只覆盖既定验收重点，不是全日穷尽证明，也不是自动模型结果；旧 58 条模型响应没有被转换或放行。
原始来源、历史 episode 和原模型响应哈希均未变，外部请求为零。
正常两次调用可能增加请求成本和时延；上述手工离线重放不代表自动质量通过。

## 2026-10-26 固定样本真实验收：第一步拒绝

绑定提交 fd033f25360485b3453e87318f02535abc97cd8c，原始来源/episode 哈希沿用固定样本。
首轮完整请求 40356 字符、193 段可见；模型 deepseek-flash、thinking=disabled、
单次 max_tokens=16384、timeout=120000ms，正文仍为 5000 字符。临时覆盖仅存在验收进程内，
生产默认 maxTokens=4096 未变。最多两次请求，无回退/重试/发布。

执行器：
`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-v8-fd033f2-20261026.cjs`
（SHA-256 `4be9e1187d9829a3950076b6e5594cfd317836b6d5c659f8dfc9ac4ba676aace`）。
完整首轮请求（含 stream:false）的 SHA-256：
`5b53c00288b64fa3010c682d4bc4a4d15561677b14f27af76f7a0ccae73442ad`。
证据目录：`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-v8-fd033f2-20261026-evidence/`，
保留原始 HTTP 包、模型原文、请求、result.json 和 review.json。

执行器 5 个假 HTTP 场景通过（正常两步、无效规划、非法引文、第二步传输失败、第二步截断），
均无第三次请求。真实请求 HTTP 200、finish_reason=stop，prompt/completion tokens=17458/1746，
返回 17 个事项、75 个证据引用（71 个不同段落），没有摘录事实或被接受的正文。

第一处拒绝为 summary_plan_evidence：e3/e5 的 unit41、e6 的 unit46/unit51 将 correction 填入 facet。
离线检查原始响应另发现 unit35 同时由 e3/e4/e5 保留且被 e5 退役，unit30 被 e6 同时保留和退役。
这些检查不修改响应，也未用修正后的规划发起第二轮。

内容审查也有独立阻断：e1 仍将 unit3 的旧“时间窗过滤”诊断作为 cause，
尽管 units13/15/32 给出了窗口内已有 129 条、confidence 在采集后补齐及已修代码顺序；
e4 仍保留 units26/35 的旧“183 天追不上”判断，与 unit43 对旧 1830 作用域及每日10条的澄清并列；
e5/e6 的旧身份判断和部署时刻推断未被一致排除。只修枚举字段不能解决这些问题。

规划引用涵盖维护/统计、日期恢复差异、三次健康检查、后续代码顺序、632/1241 回填、
49条待自然运行、自然15条及取消限制和延迟残差，但这只是引用存在，不是最终引文覆盖或全日完整性证明。
75 个引用含重复核验和报告路径，实际摘录预算是否可行仍为 UNKNOWN；
不能把旧 v7 固定引文下界套在尚未摘录的规划段落上。
来源 unit180 的 894/1908/908ms 数字本身也存在算术不一致，按未核验来源记录保留，未改写原文。

裁决：MODEL_OUTPUT_REJECTED，实际外部请求1、摘录请求0、发布/调度/checkpoint调用0，
原始来源/历史episode哈希不变，无部署。下一轮须处理混合段落内最终事实选择、
保留/退役一致性及必要证据去重，不能仅更换提示词中的枚举说明或放宽拒绝规则。

## 历史记录：v1–v7（不描述当前 v8 路径）

历史修复起点：d6fec1c920c0e031db4c8df4d70a6dc9b684bb6b。
以下保留旧设计、旧命令及旧实验结果；其中“当前”“本轮”等表述均属于对应历史阶段。

## 问题与行为变化

10-20 样例的四条输入完整送入普通提取器，摘要仍遗漏三次健康检查，
并把不同日期的占位现象合并为同一根因。旧代码仅凭非空摘要及发布成功返回 valid_summary，
结构化记忆也可能在摘要内容检查前写入。

新路径为 buildFactInput → llmNightlyExtract → validateAndRenderFacts → 既有写入/发布。
llmNightlyExtract 内部仅在全部证据合法但正文超限时增加一次编号选证；最终所有门禁仍在写入前执行。
来源数据以独立 JSON 消息发送，指令置于 system 消息；不再保留未替换的占位符，
也不再用 substring 静默截断或要求一段 300 字自由叙述。

## 协议与来源

普通提取器现在接收结构化输入对象，不再接收 combinedText 字符串。
注入的测试提取器也必须返回新协议；旧 episode_summary/smart_memories/configs 响应会被拒绝。

~~~json
{
  "protocol": "checkpoint-source-facts-v7",
  "target_date": "2026-10-20",
  "facts": [{"unit": 1, "quote": "决定停止部署。", "event_id": "deploy", "facet": "constraint", "kind": "decision"}]
}
~~~

每条事实必须包含 unit、quote、event_id、facet；unit 是全局零基段落编号，quote 是连续原文短引文。
event_id 是同来源内的模型事项分类，不是持久身份；facet 为 outcome|constraint|uncertainty|cause|context。
请求的 fact_contract 单独列出必填字段、kind/facet 各自枚举及 kind=report 缺省值，枚举由校验器同一常量生成；它是模型字段说明，不是 provider 强制 JSON Schema，也不作为响应字段。
kind=correction/decision 不属于 facet；例如纠正证据不足应填 kind=correction、facet=uncertainty。
字段说明计入完整请求输入预算；没有新增分类值、响应字段、配置或自动纠错。
不同对象、日期和运行不应合并状态或原因；原文明示的对比可以整体引用并保留差异。分类本身未独立核验。
请求保留 unit.text 完整原文，取消 parts 及 span。模型只选择少量完整判断，不计算片段或字符位置。
quote 必须在指定段落中精确、唯一出现；标点、空格、CRLF 均不规范化，不允许跨段拼接。
缺失/不匹配引文报 summary_quote，重复歧义报 summary_quote_ambiguous；模型应补足相邻原文以定位。
v1–v6、整数选择及 span 响应均不能复用于 v7；summary、skipped、coverage 等旧清单也被拒绝，
不通过自动删除冲突字段或修补旧响应来接受失败候选。
每个来源按对话轮次和段落划分，
保留 entry ID、来源哈希、角色标记及原文 UTF-16 范围；来源元数据优先复用
收集器已有的私有证据，不改变普通 rawLogs 对象形状或持久身份规则。
没有来源 ID 时使用内容摘要作为本次证据定位信息，不生成新的持久身份。

v7 的 facts 仅包含支撑简明摘要的关键事实，不要求模型逐段登记全部输入。
完整输入的段落编号和范围由程序记录，不以模型重复列出编号证明它读懂了内容。
仅独立 HEARTBEAT_OK/[OpenClaw heartbeat poll] 两类控制标记由程序从模型消息排除，
原始编号不重排，原文哈希不变，排除位置仍在本地输入审计内。
OK、收到、问候以及不同轮次的相同结果不会自动排除；模型不能把控制标记作为事实返回。
事实 ID 默认按返回数组的位置为 f1、f2…，不是原始 unit 编号；kind 默认 report，
其余时间、日期、纠正和因果字段有需要才填写。

程序检查段落编号和引文的精确唯一匹配，计算绑定原文的 UTF-16 偏移；不猜测重复句子的出现位置。
可选时间、日期、因果引文及配置 key/value 必须来自选中引文；
类别、纠正引用及控制标记引用保留独立检查。
每个有非控制内容的来源都必须在最终正文有代表。
若原始输入有助手记录，不能仅选用户检查请求；必须选助手记录或明确的 decision/correction。
此条件检查原始输入，不能靠先丢掉助手记录来绕过。角色检查也不证明实际结果的语义完整性。
最终入选事实按来源和原文位置进入正文，不因模型纠正标注自动隐藏引文。
没有独立选证步骤时，提取响应的全部事实进入正文；超限选证时，未入选候选只保留定位审计，不产生记忆/配置。
同轮次中，最近的独立标题或当前段首标题自动附作上下文，保留原文定位。
标题按 Markdown 标题、加粗标题及单行冒号结尾识别；跨轮次不继承。
这只保留可识别的结构上下文，不保证所有事件对象、时间或限制都已完整提取。

kind=correction 可单独引用最终纠正；supersedes 可选，若填写仍须引用同来源中更早且已绑定的事实。
同源/先后关系不证明语义纠正：程序显示双方原文和未核验关系提示；所有 correction、关系两端及 context 背景均不派生记忆/配置。
若只需最终状态，模型应直接选最终证据，无须先登记旧提议。
model_correction_links_verified 恒为 false；derived_excluded_fact_ids 记录因此排除派生的事实。
context_columns/context_evidence 定位实际附加的标题原文，不将其冒充模型主动选择的事实。
input_unit_columns 声明 [unit_index,source_id,start,end]，input_units 审计完整原始输入；
evidence_columns 声明 [fact_id,source_id,start,end,supersedes]，evidence 仅定位已选事实；
sources 保留 entry ID 和来源哈希，excluded_control_unit_ids 记录程序排除的控制标记。
使用选证时另记 summary_selection_applied、candidate_fact_count，以及按既有列格式编码的
candidate_evidence/candidate_context_evidence；evidence 和 fact_count 仍只描述最终入选证据。
event_columns/fact_events 记录入选事实的事项/角色；candidate_events 保留全部候选分类。
required_fact_ids 由程序根据第一步分类生成；declared_event_coverage_complete 仅表示声明的结果事项有代表，
model_event_groups_verified 和 model_evidence_facets_verified 恒为 false，不认证真实事项是否分全、分对。
不复制全文进元数据，也不把“输入审计完整”改称“模型已提取所有事实”。

source_coverage_complete 表示每个非控制来源均有代表；
unit_coverage_complete/summary_unit_coverage_complete 分别据已选引用和实际正文计算，
分母为非控制段落，允许 false，不是通过条件。缺少同一长来源中的关键事实仍需质量审阅发现。
原文继续保留在原始记录，不新增快照或 sidecar；若原始 entry 后来改变或消失，
定位元数据本身不能重建旧全文。纠正关系仍是模型标注，不是独立事实认证。

## 写入与失败

整批事实及配置检查通过前，不允许本轮提取生成的 smart-add、confidence 或 episode 写入。
结构化记忆和配置从同一批已检查引文及其标题上下文派生，排除 context、所有 correction 及未核验 supersedes 关系的两端，
保留来源归属；原有最多 10 条限制沿用。未标注的旧结论仍可能被选择，本补丁不认证其时效。
episode 继续使用既有版本检查、合作锁和原子发布。

| 情况 | 普通提取结果 |
| --- | --- |
| 输入预算、格式或 Unicode 无法完整保留 | input_incomplete |
| 引文、覆盖、结构、范围等检查失败 | summary_invalid |
| 来源代表、控制引用、纠正关系或正文字符上限失败 | summary_invalid |
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

沿用每次请求的输入、max_tokens、超时与 provider 配置。合法候选超限时新增一次独立选证请求，不重试提取或选证；
因此会多消耗一次请求及其超时窗口，不是零成本的本地压缩。
当前候选的摘要正文上限为 5000 UTF-16 字符（此前为 3000），计入标题、归属、引文和纠正说明；
超限拒绝整批响应，绝不截断。上限不含定位元数据或既有配置附节，也不是 provider token 预算。
请求中的 summary_budget 声明总额及固定标题成本；unit.cost 使用同一渲染器计算完整引用及标题上下文，
按最长合法 ID/kind 保守预留，包含 HTML 转义、换行缩进、来源角色组标题和必要的标题上下文。
每段独立计入组标题，组合渲染可共享标题，因此成本仍是保守上界；短引文成本随选择变化，关系提示另占空间；
这些是选择提示，最终渲染长度才是门禁。summary_budget 错误携带 observedSummaryChars/maxSummaryChars。
输入上限现在计入 system 指令和序列化数据的字符总量；超过即停止。
普通 HTTP 输出字符上限为现有 max_tokens × 8，finish_reason=length 必须失败；
该字符上限不能替代 provider 的 token 上限。
提取阶段仅传输失败沿用至多一次 fallback；无效 JSON、截断或无效事实不进行质量重试。
选证使用提取成功的同一 provider/model，最多一次请求，不再 fallback。通常共一次或两次请求；
若提取先回退后成功且需要选证，总计最多三次。选证输入/响应、关联或最终预算失败都终止本轮。

引用有效、段落覆盖完整不等于事实完整或推断正确。
单一段落中的短摘录仍可能遗漏该段其他信息，测试明确保留这一边界。
用户和助手记录均未由本补丁与原始 transcript 或外部事实重新核实。
semantic_quality 始终为 not_independently_verified，不能据此声称真实模型质量通过。

分段摘要协议未修改；历史错误摘要及派生记忆未自动清理。
v1 的真实 10-20 验证因输出预算失败，尚未进入完整语义验收。
v2 的真实调用完成，但结果是全文摘录，未通过摘要质量验收。
v3 实测覆盖处置冲突；v4 实测仍超长且语义错配；v5 实测 span 越界且结果残缺，见下。
fake HTTP、程序构造候选与静态预算不能代替自动选择质量验收。
模型若不标注纠正，或选择同一长来源中的错误重点，程序不能仅凭原文匹配发现全部语义问题。

## 离线验证

常规回归采用脱敏合成样例和假 HTTP。新增回归固定 v4 的真实 44 条选择结构，
在脱敏合成文本上重放其选择和关系；原始私有输入另作只读离线诊断，不将手选候选称为模型输出。
覆盖三次检查、maintenance dry-run、daily stats、日期根因范围、纠正、
整批检查前零写入、源/目标版本冲突、并发发布及身份/pending 恢复。
三项旧集成测试的 Core 索引入口夹具缺失在基线可复现，
本次补齐明确的离线入口 stub；没有放宽产品 Core 门禁。

~~~bash
cd /home/lionsol/.devspace/worktrees/memory-engine-cff493d1
env MEMORY_ENGINE_TEST_DEPENDENCIES=/home/lionsol/.openclaw/extensions/memory-engine \
/home/lionsol/.local/node24/bin/node \
  --require ./test/checkpoint-dependency-loader.cjs --test --test-concurrency=2 \
  test/checkpoint-summary-selection.test.cjs \
  test/checkpoint-fact-context.test.cjs \
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
- 原始 10-20 来源与既有 episode 的 SHA 均未变。
  v3 后续已提交 6d36438，并经 Owner 明确重开新目标授权一次实测。
  本段为历史离线结果，不授予或恢复任何调用权限。

## 三次实测复审与 v4 简化

三次使用同一 4 条来源/197 段输入，请求模型均为 deepseek-chat，响应模型字段均为
deepseek-flash；没有其他模型的受控对照，不能由此断言换模型必然有效。

| 候选 | 实际输出 | 观察到的失败 |
| --- | --- | --- |
| v1/e965365 | 4096 token，length | 回写引文导致输出截断 |
| v2/2f68275 | 457 token，stop | 197 段全文摘录，正文 36640 字符 |
| v3/6d36438 | 896 token，stop | 全部引用又把 4 段控制标记列入 skipped；134 段正文选择的原文共 16341 字符 |

v3 选择了早期“迁移/回填时序竞态”归因段（unit 3），却没有选择后来
明确更正为代码顺序问题的 unit 11/16，也漏选修复已落地及 04:10 提议正式作废的
助手结果段 unit 33。用户指令段 unit 47 中的作废文字仍被选择；
因此不能说所有纠正文字都消失，但关键纠正结果没有被正确归纳。
这不是单纯删除 4 个冲突 skip 就能完成的修复。

本轮决定为简化：将控制标记及完整输入审计交给程序，模型只选择支撑当前状态的关键引文，
取消“每段先登记为事实，再跨 fact ID 选择正文”的双重任务。
保留来源代表、原文范围、日期/因果字段、纠正关联、正文上限及整批写入前检查。
逐段硬覆盖改为如实报告选择覆盖率，这是保证的明确变化，不等于已证明关键事实没有遗漏。

- 八文件定向回归 177/177 通过，fail/cancelled/skipped 均为 0，约 13.0 秒。
  清单专属的旧用例按新协议调整，保留原文绑定、来源结果、纠正和零派生写入回归。
- 固定原文离线检查：197 段完整审计，193 段送模型，4 个确切控制标记本地排除；
  system 1420 字符，请求总内容 38666 字符，预算未提高。
- 人工指定 9 条证据（包含一条旧提议和后续纠正）的构造结果：
  正文 1422 字符、元数据 5636 字符；unit_coverage_complete=false，
  source_coverage_complete=true，semantic_quality=not_independently_verified。
  这只证明表示和门禁可用，不证明模型会选择同样事实。
- 原始 v3 响应未修补，仍以 summary_structure 拒绝；按 v4 构造的全选非控制段落
  仍以 summary_budget 拒绝，没有用缩短输入、放大正文上限或容忍旧响应来过关。
- 以上为 v4 提交前离线结果；随后提交 d2cb4c9，并经 Owner 重开验收授权一次实测。
  本地修复不会恢复已消耗的授权；后续实测仍需独立授权。

## v4 真实失败与 v5 离线修复

v4 单次请求 HTTP 200，finish_reason=stop，completion_tokens=469；响应完整，无 fallback。
44 条整段选择、0 个 span、5 条纠正标注；原文共 7439 字符。
v4 按模型关系隐藏四条记录后，40 条引文仍有 6351 字符，未含定位说明即超过 3000；
产品以 summary_budget 拒绝，未生成候选。维护和 Daily Stats 结果未选择，03:00 检查缺少标题时间。
早期竞态归因未撤下；unit49 的 entryId 纠正指向 unit32 的采集顺序修复，
unit51 的 mtime 纠正指向 unit42 的身份修复状态，错误隐藏了不同事项的有效证据。
证据位于 ops/memory-engine/session-checkpoint-d2cb4c9-isolated-quality-once-20261025-evidence。

v5 的边界修复：纠正标注不再获得删除引文的权力，两端不产生记忆或配置；
结构标题自动伴随结果呈现；渲染成本在请求中明示。协议号升级以拒绝旧语义响应。
这没有解决所有语义选择问题，也没有通过事后截断或扩大预算来接受失败输出。

固定源离线诊断：197 段审计、193 段可见，请求总内容 42213 字符，仍低于 45000。
原始 v4 响应不作修补时以 summary_structure 拒绝；仅改协议号的诊断副本仍以 summary_budget 拒绝，
按 v5 保留双方原文及标题的拟渲染正文为 12228 字符，没有生成合格候选。
人工选择 8 条证据的正向控制为 1636 字符，含三次检查的时间/结果、maintenance dry-run、
Daily Stats、不同日期恢复差异、代码顺序归因和最终作废决定；这是人工构造，只验证指定事实的表示与预算，不是完整摘要验收，也不证明模型会自动选择。

离线验证：9 文件 184/184 通过，fail/cancelled/skipped 均为 0，约 13.1 秒。
新增 6 项上下文/纠正/成本回归在旧代码先失败，修复后通过；另增实际 bin/publisher 集成检查，
确认纠正关系两端的 preference/config 均不派生，既有 episodic 写入仍按原流程执行。
首次组合回归 182/183，一项失败是指令文案断言仍依赖旧描述；同步新语义后重跑 9 文件全通过。
语法检查和 git diff --check 通过。未重跑全仓，上述历史全仓失败结论不变。
以上为 v5 提交前离线结果；随后提交 f8877c5，并经 Owner 授权一次真实验收。

## v5 真实失败与 v6 短引文协议

v5 HTTP 200、stop、641 completion token，56 条 span；第 5 条引用 unit15 的 [0,1]，但该段只有 1 个片段。
其余 55 条合法选择的原文已有 4057 字符；维护/统计及 10-15/16 无可恢复对话被截掉，部分纠正仅选标题。
产品报 summary_span，未生成候选；证据在 ops/memory-engine/session-checkpoint-f8877c5-isolated-quality-once-20261025-evidence。

v6 取消机械片段选择，恢复少量原文短引文和程序定位。依据是 v1 的 49 条完整引文均精确唯一匹配，
但当时逐段覆盖 197 段导致输出耗尽；这只能支持表示方式选择，不证明关键事实提炼已可靠。
保留 v5 的标题上下文、非破坏性纠正提示、关系两端零派生、3000 字符上限及整批写入前检查。

离线：9 文件 188/188，通过，fail/cancelled/skipped=0，约 13.4 秒；语法及 git diff --check 通过。
26 项引文协议回归在旧代码为 16 通过/10 失败，补丁后全部通过；新增末条歧义/缺失引文时整批零派生写入。
固定输入仍为 197 段审计/193 段可见，请求 40519 字符，原文完整；人工 8 条引文控制正文 1636 字符，非模型输出。
原始 v5 响应报 summary_structure；仅改协议号仍报 summary_fact_structure，未修补或放行旧响应。
以上为 v6 提交前离线结果；随后提交 69dad87，并经 Owner 授权一次真实验收。

## v6 真实结果与独立纠正修复

69dad87 实测 HTTP 200、stop、871 completion token，17 条引文全部精确唯一匹配，原文共 1218 字符。
3 条 correction 没有 supersedes，产品报 summary_correction_link，未生成候选，也未进入正文长度验收。
只选择 s0/s1 两个来源；01:00/02:00 独立检查、维护/统计及 10-15/16 无可恢复对话仍遗漏。
证据在 ops/memory-engine/session-checkpoint-69dad87-isolated-quality-once-20261025-evidence。

本轮保持 v6 字段和短引文协议，修正“最终纠正必须先列旧事实”的不必要约束。
独立 correction 可以呈现，但不产生记忆/配置；填写的关联仍检查未知、前向和跨来源引用。
来源覆盖、精确引文、预算、整批写入前校验均保留，没有自动补事实。
原始模型响应不改一字离线回放，仍以 summary_source_coverage 拒绝；本轮不宣称摘要遗漏已修好。

9 文件定向回归 191/191 通过，fail/cancelled/skipped=0，约 13.2 秒。
新增独立纠正及缺来源回归先在旧代码失败，修复后通过；实际发布链确认 correction 的派生记忆/配置为零。
请求仍包含完整原文，197 段审计/193 段可见，内容 40561 字符，未提高任何预算。
本轮没有新模型调用、部署或历史修改，未重跑全仓；旧实测结果和已消耗授权均不因此改变。

## Flash 思考模式预算验证后的选择修订

6363dc3 上的 Flash low 思考模式在 4096 completion token 时全部额度用于推理，正式输出为空。
Owner 随后授权提高至 16384：一次请求正常 stop，共 6769 token（推理 5973），
返回 12 条精确引文，正文 2693 UTF-16 字符，四个来源都有代表。
证据：ops/memory-engine/checkpoint-flash-thinking-low-16k-6363dc3-20261025-evidence。

机械校验通过，语义验收未通过：维护和统计、代码顺序纠正及 04:10 提议作废仍遗漏。
还保留“1830 条永远追不上”的旧判断，遗漏用户明确限定 unknown_legacy 不等于可回填队列、
每日 10 条是保留限制的纠正。来源覆盖门禁不能检测同一长来源内部的这些遗漏。

离线重放原始响应仍得到相同正文，不对已失败候选补事实或追认通过。
手选 11 条最终结果证据可在 2575 字符内保留上述关键事项；这只证明存在可容纳的选择，
不证明模型会自动选对，也不证明 8–12 条提示是失败原因。
非思考对照与思考请求预算不同，单次结果不能独立证明思考开关的因果效果。

本轮仅修订选择指令：先按对象/日期/运行整理事项最终状态，再摘录和压缩；
去掉固定条数目标，要求逐条检查后续否定、限定与撤回，并保留用户明确约束。
较晚时间本身不作为纠正证据。提交前复核独立结果及纠正，不新增输出清单、协议字段、
语义关键词门禁、模型调用或重试。现有 3000 字符正文及生产 4096 token 配置保持原状。
这是待真实质量验证的提示词候选，不能将离线回归通过称为事实选择已修复。

验证：9 文件定向回归 191/191 通过，fail/cancelled/skipped=0；语法及 git diff --check 通过。
序列化来源数据与 6363dc3 完全相同，197 段审计/193 段可见，总请求内容 40843 字符，未截断。
原始失败候选离线重放正文不变；本轮新增外部请求为零，未部署、未改历史及生产配置。

## 选择候选验收与正文精简

随后 Owner 授权该未提交候选一次验收，Flash low/16K 正常 stop，使用 12812 token（推理 11181）。
返回 24 条有效引文，正文 5228 字符，因 summary_budget 拒绝；未生成候选文件。
维护、“1830 条”的后续限定及 04:10 撤回被保留，Daily Stats 和最终代码顺序原因仍遗漏。
证据：ops/memory-engine/checkpoint-flash-prompt-selection-4db4607-20261025-evidence。
此结果未通过验收，不能把提示词候选视为已经修复。

本轮仅精简正文展示：连续同来源/角色共用归属标题；变化时重新标明。
每条保留事实 ID、kind、完整引文、必要标题上下文和纠正关系提示。
段落 ID、UTF-16 范围及上下文定位继续保留在原有元数据，派生记忆和配置的文本不变。
未改变协议字段、验证规则、3000 字符上限、排序、引文选择或生产预算。
unit.cost 使用同一组合渲染函数，逐段保守计入来源组标题成本，不依赖模型计算共享成本。

原始响应不修补、不删事实离线重放：12 条候选从 2693 降至 2105 字符，
定位元数据与派生结果逐项一致；24 条从 5228 降至 3915 字符，仍报 summary_budget。
这只改善展示开销，不追认旧候选通过，也不补齐事实遗漏。
新增归属分组及定位保留回归先在旧渲染器失败，修改后 9 文件 192/192 通过；
fail/cancelled/skipped=0，语法及 git diff --check 通过。
完整输入仍为 197 段审计/193 段可见，请求内容 40847 字符；本轮零 API 调用，未部署或改历史。

## 正文预算候选调整

精简后原 24 条仍为 3915 字符；保持这些选择并手动加入遗漏的 Daily Stats 结果和
代码顺序纠正共 26 条，需要 4237 字符。另一个只保留验收重点的手选 11 条样例为 2170 字符，
但省略其他事项；这些只用于测量，不代表模型能自动选全，也不是最小摘要长度的证明。
据此将候选正文上限从 3000 调至 5000，给多事项记录留出空间；不引入动态限额或截断。

模型请求的 summary_budget 与最终渲染门禁共用该上限；输入、token、超时及重试策略不变。
边界回归先在旧上限失败，修改后验证恰好 5000 可通过、5001 整批失败且响应不被修补；
过长的必要标题上下文及超限发布仍被拒绝，旧摘要和零派生写入保护继续成立。
9 文件定向回归 192/192 通过，fail/cancelled/skipped=0。

原始 24 条响应现在机械校验通过，但 Daily Stats 和最终原因仍遗漏，质量仍未通过；
旧的冻结验收记录和结论不改写。5000 只是待验收的候选预算，不构成语义合格证明。
手补 26 条只在内存诊断，未发布或改写历史。生产 max_tokens 仍为 4096；
前述 16K 仅为显式授权的单次测试额度。本轮没有新 API 调用或部署。

## 独立编号选证

7fb5e24 真实验收返回 58 条精确引文，正文 11401 字符，未通过 5000 上限。
本轮把候选证据核验与预算内选证拆为两个实际步骤，不再让同一回答兼做全部工作。
只有合法候选超限时才构造选证输入；任何一条候选引文无效都直接停止，不靠删除坏事实修补响应。
选证只返回 {"selected_fact_ids":["f1","f3"]}，未知/重复/空编号、额外字段和再次超限均拒绝。
同一已标注纠正关联的两端必须一起保留或一起不选，派生禁止集合从完整候选计算。
最终仍检查原始来源的代表和角色要求；未标注纠正及长来源内部遗漏仍需语义审阅。

选择结果以内存 Symbol 传递，原始 facts、ID 及 v6 公共 JSON 不改写；发布前再次核验。
第二步不复制引文、不改事实、不重新提取。定位元数据分别记录全部合法候选与最终入选事实。
成功发布仍沿用既有 episodic smart-add；假 HTTP 发布测试仅证明选证前及失败路径零写入，
没有借该文件系统夹具宣称 confidence 数据库绑定已验收。

58 条真实结果的选证输入为 16701 字符；手选 11 个既有 ID 后正文 1987 字符，
58 条候选/11 条入选定位都保留。手选回放不是自动质量证明，原始 58 条仍不能直接通过，
先前改写 opencode 的 52 条响应仍在选证前被拒绝。
10 文件定向回归 220/220 通过，fail/cancelled/skipped=0；语法及 git diff --check 通过。
第一阶段可能遗漏事实，第二阶段不能补造；真实自动选证仍待受控验收。
既有 58 条提取使用 4428 completion token，生产 4096 配置未改，
离线回放不证明默认额度可端到端完成。本轮无 API 调用、部署或历史重写。

## v7：将事项覆盖声明前移

b83a2be 真实两阶段验收将 57 条证据选为 21 条、3530 字符，机械通过；
但选证舍弃已提取的每日 10 条限制、自然样本和取消证据不足结论，质量未通过。
单纯结构分组得到 47 组，其最低独立成本之和估算为 9754；这是保守成本，不是最优长度证明，
因此不直接将每个标题或轮次当作必须保留的独立事项，也不按此样例写关键词规则。

第一阶段现在必须声明事项及证据角色。第二阶段只能选择既有 ID，不能改分类：
每个包含 outcome 的来源内事项至少保留一个结果；constraint/uncertainty/cause 全部保留，
decision/correction 不因被标成 context 而失去保留要求；背景仍可不入选。
遗漏必保留证据报 summary_required_facts，遗漏声明结果事项报 summary_event_coverage。
缺少/非法分类报 summary_event_structure，旧协议直接拒绝，不自动补标签。
context 可作为原文引用展示，但不派生长期记忆/配置；现有纠正关联两端保护继续保留。

手工对旧候选加分类仅作可行性诊断：旧的 21 条选择会被拒绝；
一个满足声明要求的 25 条选择为 4150 字符。这不修改原始响应，也不是自动模型质量证明。
10 文件定向回归 235/235 通过，fail/cancelled/skipped=0；
新增跨事项遗漏、限制丢失、缺字段、背景派生隔离及发布失败零写入回归。
完整输入仍为 197 段审计/193 段可见；调用轮数、5000 正文上限及生产 4096 token 未改。
第一步仍可能漏提取或误分类，声明覆盖不等于真实语义完整，尚待真实验收。
本轮无 API 调用、部署或历史重写。

## v7 字段说明澄清

6a5478f 真实验收正常返回 67 条候选、5506 completion token；其中 5 条使用 facet=correction，
触发 summary_event_structure，未进入第二次选证；原始响应保留，未自动移字段或改写引文。
原说明在介绍 facet 时混列 decision/correction，未明确两者属于 kind；本次拆开字段说明，
并在请求中由同一枚举常量生成 fact_contract，展示合法的 kind/facet 组合。
验证器及 v7 响应协议不变：facet=correction 仍拒绝；kind=correction 与 facet=uncertainty
可以共存，且继续禁止派生记忆/配置。此修改仅是请求候选，不能证明模型将遵循枚举。
完整真实输入仍为 4 来源、197 段审计/193 段可见；请求 42012 字符，低于 45000 上限。
原始 67 条响应离线重放仍以 summary_event_structure 拒绝；没有移字段、修引文或启动第二次请求。
使用上述既有隔离依赖加载命令，10 文件定向回归 238/238 通过，fail/cancelled/skipped=0；语法检查通过。
初次直接运行时两个发布测试因 worktree 缺少 better-sqlite3 在加载阶段失败；按既有 test-only loader 读取已安装依赖后通过，未安装或修改运行依赖。
本轮无新增 API 调用、部署或历史重写，生产 4096 token 与正文 5000 字符上限不变。

## 已证明无解的候选在选证前停止

4281944 真实验收的字段与引文合法；71 条候选选中 68 条，正文 14366 字符，因超限拒绝。
按原始分类，27 条必保留事实的引文共 3590 字符，25 个尚未覆盖的结果事项各取最短引文至少 4260 字符；
仅引文下界即 7850，说明原始候选与覆盖约束下不存在 5000 字符内的编号选择。
这不证明原始来源无法摘要，也不证明模型事项分类正确。
逐条诊断发现仅报告路径也被标为 outcome、旧积压判断与后续纠正被拆成不同事项，
同一事项的多段代码解释都被标为必保留 cause；第一阶段粒度及语义选择问题仍未解决。

buildSummarySelection 现在先核验全部原始证据，在确需选证时检查长度下界：
固定正文头 + 每条必保留事实的条目渲染 + 每个尚未覆盖结果事项的最短条目渲染。
条目沿用实际转义、换行和标题上下文渲染，逐条 trim 后计数；同一必保留结果不会再按事项重复收费。
下界不计来源归属、条目间分隔或纠正关联闭包，避免把保守的独立来源标题成本重复计作不可避免开销。
下界超过 5000 时抛 summary_selection_infeasible，附 minimumSummaryChars/maxSummaryChars，
不生成选证请求、不回退或重提取、不改写事实；下界未超限也不代表已证明可行，后续门禁照旧。
v7 协议、事实分类、关键覆盖及最终篇幅规则不变。

真实 71 条响应离线重放得到正文长度下界 10540，直接停止，响应保持原样、外部请求为零。
假 HTTP 的发布链回归验证仅一次提取调用、旧 episode 保留、派生文件/绑定写入为零；
另验证共享归属不重复收费、已覆盖事项不重复计数、转义/换行和无效引文优先拒绝。
旧 missing_required 发布夹具改为一条短的必保留限制，确保仍走到第二步遗漏门禁，不放宽产品规则。
10 文件定向回归 245/245 通过，fail/cancelled/skipped=0，源码语法检查通过。
本轮仅修复无解候选仍调用选证的问题；没有改善第一阶段提取或形成质量合格摘要。
本轮无新 API 调用、部署、历史修改或生产预算变更。

## 第一阶段：最终状态和最小充分摘录候选

对 71 条响应的诊断暴露出提取粒度问题：报告位置被另列为结果，重复代码佐证被列为多条必保留原因，
旧判断与其后续限制被拆成不同事项；这些模型分类不由程序自动重分类或修补。
本轮只修改第一阶段提示：按对象、日期和运行的最终状态选证，定位/佐证不另立结果事项，
cause 只表示原文明示且仍成立的实际原因；同一短引文已含结果和限制时不按标签重复登记。
同时明确第二阶段只能删 ID，不能缩短引文或改分类，要求第一阶段先选择最小充分的连续引文。

系统消息增加一个独立的北岬归档/南岬校验演示：6 段合成输入取 4 条原文证据，
排除旧猜测、代码追踪和报告路径，保留最终结果、最终原因、每批限制，以及另一事项的未解决状态。
其中一条只取长段中完整的结论，另一条同时保留失败与原因不确定性；没有生成新摘要语句或因果解释。
演示不进入实际 sources，也不是本次真实输入的证据；抄入另一个来源仍因引文不匹配被拒绝。
演示本身可由现有 v7 校验器渲染为 245 字符，只证明示例自洽，不证明模型会自动照此选证。

完整真实输入仍为 4 来源、197 段审计/193 段可见，请求 43054 字符，低于 45000 上限。
原先 71 条响应仍报 summary_selection_infeasible，未改写旧候选、未放宽覆盖或预算门禁。
10 文件定向回归 247/247 通过，fail/cancelled/skipped=0，源码语法检查通过。
本轮无 API 调用、部署、历史修改或生产预算变更；v7 协议、调用轮数、正文 5000 和生产 4096 token 均不变。
当前仅为提示侧候选，过度提取、误分类及关键事实覆盖是否改善，仍须用未经修补的真实响应验收。
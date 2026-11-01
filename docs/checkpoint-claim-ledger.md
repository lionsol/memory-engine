# 命题清单实验：段内事实覆盖与精确更正

日期：2026-11-01（Asia/Shanghai）；基线提交：0ca08c8。
状态：完整v1提取超时；原生v2小型提取已返回78条。
修正零填充ID限制并保留来源标题/表头后，82处正文证据及12处上下文回溯通过。
随后完整原生v2返回290条；最终合成19项、4994字符，仍有验收条件遗漏，未接入生产checkpoint。
完整提取与最终压缩的最新证据见文末e76249a实验。

## 要修复的缺口

前两次完整原文直接摘要中，资格保留虽改善，Daily Stats、临时文件清理和identity补齐路径仍会丢失。
同一段落s0.t1.p1包含多个独立运行结果，引用该段不代表逐个结果都进入摘要。
另一次输出把部署时间依据的撤回扩大到同段仍有独立依据的更新时间观测。

新增实验模块lib/checkpoint/summary-claim-ledger.cjs。
它将“原文定位”“模型提出的命题”“模型声明的更正关系”分别记录，
不再用同一个段落ID表示整段事实都被撤回。

## 输入与表示

沿用buildFactInput及sourcePacket中的可见来源、角色、上下文与范围。
仅将每个可见unit按物理行拆为审计fragment，标识为原unit.id加.l序号；
保留CRLF、缩进、空白和Unicode，拼回后与原unit.text完全一致。
SOURCE文本仅发送一次，输出quote由程序定位，不要求模型计算偏移。

物理行不是程序认证的原子事实：
同一行可能仍含多个判断，需要模型拆为多个claim。
程序不按关键词识别业务事实或自动推断因果。

模型响应为checkpoint-claim-ledger-v1：

~~~json
{
  "version": "checkpoint-claim-ledger-v1",
  "target_date": "2026-10-20",
  "binding": "复制请求绑定",
  "claims": [{
    "id": "c1",
    "scope": "具体任务、日期与阶段",
    "kind": "report",
    "text": "一个可单独更正的判断",
    "quotes": [{"fragment": "s0.t1.p1.l4", "quote": "片段内逐字且唯一的引文"}],
    "conditions": ["具体资格、否定、窗口或未决限制"],
    "corrects": []
  }],
  "dispositions": []
}
~~~

kind支持observation/report/request/decision/hypothesis/correction。
corrects仅允许correction使用，目标必须是本响应中的具体claim.id，
不能是段落/片段ID；未知、自指和循环目标拒收。
这验证关系的结构，不验证模型是否选对了撤回对象。

同一fragment可以支持多个claim，不按scope或引用去重。
quote须在该fragment内连续且唯一；程序返回原文角色、source_hash及UTF-16范围。
text和conditions是否忠实、kind是否合适仍为NOT_CERTIFIED。

## 片段ID证据模式v2：程序复制原文

真实v1小型实验暴露9处错引后，新增显式referenceMode=fragment_ids，
协议为checkpoint-claim-ledger-fragments-v2。
模型只返回evidence片段ID数组，不返回quotes/quote/偏移；
程序按冻结的SOURCE复制完整片段、计算范围并返回角色及来源哈希。
不会猜测字符位置、去除Markdown标记、修正转义或做模糊匹配。

claim的其他字段、条件与具体更正关系不变。
同一片段仍可支持多个claim；证据包含整个片段，不表示片段的所有文字都支持单个claim。
未知ID、重复ID、空证据及试图夹带quote字段均拒收。
新协议有不同version/binding，必须显式选择，旧v1精确引文校验保持不变。

~~~js
const generate = createCodexSummaryGenerator({ env, outputContract: "claim_ledger_fragments" });
const result = await runClaimInventory(input, async request => {
  const reply = await generate(request);
  return JSON.stringify(reply.summary);
}, { referenceMode: "fragment_ids" });
~~~

后续已执行一次原生v2小型提取；零填充ID兼容及来源上下文修复后的离线复验见文末。
程序复制证据的累计片段长度另限1048576字符，防止紧凑ID放大回读负载；超限拒收、不截断。

## 不再发生隐式的第二次内容选择

projectClaimLedger逐条呈现全部已提供claim、conditions及更正关系，
不再调用模型压缩，不删除被模型标注更正的条目。
旧判断明确附有模型更正标记，保留历史原述；关系本身仍未认证。
独立判断即使共享段落或fragment，也不会因为另一个claim被更正而由程序一并删除。

这保证的是已识别清单到呈现的字段保留。
它没有保证模型第一次提取时不漏项，也没有将本清单直接变成生产episode。

## 覆盖诊断不等于事实完整

每个fragment可被quote（v1）或evidence（v2）覆盖，或由dispositions说明：
duplicate须指向已有claim；context/unresolved不携带替代claim。
未知片段、重复处置、已引用又处置及悬空引用拒收。

未被覆盖或解释的fragment仍保留在unaccounted_fragment_ids，
并返回GAPS_REMAIN与非阻断quality_findings。
模型明确未处理的内容另列unresolved_fragment_ids。
全部片段被结构性登记仅标FRAGMENTS_ACCOUNTED_ONLY；
即使包含unresolved也不代表语义覆盖完成，semantic_coverage始终NOT_EVALUATED。

模型仍可能把独立结果错标为context，或把复合命题错误地合成一个claim。
测试专门证明：错误改写和错误处置可以在结构通过时仍不获得语义认证。
没有恢复逐项语义硬阻断政策，也不拿计数代替人工核对。

## 调用与CLI隔离

runClaimInventory仅调用一次传入的invoke，随后确定性呈现。
调用失败、JSON/绑定/引文失败、超预算、源变化或取消均无重试或fallback，
保留输入快照、invoke返回文本及可解析的ledger供复核；无publisher或DB调用。

Codex适配器新增宿主侧构造选项outputContract=claim_ledger，
选择固定的claim-ledger-schema.json；不接受任意schema路径或模型参数选择。
原derived_summary默认schema、参数及元数据行为不变，生产装配未选择新协议。

~~~js
const generate = createCodexSummaryGenerator({ env, outputContract: "claim_ledger" });
const result = await runClaimInventory(input, async request => {
  const reply = await generate(request);
  return JSON.stringify(reply.summary);
});
~~~

上述为v1调用示例；本轮真实执行及拒收结果见下文。
真实实验执行器仍须保存完整raw_records/原始文件、实际request、CLI原始输出及生成元数据。
模块record.source只是结构化可见输入，不替代完整原始记录归档；
raw_response是invoke返回文本，也不等同于CLI stdout原始字节。
新协议尚未接入既有TRACEABLE_DERIVED_MEMORY归档或Get，不宣称已经形成新的可接受生产记忆。

默认限制：输入200000字符、4096片段、1024条claim、8192处引文、
响应1MiB、最终正文20000字符。
超正文预算时不截断、不再请求压缩；返回拒收并保留可复核记录。
semantic_correctness固定NOT_CERTIFIED、publishable=false。

## 初始源码离线验证

新增19项命题清单测试、3项CLI实验schema接线测试。
覆盖同段多项、同片段多命题、部分更正、独立观测保留、
精确范围、错引/跨片段拼接/歧义引文、循环更正、覆盖缺口非阻断、
错误模型结论不获认证、资源预算、源变化、取消、单次调用及默认CLI兼容。

相关回归197/197通过、无跳过；其中显式提供既有私有input-records.json运行完整样本用例。
测试CLI响应均为模拟数据，不算真实GPT清单。
未设置MEMORY_ENGINE_TEST_CHECKPOINT_RECORDS时，完整私有样本用例明确跳过。

真实2026-10-20输入离线预检：

| 项目 | 结果 |
| --- | --- |
| 完整记录 / 原归档段落 | 4 / 197 |
| 模型可见段落 / 物理行片段 | 193 / 435 |
| 本协议输入字符 | 47623，低于200000上限 |
| Daily Stats定位 | s0.t1.p1.l4，与同段维护结果分开 |
| 全部可见unit逐字拼回 | 通过 |
| 原始source.md SHA-256 | 9b119fdc8c72918cbdc97d2000200b6d14cf71fc3c9b75c0827b2c33e903dbf6，未变 |
| 初始源码阶段新模型调用 / 生产写入 / 部署 | 0 / 0 / 0 |

## 首轮真实提取与错引修复（2026-11-01，执行基线2113019）

本轮两次CLI启动/逻辑生成：一次完整输入，一次另立的小型定位实验，
模型均明确请求gpt-6-luna/xhigh，超时均配置180000ms，未自动重试或替换模型。
CLI内部底层网络请求次数未观察，不声称只有两次HTTP请求。
原文仍只有对话和助手报告，没有独立工具事件。

| 实验 | 模型输入 | 结果 |
| --- | --- | --- |
| 完整输入 | 193个可见段落、435片段、47623字符 | thread.started与turn.started后触及期限；derived_cli_timeout，没有最终消息，不能作语义裁决 |
| 小型定位 | 19个真实段落（含所需标题）、47片段、7436字符 | CLI退出0、工具事件0；返回112条claim、112处引用、7条dispositions；v1因claim_quote拒收 |

DevSpace请求通道先于生成进程返回而超时，检查确认原进程仍在运行后仅回读结果；
没有因此重新启动相同提取。完整输入失败不能单独归因为输入长度、模型能力或服务过载，
小型任务随后成功也不能证明完整任务的语义质量。

### 精确错引的原因

112处模型复制的引文中有9处不满足v1合同：

| 类型 | claim | 情况 |
| --- | --- | --- |
| 非连续拼接 | c2、c3 | 将合并的三个时间点列表改写为单个时间点加共同结果，文字不在原文中连续出现 |
| 标记/转义改变 | c26、c32、c94、c97、c102 | 移动Markdown加粗边界、改写反斜杠转义或省掉位于引文内部的标记 |
| 不唯一 | c95、c96 | 表格同一行两次出现“不可得”，短引文不能唯一定位 |

这些缺陷不是同一回事：部分claim的含义有原文依据，但model quote仍不精确。
旧v1拒收正确保留，原quote、CLI原始JSONL和最终模型文本均未改动。
片段ID模式让程序承担逐字复制，不再要求模型同时改写命题和复制精确标记；
不因此认证命题语义，也没有放宽旧的字面校验。

### 小型输入的定向人工语义复核

本表只评审这19段中的已列检查点，不能外推为全部历史或完整输入通过。

| 检查点 | 模型输出 |
| --- | --- |
| 维护、Daily Stats、误建文件删除分别保留 | c5–c10、c13、c21–c24 |
| 共享identity补齐路径与旧误判更正 | c36–c41、c49–c57，含代码路径与运行效果尚待核验的区别 |
| mtime部署推断只撤回具体命题 | c58仅指向c26 |
| 独立更新时间观测仍保留 | c64/c65保留03:30:07最后更新及固定时刻后未更新；没有把该时刻认证为部署时刻 |
| 自然样本具体窗口、筛选资格、排除项 | c71–c78保留UTC窗口、natural_user_turn、valid、source、trigger、身份字段及排除1条 |
| 残差统计限制 | c100–c104将口径列为待复核，不计算新的“正确残差”或认证未知组件贡献 |

112条清单包含大量逐指标、逐计数条目，不等同于112个独立业务事件。
它只是候选中间表示，不能把条目数增加当成最终摘要质量改善。

### 同一输出的显式离线片段视图

只复用这次v1已返回的fragment ID，程序另建v2形式的派生视图；
不重新调用模型，不改任何claim的id、scope、kind、text、conditions或corrects。
原始quotes保留在模型响应和original-quote-findings.json中，
新视图明确标记explicit_offline_reference_rebinding_of_v1_output_not_v2_model_generation，
不是模型曾生成v2协议的证据，也没有将旧拒收结果改写为成功。

结果：112条命题、112处完整片段证据均可按来源哈希和UTF-16范围
从同一原始记录读回；正文12501字符，低于20000上限。
38个片段被引用，7个由模型标为上下文，2个标题未登记，状态仍为GAPS_REMAIN。
未登记项为“两个遗留隐患”标题和Edi补充的引导标题；7条context均为标题/表格列名或分隔行。
这些是人工核对结果，不作为程序以后自动忽略类似文本的规则。

完整输入提取仍失败，v2尚无真实生成验收；
仅19段的中间清单已达12501字符，后续还须验证全量成本和最终摘要的覆盖。
不能把该小型视图或程序回溯通过当作全量语义修复。

### 私有证据与程序检查

证据均位于/home/lionsol/.openclaw/ops/memory-engine/：

- checkpoint-claim-inventory-2113019-20261101-r1：完整输入、配置、原始CLI输出与超时结果。
- checkpoint-claim-inventory-2113019-20261101-micro-r1：完整原文/记录、完整及选取的fact input、实际request/schema、原始CLI输出、最终文本、112条原始claim及拒收结果。
- checkpoint-claim-inventory-2113019-20261101-micro-r1-fragment-view：原始模型文本副本、9处错引发现、显式派生清单及全部片段回溯。
- 对应.cjs执行器保存单次调用、子进程代理字面量提取及离线重绑定步骤，不执行shell配置、不输出代理值。

原始小型模型文本SHA-256：
08abe7fea53feb62750357c94b715485838cd9fec3d697ac76f561f19e3dfe85。
完整source.md与原响应字节均未变；全量和小型调用时源代码哈希未变。
新片段视图是源码修正后的离线结果，未冒充2113019下的原始产物。

新增10项程序测试，包含ID唯一定位、Markdown与表格重复值、旧v1仍拒收、
模式/绑定隔离、未知ID与夹带quote拒收、证据展开预算、原输出离线重放及CLI固定schema选择。
相关回归207/207通过、无跳过；已显式提供私有输入和响应路径。
默认不提供MEMORY_ENGINE_TEST_CLAIM_INPUT/RESPONSE时，私有重放用例明确跳过。
新模式CLI测试使用模拟响应，不算真实v2模型验收。

本轮生产发布/数据库操作/部署均为0，默认literal_quotes与derived_summary路径不变，
未启用生产命题清单。原有有损接受政策、NOT_CERTIFIED及生产legacy失败裁决保持不变。

## 原生v2小型提取与来源上下文修复（执行基线2834964）

本轮新启动一次真实CLI，仍请求gpt-6-luna/xhigh，限时180000ms。
模型输入与前次小型v1相同：19个原始段落、47片段，未提供旧摘要或人工答案；
新v2请求7212字符，正文上限仍20000字符。完整原文及4条原始记录另外完整保留。
这次是模型原生返回v2，不是把v1输出改造成v2。

CLI完成：退出码0、tool_events=0、4个事件、stdout 24385字节、stderr 0。
返回78条claim及10条dispositions，原始链路最初为REJECTED/claim_schema。

### 不必要的ID格式限制

模型使用c001至c078。JSON Schema和提示词只要求c编号，
但运行时隐含要求首位非零，导致78条有效字符串ID均被拒收。
这些ID只用作精确字符串关联，没有正整数数值语义。

解析器现接受c加1至6位数字，保留零填充原样，不重编号、不把c1和c001当同一个ID。
相同ID重复、超长ID、路径式ID及不存在的更正目标继续拒收。
原拒收result.json保留；仅用同一模型文本离线复验，不再次请求模型。
request、响应对象、命题正文、条件与更正关系完全不变。

ID修正后的结果为78条、82处完整片段证据全部回溯一致、正文9859字符，
47片段中37被引用、10被声明为context，未登记及unresolved均为0。
结构状态为FRAGMENTS_ACCOUNTED_ONLY，仍不认证语义覆盖。

### 会携带结论的标题被当作context

人工逐项检查10条context时发现，其中包含：
“自然样本身份—PASS”和“延迟—PASS（受限）”。
两处原始结果标签没有进入claim字段；
即使条件、数值多数保留，不能将这种结构覆盖算作没有事实遗漏。

新增程序来源上下文保留，复用ordinary-evidence-context的contextFor：
根据实际引用范围保留对应原文标题、表格列名及精确位置，
返回去重的source_context和每处证据的context_ids，并纳入最终呈现及正文预算。
不让模型的context处置决定标题/表头是否可见，也不按PASS等关键词判断标题重要性。
跨来源引用、范围不一致或展开超预算拒收；正常换轮不会继承上一轮标题。

这些是原文上下文，不是新增的模型结论。
程序不会因为复制了PASS标题就认证通过，也不据此给其他日期或任务授予PASS。
该呈现修复同时作用于两个实验命题协议；生产checkpoint路径未接入。

同一原生v2响应在新呈现中：
78条claim原样保留，82处正文证据及12处标题/表头上下文全部从原始记录核对一致，
正文10485字符。两处结果标签现作为来源原文可见。
未改模型对象，未把源上下文伪装成模型新提取的claim。

### 已列检查点的人工复核

| 检查点 | 原生v2中的范围 |
| --- | --- |
| 独立维护与Daily Stats | c003–c011 |
| 误建文件、删除及影响归属 | c018–c020 |
| identity共享补齐路径与误判更正 | c027–c040 |
| mtime推断的具体撤回 | c036仅指向c022 |
| 独立更新时间观测 | c045/c046保留03:30:07和固定时刻后未更新，未将固定时刻认证为部署时刻 |
| 样本窗口、资格、排除与生命周期 | c048–c062保留具体值 |
| 延迟统计的口径与归因边界 | c070/c071保留聚合口径未说明、不能据不同聚合的中位数验证残差；c072为未量化的假设 |

本表是已知小型开发样本的定向复核，不是全部claim语义正确或完整历史通过的裁决。
统计口径本身仍未澄清，原始对话也仍不是独立工具证据。

### 证据与回归

私有目录前缀：
/home/lionsol/.openclaw/ops/memory-engine/checkpoint-claim-fragments-2834964-20261101。

- -micro-r1：实际输入、request/schema、CLI原始输出、原生v2文本及最初ID拒收结果。
- -micro-r1-replay：只修正ID规则后的离线复验，正文9859字符。
- -micro-r1-context-replay：继续保留源标题/表头后的离线复验，正文10485字符。
- 对应-micro.cjs、-replay.cjs和-context-replay.cjs保存执行与核对步骤。

原始模型文本SHA-256：
278297101a061d44967d5576d20df40940cb13f171c587da2c354e7ed938ef13。
源文件、原始模型文本、最初失败结果均未改。
DevSpace通道超时后只检查原进程和回读结果，没有重复生成。
本轮共一次实际CLI生成，后续两次均为离线复验；底层网络请求次数未观察。

新增5项程序测试：ID零填充与精确关联、非法/重复ID仍拒收、
原生v2响应逐字回放、源标题/表头保留、去重与跨轮/跨来源边界。
相关回归212/212通过、无跳过，显式运行完整输入、旧v1和原生v2私有用例；
MEMORY_ENGINE_TEST_FRAGMENT_RESPONSE未设置时，新私有原生v2用例明确跳过。

截至该小型实验，原生v2生成、机械回溯及已列检查点已验证；
当时完整样本、全量成本与最终摘要质量仍未验证。
生产发布/数据库操作/部署为0，原文归档及有损接受政策不变。

## 完整原生v2与最终压缩（e76249a基线，2026-11-01 UTC）

### 完整提取不是最终摘要

冻结同一份4条原始记录，197个归档unit、193个可见unit、435个物理行片段。
原文SHA-256仍为9b119fdc8c72918cbdc97d2000200b6d14cf71fc3c9b75c0827b2c33e903dbf6。
本轮明确将**中间清单**正文预算放宽到200000字符、CLI期限延长至270秒；
最终摘要预算仍为20000。协议、预算与期限均不同于早先v1超时实验，
故不能据此单独证明某一因素修好了超时。

一次gpt-6-luna/xhigh请求于15:42:57Z开始、15:46:02Z完成，exit=0、tool events=0；
实际输入47400字符，返回290条claim、8个context处置。
清单呈现47406字符，410处正文引文及81处来源标题/表头上下文均与完整原始记录逐字一致。
359个片段被claim引用，8个有处置，68个尚未交代，状态GAPS_REMAIN。
68个里既有标题，也有其他claim已表述的重复验收规则；不能一概判为无关，更不等于事实完整。

人工读完290条后仍发现：
- c103把旧统计适用范围的限制连成corrects→c071/c072；原文没有撤回旧快照计数。
  程序保留所有目标claim，不按模型边自动删除旧事实。
- c268仍把894/1908/908/47.6%写成报告差额，未充分指出算术与聚合口径待核。
- c088把mtime观测和部署解释放在同一claim，虽有条件与后续撤回，原子化仍不充分。

完整清单保留了原49条逐ID成功/不成功条件、pending recovery零计数规则及主要独立结果；
以上只是定向人工复核，不是290条全部正确的认证。

### 单次最终合成与实际结果

新增隔离模块lib/checkpoint/summary-claim-compose.cjs，显式调用才生效：
buildClaimSummaryPrompt / runClaimSummary。
只接收通过结构/绑定校验的原生v2清单；将它作为UNTRUSTED_MODEL_DRAFT，
同时提供完整SOURCE和程序生成的fragment→unit定位，不再提取清单。
corrects不自动使目标事实失效，统计矛盾须待核，最终只引用原unit.id。
输入上限200000、最终默认20000字符；绑定/引用/预算错误拒收并保留响应，
不重试、不截断、不写库、不发布。语义状态始终NOT_CERTIFIED。

一次实际合成输入106515字符，含同一完整SOURCE和全部290条claim；
实际开始/结束为16:11:08Z至16:12:10Z。
请求gpt-6-luna/xhigh，exit=0、tool events=0，得到19项、4994字符。
实际软目标为14000、硬上限20000，仍远未用满；仅提高字符上限不能保证保留条件。
103处引用全部回溯到原始记录，源文件、中间清单与代码hash未变。
结果存入本次私有只追加归档，未覆盖既有episode。

| 已知开发检查点 | 本次最终摘要人工复核 |
| --- | --- |
| 三次健康检查、Nightly、Daily Stats | 均保留，Nightly与Daily Stats合在一项但分别写出结果 |
| episode恢复与误建0字节文件删除 | 结果保留；旧占位备份细节省略 |
| 部署流程与重试边界 | flush→reconcile→采集保留；targetDate化、7文件/50条边界省略 |
| fingerprint、共享identity路径与历史歧义 | 主要结论与更正保留 |
| mtime部署断言撤回 | 明确保留，不虚构实际加载时刻 |
| 旧Lance统计及每日10条 | 计数及适用范围并存，没有按c103删除旧计数 |
| 独立Gateway核对与报告修订阶段 | 独立核对保留；仅修订报告阶段的限制没有完整单列 |
| 自然首跑A/B条件 | **仍遗漏/混合**：A的49个固定ID逐项成功、原行消失不算成功、悬空/冲突异常未写；B可为0的条件被泛称“0值”，作用域不清 |
| 目标日backlog与日志缺口 | 目标日backlog=0、日志缺口不阻挡/无需再部署省略 |
| 632、1241及handoff区分 | 主要验收结果、阶段和信号区分保留；来源live 69=13+56未完整写出 |
| 原49条当前全空与归因限制 | 保留未见路径运行证据、不据此判失败、不独归因于修复 |
| 自然窗口、资格具体值与排除 | 窗口、LIMIT200饱和、15/15资格和排除1条保留；历史1652个trace无孤立started省略 |
| 延迟与908差额 | 本轮明确标聚合数字/差额口径待复核，不作为已核实残差 |
| 取消PENDING与AutoRecall执行边界 | 保留零事件不证明生效、阶段只读及建议性质 |

这里比较的是已知开发样本，不是holdout；没有重新核验报告中的runtime事实。
最终第12项（0-based index 11）已引用s0.t13.p1/p2/p3，
其中包含被省略的成功条件；因此“引文存在”不能证明“正文保留了条件”。

本次证据将损失位置缩小到**最终压缩阶段仍会丢弃、合并已提取条件**。
直接原因是实际生成的概括超出了条件原有作用域；模型为何这样选择仍未知。
不能把两阶段、提示词或加预算中的某一项单独宣布为因果修复。
裁决：TRACEABLE_LOSSY_CANDIDATE / PARTIAL_SEMANTIC_IMPROVEMENT / NOT_PROMOTED。
下一步应针对A/B这类独立判定保留结构化条件的归属，不能靠引用覆盖或更长预算替代。

### 原始证据及回放

私有前缀/home/lionsol/.openclaw/ops/memory-engine/：
- checkpoint-claim-fragments-e76249a-20261101-full-r1：完整提取、原生模型JSON、片段回溯及缺口。
- checkpoint-claim-compose-e76249a-20261101-r1：最终请求、原始CLI事件、模型JSON、代码快照、
  rendered-body.md、resolved-summary.json及archives。
- 两个对应.cjs执行器都只调用一次生成；完整提取后的合成是另一阶段，不是提取重试。

完整清单原始JSON SHA-256：
df033abed11c0cd2f317963f980ad06059106d81886a96c1d0c449873ab9a5c1。
最终摘要原始JSON SHA-256：
728f756e835aba991f110f9b6eecc6722ed4df2c37148a8ed611f7f2f37abcea。
最终私有archive_id：
9b7e2e7a210f061e85b2917cc85c3a1df19cc011a553aa4ac62afdf4f55c8d69。

新增完整清单回放、合成单元测试和最终原响应/私有归档回放，
验证机械绑定、单次调用、取消、源变更、拒收、预算与完整原文保留；
相关回归222/222通过、无跳过，显式包含完整输入、v1/v2小型与两份完整响应回放。
这些测试不把遗漏或错误变成语义通过。
未设置MEMORY_ENGINE_TEST_FULL_CLAIM_RESPONSE或MEMORY_ENGINE_TEST_CLAIM_COMPOSE_RESPONSE时，
对应私有用例明确跳过。生产发布、数据库操作和部署仍为0。

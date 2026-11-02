# 命题清单实验：段内事实覆盖与精确更正

日期：2026-11-01（Asia/Shanghai）；基线提交：0ca08c8。
状态：完整v1提取超时；原生v2小型提取已返回78条。
修正零填充ID限制并保留来源标题/表头后，82处正文证据及12处上下文回溯通过。
完整原生v2返回290条；旧叙述合成19项、4994字符仍丢验收条件。
最新原生短ID修订及限定事项复核为24项、13412字符，已补完当前样本的分类指令。
字段名拼接、未来归因限制和Daily Stats修复保留；独立Gateway核对及报告修订边界仍未完整呈现。
未接入生产checkpoint；完整提取、条件结构、局部修订及原生实测的证据见文末。

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

## 条件归属的显式字段修复（9e47062基线，2026-11-02 Asia/Shanghai）

### 改动与保证边界

上轮只用了4994/20000字符仍省略原49条验收条件；原文和290条清单均含相关内容。
本轮在summary-claim-compose.cjs增加显式实验选项outputMode="scoped_fields"；
默认prose请求及旧响应回放保持原样，生产checkpoint未接入。

新输出每项分别返回scope、conclusion、conditions、unresolved、evidence、corrects；
每个condition/unresolved都有自己的scope、text及原unit.id引用。
程序按原顺序固定呈现所有已返回字段，并将条件/未决引用纳入最终原文回溯。
不再让另一轮叙述生成覆盖这些字段，不按标题推断归属或自动删除旧判断。
原始结构响应与标准摘要投影分别保留；标准投影可用既有只追加归档和Get路径读取。
CLI新增由host显式选择的scoped_summary输出协议；请求数据不能自行选择schema。

这保证**模型已返回的字段不会在后续呈现中丢失**，
不保证模型已提取全部条件，也不保证它声明的scope正确。
缺字段、空scope、未知引用、绑定不符及渲染超预算拒收；语义发现继续非阻断。
所有文字、scope标签与引用均计入最终20000字符预算，不隐藏到预算之外。
未引入重试、模型替换、DB、调度或发布操作。

### 首次完整实测 r1

沿用同一4条完整原始记录和已保存的290条清单；未重新提取清单，
也没有把人工开发参考或手工改写后的答案给模型。
一次gpt-6-luna/xhigh，输入107272字符、270秒期限；
北京时间07:43:49至07:45:21完成（原结果UTC为2026-11-01 23:43:49Z至23:45:21Z）。
返回24项、52个条件、11个未决，正文11774字符，135处原文引用逐字通过，
exit=0、tool events=0，原文/清单/执行时代码hash不变。

定向改善：
- A路径的固定49个ID、identity关联、snapshot异常及原行消失不计成功写入独立条件。
- B路径零计数例外单独限定到pending recovery，不再泛化为所有验收的“0值”。
- 目标日backlog=0、7文件/50条、日志缺口不阻挡/无需再部署、来源live69=13+56、
  历史1652个trace无孤立started重新保留。
- 旧计数没有因c103的错误corrects边删除，908ms差额仍标待复核。

仍有实际问题，不能用“字段全部保留”掩盖：
- 0字节SQLite误建文件的清理再次遗漏，尽管完整清单c033/c034及原文均有。
- A的snapshot“对应或可解释”被收窄为必须对应，例外在生成字段时已丢失。
- 模型给旧Lance统计新增“原报告口径不一致”判断；仅凭这些数不能支持该判断：
  173+1830=2003、1781+49=1830，ambiguous是另外报告的排除集，不能随意混算。
- 把助手报告的valid=true换成traffic_origin_valid=true；
  后者出现在用户要求检查的字段中，不能据此认证它就是本次报告已验证的字段。

这次改动保证已返回字段按结构呈现，避免后续再合并条件；A/B泛化在本次样本中改善。
这不是旧渲染器丢字节的修复：错误也会在模型生成字段时发生，
仍会删例外、遗漏短结果或过度归纳。“结构保留”与“语义改善”分别评价。

### 同样本逻辑复核修订 r2

针对r1发现，通用规则补充：保留逻辑连接词与可解释例外；独立小结果和排查副作用/清理
不因讨论短而自动删除；未知不等于矛盾，集合口径不能混算；
报告字段不与用户要求检查的字段擅自互换。
没有把本样本文件名、49条判定答案或具体算术校正作为新增提示示例。
r1原始结果不改，r2是新提示下的另一次合成，不是失败重试或清单重提。
最终预算、冻结原文、冻结清单、模型和期限与r1相同；输入为107567字符。
这是已知开发样本迭代，结构和提示同时变化，不能单独证明某种格式具有普遍因果收益。

### 证据位置与程序回归

私有目录前缀：
/home/lionsol/.openclaw/ops/memory-engine/checkpoint-claim-scoped-compose-9e47062-20261102。
-r1及-r2分别保存request/schema、执行代码快照、原始CLI流、原始模型JSON、
scoped-response.json、projected-summary.json、rendered-body.md和私有只追加archives。
对应两个.cjs执行器记录各自的单次调用；底层网络请求次数未观察。

r1原始模型JSON SHA-256：
9eb0bce86a741590371fea278bf312557d92fda26c203058352eee9ef7f281eb。
r1 archive_id：
ba5b24f372309eab1a72af842b95d97fa16e7190071e47613382d85505ca79d6。

新增字段保留、分条件引用、错误结构/引用/预算拒收、单次调用、错误scope不认证、
CLI schema集成和两份真实响应回放测试。
私有回放分别由MEMORY_ENGINE_TEST_SCOPED_CLAIM_V1_RESPONSE、
MEMORY_ENGINE_TEST_SCOPED_CLAIM_RESPONSE启用，未提供时明确跳过。

### r2结果与剩余语义问题

北京时间07:47:29开始、07:49:33完成（UTC 2026-11-01 23:47:29Z至23:49:33Z），
一次CLI生成，exit=0、4个事件、tool events=0，无重试或换模型。
DevSpace响应通道到期后只回读原进程的result.json，没有另开生成。
22项、48个条件、13个未决，正文11908字符；134处原文引用逐字通过。
原文、清单和执行时代码hash均未变，完整4条原始记录保存在私有归档中。
r2原始JSON SHA-256：
7bafd34228dfa64038a1931885eda43d4d35f24a73f842b8321a5881b0f24d65。
r2 archive_id：
85777fac994af2e1fbd1f782d3e2af2bbc509eabae2703b7c6faa7ae649348d9。

| 定向检查 | r2实际结果 |
| --- | --- |
| A/B路径条件归属 | 分开呈现，B的零计数规则未泛化 |
| snapshot匹配例外 | 恢复“对应或有可解释情形” |
| 0字节探测文件清理 | 恢复误建、删除及报告无影响 |
| 旧Lance统计 | 不再新增计数矛盾判断，旧统计范围与新版队列限制均保留 |
| 目标日backlog、日志缺口、来源69及历史1652 | 保留 |
| 残差与取消机制 | 908ms继续待复核，零取消事件不认证生效 |
| 原confidence行消失 | 仍列为独立分类，但省略“不计成功，单列去向”的明确指令 |
| 原49条后续结果归因 | 保留当下全空不判失败；遗漏“日后全绑定也不单凭结果归因于修复”的限制，较r1退步 |
| 自然样本字段名 | 仍把报告valid=true写成traffic_origin_valid=true |
| 条件/未决分类 | 将已有Gateway采样和交叉计数放入unresolved，文字保留但类别不准确 |

字段名错误可定位到最终合成：中间c247明确是用户要求检查traffic_origin_valid；
c258明确是助手报告valid=true。两者均正确区分，但最终把前者字段名与后者true拼为新断言。
这不是缺源或解析器复制错误，也不能凭存在相关unit引用认证新断言。
原49条未来归因限制同样已在中间c231/c242保留，丢失发生在最终合成。
可观察到错误生成的位置与拼接方式，尚不能证明模型内部作此选择的原因。

r2的逐项发现写入其semantic-review.json，原始模型内容及归档未改；
发现不作为有损摘要接受的硬门，但不宣称Bug已经根治。
裁决：SCOPED_FIELDS_PRESERVED / PARTIAL_SEMANTIC_IMPROVEMENT / NOT_PROMOTED。
已知开发样本仍存在跨角色字段拼接、短限制遗漏和分类不稳；没有新holdout或重复采样收益证明。
本轮共两次最终合成，无清单重提、生产发布、数据库操作或部署。

相关回归233/233通过、无跳过，包括旧v1/v2、完整清单、旧叙述摘要及r1/r2原始响应回放；
语义发现未被测试计数改写成通过。

## 保留未修改内容的局部修订（e4e8b32基线，2026-11-02 Asia/Shanghai）

### 修复方向与接口

22项候选里，c247是“用户要求查traffic_origin_valid”，c258是“助手报告valid=true”；
最终将两者拼接。未来全部绑定仍不能单独归因的限制也已在c231/c242提取，却被最终合成删除。
这两类损失不是引文偏移或源文件缺失；继续整篇改写会使已修内容再次丢失。

新增隔离模块lib/checkpoint/summary-scoped-repair.cjs：
buildScopedRepairPrompt / applyScopedRepair / runScopedRepair。
读取完整SOURCE、同一290条不可信清单及冻结的CURRENT_SUMMARY，
模型只返回带原文引用和reason的局部提案：
替换一个条件/未决、追加一个条件/未决、原样移动分组，或补一个独立事项。
不允许删除旧事项/条件、覆盖整篇或改写已有scope/conclusion。
**未被指定修改的字段和独立事项按原顺序保留**；被替换字段内部仍需人工语义复核，
不能把这个机械保证夸大为每个事实都未丢失。

完整摘要SHA-256、SOURCE绑定、原始地址和引用范围为硬检查，
重复/越界目标拒收；整次调用一轮、无重试、无自动fallback。
新条件和新增事项也计入20000字符总预算，不截断或隐藏超预算部分。
提案、原摘要、原始响应、修改前后及理由均保留，语义仍NOT_CERTIFIED。
CLI的scoped_summary_repair协议只由host显式选择，默认derived_summary不改。

### 两次实际审核及其不同结果

同一完整原文、290条清单、原22项摘要均冻结不变；未把手工参考或已写好的修订答案交给模型。

| 阶段 | 实际结果 |
| --- | --- |
| r1，输入130014字符 | 10:06:23–10:07:25，3处替换、3处追加、3处分组移动；22项/12268字符/138处引文 |
| r1人工复核 | 补未来归因限制、原行消失不算成功及观测分组；但漏掉字段拼接，并不当地撤掉残差待核限制，不能宣称审核通过 |
| r2，输入130454字符 | 10:11:34–10:13:09，2处替换、10处追加、3处分组移动、1个独立事项；原生v1提案因1处目标hash不匹配被拒收，原摘要未变 |
| r2离线转换 | 全部文字、引用和目标地址保持不变；显式转换为host计算目标hash的v2，0次生成；23项/12942字符/141处引文 |

两次均请求gpt-6-luna/xhigh，exit=0、4个事件、tool events=0，期限270秒，
无清单重提、模型替换、生产DB、配置、部署或调度操作。
r2响应通道结束后只回读原进程结果，没有重新生成。
findings为空也不构成语义通过：r1的漏检和退步单独记录于semantic-review.json。

### 字段名提示和未决保护

r1漏检后新增非阻断identifier_review_hints：
程序仅比较带下划线的赋值标识符是否出现在该字段**自身所引原文**中，
不从其他用户请求借字段名。最多128条，不自动修改文字、推断别名、判字段值真假或拒绝候选。
本样本恰定位1处：item17.conditions[0]使用traffic_origin_valid，
但其所引s0.t27.p1只有报告valid=true；用户另在s0.t26.p6要求检查前者。

r2同时补通用规则：来源自身可能有错；来源未澄清统计定义时，
不能仅因原报告没有承认矛盾就撤掉现有待核限制。
字段提示及规则都不是独立语义裁判，也不是跨样本泛化证明。

### 冗余目标hash的机械失败及v2修复

r2完整摘要hash正确、源和基线未变，5个目标中4个hash匹配；
只有item18.conditions[2]的模型hash与host给出的原字段hash不同。
原v1调用仍按scoped_repair_stale拒收，失败记录和原始JSON不改。

v2不再要求模型复制每个字段的64位hash：模型给原始位置和完整摘要hash；
host校验整篇冻结基线，再由该位置计算before_sha256并保存审计。
整篇hash已覆盖每个字段和位置，任何并发变更都使绑定失败；
这没有放开跨摘要/跨来源的修订权限。
原v1验证保留，不自动忽略错误hash。

显式rebindLegacyRepair仅用于离线兼容：
必须匹配完整原基线和来源，核对地址/引用/冲突/预算；
转换副本的协议版本并移除冗余模型hash，同时保存5处hash比较，其中1处不匹配。
原提案的文字、理由、引用、操作数及地址不变，原JSON和拒收结果不覆盖。
**不是一次原生v2模型生成，也不是生成失败后的自动重试。**
v2原生CLI生成尚未实测；当前证明来自程序测试和这份v1响应的明确离线转换。

### r2转换候选的定向语义复核

| 目标/发现 | 当前候选 |
| --- | --- |
| 请求字段与报告字段拼接 | 正文恢复报告的valid=true；另保留traffic_origin_valid是否等价/是否已核验为未决 |
| 未来全部绑定的因果限制 | 在验收计划及当前复核中明确保留：后续全绑定不能单凭结果归因于修复，需自然路径运行证据 |
| Daily Stats独立结果 | 补回04:00正常写入stats-history.md；此前22项中仍遗漏了这一短结果 |
| Gateway与交叉计数分组 | 3处已有报告观测原样移出unresolved，文字未被重新生成 |
| 残差口径 | 保留894/1908/908/47.6%的报告列值，正确差额及聚合口径继续待核，不据中位数新算残差 |
| 已修内容 | A/B归属、snapshot可解释例外、探测文件清理、旧Lance范围限制及未修改内容保留 |
| 仍有遗漏 | 原confidence行消失虽单独列类，但“不计成功、单列去向”的明确指令仍未补全 |

本表是已知开发样本复核，不是独立工具证据、holdout或全历史语义通过。
当前两项主要目标在此候选中已修正，仍有遗漏；
裁决TARGETED_FIXES_OBSERVED / UNTARGETED_FIELDS_PRESERVED / NOT_PROMOTED。
有损摘要的接受政策不变，发现不另升为语义硬门。

### 原始证据和回归

私有目录前缀：
/home/lionsol/.openclaw/ops/memory-engine/checkpoint-scoped-repair-e4e8b32-20261102。
-r1保存首次提案、私有派生归档和人工发现；-r2保存带标识符提示的请求、原始提案及hash拒收；
-r2-rebound保存显式离线转换、migrated-proposal.json、migration.json、源快照、
repair-audit.json、semantic-review.json及新的只追加归档。
三个对应.cjs执行器分别保存生成或离线转换步骤；每次生成仅一轮，离线转换无provider调用。

r1原始提案SHA-256：
a8049498d9f05ee693d4b7180a89a44fa3c4b22fde4ca05fc7b446d99825aa6c。
r2原始提案SHA-256：
13289ee8eaaaf4bb8e489d2d054652c11b26b0ebc0bd12d97e346f3919024bdf。
r2转换候选archive_id：
cbe9ea8ee6f1b5f605bc128b641aff34252f999cefae54095db2b1bd57a38c15。

相关回归254/254通过、无跳过：
包括旧协议与既有完整响应、原位修改/移动、绑定/目标/引用/预算、并发变更及取消、
字段提示、v1严格拒收、v2 host目标hash、显式转换和完整原始记录回溯。
MEMORY_ENGINE_TEST_SCOPED_REPAIR_V1_RESPONSE、
MEMORY_ENGINE_TEST_SCOPED_REPAIR_RESPONSE和MEMORY_ENGINE_TEST_SCOPED_REPAIR_REBOUND_RESPONSE
分别启用本轮三份私有回放，未设置时明确跳过。
源文件、清单、基线摘要、两份原提案及最初拒收均未改。
生产发布、DB操作、部署仍为0；测试计数不认证语义完整或正确。

## 原生修订：短ID定位与限定事项复核（6783169基线，2026-11-02 Asia/Shanghai）

### 原生v2暴露的是地址错误

先以干净6783169、同一原文/290条清单/原22项摘要运行原生v2，没有改提示或重提清单。
输入126381字符，北京时间12:16:43–12:18:39，一次CLI、exit=0、tool events=0。
模型提出3处替换、2处追加、3次移动和2个新增事项，但moves[2]指向
item15.unresolved[0]；该原始事项没有这一字段，模型理由和引用对应另一事项。
程序按scoped_repair_target拒收，原摘要未变。
没有把15猜改为16，也没有抽取部分操作假装整轮通过。

这说明删掉冗余hash尚不够：模型仍会把需要修订的内容定位到错误的数字下标。
观察到的是输出地址不合法；不能据此推断模型内部如何数错。

### v3将定位交还程序

summary-scoped-repair.cjs新增当前协议checkpoint-scoped-repair-v3，
原v1/v2继续按原规则回放。
host在CURRENT_SUMMARY的提示视图里紧邻事项/条件标注item_id、part_id，
例如i018、p048；没有改变冻结原摘要或其完整SHA绑定。

模型仅引用给定的短ID：
- replacements给part_id及新字段；
- moves给part_id及目标分组；
- appends给item_id及新字段；
- 新事项和原文evidence协议保持不变，短ID不能冒充原unit.id。

host精确映射到原始位置、计算before_sha256，
保存resolvedTargets及修改前后审计，再走原来的绑定/引用/冲突/预算检查。
未知ID、拼写/零填充别名、数字下标混入、跨基线使用及重复目标拒收；
不按scope、reason或相似文本猜目标。
v1→v2离线兼容转换保持旧行为，不自动升级或修复已拒收的数字地址。
默认derived_summary及生产路径仍未接入此实验。

### 两次原生v3生成

| 阶段 | 输入及时间（北京时间） | 结果 |
| --- | --- | --- |
| r2，全量审核原22项 | 126589字符，12:24:32–12:26:00 | 原生v3直接READY；2处替换、6处追加、3次移动、2个新增事项；24项/13301字符/145处引文 |
| r3-focused，基于r2的24项 | 128891字符，12:31:39–12:32:10 | 原生v3直接READY；仅替换1个条件；24项/13412字符/145处引文 |

两次均请求gpt-6-luna/xhigh、期限270秒、最终20000字符；
每阶段仅一次生成，exit=0、4个事件、tool events=0。
未改模型JSON、未做离线协议转换或地址纠正；ID映射是v3预先定义的正常程序投影。
原文、清单、每阶段的基线及执行时代码hash均不变。
本轮共3次生成（含先前原生v2拒收），不是静默重试；超时通道只回读原结果。

r2修复了字段名拼接，补回未来关联不能单独证明修复归因、Daily Stats及报告观测分组，
并保留残差待复核。但仍只是把“原confidence行不存在”列类，没有写全“不计成功、单列去向”。
checkpoint退出0又被追加一次，尽管已有结论已写出；这类重复不被误报为新事实。
部分新增历史样例明细虽与原文相符，也不证明全部必要事实已经覆盖。

### host限定复核范围，补完已知分类指令

新增可选reviewScope={item_ids,question}：
host选择最多8个已存在事项，问题最长2000字符；非法/未知范围在调用模型前拒收。
指定范围时，程序拒绝范围外的替换/追加/移动和新增事项；
其他问题只能作为findings保留。
输入问题和ID是审核范围，不是语义通过证明。提案不能自行扩大范围。

r3由人工针对已知开发缺口选定i013（原49条验收清单），
问题要求核对每类计入标准、原记录不存在时的判定及去向说明；
未将手工写好的正确条件交给模型。
程序定位p028，仅替换原item12.conditions[3]。
模型明确保留：
- reconciliation计数是该次运行指标，不能当成逐ID状态；
- confidence/identity关联及Core ID对应或可解释关系才可计成功；
- 悬空/冲突绑定进异常、不计成功，entity_id非空本身不算成功；
- 原confidence行不存在“不计成功，单列并说明其去向”。

原文支持来自s0.t10.p1、s0.t11.p2/p5、s0.t12.p1、s0.t13.p1/p2。
修改前后均保留；其余23项及本项其他字段逐字不变，
父级原生提案、24项基线、完整4条原始记录均未改。

这证明原生短ID修订和明确限定事项的定向纠错可运行，
不是无人工提示就发现全部遗漏的证明。
短ID只约束机械定位；模型选中另一个已存在ID、改错字段内部事实仍可能发生，
所以所有语义状态保持NOT_CERTIFIED。

### 仍有的内容与泛化限制

目前已补完本轮针对的分类指令，并保留此前字段名、未来归因及Daily Stats修复。
但完整人工参考中的独立Gateway核对（93ms/systemd/compatibility）
及仅修订报告阶段的边界仍未完整呈现；原文及Get回溯保留。
r2的重复退出码条件也保持原样，r3没有跨范围清理它。
以上按用户允许有损的政策记录为非阻断发现，不能说全部事实正确或全量Bug根治。
裁决：NATIVE_OPAQUE_REPAIR_READY / FOCUSED_RULE_FIXED / NOT_PROMOTED。
没有新holdout、多次重复生成的收益统计、成本资格或生产部署证据。

### 原始证据与回归

私有前缀：
/home/lionsol/.openclaw/ops/memory-engine/checkpoint-scoped-repair-native-6783169-20261102。
-r1保存原生v2提案及最初地址拒收；
-r2保存原生v3请求、标签视图、resolved-targets.json和私有只追加归档；
-r3-focused保存范围约束、父提案/基线快照、单字段审计、语义复核及最终归档。
三个.cjs执行器各只运行一次生成，未调用兼容转换函数。

原始提案SHA-256：
- r1：dbd8d5f1582c48cc2744329d9567fdc2eab1fa3926e9112fbc11dc559b85ea8c。
- r2：6c623ca683346f21bf6bfba0c59e86439a7e26d1f1b77e091eeaeccff2724f9b。
- r3-focused：1d3ca71bf497df9dc934031081d3e361752e390e9a14036e3de2a3e8add0a44a。

最终archive_id：
21b903fa96eab48fb47d33b85ad70c0f34f6127f789e847658b76dbaf2837db7。

263/263相关回归通过、无跳过，包括v1/v2历史响应与拒收、离线兼容、原生v3及限定范围回放；
验证ID绑定、host目标hash、未知/重复/越界/跨范围拒收、预算、未修改内容及完整原文回溯。
新增私有回放由MEMORY_ENGINE_TEST_NATIVE_SCOPED_REPAIR_RESPONSE、
MEMORY_ENGINE_TEST_NATIVE_LABELLED_REPAIR_RESPONSE、
MEMORY_ENGINE_TEST_FOCUSED_LABELLED_REPAIR_RESPONSE启用，未提供时明确跳过。
生产发布、数据库操作、部署和调度为0；测试计数不代表语义完整认证。

# 有损摘要与原文回溯

日期：2026-10-30（Asia/Shanghai）。

当前接受标准为：允许摘要遗漏、归并不佳或判断出错，完整保存已采集的原始记录，
并保证每条摘要的引用可以读回同一份原文。质量问题留档，不再逐项阻断摘要接受。
本页描述归档入口、离线回溯验证及已完成的checkpoint源码接线。
生成入口与memory_engine_get读取入口已接入，默认仍走legacy；尚未部署或开启生产路径。
显式搜索与普通chunk读取已新增逐项定位接线，见下节；Nightly Maintenance清理/备份、
AutoRecall卡片、无标记分片定位及下游执行约束尚未接入。

## 接受标准

| 内容 | 处理 |
| --- | --- |
| 摘要遗漏、错误、统计或阶段归并问题 | 记为quality_findings，非阻断；不默默改写模型正文 |
| 原文未保存成功、档案损坏、绑定/引用失效、原文范围不一致 | 拒绝接受 |
| 模型正确性 | 固定标注NOT_CERTIFIED，不因引用或哈希通过改成事实认证 |
| 普通回忆 | 可以使用带派生属性的摘要 |
| 具体参数、验收结论、争议判断或执行操作 | 读取入口按purpose返回引用所在完整原文；仍需消费方据此判断，不能认证模型实际使用证据 |
| 修订 | 新归档ID链接previous_archive_id，保留旧版本，不覆盖原文 |

格式与可配置的资源预算校验仍存在，用于读取和资源控制；
不是继续要求摘要逐字保留全部验收细节。默认实验正文上限20000 UTF-16字符。

## 原始记录的范围

“原始记录”在本入口中指送入摘要的完整记录文本及已采集元数据，
不是完整session JSONL、未采集的工具结果或原文件的逐字节备份。
归档保留原始text中的User/Assistant标签、换行、空白、Unicode、未引用内容、
独立控制文本和空记录；分段收集的segmentedInput另行保存，避免数组附加属性在JSON序列化时丢失。

段落化source.json本身不足以替代完整记录：它保存段落及offset，但省去了部分标签和空白。
因此新归档同时保存raw_records、结构化input及二者的source_map，
逐段验证引用文字等于完整记录中的对应范围，并核对整条记录的source_hash。

原数据缺少具体时间时保留null，不把归档时间当作事件时间。
当前真实样本只有用户/助手对话及助手对工具结果的转述，没有独立tool call/result。
回溯可以核对当时的原述，不能凭此独立认证实际工具执行真相。

## 接口

实现：`lib/checkpoint/summary-memory-archive.cjs`。

```js
const memory = require("./lib/checkpoint/summary-memory-archive.cjs");

const archive = memory.createArchive({
  rawLogs, targetDate: "2026-10-20", summary: response,
  generator: {
    model: "gpt-6-luna",
    model_identity: "requested_not_provider_verified",
    transport: "codex-cli",
    code_revision: generationCommit,
    prompt_sha256: promptHash
  },
  qualityFindings: ["自然样本资格仅作概括，具体值需回查"],
  summaryMaxChars: 20000
});
const saved = memory.persistArchive(archiveDirectory, archive);
// 只有持久化并重新读取验证成功，才返回TRACEABLE_DERIVED_MEMORY。
const item = memory.resolveItem(archiveDirectory, saved.archive_id, 16);
const original = memory.readOriginalRecord(
  archiveDirectory, saved.archive_id, item.sources[0].locator.source_id
);
```

item_index为从0开始的摘要条目序号。回溯定位器包含archive_id、item_index、
source_id、unit_id、record_index及start/end；范围采用JavaScript UTF-16索引。
resolveItem返回原文quote、角色、entry_id、来源哈希、已知时间、上下文标题、
evidence/corrects用途及派生属性；readOriginalRecord读取完整原始记录。
这些API只从指定归档目录读数据，不读取模型给出的外部路径。

档案标识由整个payload的SHA-256生成，摘要、记录、生成元数据、政策和质量备注均绑定在内。
文件按内容ID命名、只追加；先写入私有临时文件并fsync，
再用no-clobber方式发布，目录fsync并回读验证后返回接受结果。
重复保存相同档案幂等；现有文件损坏时拒绝，不覆盖修复。
修订必须另建档案并在保存时验证前一版本已存在。

模块不调用模型、数据库或publisher，没有自动删除原文的接口。
文件备份、维护清理保留规则和生产启用仍需后续处理；
这里不声称单机归档已经具有独立备份能力。

## checkpoint生成与读取源码接线（2026-10-30）

核对基线HEAD为c649b82079cc49c018d3a94722f70a1efb954aaa，上一轮归档提交已完成。
开始时工作树只有未跟踪的lib/checkpoint/derived-summary.js草稿；
本轮在该草稿基础上完成接线及回归，没有部署、修改运行配置或发起真实模型请求。

调用链：

1. bin/session-checkpoint.js的nightlyCheckpoint按checkpointSummaryMode选择路径。
   默认legacy；只有显式MEMORY_ENGINE_CHECKPOINT_SUMMARY_MODE=derived才选择新路径。
   非法模式或derived失败均拒收，不回退legacy，也不执行旧的分段摘要。
2. lib/checkpoint/derived-summary.js检查输入就绪、未截断、对话存在与来源版本，
   冻结完整采集记录，复用现有direct协议生成绑定原文的摘要。
3. 默认generateDerivedSummary按显式transport配置分发；未配置时llmDerivedSummary适配现有primary provider的chat-completions；
   每次只有一条逻辑生成请求，不做语义修复或fallback。测试中HTTPS边界全部替换为离线响应。
   生成器记录请求的model/provider/transport，身份固定为requested_not_provider_verified。
   包装层自行计算prompt_sha256并记录protocol_version，避免把模型回填值作为绑定依据。
4. createArchive/persistArchive完成原文、摘要、来源和质量备注持久化并回读；
   只有成功后才能写episode；提交episode前再次校验来源、目标文件版本及归档。
5. episode元数据写入derivedSummary，含archive_id、previous_archive_id、条目数、
   派生属性与质量备注，正文携带memory_engine_get回溯说明。
   修订从已发布episode元数据读取前一归档，不接受模型指定历史关系。
   前一归档失效时拒绝修订；旧归档原文保持不变。
6. Owner授权的memory_engine_get支持精确checkpoint:<64位archive_id>。
   该分支直接读同一runtime的memoryDir/checkpoint-archives，不查Core/Engine，
   不把归档读取当作canonical chunk强化事件；普通chunk读取维持原有行为。

读取示例（工具参数JSON）：

```json
{
  "id": "checkpoint:<archive_id>",
  "purpose": "acceptance",
  "item_index": 0
}
```

purpose支持recall、execution、exact_parameters、acceptance、disputed_claims。
所有用途都验证归档与引用，并返回生成来源、版本、质量备注和逐项精确引用；
后四种用途额外返回引用所在完整原始记录，不能只凭短引文认定参数或结论。
source_catalog列出包括未引用来源在内的全部非空来源；
可用同一id加source_id=s0读取完整记录，追查摘要未覆盖的其他资格。
item_index为零起序号，只返回指定项正文；省略时返回全部项。
引用中的corrects是模型标注，不删除旧原文、不认证更正本身正确。

### 当前限制

- 新路径要求完整采集输入；budgetCoverageComplete=false、超过512段或请求资源预算会拒收。
  分类/分段摘要仍属既有实验，本轮没有把截断输入或部分摘要作为完整原文接受。
- 默认适配器沿用现有HTTP primary provider；Codex CLI已新增显式选择入口，见下节。
  cron及生产配置尚未修改。仍可通过withRuntime({derivedSummaryGenerator})提供其他生成器。
  当前CLI版本、参数及ChatGPT登录状态已核对；后续已在单次显式代理环境中完成
  gpt-6-luna/xhigh真实调用和归档回溯，见下节。成功仅适用于该次环境，不自动认证cron环境。
- 原文归档和episode不是跨文件事务：归档成功后episode并发冲突/写入失败时，
  保留未被episode引用的归档，返回失败；不删除或覆盖它。
- 版本关联覆盖新路径发布的同日episode历史；旧legacy episode只有既有publisher备份，
  不虚构其archive_id。外部不合作写入者仍受既有publisher的已知竞争窗口限制。
- 该入口把原文交给消费方，不强制所有未来执行工具等待证据确认。
  显式搜索现已保留已标记摘要项的locator；AutoRecall卡片、丢失标记的分片、
  独立备份和维护保留策略尚需后续接入。
- 归档中的对话转述仍非独立工具事件。此次接线没有扩大原始证据范围。

### 验证

Node v24.19.0；复用现有checkpoint-dependency-loader加载已有依赖，
未安装或修改依赖。16项新接入测试覆盖nightlyCheckpoint入口到归档、
episode、Owner工具读取及版本链；测试文件由Node实际加载执行。

最新定向回归142/142通过，包含新接入、原归档、runtime/config、
episode writer、LLM适配器、普通路径发布保护及工具兼容性。
静态检查888个.js文件通过，test-integrity扫描408个.test.js通过；
.cjs文件另由实际执行验证，git diff --check通过。

首次扩大回归820项：813通过、3失败、4跳过（随后补2项新测试并由定向回归通过）。
3项在独立干净HEAD=c649b82上以相同断言复现：

| 测试 | 基线失败 |
| --- | --- |
| checkpoint-orphan-repair：runtime override repairOrphanVectors still controls main flow | 测试缺少可用Core ingress，流程提前结束，回调次数0而非1 |
| checkpoint-raw-log-assembly：DB collector uses readonly Engine dual handles and keeps event-time role mapping | fixture不接受当前Core SQL，返回无行，role访问失败 |
| session-checkpoint-shadow-entrypoint：legacy workspace shim | worktree父目录没有.devspace/scripts/session-checkpoint.js |

4项既有跳过由OpenClaw runtime依赖不可用触发。
上述基线问题未在本轮修改，不能把扩大回归描述成全绿。
本轮模型请求0、生产发布0、部署0，测试仅写临时目录。

## Codex CLI生成适配（2026-10-30，未部署）

接线基线HEAD=c7e10c3，核对时工作树干净。本轮补充：
lib/checkpoint/codex-summary.cjs、derived-summary-schema.json及离线测试，
并将checkpoint的默认生成器接到generateDerivedSummary分发入口。

### 选择与配置

新路径依然要求MEMORY_ENGINE_CHECKPOINT_SUMMARY_MODE=derived。
只有同时显式指定MEMORY_ENGINE_CHECKPOINT_DERIVED_TRANSPORT=codex-cli，才会调用CLI。
未配置transport仍走http；未知transport报derived_transport_invalid，不静默切换。
本轮没有设置这些运行环境变量，没有修改cron、服务或OpenClaw配置。

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| MEMORY_ENGINE_CHECKPOINT_CODEX_BINARY | codex | 可用绝对路径消除cron的PATH差异；不是shell命令字符串 |
| MEMORY_ENGINE_CHECKPOINT_CODEX_MODEL | gpt-6-luna | 沿用用户明确选定的模型，不自动替换 |
| MEMORY_ENGINE_CHECKPOINT_CODEX_EFFORT | xhigh | 明确推理强度；非法值直接拒收 |
| MEMORY_ENGINE_CHECKPOINT_CODEX_TIMEOUT_MS | 180000 | 单次CLI进程墙钟期限，最大900000 |
| MEMORY_ENGINE_CHECKPOINT_CODEX_MAX_OUTPUT_BYTES | 1048576 | stdout累计字节限制，最大16777216 |

适配器不source交互shell、不发现或改写代理；只继承调用进程明确传入的
HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY及小写形式。
环境白名单保留HOME、PATH、CODEX_HOME和TLS证书等必要项，
不传递OPENAI_API_KEY、CODEX_API_KEY、其他provider密钥或NODE_OPTIONS。
认证复用所选HOME/CODEX_HOME的既有CLI账号，不自行登录或更改凭据。

### 子进程与接受条件

- 每次在私有空临时目录启动一个shell=false的子进程；文本只经stdin传入，
  不把原文放入argv或临时提示文件。输出schema从本仓库固定文件读取。
- 显式使用no-daemon、ephemeral、ignore-user-config、ignore-rules、
  read-only、approval=never及输出schema；关闭已核对的shell、exec、协作、
  hooks、memory、plugin、browser等功能，web_search=disabled、project_doc_max_bytes=0。
  这属于CLI文本任务约束，不等于操作系统对所有文件读取的完全隔离。
- 严格解析JSONL生命周期：单thread、单turn、一个完整agent_message、
  turn.completed及进程exit=0均须存在。只允许agent_message/reasoning item；
  发现命令、文件修改、MCP、搜索、plan或未知item时立即终止并拒收。
  error/turn.failed、非JSON、额外回合、损坏UTF-8、stdout/stderr超预算均拒收。
- 默认先SIGTERM，1秒后未结束则SIGKILL；POSIX按进程组终止，覆盖持有管道的后代。
  再等1秒仍不能观察close，返回derived_cli_termination_unconfirmed，不能称清理成功。
  Windows仅有直接子进程终止行为，未认证Windows后代进程树管理。
- 仅发起一次CLI逻辑调用，不做重跑、语义修复、HTTP或其他模型fallback。
  CLI内部网络重连不受此“一次进程”计数认证，墙钟期限仍然生效。
- CLI退出和事件通过后，继续使用既有createArchive/persistArchive与episode版本保护。
  schema、binding、引用或持久化失败仍不得发布。质量问题继续作为非阻断备注。

归档generator记录requested model、reasoning_effort、transport=codex-cli、
cli_contract、stdin/schema/stdout SHA-256、事件数、输出字节和零工具事件。
proxy_env_keys仅记录存在的变量名，不保存代理地址或凭据。
model_identity保持requested_not_provider_verified，不把CLI参数当作provider身份认证；
cli_contract表示本适配器核对的兼容契约，不声称每次都独立检测了二进制版本。
原始checkpoint提示的prompt_sha256仍由上层独立绑定；
stdin_sha256另绑定CLI任务包装后的实际输入。

### CLI适配提交76d65b7的历史验证与证据边界

- 本机/home/lionsol/.local/bin/codex --version为0.163.0；
  全部适配argv加--help退出0，验证参数解析，不启动模型或认证远程服务。
- login status退出0，仅提取到ChatGPT登录标志；未输出账号详情、凭据或原始诊断。
  当前DevSpace进程HTTP(S)/ALL_PROXY大小写六项均未设置，CODEX_HOME未显式覆盖。
  这不能证明账号额度、token在线有效性、模型可用性或网络直连可用性。
- 新增19项测试通过，包括逐字节Unicode流、异常事件/输出拒收、
  超时/取消/无法确认终止、代理环境白名单、完整checkpoint归档与读取。
  其中2项使用真正离线Node子进程，验证stdin/stdout和POSIX进程组强制结束，
  不调用Codex或任何模型。其余模拟CLI事件均为测试数据，不记作GPT样本。
- 包含上一轮142项的最新定向回归共161/161通过；
  修改文件和新增.cjs的node --check、test-integrity408扫描、git diff --check通过。
  上一轮已复现的3项扩大回归基线失败未在此轮修改或重新宣称解决。
- 本轮真实模型请求0、部署0、生产发布0、cron启动0。
  上述为76d65b7适配阶段的验证记录；其后真实调用结果见下节。
  部署及定时任务启用仍需单独评估，本页不改写先前语义失败记录。

官方机制参考：
[OpenAI Docs：Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)，
用于核对exec、JSONL、output-schema、ephemeral及既有CLI认证机制；
具体选项同时以本机0.163.0帮助与feature清单核对。

## 新适配器真实调用与完整回溯（2026-10-30，未部署）

核对HEAD=76d65b7，开始时工作树干净。使用本机Codex CLI 0.163.0，
仍明确请求gpt-6-luna/xhigh，没有替换模型。
本节为新生成的响应，不复用2026-10-28那份17项摘要，也不把它当作新的对照实验。

### 入口及隔离范围

新增bin/checkpoint-derived-smoke.cjs：不调用checkpoint main、Core/Engine数据库、
episode publisher、flush或cron。默认仅报告计划，--execute才生成并保存验证证据；
--out必须是新目录，既有证据目录拒绝覆盖。
输入只从显式--input读取session_flush记录；完整源文件字节另存source.md，
同时保存解析后的input-records.json、request.json、response.json、CLI原始输出及result.json。

主样本仍为/home/lionsol/.openclaw/workspace/memory/smart-add/2026-10-20.md，
完整文件SHA-256：
9b119fdc8c72918cbdc97d2000200b6d14cf71fc3c9b75c0827b2c33e903dbf6。
4条session_flush、197段完整归档；模型可见193段，含用户61段、助手132段，
另外4条独立控制文本保留在归档输入，不发送模型。
仍然没有独立工具调用或工具返回事件，不能据此核实当时工具执行真相。

当前DevSpace父进程依旧没有代理变量。
本次只读提取既有.bashrc中代理白名单的字面量export，取最后一个可解析值，
不执行/不source文件、不求值命令或变量；仅向这一次子进程环境补入这些值。
没有改写shell、系统代理、OpenClaw或服务配置，不在报告或generator元数据中保存代理值。

### 两次CLI启动与一次离线复验

1. r1：thread.started后立即出现item.completed(type=error)，没有turn.started或摘要。
   诊断为Code Mode host被禁用导致初始化不可用。
   参数--help可解析并不能证明CLI会话可初始化，这是上一轮离线验证未覆盖的问题。
2. 单点修复：删除--disable code_mode_host，保留--disable code_mode及其他既有工具功能关闭设置；
   CLI host仅保留可初始化性，不因此允许接受工具事件。
   eventReader新增启动阶段item.error识别，仍直接拒收，不忽略/吞掉此类错误。
3. r2：北京时间2026-10-30 11:29:06.747启动验证，
   11:30:07.990保存响应，约61.24秒。
   日志为thread.started、turn.started、一个agent_message和turn.completed；
   退出码0、工具事件0、stderr字节0。CLI请求模型名仍为参数级记录，
   model_identity=requested_not_provider_verified。
4. r2返回14项摘要；初次归档仍判FAILED/comparison_reference。
   定位到所有ID都在输入原文中，唯一结构问题是第0项evidence重复列出同一ID。
   r2的失败result.json及原始响应保持不变。
5. 按“可回溯派生记忆”政策，重复的有效引用改记非阻断质量备注。
   不存在的ID、绑定不一致、缺引用及损坏原文仍拒收；
   不改写正文、不去重、不修复模型响应。
   仅派生归档/读取入口显式允许重复，实验比较入口默认严格规则保留。
6. --response-file从r2已有response.json离线复验，
   原始响应文件逐字节保存为replayed-response.json。
   本次generator_invocations=0，归档summary与r2响应对象完全一致；
   没有第三次模型调用。

因此本轮为2次CLI启动，其中1次实际进入并完成生成；
不是“总共只启动过一次”，也不能由CLI日志推断底层网络请求次数。

### 结果

| 检查 | 结果 |
| --- | --- |
| 摘要 | 14项、3458 UTF-16字符 |
| 引用出现次数 | 99 |
| 不同引用段落 | 93 |
| 条目回溯 | 14/14可读取，所有99次引用可解析 |
| 引文对应完整记录范围 | 全部一致 |
| 模型输出/原始响应 | 不改写；离线保存的响应字节一致 |
| 重复引用 | 第0项evidence多1次，自动写quality_findings |
| 原始源文件 | 生成后SHA-256未变 |
| 接受状态 | PASS_TRACEABILITY_NOT_SEMANTICS |
| 语义正确性 | NOT_CERTIFIED，未新增独立语义验收 |
| 生产episode/DB/部署/cron | 均未操作 |

重复引用备注为：
Duplicate reference IDs retained: item=0; field=evidence; extra=1。

归档ID：
660bc9d48e7ce66bb4e41f00c81656512d294b075ed8b3a8c7a42baf7863f591。

私有证据目录均在/home/lionsol/.openclaw/ops/memory-engine/下：

- checkpoint-codex-smoke-76d65b7-20261030-r1：保留初始化失败。
- checkpoint-codex-smoke-76d65b7-20261030-r2：保留成功CLI生成和旧重复引用拒收结果。
- checkpoint-codex-smoke-76d65b7-20261030-replay：已接受的归档、完整来源回读和新政策结果。

replay/result.json SHA-256：
35bace833245135385c2854b77d9a42da80c92ddbc21ffd5484bbb84f0414884。

最新相关回归190/190通过，包含8项smoke测试、启动item.error回归、
重复有效引用原样接受及未知引用拒收、旧实验严格规则与生成/读取回归。
修改/新增源码node --check、test-integrity408扫描及git diff --check通过。
未重跑或改写此前3项已知扩大回归基线失败。
模型成功调用与回溯链路均已具备本次实证，生产启用和定时任务代理继承仍未验证。

## 显式搜索及普通chunk读取的回溯定位（2026-10-30，未部署）

接线基线HEAD=de66596，开始时工作树干净。
此前archive_id仅在episode文件头；Core切出的正文chunk可能不含文件头，
显式搜索又将text裁至240字符，无法保证消费方能发现已存在的原文入口。
本轮新增lib/checkpoint/derived-summary-locator.cjs，接通发布投影、两个显式搜索工具和普通chunk get。

### 写入投影

新生成的episode每条摘要项都携带程序生成的独立标记：

```text
- [checkpoint-derived:v1 archive=<64位archive_id> item=0] 事项：派生摘要及引用
```

archive_id与item_index来自已保存并验证的档案，不由模型自由填写。
每项原始内容按既有渲染规则呈现；模型字段中的反斜杠、CR和LF按单行形式编码，
避免模型文字插入新的物理标记行。项内引用编号为该项局部编号；
准确定位以archive_id、item_index及归档中的unit_id为准。

这只是episode消费投影；归档中的summary、原始记录、引用数组、模型生成来源及p.body保持不变。
原有归档不迁移、不覆盖，既有episode文件不批量改写。

### 显式搜索

memory_engine_search及memory_engine action=search在原有白名单投影后，
从完整result.text解析标记，另行返回derived_memory；
该字段不会跟随240字符正文预览一起丢失。
即使检索结果自身带有伪造的derived_memory对象，也不会直接信任或转发，
程序总是根据path/text重建字段。

只识别标准memory/episodes/YYYY-MM-DD.md路径族；路径不匹配时不提取标记。
无标记episode返回kind=episode_unlinked/status=locator_unavailable，
不据路径自行认定作者为模型。
标记互相冲突或条目序号越界返回locator_conflict。

有效格式仅返回status=unverified、archive_id、get_id=checkpoint:<archive_id>、
item_indexes及派生/语义未认证标记；搜索不认证文件存在或引用正确。
整个搜索投影为纯函数，不读episode文件/归档、不增加数据库调用，
不改变候选顺序、ID、分数、topK或rerank/canary策略。

### 普通chunk get

Owner授权的memory_engine_get现在也可直接使用搜索返回的普通Core chunk ID：

```json
{
  "id": "搜索返回的完整chunk ID",
  "purpose": "exact_parameters",
  "item_index": 0
}
```

读取方先按既有路径构造canonical memory，再验证chunk上的归档标记。
只从当前runtime memoryDir/checkpoint-archives读取指定不可变档案，
不读取当前episode文件来猜归档版本，因此旧chunk不会被改指向最新版归档。

验证包括：档案哈希/原文范围、target_date与episode路径日期、
item_index存在，以及带标记的文字必须与该归档对应项的程序投影一致。
Core在长行中途截断后缀时，只允许该不可变项投影的精确前缀；
增加或修改字符会拒收。状态为verified时scope仍固定marked_items_only，
不把同一chunk中未标记的前缀/其他文字认证为该项原文，更不认证语义正确。

recall返回经验证的定位信息、质量备注和历史关系；
execution/exact_parameters/acceptance/disputed_claims同时返回derived_evidence，
包含归档原文、引用及源目录。
省略item_index时读取完整归档以便核对上下文；
指定item_index时必须属于该chunk标出的项，不能静默切换到另一个事项。
source_id仍可回查同一档案的完整来源记录。

损坏/缺失档案、日期错误、伪造项文字、未知条目或冲突标记使get返回
MEMORY_GET_DERIVED_INVALID，且不会调用成功强化回调。
无定位器的旧episode仍允许普通recall，但敏感用途返回derived_locator_unavailable。
直接checkpoint:<archive_id>读取及既有Owner权限保持原路径。

### 验证与剩余范围

新增12项测试，包含真实checkpoint发布、240字符之外的定位保留、两种显式搜索、
普通canonical chunk读取、修改/缺失/冲突/损坏拒收、旧版本稳定定位和标记截断。
最新相关回归215/215通过，涵盖此前190项及显式rerank/canary策略兼容性；
修改源码node --check、test-integrity408扫描及git diff --check通过。

其中一项显式通过MEMORY_ENGINE_TEST_CHECKPOINT_ARCHIVE加载上一轮私有GPT归档，
在临时目录中原样保存后逐项验证新投影：
14项、99次引用、93个不同段落全部仍可读回一致原文，原始档案字节未变，
模型调用0、生产写入0。
默认不提供该环境变量时，此项会明确跳过，仓库不包含私有对话样本。

本轮没有运行真实Core索引器；长行/边界行为用Core式切片覆盖。
从项中间开始且完全不含标记的分片，当前明确返回locator_unavailable，
不会猜测其来源；后续需要结合真实分片边界验证覆盖率。
AutoRecall卡片尚未携带本轮新增字段，未改其gate、排序或注入策略；
所有下游执行工具也没有被统一强制等待原文读取。
生产配置、cron、数据库、原始样本及已发布episode均未修改，没有新模型调用或部署。

## 已完成的真实记录回溯验证（2026-10-29历史记录）

使用2026-10-28已经生成的GPT原始输出，没有新模型请求：

| 项目 | 结果 |
| --- | --- |
| 完整输入记录 | 4条 |
| 已保存段落 | 197，含4条未送模型的独立控制文本 |
| 当时模型可见段落 | 193 |
| 摘要 | 17项、3681字，逐字未改 |
| 可回溯条目 | 17/17 |
| 引用出现次数 | 95 |
| 不同引用段落 | 86 |
| 回溯期间读取活跃原文件 | 0次，全部只读归档副本 |
| 从引用原文恢复被省略的资格 | natural_user_turn、before_prompt_build、trigger=user、valid=true及agent_id/run_id/session_id |
| 新模型调用/发布/部署 | 均为0 |

结果为ACCEPTED_DERIVED_MEMORY_WITH_FINDINGS，provenance_status=PASS，
semantic_correctness=NOT_CERTIFIED。
此前FAIL_REQUIRED_QUALIFICATIONS作为旧完整性标准下的质量结论保留；
本轮改变接受政策并验证持久化回溯，不把旧摘要改写成无缺陷结果。
质量备注也保留“工具真相未核实”和残差口径待澄清。

私有验证目录：
`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-traceable-memory-d1fea51-20261029-evidence/`。
目录含archives/、archive-locator.json、resolved-items.json、recovered-qualifications.json及result.json。

档案ID：
`aa81f17c3f98f8f1741397098fdcaab64954b0a8c0db3af73fb8ae88dc47d5ab`。

验证基线HEAD：`d1fea5176b62a11204e8e87e963b2d22236a8b05`，
新增模块/测试以文件哈希冻结；原始会话和episode哈希未变。
12项新增归档测试及原有相关检查共100项通过；
包括模拟删除原文件后恢复、损坏/失效引用拒收、写入失败不接受、
历史版本保留，以及错误摘要带质量备注仍可按派生记忆接受。
静态检查887、test-integrity408已跟踪扫描通过；新增文件另由实际测试加载执行。

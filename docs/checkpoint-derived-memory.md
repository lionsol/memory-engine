# 有损摘要与原文回溯

日期：2026-11-01（Asia/Shanghai）；项目取舍于2026-11-02按Sol最新要求确认。

memory-engine是个人实验性项目，不要求生产级别的安全性和稳定性。
以直接派生摘要路径为实现基础：先保存原文，预算内一次生成，超限分批并程序拼接，提供回溯。
命题清单、多轮审核、跨模型对照等保留为可选研究，不要求先解决全部已知语义问题。
日常迭代不默认追加生产级审批、阶段卡或稳定性治理；参见[项目工作约定](../AGENTS.md)。

当前接受标准为：允许摘要遗漏、归并不佳或判断出错，完整保存已采集的原始记录，
并保证每条摘要的引用可以读回同一份原文。质量问题留档，不再逐项阻断摘要接受。
本页描述归档入口、离线回溯验证及已完成的checkpoint源码接线。
已有14项GPT摘要已通过真实Core临时索引、搜索/Get及备份回读，99次引用/93个不同段落一致；
该验证使用离线embedding，不认证摘要语义或生产provider，见2026-11-01记录。
生成入口与memory_engine_get读取入口已接入。2026-11-03起，源码默认选择derived，
不再要求设置MEMORY_ENGINE_CHECKPOINT_SUMMARY_MODE；显式legacy仍可选择旧路径。
默认transport为http，沿用现有primary provider配置；codex-cli仍须显式选择。
调用nightlyCheckpoint的程序需要传inputReady=true；CLI主流程从采集结果计算该值。
derived采集使用去重后的完整记录，不应用legacy的每会话8000/来源/总字符裁剪；
采集统计inputPolicy=full_collected_records。legacy仍使用原有预算。
每批提示词默认上限200000字符（含协议与提示），正文上限20000字符；超限按session/消息/段落分批。
完整采集原文先存快照，每批独立生成，日报由程序拼接；失败批次可补跑，不追加模型总摘要。
512个原文片段和256条摘要项的限制按单批处理；全天正文可超过20000字符。
来源未就绪或调用方提交的输入已截断时返回失败；单批格式或引用无效时标记该批失败，不自动改走旧路径。
部分成功发布partial_summary并注明未完成批次，全部失败仍可读原文快照。
当前行为与配置见[超预算分批摘要](checkpoint-summary-batching.md)；下文历史接线记录保留当时事实。
相关checkpoint/Get文件已安装并通过入口配置和隔离回读检查；Gateway重载及定时任务恢复尚未完成，
详见[本地运行入口](checkpoint-summary-batching.md#本地运行入口)。
显式搜索、普通chunk读取与AutoRecall卡片已新增逐项定位接线，
Nightly Maintenance已新增归档检查与显式配置的追加式备份，见下文。
默认不配置备份，不清理原文或历史归档；
新生成的不可变发布副本支持无标记Core分片的显式回溯，见2026-10-31接线记录。
AutoRecall无标记episode卡片现保留未确认状态和完整Core Get回查提示，不提前读取归档或猜测archive_id。
未保留发布副本的旧分片及下游统一强制回读仍有剩余范围。
已新增宿主明确声明依赖的最终执行边界，但默认装配未启用，不代表全局执行工具已受控。

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
   本节接线当时默认legacy；2026-11-03起源码默认derived，显式legacy可选择旧路径。
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
  显式搜索与AutoRecall现已保留已标记摘要项的locator；丢失标记的分片、
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

本节适配当时要求MEMORY_ENGINE_CHECKPOINT_SUMMARY_MODE=derived；2026-11-03起源码默认derived。
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
本节记录的搜索/chunk接线阶段尚未覆盖AutoRecall卡片；后续接线见下节，未改其gate、排序或注入策略；
所有下游执行工具也没有被统一强制等待原文读取。
生产配置、cron、数据库、原始样本及已发布episode均未修改，没有新模型调用或部署。

## AutoRecall回溯入口（基线a068c6b后）

AutoRecall卡片与既有raw-text fallback现已携带已标记摘要项的回溯入口。
本轮只修改源码和离线测试，默认生成模式、生产配置、cron、索引数据库及已发布episode未改，
没有新模型请求或部署。

### 展示与授权边界

回溯说明写入既有source_hint字段，保持卡片schema及字段白名单不变，例如：

```text
memory/episodes/2026-10-20.md:1-3 | derived_summary lossy=true semantic=NOT_CERTIFIED locator=unverified archive=checkpoint:<64位归档ID> items=0,1 source_required_for=parameters,acceptance,execution,disputed_claims
```

定位信息在摘要裁切之前从完整chunk提取；source_hint最多512个UTF-16字符，
优先保留完整归档ID及用途要求。超过8个项序号时只展示前8个并标注more数量；
仍可通过chunk ID或归档ID读取，未展示的序号没有被删除或改写。
卡片不加载档案、不注入完整原文，也不把存在程序标记视为通过完整性或语义校验。
冲突标记只展示locator=conflict，不选择任一归档ID；显式回读仍拒收。
缺失或损坏的档案也只在显式读取时判定，不通过AutoRecall新增磁盘读取。

Canonical投影只从Canonical source.path/text提取定位信息，
忽略运行时候选的伪造标记、derived_memory及get_id；
既有get_token仍指向Canonical chunk身份。
正式卡片的source_hint属于原有Owner预览及projection_hash覆盖的payload，
不是授权完成后追加的字段。仅改变定位器也会使旧授权不匹配；
受影响的卡片需要按原有Owner preview/assert流程重新授权，不能自动继承旧许可。
本轮没有向实际授权表写入任何许可。

正式注入继续经过原有Owner身份、精确授权、生命周期、安全及scope门槛；
没有改变选择顺序、topK、置信度门槛或检索排序。
raw-text fallback与通用卡片格式器保留各自原有入口和限制，
不因回溯指针而获得正式卡片授权。
无标记的旧episode、完全失去标记的分片及非episode卡片维持既有source_hint，
不会从日期或候选元数据猜测归档。

### 验证与剩余限制

新增7项测试，覆盖裁切后的完整指针、无归档IO、Canonical来源优先、
512字符边界、冲突/无标记处理、source_hint单独篡改使授权失效，
以及正式生产边界的“未授权/非Owner不展示、已精确授权才展示”。
显式原文回读继续返回完整记录和NOT_CERTIFIED语义状态。

私有GPT归档以离线fixture加载，14项、99次引用、93个不同段落在Owner卡片投影后
仍可回读一致原文，原始归档字节未变。模型调用0、生产写入0。
测试默认不加载私有档案；本轮通过MEMORY_ENGINE_TEST_CHECKPOINT_ARCHIVE显式运行。
相关checkpoint、AutoRecall、disclosure及工具回归626/626通过，无跳过；
static-check889文件、test-integrity409文件及修改文件语法、git diff --check通过。

尚未运行真实Core索引器验证标记覆盖率，完全不含程序标记的分片仍不能自动回溯；
尚未统一强制所有下游执行工具等待原文读取。
该阶段尚未接入Nightly归档维护；后续检查与备份接线见下节，未新增档案清理策略。
这些限制不会被“卡片带指针”或“引用可解析”改写为模型结论已获事实认证。
当前原始样本没有独立工具调用/返回事件，回溯只能核对当时的对话原述。

## Nightly归档检查与追加式备份（基线c83016d后）

实际canonical入口是bin/nightly-maintenance-command.cjs。
它原先只执行Engine生命周期处理，不存在原文文件清理或完整归档备份步骤；
retired入口bin/nightly-maintenance.js继续拒绝执行旧Core写入逻辑。

本轮新增lib/checkpoint/archive-maintenance.cjs，并在打开可写生命周期数据库之前调用。
路径复用checkpoint runtime，包括启动时MEMORY_ENGINE_MEMORY_DIR兼容覆盖，
避免生成入口与维护入口检查不同的归档目录。
维护结果进入result.checkpoint_archives及nightly_maintenance_completed事件。
任何归档检查或已配置备份失败都会退出1，本次生命周期变更和完成事件均不执行；
已经成功复制的部分备份对象会保留，不冒充整个维护过程已回滚。

### 保留与检查范围

保留策略固定keep_all_versions_no_pruning，不按置信度、当前是否引用或是否为旧修订删除证据。
扫描checkpoint-archives中的全部内容ID命名JSON，包括未被当前episode引用的档案。
逐份验证归档内容哈希、原文范围、引用及版本关系；previous_archive_id必须仍存在且属于同一天。
质量备注不导致拒收，检查通过也不改变NOT_CERTIFIED语义状态。

扫描episodes中的日期文件及程序发布保留的.md.<token>.previous版本，
验证可信derivedSummary头、日期、历史关系和带程序标记的项投影。
头与正文标记冲突、缺失归档、损坏档案或改写项文字会拒收。
正文校验范围仍为marked_items_only；旧格式只有元数据头时明确记为header_only，
不把未标记正文认证为已验证投影。
legacy无引用episode不推断归档，本备份也不包含这些legacy文件。
存在checkpoint发布锁时延后维护并退出失败，不自行清理锁；
归档或备份目录中其他既有临时文件也不删除。

### 显式备份配置

默认只检查，不创建备份目录。
仅在维护进程显式配置下列变量后复制备份；本轮没有修改实际环境变量或cron：

```text
MEMORY_ENGINE_CHECKPOINT_ARCHIVE_BACKUP_DIR=/absolute/dedicated/backup-directory
```

--dry-run验证源归档并报告backup.status=planned，不创建目录、备份文件或完成事件。
配置路径必须是绝对路径，与原文归档/episode目录互不包含；
现有路径别名也参与检查。目标目录内的符号链接不作为普通证据文件使用，
与活跃原文共用inode的硬链接不被接受为独立备份。

备份目录布局：

| 路径 | 内容 |
| --- | --- |
| checkpoint-archives/<archive_id>.json | 全部归档的逐字节副本，含完整已采集原文、摘要、来源、质量备注及历史关系 |
| episode-objects/<sha256>.md | 带引用的当前/历史episode字节对象 |
| manifests/<snapshot_id>.json | 归档与episode对象清单，包含大小、字节哈希、引用范围和修订关系 |

文件仅追加，采用私有临时文件、fsync和原子无覆盖发布；
已经存在的目标必须字节一致，否则拒收且不自动修复。
新建目录为0700、新建文件为0600。
发布清单前复核源清单未变，并再次读回全部备份对象，成功后才报告backup.status=complete。
相同内容再次备份复用已有对象与清单，不覆盖旧文件，也不自动删历史快照。
归档字节数通过archive_bytes报告。

清单一致性明确为observed_stable_inventory_not_atomic_filesystem_snapshot。
本实现使用文件清单及字节复核检测观察到的并发变化，不宣称跨目录原子快照或排除外部写入竞态；
变化时拒绝发布本次完成清单，下一次维护重新捕获。
备份不是整个workspace、Core/Engine数据库或完整session JSONL的备份，
也不替代异机/异盘容灾。当前实现为全量扫描，内存和耗时随归档量增长，
尚未验证长期大规模容量表现，未向召回热路径添加IO。

### 验证与剩余范围

新增归档维护测试含28个测试/子场景，覆盖全部版本及未引用原文保留、dry-run、
追加式幂等备份、缺失历史/引用、篡改/损坏/冲突拒收、写入失败、
路径别名/硬链接、复制后损坏、并发发布、checkpoint锁以及自定义memory目录。
真实CLI在临时数据库中验证：检查或备份失败不改Engine字节；
生命周期把摘要chunk标为archived后，旧归档和原文仍可显式读取，Core数据库字节不变。

私有GPT档案以离线fixture备份；删除临时活跃源目录后，只读备份仍恢复
14项、99次引用、93个不同段落的一致原文，私有源档案字节未变。
没有新模型请求，未据此认证语义正确或工具实际执行真相。
相关回归682/682通过，无跳过；static-check889文件、test-integrity409文件、
新增/修改CJS语法和git diff --check通过。
独立worktree测试通过临时NODE_PATH/NODE_OPTIONS及既有test-only加载器使用现成依赖，
没有安装依赖或修改生产环境。

本轮未运行实际生产Nightly、未部署、未开启备份任务。
本阶段尚未使用真实Core分片器；后续验证和无标记显式回溯见下节，
下游统一强制回读仍待完成。没有新增原文/历史档案清理策略，全部继续保留。

## 无标记Core分片的显式回溯（2026-10-31，基线f6493c5后）

读取实际安装的OpenClaw 2026.7.1-2源码后确认：
memory-core-host-engine-storage中的chunkMarkdown不只按源文件整行切分。
长行先分段，再以换行连接；中文/Unicode字符估算还可能使同一原始行拆成更细的段。
多个Core分片因此可共享同一个start_line/end_line，且续段不含完整程序标记。
旧的“只核对标记所在行前缀”不能覆盖这些续段。

### 不可变发布副本与版本状态

新增lib/checkpoint/episode-projection.cjs。
episode-writer导出renderEpisodeFile，发布与归档使用同一渲染结果，
原有legacy文件格式、源归档协议及模型输出保持不变。
副本按内容SHA-256保存于：

```text
memory/checkpoint-projections/YYYY-MM-DD/<projection_id>.json
```

副本绑定archive_id、episode路径、完整文件文字、协议版本及publication_status。
校验可信头的归档/历史关系，要求所有摘要项的程序投影各出现一次；
不修改模型正文或原文记录。

| 状态 | 时机与用途 |
| --- | --- |
| prepared | episode发布前持久化并读回验证；失败则不发布。保留，但不参与来源匹配 |
| published | episode提交后确认文件文字一致，再追加登记；显式回溯只匹配该状态 |

两种状态是不同内容ID，不覆盖旧版本。
发布前失败可保留未引用的原文归档或prepared副本；
发布后登记失败返回summary_invalid，但保留episode=true、
publication.published=true、projection_registered=false，不能报告已经回滚。
直接按checkpoint:<archive_id>读取仍可使用已保存原文；
登记缺失的无标记续段不会被自动认领。

### 显式读取匹配

memory_engine_get从Canonical Core行取得hash、start_line、end_line及完整text，
不使用工具参数或运行时候选提供的定位声明。
先确认Core分片SHA-256与完整text一致，再在该日期的不可变published副本中匹配：

- 必须保留源行边界、字符顺序、空白及所有非换行字符；
- 只允许同一原始行被Core分段后插入的额外换行；
- 必须与副本中的摘要项行相交；不从无关头部文字推断摘要项；
- 不读取活跃episode，不按日期或“最新版本”选择归档。

匹配后返回scope=archived_projection_line_range、projection_ids、
item_indexes和newline_policy=core_inserted_segment_separators_only。
provenance_basis明确为exact_projection_match_not_core_ingestion_attestation：
这证明文字与归档投影匹配，不证明Core索引的因果来源，也不认证模型语义或工具执行。
相同归档与相同项的多个匹配副本可合并列出；
不同archive_id或不同项集合同时匹配时返回derived_projection_ambiguous，
不因文字相同就把旧修订重定向到新修订。

敏感purpose继续返回完整已采集原文及字面引用。
item_index必须属于该分片覆盖的项；失败不触发成功强化回调。
具有有效Core定位信息、且归档已有published副本的标记分片，
也不能凭开头标记绕过被改写续段的检查。
没有副本的历史标记读取保留原来的marked_items_only兼容范围。

单次读取最多检查该日期256份副本（prepared也计入预算），
分片最多131072个UTF-16字符，单个发布副本文字最多2000000字符；
匹配工作量也有显式预算，超限拒收，不截断后接受。
没有匹配副本或缺少可信Core定位的无标记分片仍为locator_unavailable，
不能追认旧分片的来源。

搜索与AutoRecall保持纯投影，不在热路径读取这些副本。
无标记搜索预览/卡片仍不会直接展示归档ID；
消费方可以使用已有Canonical chunk ID显式get并请求相应purpose。
下游所有执行工具尚未统一强制等待原文读取。

### Nightly与备份

Nightly同时验证并保留prepared/published全部副本及其原文绑定。
备份清单升级checkpoint-archive-backup-v2，新增projections清单和projection_count，
备份目录按原相对路径保留checkpoint-projections/YYYY-MM-DD/<id>.json。
原v1清单和备份对象不改写，仍不自动清理任何历史版本。
缺失/损坏副本、复制失败或目标字节冲突不会发布新的完成清单。

### 验证范围

新增18项测试，包含真实checkpoint发布、发布前写入失败、发布后登记失败、
完全无标记get、续段篡改、跨修订歧义、旧版本稳定定位及备份恢复。
相关回归700/700通过，无跳过；static-check889文件、test-integrity409文件、
新增/修改CJS语法及git diff --check通过。

通过MEMORY_ENGINE_TEST_OPENCLAW_ROOT显式加载实际安装的SDK纯分片函数，
测试tokens/overlap为8/0、16/8、32/16、128/32、400/80。
合成样本397个含摘要项分片全部通过，其中391个无完整标记，
369个在同一原始行内含Core插入的换行。
实际SDK文件SHA-256：
1b7f015f10567a2df3ccd3b271bc4dfc82cd2dd9599465dbf9ab85b381eeefff。

私有GPT样本在临时目录备份后，删除临时活跃归档和投影目录，
仅用备份验证真实Core生成的71个分片（69个无完整标记），
恢复14项、99次引用、93个不同段落的一致原文。
私有源档案字节未变，模型调用0、provider调用0、生产写入0。
默认未设置私有样本/SDK环境变量时，这两项测试会明确跳过。

本轮只调用SDK纯分片函数，没有启动真实Core索引器或调用provider；
该阶段尚未运行provider二次拆分纯函数；后续验证见下节。
整条生产索引链仍未实跑，不宣称覆盖全部生产分片。
原始样本仍只有对话及助手转述，不能据此认证工具实际执行。
尚未部署、未修改生产配置或cron，也未补写已发布的旧episode。

## 敏感消费的最终执行边界（2026-10-31，基线06de582后）

新增lib/checkpoint/derived-evidence-consumer.cjs，
并在createMemoryEngineExecute中提供宿主侧action.derivedEvidencePolicy接线。
该策略必须是运行时装配的函数，memoryDir也取自同一宿主装配，
不读取模型参数中的策略、已验证声明或回读令牌。

当前index.js默认装配没有注入该策略，也没有新增公开工具、JSON配置开关或生产启用项。
本轮完成可调用的执行边界及memory-engine操作入口接线，
不代表所有外部exec、部署工具或结论输出已经自动受控。

### 为什么放在最终执行入口

实际SDK中，trusted tool policy运行之后，其他before_tool_call hook仍可修改参数；
单靠较早的hook检查不能证明校验绑定最终执行内容。
SDK也不能可靠判定任意命令是否依赖摘要，不能用关键词冒充依赖识别。

包装器因此在实际调用操作函数前执行以下步骤：

1. 对本次参数做严格JSON快照并深度冻结，绑定工具名、toolCallId及参数的SHA-256。
2. 由宿主策略返回明确的敏感purpose、不可变archive_id及可选item_index。
3. 对每个依赖调用readDerivedSummary，读取引用所在完整原始记录。
4. 再次验证所有涉及的原文归档仍可读且完整。
5. 把冻结的原文证据上下文交给消费者，再且仅再调用一次操作函数。

每次调用都会重新读取，不缓存可转移的“已读凭证”；
不能用上轮成功、相同toolCallId或模型传入的已验证字段跳过本次读取。
没有依赖声明的默认执行器维持原行为；
显式配置策略后，只有返回null表示这次操作不在其范围内。
策略缺失返回值、抛错、绑定不符或非法引用都会拒收，不静默视为无依赖。

### 宿主声明与消费者接口

声明结构固定如下：

```js
{
  operation_sha256: expectedOperationDigest,
  purpose: "execution", // 或exact_parameters/acceptance/disputed_claims
  references: [
    { archive_id: immutableArchiveId, item_index: 0 }
  ]
}
```

operationDigest({toolName, toolCallId, params})导出供宿主计算同一规范摘要。
依赖计划必须由宿主负责，不能从模型的“我已经核验”或工具参数直接复制。
如果宿主计划预先绑定了操作参数，应返回计划中的expected digest；
最终参数变化后绑定必须失效。

wrapDerivedEvidenceConsumer({memoryDir, toolName, resolveDeclaration, execute})
返回execute(toolCallId, params, trustedContext)。
宿主策略接收冻结的invocation及trustedContext；
操作函数接收(toolCallId, frozenParams, evidenceContext, trustedContext)。
evidenceContext包含purpose、references、完整证据读取结果及operation_sha256，
语义状态固定NOT_CERTIFIED，范围仍为已采集原文。
源记录级单独读取不被当作完整事项声明；声明只接受archive_id及可选item_index。

memory-engine自身操作可通过action.derivedEvidencePolicy和action.memoryDir使用该包装器。
普通动作回复不会自动附带完整原文；既有cite授权、Owner Get约束和其他权限不被替代。
取消信号在读取前后检查，失败返回MEMORY_DERIVED_EVIDENCE_REQUIRED及稳定reason。
操作函数自身失败原样传播，不重试、不回退，也不承诺撤回已开始的操作。

输入/证据上下文最多20000个节点、32层、1000000个UTF-16字符串/键字符，
单次声明最多16个引用；重复引用去重，非法JSON、getter、稀疏数组或预算超限拒收，
不截断证据后继续执行。

### 验证与适用边界

新增20项测试，包括：
已知错误摘要仍按非阻断质量问题接受、完整原文及资格可见、四种敏感purpose、
缺失/损坏/部分失败拒收、最终重验、跨调用绑定、等待期间参数篡改、
取消、非法声明/预算，以及消费者失败不重试。

真实memory_engine cite在临时Engine数据库中验证：
证据通过后才变更；归档损坏或取消时hit_count及事件不变；
证据通过仍不能绕过原有cite授权。
默认执行器不读取归档，模型参数不能注入宿主策略。
私有GPT归档进入消费者回调后，14项、99次引用、93个不同段落仍一致，
原始档案字节未变。相关回归720/720通过，无跳过；
static-check889文件、test-integrity409文件、新增CJS语法及git diff --check通过。

这个边界保证经过该入口且被宿主明确声明的消费会先机械回读证据；
不自动发现遗漏的依赖，不证明消费方采纳了证据或使用了正确参数，
也不替代执行权限、业务验收、跨文件事务或工具实际执行结果验证。
原始样本仍没有独立tool call/result，不能凭对话转述认证工具真相。
全局操作强制回读仍需确定具体下游消费者并由宿主接线。
本轮未部署、未启用策略、未改生产配置/数据库/cron，也没有新模型请求。

## Provider二次拆分的行窗口回溯（2026-10-31，基线9a81f92后）

已核对实际安装OpenClaw 2026.7.1-2的两个SDK入口：
chunkMarkdown及enforceEmbeddingMaxInputTokens。
后者对超限的文本按UTF-8字节拆分并重新计算分片哈希，
但保留父分片的startLine/endLine，不把行号改成子片段的精确位置。

这会让合法子片段只含父范围中的某一行或一行中的几个字符，
也可能恰好从分隔换行处开始或结束。
旧的精确范围匹配在“first source line / second source line / third source line”
这类三行例子中会把三个真实SDK子片段全部误拒收。
本轮修复该读取问题，没有修改Core分片器或provider实现。

### 匹配规则与范围

episode-projection新增matchLineWindow，把Canonical行号视为有界搜索窗口，
在已登记的不可变发布副本中核对完整子片段文字：

- 仍检查完整分片哈希，不修剪空白或替换、重排任何非换行字符；
- 原始换行及真实空行不能被删除或凭空增加；
- 允许Core在原始长行内插入的分隔换行，以及二次切分后首尾留下的分隔符；
- 根据实际含非空文字的源行计算item_indexes，不把父窗口覆盖的全部事项都授予子分片；
- 同时保留所有可能匹配的源跨度，不把其中一个位置冒充provider精确offset记录。

完整范围匹配继续使用scope=archived_projection_line_range。
只有窗口内部分内容匹配时，返回scope=archived_projection_line_window，
并附带core_line_window及matched_source_spans；其语义仍为归档投影文字匹配，
不是对Core索引因果来源、摘要事实或工具执行的认证。

若相同子片段同时出现在多个事项、不同归档版本，或同时出现在头部与摘要项中，
不同事项范围会触发derived_projection_ambiguous。
不丢弃头部匹配来挑选一个事项；调用方传入item_index也不能消除来源歧义。
只有头部匹配的子片段保持locator_unavailable，敏感读取拒收。
明确已知归档ID的整份原文回读仍可使用原有checkpoint:<archive_id>入口。

匹配工作量按字符比较计入预算，最多保留256个匹配位置；
整个读取也最多接受256个候选匹配，不截断后选择“第一个”。
原有快照/分片大小预算继续生效。
搜索、AutoRecall、原文归档、发布副本状态及Nightly备份格式均未改变，
仅显式读取的投影匹配增加该路径。

### 离线验证

新增test/checkpoint-provider-projection.test.cjs，共10项测试。
直接调用真实SDK纯函数，用较小输入限额触发路径；
provider stub的embedding函数若被调用就使测试失败。
当前SDK以UTF-8字节估算这里的限额，本轮人为预算不是生产provider的token配额，
也不据此推断生产请求曾实际触发该分支。

| 场景 | 结果 |
| --- | --- |
| 单父窗口、多种provider/hard上限组合 | 125次非空子片段检查：113次通过、2次歧义拒收、10次头部/非事项范围未认领 |
| 主Unicode分片再做字节拆分 | 529次事项续段检查通过，含120次首尾换行及271次片段内换行场景 |
| 实际memory_engine_get | 只允许子片段实际覆盖的item_index，错误事项不触发成功强化回调 |
| 空白/字符/哈希/越界篡改 | 拒收，不扩大事项范围 |
| 私有GPT档案备份恢复 | 59个SDK子片段：57个摘要片段通过，2个纯头部片段未认领；恢复14项、99次引用、93个不同段落 |

所有字节拆分均额外核对：子片段重新连接后与父文本完全一致，
Unicode合法，哈希等于完整子片段的SHA-256。
事项期望值独立按父文本的原始字符offset计算，歧义也与原文重复出现位置交叉检查。
私有档案仅复制到临时目录；删除临时活跃归档/投影后只用备份回读，
原始私有档案字节未变。

验证SDK指纹：

| 文件 | SHA-256 |
| --- | --- |
| plugin-sdk/memory-core-host-engine-embeddings.js | c648220ea0122589bc5d5e231f3224662128627b1f8e7fa104e4b99126e4eeee |
| memory-core-host-engine-embeddings-DVluEqwT.js | ca7f8f7e2146cea0329afe218b60dc0aab4dd02e3dd3062288316f5da9330964 |
| internal-ss-Qpla0.js | ba0a670347e61bbf9c85a07a482fb23c30d26cb64b1657edc646d74298d560a8 |

相关回归730/730通过，无跳过；static-check889文件、test-integrity409文件、
修改/新增CJS语法及git diff --check通过。
provider调用0、模型调用0、生产数据库写入0，没有运行真实生产索引器。
这补齐了两段SDK拆分的离线验证，不等于整条生产索引/嵌入链已经验收。

歧义片段仍需更多可验证上下文，不能从现有父行号和重复文字中唯一恢复事项。
没有发布副本的旧记录、AutoRecall无标记直接定位及全局下游强制回读仍有剩余范围；
可选最终执行守卫也仍未在默认装配中启用。
本轮未部署，未修改生产配置、cron、原始样本或已发布episode。
原始实验样本没有独立tool call/result事件，所有语义与工具真相边界保持不变。

## 真实Core索引链隔离集成（2026-10-31，未部署）

接线基线HEAD=0d211eb，核对时工作树干净。
新增test/checkpoint-core-index-integration.test.cjs；本轮没有修改生产业务代码。
验证发现现有Core只读适配层已经兼容新版memory_index_chunks表，
无需新增业务层表名分支。

### 实际调用和隔离范围

测试使用本机OpenClaw 2026.7.1-2的真实MemoryIndexManager实现，
调用真实sync、文件发现、分片、provider输入拆分、SQLite/FTS写入及search。
随后经memory-engine现有只读适配层、混合搜索和memory_engine_get读取。
Core主库由Core管理器创建；Engine仅在临时库初始化现有生命周期表，
没有伪造Core行、手工复制分片或用模拟SQL结果代替Core索引。

每次测试先创建私有临时根目录，在导入SDK前设置该测试进程自己的
OPENCLAW_HOME、OPENCLAW_STATE_DIR、OPENCLAW_CONFIG_PATH和日志位置。
管理器构造前显式覆盖store.databasePath，provider直接由constructor/providerResult注入，
purpose=cli，禁用watch、定时同步、自动搜索同步及provider fallback。
Core的agent database登记也落在临时state中；没有调用默认生产索引入口。
没有修改HOME、CODEX_HOME、真实配置或服务环境。

摘要生成使用两项合成fixture；embedding由本地确定性三维向量替身生成。
测试直接阻断fetch、HTTP(S) request及Socket.connect，观测到网络尝试0。
SQLite向量扩展关闭，走Core现有内存余弦/FTS路径；
LanceDB不装配，既有日志中的lancedb_table_null是该测试的预期条件。
这些人工向量和合成摘要不用于评价模型、语义检索质量或生产provider性能，
也不记作新增GPT实验。

该测试依赖安装版本的私有构造注入接口，明确限制包版本为2026.7.1-2。
只在设置MEMORY_ENGINE_TEST_OPENCLAW_ROOT时运行；没有设置时显式跳过。
SDK升级需重新核对接口和路径隔离，不能把测试适配当作稳定生产API。

### 覆盖与结果

两种配置分别为主分片tokens=64/overlap=16，以及单大父窗口加provider输入上限128。
128在此SDK分支按UTF-8字节估算，仅用于触发二次拆分，不代表生产token配额。

| 场景 | 结果 |
| --- | --- |
| 真实checkpoint发布 | 4次离线fixture调用，两个配置各发布初版和修订版，均通过 |
| 初版真实Core索引 | 两个配置合计71个分片；路径、完整文本SHA-256一致 |
| 无标记分片Get | 初版32次读取成功，归档定位仍可解析 |
| 初版敏感读取 | 41次；完整来源记录与引用字符范围逐一一致 |
| 实际搜索再Get | Core原生search和memory-engine搜索均有结果，ID来自真实Core表，返回项可Get |
| 修订再次索引 | 新分片定位到新归档及参数43；previous_archive_id和旧episode副本指向初版 |
| 旧版本 | 初版归档原始字节保留，旧参数42及完整记录仍可回读 |
| 备份恢复 | 关闭管理器后删除整个临时活跃memory目录，仅用备份和既有只读Core库回读 |
| 恢复版本/事项 | 两个配置各恢复两版、每版两项，共8个版本事项；不是8项新模型摘要 |
| 损坏拒收 | 临时备份中的新归档损坏后Get拒收，不触发成功强化回调；直接读取完整旧归档仍成功 |
| 数据库读取边界 | Core写入尝试被readonly连接拒绝；备份回读前后Core/Engine主文件字节一致 |

修订回读和备份回读另有完整记录及引用检查，不计入表中的初版41次。
原文回读保留source=before_prompt_build、trigger=user等被合成摘要省略的资格。
重复文字导致事项来源歧义的片段保持拒收，不靠指定item_index选择一个来源。
两个事项都必须至少有一个可验证的真实Core分片，不能通过跳过全部歧义来通过测试。

本轮相关回归733/733通过，无跳过；包含上轮730项及本次父测试/两个子测试。
static-check889文件、test-integrity409文件、显式新增CJS语法检查及git diff --check通过。
静态工具当前不计入这份新增CJS，因此它另经真实测试执行和node --check核对。
观测到4次离线摘要fixture调用、6批离线embedding、4次离线query embedding；
真实模型调用0、真实embedding provider调用0、生产数据库写入0、部署0。

### 尚未覆盖的范围

这是实际Core管理器的隔离集成，不包含生产配置装配、provider工厂/认证、
远程embedding、sqlite-vec或LanceDB写入、文件watch及定时任务运行。
本次合成fixture的完整索引链结果，与前文真实GPT档案的纯函数分片/备份验证分开记录；
不能据此宣称那份14项/99引用样本已经经过真实生产索引。

无发布副本的历史记录、AutoRecall无标记直接定位，以及默认装配尚未覆盖外部敏感消费者的强制回读，
仍保留原有边界。没有将可选最终执行守卫装配到生产。
主实验原文没有独立tool call/result事件，回溯仍只核实对话当时说了什么。
语义状态继续为NOT_CERTIFIED，先前的语义失败和质量备注不改写。


## 已有GPT档案经过真实Core索引链（2026-11-01，未部署）

基线HEAD=3bd6586，开始时工作树干净。
本轮扩展test/checkpoint-core-index-integration.test.cjs，复用同一隔离管理器构造器，
新增两个私有档案集成场景；没有修改生产业务代码或重新调整摘要提示词。
本机Core重新核对为2026.7.1-2，继续沿用前节的进程环境、数据库、日志及网络隔离。

### 重放来源与约束

使用已有2026-10-30 GPT响应所对应的不可变档案：

- archive_id：660bc9d48e7ce66bb4e41f00c81656512d294b075ed8b3a8c7a42baf7863f591；
- 原档案文件SHA-256：7c4d2f72e23cf7d6a59902af60ac61d29acb18d83f115b2459a90842cb37d4b0；
- 4条完整session_flush记录，14项摘要、99次引用、93个不同引用段落。

测试先验证档案完整性，再用其中完整raw_records重建checkpoint输入，
要求重建input与原档案input完全一致。
注入的离线生成器逐字返回已有summary，不改写正文、证据、corrects或重复引用。
checkpoint经真实发布流程生成新的重放档案及prepared/published投影；
新档案generator标记transport=offline-replay，保存源档案ID、文件哈希和original_generator，
不能把它当作一次新的GPT生成或用重放模型标签认证原provider身份。
原始质量备注逐项保留，策略继续为lossy/NOT_CERTIFIED。
每个场景结束均重新核对原私有档案文件的完整字节，未将私有原文加入仓库。

### 真实索引、搜索和恢复结果

两种配置均运行真实Core sync及search，使用同一离线确定性embedding替身。
随后调用memory-engine真实混合搜索和只读Get；没有手工插入Core行。

| 检查 | 主分片64 tokens / overlap 16 | 单父窗口 / provider上限128 |
| --- | --- | --- |
| Core索引分片 | 90 | 74 |
| 可验证的摘要分片 | 72 | 57 |
| 其中无完整定位标记的分片 | 70 | 54 |
| 头部/说明分片，未认领为事项证据 | 18 | 17 |
| 来源歧义拒收 | 0 | 0 |
| 逐项显式Get覆盖 | 14/14 | 14/14 |
| 引用出现次数 / 不同段落 | 99 / 93 | 99 / 93 |
| 搜索结果经敏感Get验证 | 5项命中 | 3项命中 |
| 删除活跃memory后按Core ID从备份回读 | 14/14 | 14/14 |

provider分支的128是该SDK按UTF-8字节估算的人工输入上限，不是生产token配额。
这一分支另以完整发布文件中的字面字符offset独立计算每个子片段的事项集合，
与Get元数据交叉验证；不复用投影匹配函数生成期望值。
出现多个事项身份时仍须拒收，只有头部匹配时不能授予事项来源。

逐项Get返回的summary item与原GPT对象完全一致；
每个引用的quote同时与原档案unit及完整记录中的start/end字符范围一致。
完整source记录与原档案raw_records逐项一致，未只核对引用短句。
搜索得到的ID必须属于真实Core行，搜索预览继续不超过240字符。
表中命中数是这一固定查询的可回读结果数，不是召回质量或性能指标。

关闭Core管理器后，测试删除整个临时活跃memory目录，
保留Core/Engine临时数据库，只把Get的证据目录指向Nightly备份。
随后验证14次item_index读取、完整归档读取，以及4个source_id的完整记录读取；
备份回读前后Core/Engine主文件字节一致，也不会重建活跃memory目录。

### 读取范围与验收边界

测试最初把“省略item_index”的敏感Get错误期望为只返回当前chunk事项。
核对既有文档及实现后保留原合同：
metadata.item_indexes仅声明当前分片可验证的事项范围；
省略item_index会读取整份归档供上下文核对，指定item_index才返回该项，
且该项必须属于当前分片。
现在分别检查这两种结果，不把完整上下文回读当作串项，
也不把整份归档中的所有事项都归为当前分片来源。

本轮只新增离线重放和真实临时Core索引的组合验证。
原GPT摘要的语义质量未重新认证；此前语义失败及质量备注均保留。
原样本没有独立tool call/result事件，完整回溯只能证明对话当时说了什么。
远程provider认证与embedding、生产配置装配、watch/cron、LanceDB/sqlite-vec及部署，
仍未在本轮执行或验收。
无发布副本的旧记录、AutoRecall无标记直接定位及外部敏感消费者的默认强制回读，
也不因本次测试自动补齐。

相关回归735/735通过，无跳过；包含上轮733项及新增两个档案重放子测试。
static-check889文件、test-integrity409文件、CJS语法及git diff --check通过。
静态扫描首次在40秒工具超时前未完成，单独补跑通过；相关回归没有因此重复执行。
完整索引集成文件合计4次合成摘要fixture调用、2次已有GPT输出离线重放、
11批离线embedding、8次离线query embedding，网络尝试0。
真实模型调用0、真实embedding provider调用0、生产数据库写入0、部署0。


## AutoRecall无标记episode的显式回查提示（2026-11-01，未部署）

基线HEAD=6ee471f，核对时工作树干净。
前两轮已经验证无标记Core分片可以经显式Get解析发布副本；
本轮补上卡片表现层丢弃locator_unavailable状态的问题。

### 提示与读取路径

无完整定位标记的episode可能是派生摘要续段，也可能是旧格式文字。
AutoRecall不读取归档或投影，不能仅凭路径把它标成已认证的派生摘要。
现在在MemoryObject中保留episode_unlinked/locator_unavailable，
并把以下提示写入既有、最多512字符的source_hint：

episode_unlinked semantic=NOT_CERTIFIED locator=unavailable get=memory_engine_get:<完整Core ID>

同时保留source_required_for=parameters,acceptance,execution,disputed_claims。
不猜测archive_id或item_indexes，也不增加lossy=true或derived_summary断言。
这条Get路径表示尝试解析证据，不是保证已有原文或回溯成功。
旧格式episode同样带未确认提示；其他路径和已有完整标记的提示保持原来的格式。

普通候选卡片和Canonical卡片都保留该状态。
旧文本fallback优先使用候选的完整memory_id，避免既有16字符显示截断；
缺少memory_id时只能沿用候选ID，提示不认证其完整性或唯一性，仍由Get校验。
Canonical卡片只使用Canonical source.path/text及memory_id，
不接受runtime candidate携带的伪造文本、derived_memory或get_token作为定位权威。
提示中显示的Get ID限制为1至256个ASCII字母/数字及点、下划线、冒号、连字符，
排除checkpoint:保留前缀；非法或超长ID仅显示get=unavailable，不截断后伪装成有效ID。
Get token本身仍遵守既有披露策略，未增加新工具或新payload字段。

### Owner披露与显式证据验证

生产DIRECT_CARD仍从已选中的Owner披露artifact格式化source_hint。
新提示在Owner preview计算projection_hash之前生成，
因此无法把一个旧的不带提示卡片授权直接沿用到新卡片。
受影响的无标记episode需要Owner重新确认新投影；本轮没有写入任何生产授权，
也没有放宽Owner、风险或披露能力检查。
已有完整标记卡片和非episode卡片的提示不因本轮改变。

AutoRecall中仍不打开归档、不注入原始记录、不提前认证投影。
显式memory_engine_get收到完整Core ID和敏感purpose后，
继续由原有读取器核对完整Core文本、哈希、行窗口及已发布的不可变副本。
有证据时返回可验证的archive_id和完整来源记录；
旧格式无发布副本仍以derived_locator_unavailable拒绝敏感读取，
归档损坏仍在成功强化回调前拒收。
提示不是强制执行守卫，也不证明模型实际调用了Get或正确理解原文。

### 验证

新增3项测试，覆盖：

- 最长完整ID和512字符提示上限；非法、保留前缀及控制字符ID不会进入回查提示；
- 无标记Canonical卡片在不访问归档/投影的情况下生成正确提示，伪造runtime ID不能改变投影权威；
- 旧卡片授权不能覆盖新提示，非Owner仍拒绝；新Owner授权后卡片可显示完整Get路径；
- 显式Get恢复完整原文和事项范围，损坏归档不触发额外成功回调；
- 旧格式episode可普通回忆，但提示不会让它凭空获得原文证据。

既有真实Core索引集成另外对GPT档案的124个无完整标记分片
（主分片70个、provider拆分54个）核对Owner preview：
提示包含该真实Core行的完整ID、locator=unavailable和NOT_CERTIFIED，
不包含推测archive_id；随后仍使用原有Get验证14项/99引用/93段原文。
原GPT对象、私有档案字节及质量备注不变。

无发布副本的历史记录仍需独立处理。
本轮补齐的是AutoRecall到显式Get的可见回查入口，
并未让AutoRecall直接确定无标记分片的archive_id，
也未启用外部敏感消费者的默认强制回读、生产路径或定时任务。
主实验没有独立tool call/result事件，不能由回溯证明实际工具执行结果。

相关回归738/738通过，无跳过；static-check889文件、test-integrity409文件、
修改CJS语法和git diff --check通过。
真实模型调用0、真实embedding provider调用0、生产数据库/授权写入0、部署0。

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

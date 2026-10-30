# 有损摘要与原文回溯

日期：2026-10-30（Asia/Shanghai）。

当前接受标准为：允许摘要遗漏、归并不佳或判断出错，完整保存已采集的原始记录，
并保证每条摘要的引用可以读回同一份原文。质量问题留档，不再逐项阻断摘要接受。
本页描述归档入口、离线回溯验证及已完成的checkpoint源码接线。
生成入口与memory_engine_get读取入口已接入，默认仍走legacy；尚未部署或开启生产路径。
Nightly Maintenance清理/备份、检索结果逐片段携带回溯定位器及下游执行约束尚未接入。

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
3. 默认llmDerivedSummary适配现有primary provider的chat-completions；
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
- 默认适配器沿用现有HTTP primary provider；没有把交互式Codex CLI自动接入cron。
  可通过withRuntime({derivedSummaryGenerator})提供其他明确配置的生成器。
  本机只读核对到/home/lionsol/.local/bin/codex、CLI 0.163.0及exec选项；
  未调用GPT，未核实当前模型可用性、代理继承或登录状态。
  不能据此声称gpt-6-luna/xhigh现在仍可成功生成。
- 原文归档和episode不是跨文件事务：归档成功后episode并发冲突/写入失败时，
  保留未被episode引用的归档，返回失败；不删除或覆盖它。
- 版本关联覆盖新路径发布的同日episode历史；旧legacy episode只有既有publisher备份，
  不虚构其archive_id。外部不合作写入者仍受既有publisher的已知竞争窗口限制。
- 该入口把原文交给消费方，不强制所有未来执行工具等待证据确认。
  搜索片段/AutoRecall逐项携带locator、独立备份和维护保留策略尚需后续接入。
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

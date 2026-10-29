# 有损摘要与原文回溯

日期：2026-10-29（Asia/Shanghai）。

当前接受标准为：允许摘要遗漏、归并不佳或判断出错，完整保存已采集的原始记录，
并保证每条摘要的引用可以读回同一份原文。质量问题留档，不再逐项阻断摘要接受。
本页描述隔离归档入口及已完成的回溯验证；生产checkpoint、Nightly Maintenance、
检索注入和执行前查原文的消费流程尚未接入，没有部署。

## 接受标准

| 内容 | 处理 |
| --- | --- |
| 摘要遗漏、错误、统计或阶段归并问题 | 记为quality_findings，非阻断；不默默改写模型正文 |
| 原文未保存成功、档案损坏、绑定/引用失效、原文范围不一致 | 拒绝接受 |
| 模型正确性 | 固定标注NOT_CERTIFIED，不因引用或哈希通过改成事实认证 |
| 普通回忆 | 可以使用带派生属性的摘要 |
| 具体参数、争议判断或执行操作 | 按使用约定先回查来源；运行时强制接线尚未实现 |
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
文件备份、维护清理保留规则和生产消费接线仍需在接入阶段处理；
这里不声称单机归档已经具有独立备份能力。

## 已完成的真实记录回溯验证

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

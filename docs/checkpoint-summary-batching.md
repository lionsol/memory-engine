# Checkpoint 超预算分批摘要

2026-11-03（Asia/Shanghai）。个人实验项目，采用“有损摘要＋原文可回溯”。
本页描述源码实现；不代表运行目录已更新，不认证摘要语义。

默认使用 derived。预算内一次生成；超过字符预算或512个原文片段时分批，每批直接生成一次，
程序拼接各批结果，不追加模型总摘要、命题提取或语义审核。

## 输入与分批

- derived 使用按目标日期采集、过滤、去重后的完整记录，不使用 legacy 的每会话8000字符等裁剪。
- “完整”指采集器提供的记录；不是全部 session JSONL、原始工具调用及结果。
- 先将完整记录和已有来源元数据保存到 memoryDir/checkpoint-sources，再规划批次。
- 有 sessionId 时优先将同一 session 的记录放在同一批；没有该元数据时保持来源记录边界。
- 多个小 session 合批；一个 session 过长时按既有消息/段落单元拆批。
- 单段也过长时按实际可容纳长度切分，优先换行位置，不切断 Unicode 代理对。
- 计费量的近似控制仍是字符数，不等同 tokens 或模型上下文保证。
  每批按实际 system＋JSON prompt 字符数检查，协议开销计入预算。
- 默认每批最多512个原文片段、256条摘要项；每天的累计数量可以超过这些值。
- HEARTBEAT_OK 等既有噪声过滤维持，噪声原记录仍在快照中。
- 不做跨批语义归并；允许重复、阶段归并不佳及跨批更正未充分合并。

## 原文与读取

原文快照以内容哈希命名，生成失败也保留。摘要归档仍在 checkpoint-archives，
包含完整原记录、所有片段及其原文位置、批次生成结果和程序拼接的摘要。
拆分后的引用保持原来源编号与字符位置，source_id 读取完整记录。

沿用 memory_engine_get：

- id=checkpoint:<archive_id>：摘要与引用；source_id=s0 读取完整来源。
- id=checkpoint:<source_snapshot_id>：独立原文快照；普通读取返回来源目录，
  source_id=s0 读取该完整来源，purpose=execution 等返回全部快照记录。
- 原文快照没有摘要项，不能传 item_index；摘要项编号为全天拼接后的零基序号，可以大于255。

快照和本地进度文件单独保留在 checkpoint-sources / checkpoint-summary-jobs。
既有可选归档备份流程不自动扩展到这两个新目录；有成功摘要时，摘要归档自身仍包含全天原文。

## 输出、失败与补跑

每批正文默认上限20000字符，全天不再套用单批正文上限。程序按分组和时间顺序拼接，
显示批次与来源标题，不再调用模型压缩一次。原始模型返回与程序拼接结果分别保存。

- 全部成功：status=valid_summary。
- 部分成功：发布成功部分，status=partial_summary，正文和元数据注明完成数与未完成批次；
  这不代表全天摘要完成，CLI 的业务完成条件仍不满足。
- 全部失败：保留旧 episode；返回失败原因、source_snapshot_id 及批次状态。
- 原文或 episode 在生成中改变、取消或达到主流程期限：停止当前发布，已保存的快照和批次进度保留。
- 不默认自动重试或切换 provider。
- 再运行同一天、同一原文与生成配置时，复用已完成批次，仅重新请求失败或未开始批次。
  生成期间发生变化的来源不混入旧快照；重新采集后创建新快照和计划。
- 失败的模型返回及重试历史留在本地进度文件；已发布旧摘要归档保持不变。
- 完成后的修订继续链接 previous_archive_id，不覆盖旧原文和旧版本。

## 配置

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| MEMORY_ENGINE_CHECKPOINT_SUMMARY_INPUT_CHARS | 200000 | 每批 system＋prompt 上限 |
| MEMORY_ENGINE_CHECKPOINT_SUMMARY_OUTPUT_CHARS | 20000 | 每批摘要正文上限 |
| MEMORY_ENGINE_CHECKPOINT_SUMMARY_CACHE_KEY | default | 改值可强制开一轮新生成，不删除旧产物 |

缓存还区分原文、请求内容、输出预算、配置文件内容以及 Codex model/effort、transport。
同一进程自定义 generator 的实现改变而其他信息不变时，调用方应更换 resumeKey 或 CACHE_KEY。
正常的 CLI 补跑仍使用原 target-date 参数，不需要任务队列或后台守护进程。

## 功能验证

离线测试覆盖：原文在首次请求前可读取、全部失败仍可回溯、同 session 合批、
超长段落与 Unicode 位置、实际提示词上限、部分失败只补失败批次、
一天超过512片段/256摘要项、超过20k的日报、取消后的续跑及旧归档保留。
这些验证不说明模型摘要没有遗漏或因果错误。

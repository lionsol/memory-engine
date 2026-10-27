# Checkpoint 摘要方案对照

日期：2026-10-27（Asia/Shanghai）。状态：源码实验候选，MODEL_NOT_RUN。
用户已同意“原文保留＋事项最终状态＋带引用的生成式摘要”方向。
当前普通checkpoint仍为v15，既有真实验收失败裁决不变。

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
未知/重复引用、空支持证据、同一条目同时支持又撤回同一个unit均拒绝。
当前引用粒度是原始段落，不能表达同段内精确相反范围；必要时应审查为范围不足，
不能在未评测时直接增加复杂定位协议。

程序只检查结构、绑定、引用和预算，不认证结论受引用支持。
测试特意展示：一条错误部署断言仍可能有合法引用，因此语义始终NOT_EVALUATED。
结果固定publishable=false；来源有引用不代表独立事项完整覆盖。
uncitedSourceIds仅供审查，不是质量分数。

## 已执行离线验证

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
本轮真实请求0，发布0，部署0。

## 下一阶段的判定方式

先提交实验候选，再冻结真实对照执行器与每阶段预算。
先对3个开发案例比较direct与staged；全部执行最多9请求，不含重试。
模型、temperature、thinking设置与每阶段输出预算须一致并记录；
完整对照的总tokens、调用次数、耗时分别报告。
这不是复用旧v15“最多1请求”验收执行器；真实对照有独立执行范围。

逐项人工核对：无依据断言、已撤回判断冒充现状、关键事项遗漏、
数字/日期/否定/条件/不确定性丢失、正文长度。
任何关键事实错误都不能用“引用合法”抵消。
开发案例通过后，再以2026-10-20完整样本检查独立事项覆盖和正文预算。
该完整样本已用于多轮调试，不能充当holdout。
在选型前还需要未用于调试的独立样本；目前holdout选择与执行均未完成。

若direct质量相当或更好，采用更简单路径；只有staged的改善有实际证据时才接入两阶段。
若两者均失败，保留失败材料并重新定位，不追加一轮提示词后重复宣称已修复。

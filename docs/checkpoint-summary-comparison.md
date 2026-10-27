# Checkpoint 摘要方案对照

日期：2026-10-27（Asia/Shanghai）。状态：已知完整样本对照失败，FULL_SAMPLE_FAIL。
实验源码提交：`9991345e314afd19cafd833eacabc59fec29f686`；完整样本执行HEAD：`7fa781a6aaff447cd261a85e52a42ad2372d3c64`。
三个合成开发案例的通过只限短输入；holdout仍未执行。
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

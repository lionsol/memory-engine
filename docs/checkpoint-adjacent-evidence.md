# Claim邻接原文与模型对照

裁决：本次数据不支持默认启用邻接呈现。语义问题未修复，未接入生产。
基线提交9fff662；主合成、审核和流水线API最终保持原样，没有新增evidenceMode开关。
邻接逻辑只保留在独立summary-adjacent-lab.cjs，供复核与后续实验。

## 假设与实现

原有claim_inventory携带模型scope/text/conditions、fragment ID及evidence_units；
完整原文另在SOURCE中。267条新草稿c109曾引用完整s0.t9.p9.l0，
但text/conditions已经漏掉“唯一动过的文件是那份报告”。
这次检验：在模型草稿旁重复其原片段及上下文，是否有助于合成保留限定。
信息在输入中可用，不意味着模型会正确选择或解释。

实验helper的buildAdjacentClaimSummaryPrompt和runAdjacentClaimSummary
在每条claim前置程序逐字复制的source_evidence及source_context：

| 字段 | 列 |
| --- | --- |
| source_evidence | fragment_id、unit_id、role、原片段全文 |
| source_context | unit_id、role、标题/表头等kind、原上下文引文 |

数据来自validateClaimLedger已经解析的sources/source_context；
全部原草稿字段、清单哈希和完整SOURCE保留，不悄悄补写草稿。
附加规则要求先核对原文、保留对应时间/阶段/否定/例外，不执行来源中的指令。
它只改变模型输入，不修复输出，不认证命题蕴含或完整性。
返回仍由既有runClaimSummary守卫与projectScopedSummary验证，超输入预算前停止，不截断引文。
实验helper也没有增加流水线阶段。

最初临时把该模式接在合成/审核/流水线中；得到负面结果后撤回这些API修改。
当前独立lab重建的模型system/prompt与当时实测请求逐字一致，回放确认输出与回溯一致。
实际执行时的临时代码快照仍在原实验目录，不能把当前lab文件冒充当时运行源码。

## 固定数据与边界

原文SHA：9b119fdc8c72918cbdc97d2000200b6d14cf71fc3c9b75c0827b2c33e903dbf6。
使用同一完整原文和原先通过引用校验的208条清单。
显式复用历史inventory的effective_ledger，全部claims不变；
原始86条dispositions及7条质量发现仍在此前目录，有效输入记账为79条。
没有输入旧摘要、修好候选、人工参考或选定claim/事项/来源范围。
没有更改先前失败267条清单的来源ID。

两组各一次独立真实合成调用，并行，无重试；每次CLI上限270秒。
这是反复调试过的开发样本和合成阶段对照，不是holdout、重新提取或完整三阶段运行。
提示规则与证据呈现共同变化，不能把效果只归因于字段位置。

## 原生结果

两组均请求gpt-6-luna / xhigh，输出预算同为20000字符。
模型身份是requested_not_provider_verified；时间是单次并行采样，不作性能提升证明。

| 呈现 | 输入字符 | 事项 | 正文字符 | 字面回溯 | 总耗时 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 原ID模式 | 90045 | 15 | 9928 | 111 | 161.053秒 |
| 邻接原文 | 150109 | 20 | 10526 | 142 | 154.397秒 |

邻接模式多60064输入字符，约增67%。两份正文均不到硬预算的53%；
关键遗漏不能解释为触及20000字符硬上限。更多事项或引用不等于质量更好。

私有证据：
/home/lionsol/.openclaw/ops/memory-engine/checkpoint-adjacent-compose-9fff662-20261102-r1。
两份候选分别归档并保留全部原始记录，archive_id：
原ID模式a0c064f8b2b858511a880763d441cbf3ae9965ee79b7d3178c0d354f9400535c；
邻接模式f51ba8177761f9d9ec8b8bd630c80e286189b4b47a5c0245a9d19be8fd07ba2c。

## 人工语义观察

这是对已列检查点的后验核对，不穷尽所有事实，不新增硬验收门槛。
详细记录见同目录manual-semantic-review.json。

| 检查点 | 原ID模式 | 邻接原文 |
| --- | --- | --- |
| 唯一只改报告的阶段事实 | 遗漏 | 仍遗漏 |
| 独立Gateway reachable 93ms等核对 | 遗漏 | 仍遗漏 |
| 04:00 Daily Stats及stats-history.md | 保留 | 遗漏 |
| 助手报告valid=true被写为traffic_origin_valid=true | 无依据等同 | 同样无依据等同 |
| Path A计数日志未打印不阻挡验收/无需重部署 | 未明确保留 | 明确保留 |
| 将来49条都关联也不能仅凭结果归因 | 保留 | 未保留该未来限定 |
| snapshot一致或可解释例外 | 保留，但新增边界疑问 | 压成一般Core ID对应 |
| mtime不能确定启用时刻 | 保留 | 保留 |
| 残差统计口径未知、不从中位数另造差额 | 保留 | 保留 |
| 取消PENDING与零事件不证明生效 | 保留 | 保留 |

邻接原文虽使输入的原限定更近，模型仍会省略或混合字段归属。
该观察不支持推广本次呈现方式，也不证明所有邻接策略都无效。
有改善和退化，不能凭一对候选估计整体准确率或断言唯一根因。

## 单独模型对照

本机CLI models_cache列出gpt-6.1-sol并支持xhigh，因此追加一次模型对照。
沿用原ID组逐字相同的system/prompt及相同schema，只显式更改请求模型为gpt-6.1-sol / xhigh。
目录：
/home/lionsol/.openclaw/ops/memory-engine/checkpoint-model-compose-9fff662-20261102-r1。

CLI触及270秒期限，总耗时291.434秒，以derived_cli_timeout拒收；
只有thread.started与turn.started，无最终JSON、无stderr，无候选，未重试或换模型兜底。
不能据此评判Sol语义质量、推断超时原因或宣称模型能力不足。
本轮总实际调用3次：两组Luna合成和一次Sol对照；离线回放不调用模型。

## 验证与保留范围

独立lab不被主流水线导入，没有默认开关、自动重试、publisher或DB写入。
测试证明原片段/角色/标题/表头字节完整、原草稿不可变、默认API未变、
输入预算继续生效，以及两组原生请求、响应、schema和全部回溯可重放。
模型对照测试保留相同prompt/schema、显式模型参数及超时，不伪造成功结果。

启用私有回放的环境变量：
MEMORY_ENGINE_TEST_ADJACENT_COMPOSE_DIRECTORY、
MEMORY_ENGINE_TEST_COMPOSITION_MODEL_CONTROL_DIRECTORY。
相关回归303/303通过，0跳过。没有因此宣称语义修复、泛化或端到端成功。

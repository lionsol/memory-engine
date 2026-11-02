# 逐命题审核实验

状态：开发实验，未接入生产；允许有损摘要，不以覆盖声明认证事实完整。
基线提交e6992a7。原自动候选25项、12803字符，完整源SHA为
9b119fdc8c72918cbdc97d2000200b6d14cf71fc3c9b75c0827b2c33e903dbf6。

## 问题与处理

此前审核只有replacements/appends/moves/additions/findings。
两次同源审核都未补报告修订事项；引用s0.t9.p4不能证明其中报告修订和断言撤回都已呈现。
命题清单c65/c72保留了相关内容，但合成/审核没有逐命题去向记录。
这是可观测的机制缺口；并不证明模型内部错误只由这一原因造成。

新增lib/checkpoint/summary-claim-audit.cjs，runClaimAuditReview(input, inventory, current, invoke, settings)：
固定一次模型调用，对照完整SOURCE、全部不可信命题和冻结摘要，返回局部修订及claim_checks。
不输入人工参考、旧修好答案或人工选择的事项/来源scope；不自动重试。
settings只接受maxInputChars、summaryMaxChars、signal；默认200000/20000字符。
原有scoped修订协议和三阶段流水线默认行为保留。
runSummaryPipeline的reviewMode="claim_audit"可将第三阶段替换为逐命题审核，仍恰好三次调用；
reviewMode="local"为既有默认。该接入在本次独立真实审核结束后完成，仅做集成测试，未新增真实完整运行。

## 输出合同

合同claim_audit_review，版本checkpoint-claim-audit-review-v1。
原有根绑定及五类修订数组保留，新增claim_checks：

| 字段 | 含义 |
| --- | --- |
| claim_id | 清单中的原命题ID |
| status | represented / omitted / excluded / uncertain |
| item_ids | 冻结摘要的item标签；不是原文evidence |
| note | 对应的具体事实、缺失点、省略理由或疑问 |

所有声明针对修订前的冻结摘要，不能把本次拟新增的事实算成原来已呈现。
represented须指出具体正文事项；同主题、同段引用或另一事实已写入都不够。
omitted与excluded无对应事项。excluded允许主动压缩过程/重复/明细，但要说明理由。
这些均为模型判断；不从字面覆盖自动推断事实完整，也不自动相信更正图。

缺少claim检查、重复/未知claim、未知item或不合用的映射会保存原条目并记录质量发现，
不会阻挡有来源的局部修订。非JSON、结构错误、根绑定不符、修订目标/引文错误仍拒收。
原始模型对象、全部命题、原始响应和冻结基线都保留。
claimAudit.valid_checks只是可用于记账的声明，不表示其语义正确。

应用时显式从审阅合同剥离claim_checks，并将协议标签转为既有v3局部修订合同。
源绑定、摘要哈希、补丁地址、正文和引文不改写；由既有applyScopedRepair再验证和应用。
这不是失败哈希重绑或修复模型原字节。模型提出的遗漏不自动全部写入正文，
未修订的问题可留为质量发现。

该协议依旧不能直接重写既有事项scope/conclusion；可以追加阶段限定或记finding。
不得把“某次核对/修订未执行某动作”泛化为整个日期未执行，也不能用新条件掩盖明确错误的结论。
publishable=false、publisherCalls=0、semantic_correctness=NOT_CERTIFIED、
semantic_improvement=NOT_EVALUATED。

## 验证

test/checkpoint-claim-audit.test.cjs涵盖同段独立事实、修订前后口径、允许省略/不确定、
不合用记账的保留、仍严格的绑定/补丁引文、取消及并发源变更。
test/checkpoint-claim-audit-capture.test.cjs通过
MEMORY_ENGINE_TEST_CLAIM_AUDIT_REVIEW_DIRECTORY启用私有原生调用回放，
核对请求、真实单值schema、原始响应、全部对照记录及完整原文回溯。
机械测试和模型覆盖声明均不构成语义正确或泛化证明。

完整208条清单的原生调用证据目录：
/home/lionsol/.openclaw/ops/memory-engine/checkpoint-claim-audit-e6992a7-20261102-r1。
这是反复调试过的已知开发样本，不是holdout；只审核冻结25项候选，不是全新三阶段运行。
原生调用222.167秒完成，2处替换、7处追加、3个新事项；28项、14507字符、154处引用回溯通过。
完整原文归档ID：692b9180550866842d245f50a48bccfea4c72848e720f6d715fdf5af132a1992。

| 已知检查点 | 本次观察 |
| --- | --- |
| 报告修订独立结果c65 | 标omitted并新增事项，保留错误断言撤回、源码/部署副本口径及首跑清单 |
| 仅改报告的执行边界c72 | 标excluded，未补；日期级操作scope歧义仍在 |
| valid字段名c181 | 局部修订恢复valid=true；但对冻结基线仍标represented，说明该状态不能认证含义正确 |
| mtime与运行归因 | 补回原报告更新时间观测，同时保留mtime不能证明启用时刻或运行先后的限制 |
| 残差统计关系 | 本次未进一步修订，仍仅保留原值及聚合公式未知 |

原始208条检查均保留：represented 153、omitted 14、excluded 41、uncertain 0。
其中32条excluded附带相关item_ids，违反本版“excluded无对应事项”的记账规则；
被记为不合用记录而不阻挡修订。有效记账为176条、32条没有可用记账；
这不表示模型没看这32条，也不能把176当作事实覆盖数。未发现未知claim/item或重复声明。
该规则是否应允许“主动压缩但列相关事项”需另作协议决定，本次没有静默重解释或改写原输出。

人工后验审阅见同目录manual-semantic-review.json，只查已列问题，不穷尽新输出。
两次此前不限事项审核均未补报告修订，本次补回；这是已知开发样本上的局部观察，
没有随机/重复对照，不能将差异全部归因于逐命题机制，更不估计整体错误率或泛化。
一次额外审核已有明显延迟成本；尚不足以默认接入生产。

包含私有历史与本次真实响应的相关回归291/291通过，0跳过；未新增模型调用。
旧默认审核请求/原始拒收回放保留；git diff --check通过。

# 命题清单实验：段内事实覆盖与精确更正

日期：2026-11-01（Asia/Shanghai）；基线提交：0ca08c8。
状态：源码与离线验证完成；尚无本协议的真实模型语义验收，未接入生产checkpoint。

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

## 不再发生隐式的第二次内容选择

projectClaimLedger逐条呈现全部已提供claim、conditions及更正关系，
不再调用模型压缩，不删除被模型标注更正的条目。
旧判断明确附有模型更正标记，保留历史原述；关系本身仍未认证。
独立判断即使共享段落或fragment，也不会因为另一个claim被更正而由程序一并删除。

这保证的是已识别清单到呈现的字段保留。
它没有保证模型第一次提取时不漏项，也没有将本清单直接变成生产episode。

## 覆盖诊断不等于事实完整

每个fragment可被quote覆盖，或由dispositions说明：
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

上述是显式调用示例，本轮没有实际执行它。
真实实验执行器仍须保存完整raw_records/原始文件、实际request、CLI原始输出及生成元数据。
模块record.source只是结构化可见输入，不替代完整原始记录归档；
raw_response是invoke返回文本，也不等同于CLI stdout原始字节。
新协议尚未接入既有TRACEABLE_DERIVED_MEMORY归档或Get，不宣称已经形成新的可接受生产记忆。

默认限制：输入200000字符、4096片段、1024条claim、8192处引文、
响应1MiB、最终正文20000字符。
超正文预算时不截断、不再请求压缩；返回拒收并保留可复核记录。
semantic_correctness固定NOT_CERTIFIED、publishable=false。

## 本轮验证

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
| 本轮新模型调用 / 生产写入 / 部署 | 0 / 0 / 0 |

下一步是用这份完整输入运行受控真实提取，人工核对三类独立结果、资格、
矛盾统计及部分更正，再评估是否优于已记录的direct输出。
在此之前，不能将结构修复候选或197项程序测试描述为历史摘要语义Bug已解决。

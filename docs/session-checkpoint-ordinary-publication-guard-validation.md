# 普通 checkpoint 发布保护：最小修复验证

日期：2026-10-24（Asia/Shanghai）。
产品基线：ddacf66d2458190f32747849998b9e46faa6d699（此前现场checkpoint相关安装文件绑定）。
隔离worktree：/home/lionsol/.devspace/worktrees/memory-engine-423c0dac。
状态：源码修复完成、未提交、未部署；本轮真实provider、scheduler、Core索引及服务操作均0。

## 已复现的缺陷

普通nightlyCheckpoint在模型返回后直接调用writeEpisodeFiles，
未传入模型调用前的episode快照，也未复核收集器的源版本。
因此基线在两个临时目录场景下实际覆盖了文件：
1. 模型调用期间源发生变化，仍把响应写成新episode；
2. 模型调用期间其他写入者修改episode，旧响应覆盖并发写入。

修正fixture后，原基线两项保留性测试均失败，失败内容是文件已被新episode替换，
不是仅缺少新字段。TAP捕获SHA256：
1f6604302cc0796e4bf8a81f529c19bcd8076e4a7922c0b1caea01b1a62d2f53。
最初一次fixture因对象展开顺序覆盖预算注入，误走分段分支；纠正后才取得上述有效基线。

## 产品差异

只修改bin/session-checkpoint.js，另增本验证文档和一个定向测试文件。
不修改llm.js、预算默认值、共享provider adapter、publisher、Core/Engine/Lance逻辑、
现有分段提示/协议，或任何执行器。没有引入whole-source、M1或source-only分配器。

普通有效输入流程现在：
- 模型调用前保存输入对象签名及episode版本；
- 有真实collector证据时检查segmentedInput.targetDate与unchanged()；
- 请求前、成功返回后及异常处理前检查版本；
- 已观察到源/episode变化或读版本失败时，先停止，再进行任何本轮提取生成的记忆写入；
- 发布时将调用前expected快照与source unchanged回调传给已有writeEpisodeFiles；
- 普通发布结果、失败状态、清理及mirror结果进入main的业务状态，不再只处理segmented结果；
- source冲突为input_incomplete，目标文件冲突/发布失败为publication_incomplete；
- 已提交但清理失败仍记录published=true，同时main.ok与business_complete为false。

新结果字段source_version_valid、publication，
以及Business status中的ordinary_source_version_valid、ordinary_publication，
只记录版本检查/发布事实，不认证语义质量。
版本未检查时使用null；已知源无效不把它表示为输入完整。
发布冲突日志不再被归为“没有对话”。

## 现有预算参数验证

只使用上轮真实运行元数据的四个长度22932/366/356/360构造合成字符串，
不读取真实正文，不调用模型。随后用实际reader和现有预算模块验证。

| perSessionChars | conversationChars | 预算后计数 | 覆盖 |
| ---: | ---: | ---: | --- |
| 8000 | 24000 | 9097 | 长条目截断 |
| 24000 | 24000 | 24000 | 最后一条360→331，仍少29 |
| 24000 | 25000 | 24029 | 四条全保留 |

24029是采集预算口径，含原有条目分隔符；不是整个HTTP请求的字节/token数。
普通提取器源码默认maxInputChars=45000、maxTokens=4096、timeoutMs=120000。
真实JS测试在显式隔离预算24000/25000下走原nightlyCheckpoint及llmNightlyExtract，
bytewise fake HTTPS只创建一个请求，并逐条核验完整原文均在发送prompt内。
未调用分段分支，未使用新whole-source候选。

**生产默认值保持8000/24000不变。**
候选运行参数的环境变量名为：
MEMORY_ENGINE_CHECKPOINT_PER_SESSION_CHARS、MEMORY_ENGINE_CHECKPOINT_CONVERSATION_CHARS。
本轮没有设置宿主变量、编辑任务payload或应用生产配置。
真实验证前还须核对实际作业环境的LLM输入上限；不能用源码默认值代替生效配置。
若该上限被调低，普通提取器仍有substring截断行为，本补丁没有改动它。
仅适配本批已知规模，不声称任意更长/更密输入均可完整生成摘要。

## 并发保护与边界

复用原publisher的合作锁、hash/inode/ctime等版本比对、临时文件fsync和原子发布，
旧episode内容仍由publisher备份。初始缺失文件采用no-clobber发布。
不是文件系统CAS：不守锁的写入者仍可能在最后检查和rename之间竞争。
源最后检查后的变化也不能以这些同步检查完全排除。

生产reader提供私有unchanged()，用于重新核对收集源。
遗留直接API若只传普通数组，则只能检查传入对象，无法检测它未提供证据的外部文件变化；
不把这种内存保护说成源文件版本认证。

这是episode保护，不是整个checkpoint跨存储事务。
Core索引/Engine对账等前置步骤未改变。
若源在模型返回时已改变，则定向测试确认生成目录和confidence调用数均为0；
若变化发生在episodic smart-add之后、episode提交之前，episode仍受保护，
但已生成的smart-add/相关写入不会回滚。测试明确保留并报告这条边界。
生成文件日期策略沿用原逻辑，没有因历史targetDate改写输出路由。

空输入、无会话、普通超时marker策略没有重构。
模型调用期间已观察到的冲突会在进入失败marker前被拦截，
但不将全部旧marker路径宣称为统一事务或CAS发布。
本补丁也不修改旧普通LLM的fallback、超时/取消、输入截断或输出限制实现。
摘要语义遗漏若未触发已有失败判定，仍需真实样本审阅，不能靠版本检查识别。

## 定向与共享回归

Node v24.19.0，真实外部provider请求0；所有写入均在自动清理的临时目录。
使用实际bin、reader、budget、普通llmNightlyExtract、HTTP解码器和publisher。
与本缺陷无关的confidence DB写入在测试边界被stub并计数；
未宣称此测试重新验收confidence写入或整库正确性。

| 检查 | 结果 | TAP stdout SHA256 |
| --- | --- | --- |
| 新增定向 | 16/16，fail/cancelled/skipped/todo=0 | 97f7431a0ec6ead95d266d6fbd2bf27138139c2de0d9e6d2663593390db04f97 |
| 七文件共享回归 | 79/79，fail/cancelled/skipped/todo=0 | 25aad3505849ce0a0960a247cbed5113a486b394d3eb687e10e72ea78bebf5ae |
| 既有分段main兼容用例 | 2/2，fail/cancelled/skipped/todo=0 | e11503a0f9f872248a4a48e99a6636ed0ff6b6a0ed6a2944600b878fc9453858 |

stderr空。TAP为内存捕获并散列，未另存完整原始TAP。
覆盖预算三种情况、完整22932混合输入、真实JS/fake HTTP普通提取、
调用中源变化/源读失败、episode修改/清空/并发首次创建、
旧数组API对象变化、无效snapshot、锁冲突、发布前迟到变化及跨存储边界、
main失败状态传播、已提交但清理失败的事实区分。
准备阶段另有生成文件日期断言错误，已按原有处理日目录策略修正，没有改产品日期逻辑。

~~~bash
cd /home/lionsol/.devspace/worktrees/memory-engine-423c0dac
MEMORY_ENGINE_TEST_DEPENDENCIES=/home/lionsol/.openclaw/extensions/memory-engine \
/home/lionsol/.local/node24/bin/node \
  --require ./test/checkpoint-dependency-loader.cjs \
  --test --test-reporter=tap \
  test/checkpoint-ordinary-publication-guard.test.cjs \
  test/checkpoint-episode-writer.test.js \
  test/checkpoint-publication-failures.test.js \
  test/checkpoint-raw-log-components.test.js \
  test/checkpoint-completeness.test.js \
  test/checkpoint-markers.test.js \
  test/session-flush-reconciliation.test.js
~~~

共享main的分段兼容检查使用既有fake summaryTransport，不发外部请求：

~~~bash
cd /home/lionsol/.devspace/worktrees/memory-engine-423c0dac
MEMORY_ENGINE_TEST_DEPENDENCIES=/home/lionsol/.openclaw/extensions/memory-engine \
/home/lionsol/.local/node24/bin/node \
  --require ./test/checkpoint-dependency-loader.cjs \
  --test --test-reporter=tap \
  --test-name-pattern '^full main reports' \
  test/checkpoint-long-session-summary.test.js
~~~

产品文件SHA256：200a4adaa50d8bb62237114991fed0aa0f94133b079f5d6192686df24cf5e6cd
测试文件SHA256：872931dece41a2f5c1c5e15a6e6b4851287ad14a99e28e494ae78541910397ac

CodeGraph工具未暴露，使用定点源码和真实JS路径测试。
没有安装依赖或改变package/lock；旧研究worktree、主工作区既有修改均保留。

## 提交命令

仅提交三份指定文件，不混入此前实验或执行器；没有部署效果或runtime授权。
当前接口仅用于Git检查，尚未创建commit，因此尚无产品提交SHA。

~~~bash
set -e
cd /home/lionsol/.devspace/worktrees/memory-engine-423c0dac
test "$(git rev-parse HEAD)" = ddacf66d2458190f32747849998b9e46faa6d699
test -z "$(git diff --cached --name-only)"
git add -- \
  bin/session-checkpoint.js \
  test/checkpoint-ordinary-publication-guard.test.cjs \
  docs/session-checkpoint-ordinary-publication-guard-validation.md
git diff --cached --check
git diff --cached --stat
git commit -m "fix(checkpoint): protect ordinary summary source and episode versions"
git rev-parse HEAD
git status --short
~~~

运行恢复是后续独立步骤：本次不会启用cron、重跑已关闭批次或自动修复历史输出。
向量backlog仍属独立状态；即使摘要成功，总business_complete也可能因向量未完成而false。

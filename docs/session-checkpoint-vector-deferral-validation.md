# Checkpoint vector-limit deferral and saved-summary review

日期：2026-10-24（Asia/Shanghai）。
产品基线：b1a3b46274f9c3508e78c62715d35d8d79027d98。
隔离 worktree：/home/lionsol/.devspace/worktrees/memory-engine-2fb7407c。
状态：离线修复完成、未提交、未部署。主工作区既有修改保留。
没有运行真实 checkpoint、索引、provider、cron 编辑或服务操作。

## 实际缺陷与最小差异

scoped orphan repair 的 ok 表示 membership 是否已经收敛。
触及正常 10 条限额时，ok=false 与 limit_backlog 可以同时出现，
即使写入/操作/指纹冲突计数全为 0。
main 原先直接用 lanceSummary.ok 判进程成功，导致已经发布的有效
ordinary episode 也让 wrapper 返回 1。

本次只修改产品 bin/session-checkpoint.js：
- 仅当 limit_backlog 的来源、会员状态、正整数限额 backlog、
  总 backlog、零失败计数、零隔离记录及无错误均有明确证据时，
  将该 false 识别为正常限额延期。
- 新增 Business status.vector_operation_status：
  deferred_limit / failed / completed。
- 保留向量 membership/validation、backlog 与 business_complete；
  延期不表示向量收敛，不使 business_complete=true。
- 非零或非法失败计数、写入/操作错误、指纹冲突、未知 false、
  不明响应或抛出的异常仍使 main.ok=false。
- 普通源版本、发布保护、输入不完整和模型失败判定保持，
  向量延期不能掩盖这些失败。

没有改 orphan repair 的 ok 契约、上限 10、embedding/schema/provider、
默认 8000/24000 预算、prompt、摘要发布器、wrapper、executor 或 cron。
此处 completed 仅表示本轮操作没有失败；向量验证是否完成仍看独立字段。
原有数字型 legacy 返回值及轻量成功结果兼容行为保留。

| 情况 | main.ok | vector_operation_status | business_complete |
| --- | --- | --- | --- |
| 摘要正常，纯限额 backlog | true | deferred_limit | false |
| 摘要正常，membership 完成但指纹未验证 | true | completed | false |
| 摘要及向量均完整 | true | completed | true |
| 写入/操作失败或指纹冲突 | false | failed | false |
| 缺失失败证据的 ok=false / 未知响应 | false | failed | false |
| 限额延期但源变化或 LLM 失败 | false | deferred_limit | false |

## 先红后绿与真实 JS 路径

不是仅把 mock 中的 ok 改成 true。既有 scoped Lance 测试使用真实
reconcileSessionFlushManagedState 和 repairOrphanVectors，真实临时 SQLite，
fake Lance/embedding，将第一次修复的实际结果交给真实 checkpoint.main：
12 个 eligible，已有 1，新增 10，剩余 1，零写入/操作失败。
在未修改产品的 b1a3b462 基线上，main.ok 为 false，新增断言失败。
修复后相同用例 main.ok=true，摘要发布，向量未完成仍明确为 false。

基线失败 TAP SHA256：
0a2ed11660507d53ecabf92e87762381e11fcc8b5ce41047d6ca4226f1824562。
修复后该用例 TAP SHA256：
dc50f41e4e5915536bbc3a16ae42588cac7da2f2a8cb6688ca6d935bae23af2d。

| 定向检查 | 结果 | TAP stdout SHA256 |
| --- | --- | --- |
| ordinary guard + session-flush 两文件 | 66/66 | 63d5254d18fbc87f42c1cd3cadba5289a7ebf5c74cdc5c854133152a96467335 |
| 七文件共享回归（包含上述用例） | 97/97 | 77c6edd1d1e541e9307c91bc50ed6011a7a2ce9cf59aa747f6851abe0ac1c4a7 |
| 既有分段 main 兼容检查 | 2/2 | 7cd60a4b513c20ea8852fb6375cff33442632ee1e2bdfc95d1ce9a85ca54cef7 |

Node v24.19.0，fail/cancelled/skipped/todo 全为 0，stderr 空。
TAP 仅捕获并散列，未另存完整原始日志。测试读写仅在临时 fixture，
或对指定现有源码作只读查询；真实 provider 请求数为 0。
CodeGraph 工具未暴露，使用定点源码与真实 JS 路径测试。

~~~bash
cd /home/lionsol/.devspace/worktrees/memory-engine-2fb7407c
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

MEMORY_ENGINE_TEST_DEPENDENCIES=/home/lionsol/.openclaw/extensions/memory-engine \
/home/lionsol/.local/node24/bin/node \
  --require ./test/checkpoint-dependency-loader.cjs \
  --test --test-reporter=tap \
  --test-name-pattern '^full main reports' \
  test/checkpoint-long-session-summary.test.js
~~~

## 既有 b1a3b462 执行：不重跑、不追改裁决

仅复核已有材料：
/home/lionsol/.openclaw/ops/memory-engine/session-checkpoint-b1a3b462-ordinary-historical-20261020-r1-evidence/executor-structured-report.json
SHA256：7a0ea72e59b3993db5765b8f14e553cfa39c805375d3a480c3b5dbe0aca8396d。

明确 Run ID：
manual:7b40cc54-3c66-4183-a0f7-453e3e9cec00:1792812106739:1。
内外 ID 一致，action=finished，task_status=error、命令退出 1，
scheduler 调用 1，部署 1，执行器最终退出 2。
四条输入完整 24029 字符，零裁剪；Core 4/4；
一次 DeepSeek 请求成功，模型别名认证/语义正确性仍不由日志证明。
摘要已发布，旧摘要 .previous hash 与原文件一致。
Lance 新增 10，backlog 1810，fingerprint unverified，零写入/操作/冲突失败。
候选保留，没有数据库/代码恢复。原 argv 已恢复且 job disabled。

原卡要求 task_status=ok，因此其 INSUFFICIENT_EVIDENCE 原判保留；
本补丁没有事后放宽该卡、修改原报告或制造一个新 PASS。
run_identity_terminal_verified=false 是旧 evaluator 把 task_status=ok
也合进该字段的结果，不能解读成“Run ID 不明确/任务未终态”。
只按实际字段分别陈述：身份明确、终态 error、普通摘要已发布、
向量未收敛、语义存在以下发现。

仅“窗口关闭”不能证明 WSL/内核崩溃。
现有持久记录完整覆盖最终验收与 argv 恢复；窗口消失的具体原因未认证。
本轮没有修改终端配置或启动/关闭 WSL。

## 已保存摘要的人工语义审阅

范围仅为目标 smart-add 文件全部四个 session_flush 条目，
与已生成 episode 的正文及配置段逐项比较。不查询其他会话/数据库，
不使用真实 provider 重评，不重建或修改摘要。
本节只评估与保存输入的一致性，未重新验证其中转述的外部世界事实。

输入：
/home/lionsol/.openclaw/workspace/memory/smart-add/2026-10-20.md
SHA256：9b119fdc8c72918cbdc97d2000200b6d14cf71fc3c9b75c0827b2c33e903dbf6。
输出：
/home/lionsol/.openclaw/workspace/memory/episodes/2026-10-20.md
SHA256：9d97282da2e9e3a8480d0a1b0264f54a15bd209b345f8cc6584738ce704f8f33。

| 源条目后缀 | 主要内容 | 摘要审阅 |
| --- | --- | --- |
| 1779d2b5 | checkpoint 排查与修订；632、1241/56 验收；49 条复查；AutoRecall 核查 | 核心主题及后续误判修正有体现，但原因归纳过度概括 |
| bf9fdb7e | 03:00 硅基流动 LLM/embedding(dim2560)/vision 正常 | 未明确保留 |
| 63b7ae04 | 02:00 同上 | 未明确保留 |
| 1a1e7861 | 01:00 同上 | 未明确保留 |

具体发现：
1. 输出把 10-15/16/18/19 的占位统一归因于采集时序竞态。
   源中却分别说明：10-18/19 已能重跑恢复，而 10-15/16 重跑仍无
   可恢复对话。因此没有证据把四天均归为同一已证实原因。
2. 三条常规健康检查未在正文或配置段明确出现。
   与身份验收有关的 Gateway 正常，不能替代这些独立 provider 检查。
   四条输入完整送达模型不等于四条事实均被摘要覆盖。
3. MAX_LANCE=10 有源依据；1830/97.3% 属源中的旧历史快照，
   不应把它用作当前可回填队列或永久配置事实。
   当前执行记录的 backlog 是 1810，两者不能拼接或互相替代。
4. 正面证据：632/632、1241/1241 与 56/56 的验收结论；
   后续 entryId/identity 两项纠正；49 条尚无自然修复运行证据；
   AutoRecall 取消 PENDING，均有输入依据且主要区别保留。

人工结论：存在语义遗漏和因果归纳问题，不能认证“整日语义完整”。
机械发布成功与该结论并不冲突。
没有自动修改 episode、七条 configs 或已生成的其他产物；
这些历史内容若要人工修订，应另行明确授权，不能为刷新 PASS 重跑任务。
无需为此再启动模型比较或新的长会话架构。

## 提交命令（不含部署）

~~~bash
set -e
cd /home/lionsol/.devspace/worktrees/memory-engine-2fb7407c
test "$(git rev-parse HEAD)" = b1a3b46274f9c3508e78c62715d35d8d79027d98
test -z "$(git diff --cached --name-only)"
git add -- \
  bin/session-checkpoint.js \
  test/checkpoint-ordinary-publication-guard.test.cjs \
  test/session-flush-reconciliation.test.js \
  docs/session-checkpoint-vector-deferral-validation.md
git diff --cached --check
git diff --cached --stat
git commit -m "fix(checkpoint): separate capped vector backlog from process failure"
git rev-parse HEAD
git status --short
~~~

没有创建新执行卡，没有重用任何已消耗的执行额度。
本轮未修改安装代码或调度，不能将离线源码修复写成已上线。

# Checkpoint 只读预演与历史补跑

2026-11-06：新增历史转录补跑入口，复用 derived 摘要、原文快照、引用和失败批次续跑。

## 日常运行

`session-checkpoint.js --dry-run` 现在在 flush 前返回。它只读现有采集来源并计算实际请求的分批计划，不执行 flush、Core 索引、Engine/Lance 写入、模型请求或 episode/fallback 写入。它不模拟一次尚未发生的 flush，也不承诺这些已采集来源覆盖全部历史会话。

日常实跑发现目标日 smart-add 缺失时，只有在以下检查通过后，才写 `status: empty` 并成功退出：

- flush 成功；
- Core/Engine 原始记录读取完成，目标日没有采集记录，也没有无法归日的原始记录；
- sessions 目录的普通、reset、deleted 转录均读取成功，目标日没有待处理记录；
- 来源在发布时未变化；已有有效摘要不会被空白标记覆盖。

empty 表示本次检查的来源没有当日可摘要内容，不推断当天没有对话。读取失败、非法 JSON、缺少消息时间戳或发现未处理转录，不作为 empty 成功。已有 incomplete/fallback 标记可以在上述检查通过后替换，旧文件由既有发布函数备份。

空白 episode 的 sourceAudit 仅包含读取数、命中数、消息数和排除原因计数，不展开文件名或哈希。完整采集清单保存在不可变原文快照中，用该 snapshot ID 调用 memory_engine_get，purpose=acceptance 时返回 source_audit；默认 recall 不返回全量清单。

## 从备份补跑

使用实际 cron wrapper；它加载安装目录的 `checkpoint-summary.env`，也支持 `MEMORY_ENGINE_CHECKPOINT_ENV_FILE` 指定配置文件。

```bash
/bin/bash /home/lionsol/.openclaw/extensions/memory-engine/bin/run-session-checkpoint-direct.sh \
  --target-date 2026-10-21 \
  --replay-transcripts /home/lionsol/.openclaw/backups/session-gap-2026-11 \
  --dry-run
```

确认预演结果后，去掉 `--dry-run` 才实际生成。源码工作树验证时，可用工作树中的 wrapper，并将 `MEMORY_ENGINE_CHECKPOINT_ENV_FILE` 指向安装目录现有 env 文件。

补跑要求显式日期和 derived 模式。它不调用当前会话 flush、Core 索引、Engine 对账或 Lance 修复；写入范围是原文快照、批次进度、摘要归档、projection、episode 及既有发布备份。数据库对账完成情况不作为该入口的成功声明。

### 采集范围

- 读取指定目录下 `.jsonl`、`.jsonl.reset.*`、`.jsonl.deleted.*`，排除 `.trajectory.*` 产物及其归档副本，忽略 Markdown 等其他文件。
- 依据消息原始 timestamp 和 Asia/Shanghai（或配置业务时区）选日，不按文件名或文件修改时间归日。时间戳缺失、非法 JSON 或文件读取失败会报错，不默认归到今天。
- 独立会话中全部 user 消息都有明确 `[cron:…]` 前缀时，记为 cron 会话并从摘要输入排除。普通用户谈论 cron 不会被排除。审计清单保留每个读取文件的哈希和排除原因。
- 用户会话中的 user、assistant、tool、toolResult 消息均纳入。完整工具输出会增加批次数；这与旧采集路径只保留部分工具摘要的口径不同。
- 快照保存每条选中消息的原始 JSONL 行（含非文本内容）、文件名、行号及文件哈希。模型收到的是文字内容；无文字块时使用 content 的 JSON 表示。
- 同一 session 的相同 JSONL 行去重，保留所有物理位置；不同 session 的相同文字不合并。
- 原文先保存，再调用模型。使用现有成功批次缓存；相同输入再跑只请求未成功批次。实际提示词长度及每批 512 个来源单元共同决定分批，不能只用原文字符数估算。

### 真实备份预演（2026-11-06）

读取 `/home/lionsol/.openclaw/backups/session-gap-2026-11` 中 23 个文件，其中 15 个带明确 cron 标记的会话排除。下表单位是消息记录，不等同于 Core chunk 或旧采集条目。所有预演均为模型请求 0、文件写入 0、数据库写入 0；备份文件哈希未变化。

| 目标日 | 消息记录 | 模型来源文本字符 | 批次 |
| --- | ---: | ---: | ---: |
| 2026-10-21 | 267 | 496116 | 4 |
| 2026-10-22 | 110 | 339949 | 3 |
| 2026-10-23 | 0 | 0 | 0 |
| 2026-10-24 | 53 | 155209 | 1 |
| 2026-10-25 | 33 | 38381 | 1 |
| 2026-10-27 | 58 | 267738 | 2 |
| 2026-10-28 | 21 | 30515 | 1 |
| 2026-10-31 | 2 | 86 | 1 |
| 2026-11-02 | 29 | 39450 | 1 |
| 2026-11-04 | 0 | 0 | 0 |

10-23 在本备份目录中无非 cron 消息，不代表当天没有对话；该日已有 smart-add，不应据此覆盖已有摘要。11-04 另对现存 sessions 的 898 个文件以及数据库进行只读检查，数据库读取完成、采集记录为 0、非 cron 转录记录为 0。此处只记录输入检查，不曾实跑 empty 发布。

修复已同步至 extensions 安装目录，共 8 个运行文件；6 个旧文件已在 ops/memory-engine 保留副本并逐字节核对。安装后的 wrapper 完成 10-21 备份预演和 11-04 常规预演，均退出 0、flush 未执行、模型请求 0。检查 smart-add、episodes、checkpoint-sources、checkpoint-summary-jobs、checkpoint-archives、checkpoint-projections 的文件内容和修改时间，前后未变化。配置检查为 CONFIG_OK。相关 112 项测试通过，静态检查通过（889 个已跟踪文件）。

结果记录：`/home/lionsol/.openclaw/ops/memory-engine/checkpoint-replay-fix-20261106-result.json`。没有重启 Gateway 或修改 cron job 配置；cron 每次启动新 Node 进程会读取本次安装文件。

## 后续真实运行与 audit 修复（2026-11-06）

EDi 已完成 8 个缺失日期的真实补跑；本端读取归档核对了全部 88 个摘要条目，批次全部完成，引用可读。索引中八个 episode 的 chunk 数依次为：10-21=33、10-22=23、10-24=8、10-25=6、10-27=17、10-28=2、10-31=2、11-02=6。语义正确性仍标记 NOT_CERTIFIED。

11-04 正常空白天实跑成功，但旧版把全量 sourceAudit 写进正文，产生 164306 字节的 episode 和 105 个 Core chunk。核对发现清单中有 898 个文件，其中 678 个是 trajectory JSONL 产物。现已修复采集过滤、缩减正文审计内容，重新运行该日期并做增量索引：

| 项目 | 修复前 | 修复后 |
| --- | ---: | ---: |
| episode UTF-8 字节 | 164306 | 866 |
| Core chunk | 105 | 1 |
| FTS 行 | 未单独计数 | 1 |

新快照只读取 220 个候选转录，按文件名排除了 1198 个 trajectory 产物（含元文件），没有目标日消息。旧快照 bb9bb357ef8d0ec1e4aac5a0f016f6fefdea7da2a26392d40c3d2d24a895d2fd 及完整 898 项清单仍在，哈希校验通过。smart-add/2026-11-04.md 仍未生成，八份补跑摘要的索引 chunk 数未变。

当前超时设置已记录回源码工作树：

- 单批 CLI 600000ms，写在不含凭据的 checkpoint-summary.env.example 中；部署时保留机器本地 checkpoint-summary.env，勿覆盖代理等本地设置。
- session-checkpoint.js 整轮 deadline 为 1800000ms（30 分钟）。
- 外部 cron 设置为 noOutputTimeoutSeconds=900、timeoutSeconds=3600；静默超时必须大于单批 CLI 超时。外部调度配置不由 env 文件修改。

新增 npm run checkpoint（调用现有 wrapper）和 npm run sync-index:incremental（调用既有索引同步且不强制重建）作为运维入口。audit 修复已同步到 extensions，相关测试 113 项通过，静态检查通过（889 个已跟踪文件），运行文件与源码逐字节一致。源码尚未提交。

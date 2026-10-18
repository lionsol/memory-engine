# Stable Memory Identity：个人实验迁移与恢复

当前源码验收：PASS_WITH_FINDINGS。实际数据库尚未迁移，候选尚未安装。
本文是操作说明，不自动授权提交、写真实数据库或重启服务。

## 提交范围

提交已验收的 33 个文件（16 源文件、13 测试/脱敏 fixture、4 OpenSpec）
以及本文，共 34 个文件。以 CODEX_CANDIDATE_FREEZE.md 的路径清单
作为已验收文件列表；提交时检查实际 diff，不使用 git add .。

不提交 node_modules、CODEX_BRIEF.md、CODEX_REPORT.md、
CODEX_CANDIDATE_FREEZE.md、隔离 runner、临时数据库/日志、真实恢复清单
或已停止的 runtime 准备任务书。其他工作区修改保持原状。
原冻结 digest 留作历史验证证据；后续以实际源码 commit 标识版本。

## 已知验证范围

相关源码回归及静态检查已通过；33 个全量失败已与未修改基线对照，
未观察到候选新增失败。隔离加载执行已走过真实 SDK 导入、native
临时读写和 API 采集器注册断言，但整体隔离检查未通过并已停止。
不再扩充该 runner，也不把这些证据表述为完整 Gateway 验证通过。

## 最小迁移步骤

1. 准备可恢复的当前插件副本和 Engine SQLite 一致备份。
   使用 SQLite backup API；不要在 WAL 活跃时只复制 .sqlite 主文件。
2. 先对 Engine 备份的独立副本调用现有
   migrateStableMemoryIdentity(db, { manifestPath })，输入实际恢复清单。
   不创建新 CLI，不连接 provider，不写 Core 或真实 LanceDB。
3. 在副本中核对：清单为预期 129 条；映射与 recovered 实体对应；
   Engine/Core ID 不一致记录保留正确 alias；重复迁移不增加实体；
   36 条无源记忆保持 unknown_legacy，不猜测关联；
   613 条未知向量不触碰。迁移本身不重新 embedding。
4. 副本验证通过后，再单独执行真实切换：让相关数据库没有其他写入者，
   建立切换前一致恢复点，使用同一份已核对清单执行同一迁移函数，
   安装对应源码版本并恢复正常运行。该步骤需要 Owner 明确授权。
5. 用既有最小检查确认插件加载、数据库可读及迁移结果。
   全局 embedding 收敛不随迁移自动执行。

不用先做性能实验、provider 资格测试或新的验证框架。

## 迁移实际改变什么

现有入口位于 lib/db/stable-memory-identity.cjs。
它为 Engine 增加身份字段、身份/文档/映射/收敛 checkpoint 相关表及索引，
并建立恢复清单映射；Core 保持只读，LanceDB 历史向量不改写。
原来的未知记忆可以获得 unknown_legacy 占位身份，这不等于找到了来源。

注意：schema 初始化先于记录迁移事务。清单解析或记录迁移失败时，
新增 schema 可能仍然存在，不宣称整个操作已自动回滚。
任何冲突先停止，保留错误，不跳过冲突或另造身份继续。

## 恢复

失败后先让相关数据没有其他写入者，再恢复同一恢复点的 Engine 备份
和旧插件，随后恢复运行。不要在仍打开 SQLite 连接或存在旧 WAL/SHM
状态时直接覆盖主文件；由恢复操作统一处理数据库及其 sidecar。
不通过 DROP TABLE/手动清列来反向修补。

本轮迁移不写 LanceDB，因此无需为它另造向量回滚逻辑。
若后续另行执行回填或其他向量写入，则在那个操作前另做相应备份。
切换后的新数据不会自动包含在旧备份中；恢复前应明确要保留的内容。

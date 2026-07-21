# Runtime Sync

## 当前运行边界

memory-engine 的开发源码目录是：

```text
/home/lionsol/.openclaw/workspace/plugins/memory-engine
```

OpenClaw 当前安装并由 Gateway 加载的运行副本是：

```text
/home/lionsol/.openclaw/extensions/memory-engine
```

必须通过 cold operator inspection 读取当前安装路径：

```bash
openclaw plugins inspect memory-engine --json
```

读取返回值中的：

```text
install.installPath
plugin.rootDir
plugin.source
```

不要使用：

```bash
openclaw plugins inspect memory-engine --runtime --json
```

在 OpenClaw 2026.6.9 中，`--runtime` 会把插件导入当前 CLI 进程，而不是查询已经运行的 Gateway。默认 shell 中 CLI 使用 Node 22 / ABI 127，而 Gateway 使用 Node 24 / ABI 137；该命令可能产生错误的 ABI 结论并触发插件初始化。

## 为什么源码修改不会自动生效

开发目录和运行副本是两个独立目录。

因此：

```text
源码测试通过
!= Gateway 已运行新代码
```

运行身份必须同时绑定：

```text
reviewed source commit
source runtime-build identity
installed runtime-build identity
Gateway loaded runtime identity
```

当前统一 parity 工具是：

```bash
$HOME/.local/node24/bin/node \
  bin/build-runtime-source-parity-report.js \
  --source-root /home/lionsol/.openclaw/workspace/plugins/memory-engine \
  --runtime-root <cold-inspected-install.installPath> \
  --checked-at <canonical-UTC-ISO> \
  --pretty
```

健康结果必须是：

```text
source_runtime_equal=true
difference_count=0
```

## 禁止直接从工作仓库覆盖

不要把以下命令作为普通同步程序执行：

```bash
openclaw plugins install . --force
```

OpenClaw 2026.6.9 对本地目录执行递归复制，不排除：

```text
.git
node_modules
test
docs
reports
开发工具和临时目录
```

本地目录安装也不会重新安装 runtime dependencies，而是复制来源目录中现有的 `node_modules`。这会把开发目录大小、临时文件和最后一次 native build ABI 一起带入运行副本。

当前开发目录约 938 MB；直接复制不是可审计的生产同步策略。

## 禁止直接安装普通 npm archive

`npm pack` 可以排除 `.git` 和来源 `node_modules`，但不能直接把普通 archive 交给 OpenClaw 作为最终 native candidate。

OpenClaw 2026.6.9 的 archive dependency 安装使用：

```text
npm install --omit=dev --ignore-scripts
```

`better-sqlite3` 需要安装生命周期取得或构建 native binary。忽略 scripts 的 archive 安装不能证明 ABI 137 可用。

## 当前选定的同步模型

当前同步设计与已完成的离线 rehearsal 见：

```text
docs/smoke-tests/personal-runtime-remediation-authorization.md
docs/smoke-tests/personal-runtime-candidate-rehearsal-decision-20260721.md
docs/smoke-tests/personal-runtime-live-remediation-authorization-20260721.md
docs/smoke-tests/personal-runtime-live-remediation-decision-20260721.md
```

选定流程是：

```text
clean reviewed source
  -> npm pack
  -> 在独立目录解包
  -> 补入 exact package-lock.json
  -> Node 24 下 npm ci --omit=dev，允许受控 lifecycle scripts
  -> better-sqlite3 :memory: smoke
  -> disposable LanceDB smoke
  -> source/candidate parity=0
  -> 用 memory-engine-runtime-artifact-manifest-v1 精确绑定 candidate
  -> fresh C0/R0/D0 与安装前后数据身份门
  -> 单独明确授权后由 OpenClaw 从 dependency-complete candidate 目录安装
```

OpenClaw 命令必须由 Gateway 同一 Node 明确执行：

```bash
$HOME/.local/node24/bin/node \
  $HOME/.local/lib/node_modules/openclaw/openclaw.mjs \
  <command>
```

不要依赖 shell 当前的 `node` 或 `openclaw` shebang 解析结果。

## 安装命令不是纯文件复制

R6.4 隔离 rehearsal 证明，`openclaw plugins install` 会在 CLI 进程中导入 memory-engine，并可能初始化所选 OpenClaw state 下的 engine SQLite 与 LanceDB。

因此真实同步必须：

```text
先停止并 quiesce Gateway
先创建 D0
记录 install 前的 engine SQLite 与 LanceDB 身份
执行 install
在 Gateway 启动前重新记录并比较数据身份
任何未评审的语义数据变化都阻止启动
```

WAL/SHM housekeeping 必须单独记录，不能直接等同于逻辑数据变化。

## 安装时必须使用稳定 cwd

不能从将被替换的 runtime 目录执行安装或后续验证。R6.4 在 sandbox 中复现：安装成功替换 runtime 后，位于旧 runtime inode 内的 cwd 导致后续 CLI 报错：

```text
ENOENT: no such file or directory, uv_cwd
```

安装、rollback、inspect、parity 和 smoke 应从源码仓库根目录或 artifact root 等稳定目录执行。

## 配置等价门

首次 R6.5 live transaction 证明，OpenClaw `plugins install` 会更新 host bookkeeping 字段：

```text
meta.lastTouchedAt
```

该变化会破坏 exact-byte equality，但不改变 memory-engine、AutoRecall、Hybrid、active-memory、tool、channel、model 或 security 配置。首次事务仍按当时合同执行 stop/rollback，candidate 未由 Gateway 启动。

重试只能使用：

```bash
$HOME/.local/node24/bin/node \
  bin/build-config-semantic-equivalence-report.js \
  --before <fresh-C0> \
  --after <post-install-config> \
  --pretty
```

允许结果必须是：

```text
policy=memory-engine-config-semantic-equivalence-v1
status=exact_equal
```

或：

```text
policy=memory-engine-config-semantic-equivalence-v1
status=approved_host_metadata_change
changed_paths=[meta.lastTouchedAt]
unexpected_changed_paths=[]
canonical_semantic_equal=true
last_touched_at.before_valid=true
last_touched_at.after_valid=true
last_touched_at.monotonic=true
```

任何其他路径、逆序/非法时间戳、symlink config 或 semantic hash 差异仍然 rollback。

## 当前阶段

```text
B8-A7-R6.1 read-only baseline execution=PASSED
B8-A7-R6.1 baseline decision=BASELINE BLOCKED
B8-A7-R6.2 host activation boundary compatibility=PASSED / CLOSED
B8-A7-R6.3 runtime-remediation authorization design=PASSED / CLOSED
B8-A7-R6.4 offline candidate and rollback rehearsal=PASSED / CLOSED
B8-A7-R6.5 live remediation execution authorization packet=PASSED / CLOSED
B8-A7-R6.5 live remediation execution=ROLLED BACK / SAFE
candidate Gateway activation=NOT REACHED
old runtime restored=TRUE
configuration restored to exact C0=TRUE
memory data restored from D0=FALSE / NOT REQUIRED
B8-A7-R6.5.1 config semantic equivalence repair=IMPLEMENTED / EDI VERIFICATION PENDING
R6.5 live retry=NOT AUTHORIZED
explicit retry approval=NOT RECEIVED
offline candidate artifact=VALIDATED / FROZEN / EPHEMERAL
candidate artifact identity=0490e60741c8ef12c0a6a8e70a169c43bd6d81c8cd465f781b7d01c8b3244f42
final active runtime identity=86d04dd7b07bbd62948381f26dadd6b4e444b993ae7bdf6e535b0a5a8152f1f1
```

当前仍然禁止：

```text
live retry candidate install/reload=NOT AUTHORIZED
live retry configuration mutation=NOT AUTHORIZED
live retry Gateway stop/start/restart=NOT AUTHORIZED
fresh retry C0/R0/D0=NOT CREATED
live memory-data restoration=NOT AUTHORIZED
AutoRecall activation=NOT AUTHORIZED
production evidence activation=NOT AUTHORIZED
B8-A7 sustained runtime window=NOT AUTHORIZED
B8-B removal=NOT AUTHORIZED
```

## 运行同步后的必要验证

未来只有在 R6.5.1 独立验证、提交并获得新的精确 retry 授权后，才能再次验证：

```text
installed source/runtime parity=0
Gateway Node=v24.8.0
Gateway ABI=137
memoryEngine.sustainedRuntimePreflight registered and clean
memoryEngine.productionEvidenceHealthcheck registered
memory_engine registered
memory_engine_search registered
memory_engine_get registered
active-memory disabled by effective host policy
AutoRecall=false
KG=legacy_fallback
Recent=legacy_fallback
production evidence=false
A5 smoke=10/10
```

在这些证据完成前，不得声称 Gateway 已同步到 reviewed source。

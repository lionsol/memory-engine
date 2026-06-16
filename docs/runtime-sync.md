# Runtime Sync

当前目录就是 memory-engine 插件根目录。

OpenClaw 实际运行的是：

../../extensions/memory-engine

因此修改插件源码后，需要重新安装插件，将源码同步到运行时目录。

## 同步运行时副本

```bash
cd ~/.openclaw/workspace/plugins/memory-engine
openclaw plugins install . --force
```

## 验证同步是否成功
```bash
cd ~/.openclaw/workspace/plugins/memory-engine
diff -qr . ../../extensions/memory-engine \
  -x node_modules -x .git
```
## 正常情况下不应存在源码差异。

# 注意

以下目录职责不同：

* 当前目录（memory-engine 插件根）
   * 源码 / 开发目录
   * Git 管理
   * CodeGraph 索引目标
* ../../extensions/memory-engine
   * OpenClaw 运行时副本
   * gateway 实际加载目录

修改源码后如果未执行 plugins install --force，
可能出现：

测试通过但运行时未更新
Codex 修改源码但实际行为未变化
runtime / workspace 副本漂移

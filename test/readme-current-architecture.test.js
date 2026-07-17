import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const README = new URL("../README.md", import.meta.url);

function readReadme() {
  return readFileSync(README, "utf8");
}

test("README title does not freeze a release version", () => {
  const readme = readReadme();
  const heading = readme.split("\n", 1)[0];

  assert.equal(heading, "# Memory Engine for OpenClaw");
  assert.doesNotMatch(heading, /\bv?\d+\.\d+\.\d+\b/i);
  assert.match(readme, /发布版本以 Git tag 与 commit 为准/);
  assert.match(readme, /npm run version:status/);
  assert.match(readme, /docs\/release-version-policy\.md/);
});

test("README describes the current ownership and safety boundaries", () => {
  const readme = readReadme();

  for (const token of [
    "`memory-core` 之上的**增强与治理层**",
    "不占用 `plugins.slots.memory`",
    "Core DB 写保护",
    "Canonical action 边界",
    "检索不等于强化",
    "AutoRecall 默认关闭",
    "事件时间不可伪造",
    "源码不等于运行时",
    "memory_engine_search",
    "memory_engine_get",
    "Current-turn reinforcement allowlist",
  ]) {
    assert.equal(readme.includes(token), true, `missing current architecture token: ${token}`);
  }
});

test("README points algorithm details to current implementation sources", () => {
  const readme = readReadme();

  for (const token of [
    "多阶段、可配置的检索管线",
    "词法优先召回",
    "向量惰性启用",
    "RRF 融合",
    "可解释重排",
    "lib/recall/hybrid-search.js",
    "lib/recall/hybrid/fusion.js",
    "lib/config/defaults.js",
    "lib/memory-confidence.js",
    "README 故意不复制 `rrfK`、topK、阈值、boost 权重等具体数值",
  ]) {
    assert.equal(readme.includes(token), true, `missing algorithm source token: ${token}`);
  }
});

test("README excludes known stale architecture and ranking claims", () => {
  const readme = readReadme();

  for (const stale of [
    "OpenClaw Memory System v0.8.4",
    "4通道 RRF 融合",
    "6组正则路由",
    "0.7 \\cdot \\text{Sim}",
    "语义相似度低于 0.55",
    "心跳仅标记 `is_archived`",
  ]) {
    assert.equal(readme.includes(stale), false, `stale README claim must not return: ${stale}`);
  }
});

test("all local links in the root README resolve", () => {
  const readme = readReadme();
  const readmePath = fileURLToPath(README);
  const baseDir = dirname(readmePath);
  const links = [...readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);

  assert.ok(links.length > 0, "README should contain local links");

  for (const href of links) {
    if (/^(?:https?:|mailto:)/.test(href) || href.startsWith("#")) {
      continue;
    }

    const pathWithoutAnchor = decodeURIComponent(href.split("#", 1)[0]);
    const target = resolve(baseDir, pathWithoutAnchor || ".");
    assert.equal(existsSync(target), true, `broken README link: ${href}`);
  }
});

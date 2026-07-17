import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_README = new URL("../README.md", import.meta.url);
const DOCS_INDEX = new URL("../docs/README.md", import.meta.url);

function read(url) {
  return readFileSync(url, "utf8");
}

test("root README exposes the architecture and governance documentation index", () => {
  const readme = read(ROOT_README);

  assert.match(
    readme,
    /\[[^\]]*docs\/README\.md[^\]]*\]\(docs\/README\.md\)/,
    "README must link the canonical documentation index",
  );
});

test("documentation index defines authority levels and key governance entrypoints", () => {
  const index = read(DOCS_INDEX);

  for (const token of [
    "# Memory-engine 架构与治理文档索引",
    "Status: Current documentation index",
    "## 文档权威层级",
    "代码与自动化测试",
    "Accepted ADR / Current contract / Policy",
    "## 总体架构入口",
    "## 治理文档入口",
    "## 按任务选择阅读路径",
    "## 文档维护规则",
    "agent-memory-tool-strategy.md",
    "memory-entry-boundary-audit.md",
    "adr/event-time-ownership.md",
    "release-version-policy.md",
    "retrieval-answering-policy.md",
    "memory-quality-eval-mvp-v4.md",
    "human-annotation-gold-set.md",
    "smoke-tests/README.md",
  ]) {
    assert.equal(index.includes(token), true, `missing documentation index token: ${token}`);
  }
});

test("all local Markdown links in the documentation index resolve", () => {
  const index = read(DOCS_INDEX);
  const indexPath = fileURLToPath(DOCS_INDEX);
  const baseDir = dirname(indexPath);
  const links = [...index.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);

  assert.ok(links.length > 0, "documentation index should contain local links");

  for (const href of links) {
    if (/^(?:https?:|mailto:)/.test(href) || href.startsWith("#")) {
      continue;
    }

    const pathWithoutAnchor = decodeURIComponent(href.split("#", 1)[0]);
    const target = resolve(baseDir, pathWithoutAnchor);
    assert.equal(existsSync(target), true, `broken documentation index link: ${href}`);
  }
});

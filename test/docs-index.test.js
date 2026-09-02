import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS_INDEX = new URL("../docs/README.md", import.meta.url);

function read(url) {
  return readFileSync(url, "utf8");
}

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

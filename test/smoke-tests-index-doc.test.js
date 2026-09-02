import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const INDEX = new URL("../docs/smoke-tests/README.md", import.meta.url);

function readIndex() {
  return readFileSync(INDEX, "utf8");
}

test("all local links in the smoke-test index resolve", () => {
  const index = readIndex();
  const baseDir = dirname(fileURLToPath(INDEX));
  const links = [...index.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);

  assert.ok(links.length > 0, "smoke-test index should contain local links");

  for (const href of links) {
    if (/^(?:https?:|mailto:)/.test(href) || href.startsWith("#")) {
      continue;
    }

    const pathWithoutAnchor = decodeURIComponent(href.split("#", 1)[0]);
    const target = resolve(baseDir, pathWithoutAnchor);
    assert.equal(existsSync(target), true, `broken smoke-test index link: ${href}`);
  }
});

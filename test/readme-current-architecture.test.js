import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const README = new URL("../README.md", import.meta.url);

function readReadme() {
  return readFileSync(README, "utf8");
}

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

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { snapshotEpisode, publishEpisode } = require("../lib/checkpoint/episode-publication");
const { writeEpisodeFiles } = require("../lib/checkpoint/episode-writer");
const { withRuntime } = require("../lib/checkpoint/runtime");

async function fixture(run) {
  const root = fs.mkdtempSync(join(tmpdir(), "checkpoint-publication-review-"));
  const path = join(root, "2026-10-20.md");
  fs.writeFileSync(path, "OLD");
  try { await run({ root, path }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test("committed replacement remains published when lock cleanup fails", async () => {
  await fixture(({ path }) => {
    const original = fs.unlinkSync;
    fs.unlinkSync = target => {
      if (target === path + ".checkpoint.lock") throw Object.assign(new Error("fixture"), { code: "EACCES" });
      return original(target);
    };
    let result;
    try { result = publishEpisode(path, "NEW"); } finally { fs.unlinkSync = original; }
    assert.equal(fs.readFileSync(path, "utf8"), "NEW");
    assert.equal(result.published, true);
    assert.equal(result.cleanup_complete, false);
    assert.deepEqual(result.cleanup_errors, [{ operation: "remove_lock", code: "EACCES" }]);
    assert.equal(fs.readFileSync(result.backup, "utf8"), "OLD");
  });
});
test("cleanup failure does not obscure the original pre-commit source conflict", async () => {
  await fixture(({ path }) => {
    const original = fs.unlinkSync;
    fs.unlinkSync = target => {
      if (target === path + ".checkpoint.lock") throw Object.assign(new Error("fixture"), { code: "EACCES" });
      return original(target);
    };
    try {
      assert.throws(() => publishEpisode(path, "NEW", { unchanged: () => false }), error => {
        assert.equal(error.message, "source_version_changed");
        assert.equal(error.publication.published, false);
        assert.equal(error.publication.cleanup_complete, false);
        return true;
      });
    } finally { fs.unlinkSync = original; }
    assert.equal(fs.readFileSync(path, "utf8"), "OLD");
  });
});
test("absent episode stays published if temporary-link cleanup fails", async () => {
  await fixture(({ path }) => {
    fs.unlinkSync(path);
    const expected = snapshotEpisode(path);
    const original = fs.unlinkSync;
    fs.unlinkSync = target => {
      if (target.endsWith(".tmp")) throw Object.assign(new Error("fixture"), { code: "EACCES" });
      return original(target);
    };
    let result;
    try { result = publishEpisode(path, "NEW", { expected }); } finally { fs.unlinkSync = original; }
    assert.equal(fs.readFileSync(path, "utf8"), "NEW");
    assert.equal(result.published, true);
    assert.equal(result.cleanup_complete, false);
  });
});
test("optional mirror failure cannot report the committed episode as unmodified", async () => {
  await fixture(async ({ root, path }) => {
    const blocked = join(root, "not-a-directory");
    fs.writeFileSync(blocked, "BLOCK");
    const result = await withRuntime({ episodesDir: root, memoryDir: blocked,
      configJsonPath: join(root, "absent.json"), checkpointLegacyDailyMirror: true }, () =>
      writeEpisodeFiles({ episodeDate: "2026-10-20", generatedAt: "fixture",
        episodeText: "NEW", configs: [] }));
    assert.match(fs.readFileSync(path, "utf8"), /NEW/);
    assert.equal(result.published, true);
    assert.equal(result.mirror.status, "failed");
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  CONFIG_EQUIVALENCE_POLICY,
  buildConfigSemanticEquivalenceReport,
} = require("../bin/config-semantic-equivalence-lib.js");

const CLI = fileURLToPath(new URL("../bin/build-config-semantic-equivalence-report.js", import.meta.url));

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "config-semantic-equivalence-"));
  const before = resolve(root, "before.json");
  const after = resolve(root, "after.json");
  const base = {
    meta: { lastTouchedAt: "2026-07-19T08:01:53.000Z", version: "2026.6.9" },
    plugins: {
      allow: ["memory-engine"],
      entries: {
        "memory-engine": {
          enabled: true,
          config: { autoRecall: { enabled: false }, secret: "do-not-emit" },
        },
      },
    },
  };
  const write = (path, value) => {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);
  };
  write(before, base);
  write(after, base);
  return { root, before, after, base, write };
}

test("exact byte equality passes without approved metadata use", () => {
  const f = fixture();
  try {
    const report = buildConfigSemanticEquivalenceReport({
      beforePath: f.before,
      afterPath: f.after,
      checkedAt: "2026-07-21T12:00:00.000Z",
    });
    assert.equal(report.policy, CONFIG_EQUIVALENCE_POLICY);
    assert.equal(report.status, "exact_equal");
    assert.equal(report.valid, true);
    assert.equal(report.exact_byte_equal, true);
    assert.deepEqual(report.changed_paths, []);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("only monotonic meta.lastTouchedAt change is approved", () => {
  const f = fixture();
  try {
    f.write(f.after, {
      ...f.base,
      meta: { ...f.base.meta, lastTouchedAt: "2026-07-21T11:55:54.599Z" },
    });
    const report = buildConfigSemanticEquivalenceReport({
      beforePath: f.before,
      afterPath: f.after,
      checkedAt: "2026-07-21T12:00:00.000Z",
    });
    assert.equal(report.status, "approved_host_metadata_change");
    assert.equal(report.valid, true);
    assert.equal(report.exact_byte_equal, false);
    assert.equal(report.canonical_semantic_equal, true);
    assert.deepEqual(report.changed_paths, ["meta.lastTouchedAt"]);
    assert.equal(report.last_touched_at.monotonic, true);
    assert.deepEqual(report.errors, []);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("backward or malformed host timestamp fails closed", () => {
  const f = fixture();
  try {
    f.write(f.after, {
      ...f.base,
      meta: { ...f.base.meta, lastTouchedAt: "2026-07-18T00:00:00.000Z" },
    });
    const backward = buildConfigSemanticEquivalenceReport({
      beforePath: f.before,
      afterPath: f.after,
      checkedAt: "2026-07-21T12:00:00.000Z",
    });
    assert.equal(backward.valid, false);
    assert.equal(backward.status, "semantic_mismatch");
    assert.ok(backward.errors.includes("last_touched_at_not_monotonic"));

    f.write(f.after, {
      ...f.base,
      meta: { ...f.base.meta, lastTouchedAt: "not-a-time" },
    });
    const malformed = buildConfigSemanticEquivalenceReport({
      beforePath: f.before,
      afterPath: f.after,
      checkedAt: "2026-07-21T12:00:00.000Z",
    });
    assert.equal(malformed.valid, false);
    assert.ok(malformed.errors.includes("invalid_after_last_touched_at"));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("any operational config change fails without exposing values", () => {
  const f = fixture();
  try {
    f.write(f.after, {
      ...f.base,
      plugins: {
        ...f.base.plugins,
        entries: {
          "memory-engine": {
            ...f.base.plugins.entries["memory-engine"],
            config: {
              ...f.base.plugins.entries["memory-engine"].config,
              autoRecall: { enabled: true },
              secret: "changed-secret-must-not-emit",
            },
          },
        },
      },
    });
    const report = buildConfigSemanticEquivalenceReport({
      beforePath: f.before,
      afterPath: f.after,
      checkedAt: "2026-07-21T12:00:00.000Z",
    });
    assert.equal(report.valid, false);
    assert.equal(report.canonical_semantic_equal, false);
    assert.ok(report.unexpected_changed_paths.includes(
      "plugins.entries.memory-engine.config.autoRecall.enabled",
    ));
    assert.ok(report.unexpected_changed_paths.includes(
      "plugins.entries.memory-engine.config.secret",
    ));
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes("do-not-emit"), false);
    assert.equal(serialized.includes("changed-secret-must-not-emit"), false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("equal arrays do not produce false differences", () => {
  const f = fixture();
  try {
    const parsed = JSON.parse(readFileSync(f.before, "utf8"));
    f.write(f.after, parsed);
    const report = buildConfigSemanticEquivalenceReport({
      beforePath: f.before,
      afterPath: f.after,
      checkedAt: "2026-07-21T12:00:00.000Z",
    });
    assert.deepEqual(report.changed_paths, []);
    assert.equal(report.valid, true);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("symlink config inputs are rejected", () => {
  const f = fixture();
  try {
    const link = resolve(f.root, "before-link.json");
    symlinkSync(f.before, link);
    assert.throws(
      () => buildConfigSemanticEquivalenceReport({
        beforePath: link,
        afterPath: f.after,
        checkedAt: "2026-07-21T12:00:00.000Z",
      }),
      /must not be a symlink/,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("CLI writes owner-only report and returns mismatch status 2", () => {
  const f = fixture();
  try {
    const output = resolve(f.root, "report.json");
    f.write(f.after, {
      ...f.base,
      meta: { ...f.base.meta, lastTouchedAt: "2026-07-21T11:55:54.599Z" },
    });
    const pass = spawnSync(process.execPath, [
      CLI,
      "--before", f.before,
      "--after", f.after,
      "--checked-at", "2026-07-21T12:00:00.000Z",
      "--out", output,
      "--pretty",
    ], { encoding: "utf8" });
    assert.equal(pass.status, 0, pass.stderr);
    assert.equal(lstatSync(output).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(output, "utf8")).valid, true);

    f.write(f.after, { ...f.base, plugins: { allow: [] } });
    const mismatch = spawnSync(process.execPath, [
      CLI,
      "--before", f.before,
      "--after", f.after,
    ], { encoding: "utf8" });
    assert.equal(mismatch.status, 2);
    assert.equal(JSON.parse(mismatch.stdout).valid, false);

    const unknown = spawnSync(process.execPath, [CLI, "--unknown"], { encoding: "utf8" });
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /unknown argument/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

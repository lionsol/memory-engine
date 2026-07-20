import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeSync,
  linkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  MANIFEST_MAX_BYTES,
  MANIFEST_NAME,
  TEMP_PREFIX,
  canonicalJson,
  compareSyntheticFingerprints,
  createSyntheticManifest,
  fingerprintManifestArtifacts,
  fingerprintSyntheticTree,
  publishSyntheticManifestAtomic,
  readSyntheticManifestSnapshot,
  runSyntheticManifestSmoke,
} from "../lib/ops/synthetic-host-plugin-metadata-manifest.js";

const require = createRequire(import.meta.url);

function withRoot(callback, suffix = "fixture") {
  const root = mkdtempSync(path.join(tmpdir(), `${TEMP_PREFIX}${suffix}-`));
  try {
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeFinal(root, bytes) {
  const fd = openSync(path.join(root, MANIFEST_NAME), constants.O_CREAT | constants.O_WRONLY | constants.O_TRUNC, 0o600);
  writeSync(fd, bytes);
  closeSync(fd);
}

test("installed manifest publishes atomically and consumer is read-only", () => {
  withRoot((root) => {
    publishSyntheticManifestAtomic(root, createSyntheticManifest());
    const before = fingerprintSyntheticTree(root);
    const snapshot = readSyntheticManifestSnapshot(root);
    const after = fingerprintSyntheticTree(root);
    assert.equal(snapshot.valid, true);
    assert.equal(snapshot.installed, true);
    assert.equal(snapshot.plugin_id, "memory-engine");
    assert.equal(snapshot.observable_write_detected, false);
    assert.equal(compareSyntheticFingerprints(before, after).observable_write_detected, false);
  });
});

test("absent tombstone is valid and installed-to-absent replacement hides old install data", () => {
  withRoot((root) => {
    publishSyntheticManifestAtomic(root, createSyntheticManifest());
    publishSyntheticManifestAtomic(root, createSyntheticManifest({
      state: "absent",
      absent_reason: "uninstalled",
      generation: "2",
      publication_id: "b".repeat(64),
    }));
    const snapshot = readSyntheticManifestSnapshot(root);
    assert.equal(snapshot.valid, true);
    assert.equal(snapshot.installed, false);
    assert.equal(snapshot.state, "absent");
    assert.equal(snapshot.install_path, null);
    assert.equal(snapshot.generation, "2");
  });
});

test("orphan and interrupted temporary files are ignored and never promoted", () => {
  withRoot((root) => {
    publishSyntheticManifestAtomic(root, createSyntheticManifest());
    const orphan = path.join(root, `.${MANIFEST_NAME}.tmp-orphan`);
    writeFileForTest(orphan, "orphan");
    const fd = openSync(path.join(root, `.${MANIFEST_NAME}.tmp-partial`), constants.O_CREAT | constants.O_WRONLY, 0o600);
    writeSync(fd, Buffer.from("{\"schema_version\":1", "utf8"));
    closeSync(fd);
    assert.equal(readSyntheticManifestSnapshot(root).valid, true);
    assert.equal(existsSync(orphan), true);
    assert.equal(existsSync(path.join(root, `.${MANIFEST_NAME}.tmp-partial`)), true);
  });
});

test("publisher faults preserve the old canonical snapshot and clean temporary files", () => {
  for (const fault of ["after_temp_create", "after_temp_write", "after_temp_fsync", "before_rename"]) {
    withRoot((root) => {
      const first = createSyntheticManifest();
      publishSyntheticManifestAtomic(root, first);
      assert.throws(
        () => publishSyntheticManifestAtomic(root, createSyntheticManifest({ generation: "2", publication_id: "b".repeat(64) }), { fault }),
        new RegExp(`synthetic_publish_fault:${fault}`),
      );
      const snapshot = readSyntheticManifestSnapshot(root);
      assert.equal(snapshot.valid, true);
      assert.equal(snapshot.generation, "1");
      assert.deepEqual(readdirSync(root).filter((name) => name.includes(".tmp-")), []);
    }, `fault-${fault}`);
  }
});

test("replacement keeps old descriptor content while the final path exposes new content", () => {
  withRoot((root) => {
    publishSyntheticManifestAtomic(root, createSyntheticManifest());
    const finalPath = path.join(root, MANIFEST_NAME);
    const fd = openSync(finalPath, constants.O_RDONLY);
    publishSyntheticManifestAtomic(root, createSyntheticManifest({ generation: "2", publication_id: "b".repeat(64) }));
    const old = JSON.parse(readFileSync(fd, "utf8"));
    closeSync(fd);
    const current = readSyntheticManifestSnapshot(root);
    assert.equal(old.generation, "1");
    assert.equal(current.generation, "2");
  });
});

test("canonical and schema failures are rejected", () => {
  const cases = [
    ["invalid-json", "{"],
    ["duplicate-key", '{"schema_version":1,"schema_version":1}\n'],
    ["bom", `\ufeff${canonicalJson(createSyntheticManifest())}`],
    ["nul", `${canonicalJson(createSyntheticManifest())}\0`],
    ["non-canonical", JSON.stringify(createSyntheticManifest())],
    ["wrong-plugin", canonicalJson({ ...createSyntheticManifest(), plugin_id: "other" })],
  ];
  for (const [name, content] of cases) {
    withRoot((root) => {
      writeFinal(root, Buffer.from(content, "utf8"));
      const snapshot = readSyntheticManifestSnapshot(root);
      assert.equal(snapshot.valid, false, name);
      assert.ok(snapshot.blockers.length > 0, name);
      if (name === "duplicate-key") {
        assert.ok(snapshot.blockers.includes("manifest_duplicate_key"));
      }
    }, name);
  }
});

test("oversized, symlinked, and hardlinked final files fail closed", () => {
  withRoot((root) => {
    writeFinal(root, Buffer.alloc(MANIFEST_MAX_BYTES + 1, 0x20));
    assert.equal(readSyntheticManifestSnapshot(root).valid, false);
  }, "oversized");
  withRoot((root) => {
    const target = path.join(root, "target");
    writeFileForTest(target, canonicalJson(createSyntheticManifest()));
    symlinkSync(target, path.join(root, MANIFEST_NAME));
    const snapshot = readSyntheticManifestSnapshot(root);
    assert.equal(snapshot.valid, false);
    assert.ok(snapshot.blockers.includes("manifest_symlink"));
    assert.equal(snapshot.observable_write_detected, false);
  }, "symlink");
  withRoot((root) => {
    const source = path.join(root, "source");
    writeFileForTest(source, canonicalJson(createSyntheticManifest()));
    linkSync(source, path.join(root, MANIFEST_NAME));
    const snapshot = readSyntheticManifestSnapshot(root);
    assert.equal(snapshot.valid, false);
    assert.ok(snapshot.blockers.includes("manifest_link_count_invalid"));
  }, "hardlink");
});

test("negative smoke scenarios pass when their expected invalidity is observed", () => {
  const report = runSyntheticManifestSmoke();
  const malformed = report.scenarios.find((scenario) => scenario.id === "malformed-json");
  const duplicate = report.scenarios.find((scenario) => scenario.id === "duplicate-key");
  assert.equal(malformed.status, "PASS");
  assert.equal(malformed.expected_valid, false);
  assert.equal(malformed.actual_valid, false);
  assert.equal(malformed.expected_block, true);
  assert.equal(duplicate.status, "PASS");
  assert.equal(duplicate.actual_valid, false);
  assert.deepEqual(report.blockers, []);
});

test("consumer artifact fingerprints ignore unrelated sibling files", () => {
  withRoot((root) => {
    publishSyntheticManifestAtomic(root, createSyntheticManifest());
    const before = fingerprintManifestArtifacts(root);
    writeFileForTest(path.join(root, "metrics.log"), "not a manifest artifact");
    const after = fingerprintManifestArtifacts(root);
    assert.equal(compareSyntheticFingerprints(before, after).observable_write_detected, false);
  }, "fingerprint-scope");
});

function writeFileForTest(filePath, text) {
  const fd = openSync(filePath, constants.O_CREAT | constants.O_WRONLY | constants.O_TRUNC, 0o600);
  writeSync(fd, Buffer.from(text, "utf8"));
  closeSync(fd);
}

test("requiring the CommonJS smoke wrapper does not publish or read metadata", () => {
  const before = readdirSync(tmpdir()).filter((name) => name.startsWith(TEMP_PREFIX));
  const cli = require("../bin/run-host-plugin-metadata-manifest-smoke.js");
  assert.equal(typeof cli.main, "function");
  assert.deepEqual(readdirSync(tmpdir()).filter((name) => name.startsWith(TEMP_PREFIX)), before);
});

test("CLI rejects external paths before importing the library", () => {
  const cli = new URL("../bin/run-host-plugin-metadata-manifest-smoke.js", import.meta.url);
  const result = spawnSync(process.execPath, [cli.pathname, "--root", "/tmp/not-used"], { encoding: "utf8" });
  assert.equal(result.status, 64);
  assert.match(result.stderr, /unknown argument/);
});

test("synthetic smoke decision is conservative", () => {
  const cli = new URL("../bin/run-host-plugin-metadata-manifest-smoke.js", import.meta.url);
  const result = spawnSync(process.execPath, [cli.pathname, "--json"], { encoding: "utf8" });
  assert.ok([0, 1].includes(result.status));
  const report = JSON.parse(result.stdout);
  assert.match(report.decision, /^B8-A7-R3A synthetic manifest contract=/);
  assert.equal(report.production_authorized, false);
});

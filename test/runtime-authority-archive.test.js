import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createCanonicalArchive, extractCanonicalArchive, inspectCanonicalTar } from "../lib/runtime-authority/archive.js";
import { buildRuntimeArtifactManifestV2 } from "../bin/runtime-artifact-manifest-v2-lib.cjs";

function hash(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }

function tarHeader(name) {
  const header = Buffer.alloc(512); header.write(name, 0, "utf8"); header.write("0000644\0", 100, "ascii"); header.write("0000000\0", 108, "ascii"); header.write("0000000\0", 116, "ascii"); header.write("00000000000\0", 124, "ascii"); header.write("00000000000\0", 136, "ascii"); header[156] = 48; header.write("        ", 148, "ascii"); let sum = 0; for (const byte of header) sum += byte; header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii"); return header;
}

test("canonical POSIX pax archive is deterministic and preserves exact manifest identity", () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-authority-archive-"));
  const second = mkdtempSync(join(tmpdir(), "runtime-authority-archive-"));
  const out = mkdtempSync(join(tmpdir(), "runtime-authority-archive-out-"));
  try {
    for (const base of [root, second]) {
      mkdirSync(join(base, "nested"), { mode: 0o700 });
      writeFileSync(join(base, "nested", "value.txt"), "value\n", { mode: 0o400 });
      chmodSync(join(base, "nested"), 0o500);
      chmodSync(base, 0o700);
    }
    const archive1 = join(out, "one.tar");
    const archive2 = join(out, "two.tar");
    createCanonicalArchive({ root, archivePath: archive1, tarExecutable: "/usr/bin/tar" });
    utimesSync(join(second, "nested", "value.txt"), new Date("2030-01-01"), new Date("2030-01-01"));
    createCanonicalArchive({ root: second, archivePath: archive2, tarExecutable: "/usr/bin/tar" });
    assert.equal(hash(archive1), hash(archive2));
    const extracted = join(out, "extracted");
    mkdirSync(extracted, { mode: 0o700 });
    extractCanonicalArchive({ archivePath: archive1, destination: extracted, tarExecutable: "/usr/bin/tar" });
    const sourceManifest = buildRuntimeArtifactManifestV2({ rootDir: root, checkedAt: "1970-01-01T00:00:00.000Z" });
    const extractedManifest = buildRuntimeArtifactManifestV2({ rootDir: extracted, checkedAt: "1970-01-01T00:00:00.000Z" });
    assert.equal(sourceManifest.exact_identity, extractedManifest.exact_identity);
  } finally {
    for (const path of [root, second, out]) { try { rmSync(path, { recursive: true, force: true }); } catch {} }
  }
});

test("archive contract rejects special or external symlink entries before tar", () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-authority-archive-invalid-"));
  try {
    symlinkSync("/outside", join(root, "external"));
    assert.throws(() => createCanonicalArchive({ root, archivePath: join(root, "out.tar"), tarExecutable: "/usr/bin/tar" }), /invalid archive source/);
  } finally { try { rmSync(root, { recursive: true, force: true }); } catch {} }
});

test("canonical archive preserves internal symlinks, hardlinks, long paths and rejects archive traversal", () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-authority-archive-topology-"));
  const out = mkdtempSync(join(tmpdir(), "runtime-authority-archive-topology-out-"));
  try {
    const nested = join(root, "nested"); mkdirSync(nested); const longName = `${"long-".repeat(40)}.txt`;
    writeFileSync(join(nested, longName), "bytes\n", { mode: 0o400 });
    linkSync(join(nested, longName), join(nested, "hardlink.txt"));
    symlinkSync(longName, join(nested, "internal-link"));
    const archive = join(out, "topology.tar"); createCanonicalArchive({ root, archivePath: archive, tarExecutable: "/usr/bin/tar" });
    assert.ok(inspectCanonicalTar(archive).some(entry => entry.type === "1"));
    const extracted = join(out, "extracted"); mkdirSync(extracted); extractCanonicalArchive({ archivePath: archive, destination: extracted, tarExecutable: "/usr/bin/tar" });
    assert.equal(readFileSync(join(extracted, "nested", longName), "utf8"), "bytes\n");
    assert.equal(readFileSync(join(extracted, "nested", "hardlink.txt"), "utf8"), "bytes\n");
    assert.equal(readFileSync(join(extracted, "nested", "internal-link"), "utf8"), "bytes\n");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); }
});

test("archive extraction rejects absolute and parent-traversal entries before extraction", () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-authority-archive-malicious-"));
  try {
    const archive = join(root, "bad.tar"); writeFileSync(archive, Buffer.concat([tarHeader("../escape"), Buffer.alloc(1024)]));
    const destination = join(root, "destination"); mkdirSync(destination);
    assert.throws(() => extractCanonicalArchive({ archivePath: archive, destination, tarExecutable: "/usr/bin/tar" }), /unsafe archive entry/);
    assert.equal(readFileSync(archive).length, 1536);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

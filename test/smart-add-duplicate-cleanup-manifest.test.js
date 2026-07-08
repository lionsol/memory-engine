import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import previewCli from "../bin/preview-smart-add-duplicate-cleanup-candidates.js";
import manifestCli from "../bin/validate-smart-add-duplicate-cleanup-manifest.js";
import {
  createSmartAddDuplicateFixture,
  withSmartAddDuplicateEnv,
} from "./helpers/smart-add-duplicate-fixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const previewScriptPath = resolve(repoRoot, "bin/preview-smart-add-duplicate-cleanup-candidates.js");
const scriptPath = resolve(repoRoot, "bin/validate-smart-add-duplicate-cleanup-manifest.js");

const { runCleanupCandidatePreview } = previewCli;
const {
  parseArgs,
  validateCleanupManifestAgainstPreview,
  validateCleanupManifest,
  main,
} = manifestCli;

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "smart-add-cleanup-manifest-"));
}

function writeJson(dir, name, value) {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

async function captureConsole(fn) {
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const result = await fn();
    return { result, output: logs.join("\n"), error: errors.join("\n") };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

async function withManifestFixture(fn) {
  const fixture = createSmartAddDuplicateFixture();
  return withSmartAddDuplicateEnv(fixture, fn);
}

async function buildValidManifest() {
  const preview = await runCleanupCandidatePreview();
  const fallbackGroup = preview.groups[0];
  const groups = [
    {
      group_hash: preview.groups[0].group_hash,
      normalized_content_hash: preview.groups[0].normalized_content_hash,
      decision: "approve_delete_candidates",
      keep_chunk_id: preview.groups[0].suggested_keep_candidate.chunk_id,
      delete_chunk_ids: preview.groups[0].suggested_delete_candidates.map(candidate => candidate.chunk_id),
      reason: "adjacent raw_log duplicate with zero retrieval/injection",
    },
    {
      group_hash: (preview.groups[1] || fallbackGroup).group_hash,
      normalized_content_hash: (preview.groups[1] || fallbackGroup).normalized_content_hash,
      decision: "skip",
      keep_chunk_id: (preview.groups[1] || fallbackGroup).suggested_keep_candidate.chunk_id,
      delete_chunk_ids: [],
      reason: "skip fixture coverage",
    },
    {
      group_hash: (preview.groups[2] || fallbackGroup).group_hash,
      normalized_content_hash: (preview.groups[2] || fallbackGroup).normalized_content_hash,
      decision: "manual_review_required",
      keep_chunk_id: (preview.groups[2] || fallbackGroup).suggested_keep_candidate.chunk_id,
      delete_chunk_ids: [],
      reason: "manual review fixture coverage",
    },
  ];

  return {
    version: 1,
    kind: "smart_add_duplicate_cleanup_manifest",
    reviewed_at: "2026-06-30",
    reviewer: "manual",
    mode: "dry_run_only",
    groups,
  };
}

test("manifest validator CLI file exists", () => {
  assert.equal(existsSync(scriptPath), true);
});

test("parseArgs supports valid flags", () => {
  assert.deepEqual(parseArgs(["--manifest", "/tmp/example.json", "--json"]), {
    help: false,
    manifestPath: "/tmp/example.json",
    json: true,
    markdown: false,
  });
  assert.deepEqual(parseArgs(["--manifest", "/tmp/example.json", "--markdown"]), {
    help: false,
    manifestPath: "/tmp/example.json",
    json: false,
    markdown: true,
  });
  assert.deepEqual(parseArgs(["--help"]), {
    help: true,
    manifestPath: null,
    json: false,
    markdown: false,
  });
});

test("parseArgs rejects destructive flags", () => {
  for (const flag of [
    "--apply",
    "--fix",
    "--delete",
    "--archive",
    "--quarantine",
    "--backfill-confidence",
    "--write-db",
  ]) {
    assert.throws(() => parseArgs(["--manifest", "/tmp/example.json", flag]), /unsupported destructive flag/);
  }
});

test("validator source is read-only by construction", () => {
  const source = readFileSync(scriptPath, "utf8");
  assert.equal(source.includes("DELETE FROM"), false);
  assert.equal(source.includes("UPDATE "), false);
  assert.equal(source.includes("applyConfirmed"), false);
  assert.equal(source.includes("quarantine"), true);
  const previewSource = readFileSync(previewScriptPath, "utf8");
  assert.equal(previewSource.includes("execFileSync"), false);
});

test("valid fixture manifest passes and produces expected would_delete_count", async () => {
  const dir = makeTempDir();
  const fixture = createSmartAddDuplicateFixture();
  try {
    await withSmartAddDuplicateEnv(fixture, async () => {
      const manifest = await buildValidManifest();
      const manifestPath = writeJson(dir, "valid-manifest.json", manifest);
      const report = await validateCleanupManifest(manifestPath);
      assert.equal(report.summary.status, "pass");
      assert.equal(report.summary.approved_group_count, 1);
      assert.equal(report.summary.skipped_group_count, 1);
      assert.equal(report.summary.manual_review_required_group_count, 1);
      assert.equal(report.summary.rejected_group_count, 0);
      assert.equal(report.summary.would_delete_count, manifest.groups[0].delete_chunk_ids.length);
      assert.equal(report.would_keep.length, 1);
      assert.equal(report.would_delete.length, manifest.groups[0].delete_chunk_ids.length);
      assert.equal(report.errors.length, 0);
      for (const [key, value] of Object.entries(report.side_effects)) {
        assert.equal(value, false, key);
      }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown group hash fails", async () => {
  const dir = makeTempDir();
  try {
    await withManifestFixture(async () => {
      const manifest = await buildValidManifest();
      manifest.groups[0].group_hash = "missing-group";
      const report = await validateCleanupManifest(writeJson(dir, "unknown-group.json", manifest));
      assert.equal(report.summary.status, "fail");
      assert.equal(report.errors.some(error => error.includes("group_hash not found")), true);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mismatched normalized hash fails", async () => {
  const dir = makeTempDir();
  try {
    await withManifestFixture(async () => {
      const manifest = await buildValidManifest();
      manifest.groups[0].normalized_content_hash = "mismatch";
      const report = await validateCleanupManifest(writeJson(dir, "mismatch-hash.json", manifest));
      assert.equal(report.summary.status, "fail");
      assert.equal(report.errors.some(error => error.includes("normalized_content_hash mismatch")), true);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wrong keep chunk fails", async () => {
  const dir = makeTempDir();
  try {
    await withManifestFixture(async () => {
      const manifest = await buildValidManifest();
      manifest.groups[0].keep_chunk_id = "wrong-keep";
      const report = await validateCleanupManifest(writeJson(dir, "wrong-keep.json", manifest));
      assert.equal(report.summary.status, "fail");
      assert.equal(report.errors.some(error => error.includes("keep_chunk_id mismatch")), true);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid manifest shape reports each shape error once", async () => {
  const dir = makeTempDir();
  try {
    await withManifestFixture(async () => {
      const manifest = await buildValidManifest();
      manifest.version = 2;
      const report = await validateCleanupManifest(writeJson(dir, "invalid-shape.json", manifest));
      assert.equal(report.summary.status, "fail");
      assert.equal(report.errors.filter(error => error === "manifest version must be 1").length, 1);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown delete chunk fails", async () => {
  const dir = makeTempDir();
  try {
    await withManifestFixture(async () => {
      const manifest = await buildValidManifest();
      manifest.groups[0].delete_chunk_ids.push("missing-delete");
      const report = await validateCleanupManifest(writeJson(dir, "unknown-delete.json", manifest));
      assert.equal(report.summary.status, "fail");
      assert.equal(report.errors.some(error => error.includes("unknown delete_chunk_id")), true);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("duplicate delete chunk fails", async () => {
  const dir = makeTempDir();
  try {
    await withManifestFixture(async () => {
      const manifest = await buildValidManifest();
      manifest.groups[0].delete_chunk_ids.push(manifest.groups[0].delete_chunk_ids[0]);
      const report = await validateCleanupManifest(writeJson(dir, "duplicate-delete.json", manifest));
      assert.equal(report.summary.status, "fail");
      assert.equal(report.errors.some(error => error.includes("duplicate delete_chunk_id")), true);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skip and manual review groups do not produce deletes", async () => {
  const dir = makeTempDir();
  try {
    await withManifestFixture(async () => {
      const manifest = await buildValidManifest();
      manifest.groups = manifest.groups.slice(1);
      const report = await validateCleanupManifest(writeJson(dir, "no-approvals.json", manifest));
      assert.equal(report.summary.status, "pass");
      assert.equal(report.summary.approved_group_count, 0);
      assert.equal(report.summary.skipped_group_count, 1);
      assert.equal(report.summary.manual_review_required_group_count, 1);
      assert.equal(report.summary.would_delete_count, 0);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unsafe or missing current group cannot be approved", async () => {
  const dir = makeTempDir();
  try {
    await withManifestFixture(async () => {
      const manifest = await buildValidManifest();
      const preview = await runCleanupCandidatePreview();
      const unsafePreview = {
        ...preview,
        groups: preview.groups.map((group, index) => (
          index === 0
            ? {
                ...group,
                cleanup_eligibility: false,
              }
            : group
        )),
      };
      const report = validateCleanupManifestAgainstPreview(manifest, unsafePreview);
      assert.equal(report.summary.status, "fail");
      assert.equal(report.errors.some(error => error.includes("current group is not cleanup eligible")), true);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mixed invalid and valid approved groups still emit valid would_delete entries", async () => {
  await withManifestFixture(async () => {
    const manifest = await buildValidManifest();
    const preview = await runCleanupCandidatePreview();
    const validGroup = preview.groups[0];

    manifest.groups = [
      {
        ...manifest.groups[0],
        keep_chunk_id: "wrong-keep",
      },
      {
        group_hash: validGroup.group_hash,
        normalized_content_hash: validGroup.normalized_content_hash,
        decision: "approve_delete_candidates",
        keep_chunk_id: validGroup.suggested_keep_candidate.chunk_id,
        delete_chunk_ids: validGroup.suggested_delete_candidates.map(candidate => candidate.chunk_id),
        reason: "adjacent raw_log duplicate with zero retrieval/injection",
      },
    ];

    const report = validateCleanupManifestAgainstPreview(manifest, preview);
    assert.equal(report.summary.status, "fail");
    assert.equal(report.summary.rejected_group_count >= 1, true);
    assert.equal(report.summary.approved_group_count, 1);
    assert.equal(report.summary.would_delete_count, validGroup.suggested_delete_candidates.length);
    assert.equal(report.would_keep.length, 1);
    assert.equal(report.would_keep[0].chunk_id, validGroup.suggested_keep_candidate.chunk_id);
  });
});

test("CLI default JSON output parses successfully", async () => {
  const dir = makeTempDir();
  try {
    const fixture = createSmartAddDuplicateFixture();
    await withSmartAddDuplicateEnv(fixture, async () => {
      const manifest = await buildValidManifest();
      const manifestPath = writeJson(dir, "cli-valid.json", manifest);
      const result = spawnSync(process.execPath, [scriptPath, "--manifest", manifestPath], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          MEMORY_ENGINE_CORE_DB: fixture.corePath,
          MEMORY_ENGINE_DB: fixture.enginePath,
          MEMORY_ENGINE_DB_PATH: fixture.enginePath,
        },
      });
      assert.equal(result.status, 0);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.summary.status, "pass");
      assert.equal(parsed.summary.approved_group_count, 1);
      assert.equal(Array.isArray(parsed.would_delete), true);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("markdown output includes approved groups and would-delete section", async () => {
  const dir = makeTempDir();
  try {
    const fixture = createSmartAddDuplicateFixture();
    await withSmartAddDuplicateEnv(fixture, async () => {
      const manifest = await buildValidManifest();
      const manifestPath = writeJson(dir, "cli-markdown.json", manifest);
      const result = spawnSync(process.execPath, [scriptPath, "--manifest", manifestPath, "--markdown"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          MEMORY_ENGINE_CORE_DB: fixture.corePath,
          MEMORY_ENGINE_DB: fixture.enginePath,
          MEMORY_ENGINE_DB_PATH: fixture.enginePath,
        },
      });
      assert.equal(result.status, 0);
      assert.equal(result.stdout.includes("# Smart-Add Duplicate Cleanup Manifest Validation"), true);
      assert.equal(result.stdout.includes("## Would Delete"), true);
      assert.equal(result.stdout.includes("approved_group_count"), true);
      assert.equal(result.stdout.includes("group_hash:"), true);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI executable exits non-zero on invalid manifest", async () => {
  const dir = makeTempDir();
  try {
    const fixture = createSmartAddDuplicateFixture();
    await withSmartAddDuplicateEnv(fixture, async () => {
      const manifest = await buildValidManifest();
      manifest.groups[0].group_hash = "missing-group";
      const manifestPath = writeJson(dir, "invalid-cli.json", manifest);
      const result = spawnSync(process.execPath, [scriptPath, "--manifest", manifestPath], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          MEMORY_ENGINE_CORE_DB: fixture.corePath,
          MEMORY_ENGINE_DB: fixture.enginePath,
          MEMORY_ENGINE_DB_PATH: fixture.enginePath,
        },
      });
      assert.equal(result.status, 1);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

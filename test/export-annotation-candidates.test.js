import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { exportAnnotationCandidates } from "../lib/annotation/export-annotation-candidates.js";

function createFixtureDir() {
  return mkdtempSync(resolve(tmpdir(), "annotation-candidates-"));
}

function buildCandidateSource() {
  return {
    candidates: [
      {
        id: "m1",
        path: "memory/smart-add/2026-06-24.md",
        path_family: "smart-add",
        quality_scope_family: "smart_add",
        quality_scope_owner: "memory_engine_lifecycle",
        category: null,
        has_confidence_record: false,
        confidence: null,
        retrieved_count: 0,
        injected_count: 0,
        updated_at: 1719400000,
        text: "",
      },
      {
        id: "m2",
        path: "memory/episodes/2026-06-24.md",
        path_family: "episodes",
        quality_scope_family: "episode",
        quality_scope_owner: "memory_engine_lifecycle",
        category: "raw_log",
        has_confidence_record: true,
        confidence: 0.7,
        retrieved_count: 2,
        injected_count: 1,
        updated_at: 1719400001,
        text: "",
      },
      {
        id: "m3",
        path: "memory/dreaming/2026-06-25.md",
        path_family: "dreaming",
        quality_scope_family: "dreaming",
        quality_scope_owner: "memory_engine_lifecycle",
        category: "dreaming",
        has_confidence_record: true,
        confidence: 0.9,
        retrieved_count: 0,
        injected_count: 0,
        updated_at: 1719400002,
        text: "duplicate exact body",
      },
      {
        id: "m4",
        path: "memory/dreaming/2026-06-26.md",
        path_family: "dreaming",
        quality_scope_family: "dreaming",
        quality_scope_owner: "memory_engine_lifecycle",
        category: "dreaming",
        has_confidence_record: true,
        confidence: 0.4,
        retrieved_count: 0,
        injected_count: 0,
        updated_at: 1719400003,
        text: "duplicate exact body",
      },
      {
        id: "m5",
        path: "MEMORY.md",
        path_family: "memory-root",
        quality_scope_family: "curated_memory",
        quality_scope_owner: "memory_engine_legacy_or_manual",
        category: "project",
        has_confidence_record: true,
        confidence: 0.8,
        retrieved_count: 0,
        injected_count: 0,
        updated_at: 1719400004,
        text: "manual memory root item",
      },
      {
        id: "m6",
        path: "memory/misc.md",
        path_family: "memory-other",
        quality_scope_family: "raw_log",
        quality_scope_owner: "raw_or_legacy",
        category: "project",
        has_confidence_record: true,
        confidence: 0.6,
        retrieved_count: 0,
        injected_count: 0,
        updated_at: 1719400005,
        text: "misc memory other",
      },
      {
        id: "m7",
        path: "memory/dreaming/2026-06-27.md",
        path_family: "dreaming",
        quality_scope_family: "dreaming",
        quality_scope_owner: "memory_engine_lifecycle",
        category: "dreaming",
        has_confidence_record: true,
        confidence: 0.7,
        retrieved_count: 0,
        injected_count: 0,
        updated_at: 1719400006,
        text: "# Deep Sleep\nRepaired recall artifacts\nRanked 2 candidates for durable promotion\nPromoted 1 candidate into MEMORY.md",
      },
      {
        id: "m8",
        path: "memory/dreaming/2026-06-28.md",
        path_family: "dreaming",
        quality_scope_family: "dreaming",
        quality_scope_owner: "memory_engine_lifecycle",
        category: "dreaming",
        has_confidence_record: true,
        confidence: 0.65,
        retrieved_count: 0,
        injected_count: 0,
        updated_at: 1719400007,
        text: "- Candidate: durable memory candidate\nconfidence: 0.72\nevidence: seen in recalls\nstatus: staged",
      },
      {
        id: "m9",
        path: "memory/dreaming/2026-06-29.md",
        path_family: "dreaming",
        quality_scope_family: "dreaming",
        quality_scope_owner: "memory_engine_lifecycle",
        category: "dreaming",
        has_confidence_record: true,
        confidence: 0.5,
        retrieved_count: 0,
        injected_count: 0,
        updated_at: 1719400008,
        text: "# Deep Sleep\nProcess exited with code 1\nRepaired recall artifacts",
      },
    ],
    chunk_text_by_id: {
      m1: "User: 昨天做了什么\nAssistant: Tool output stdout\n## 2026-06-23_foo\nlong enough to preview",
      m2: "User: hello\nAssistant: there\nraw log content",
      m3: "duplicate exact body from chunk join",
      m4: "duplicate exact body from chunk join",
      m5: "manual memory root item from chunk join",
      m7: "# Deep Sleep\nRepaired recall artifacts\nRanked 2 candidates for durable promotion\nPromoted 1 candidate into MEMORY.md",
      m8: "- Candidate: durable memory candidate\nconfidence: 0.72\nevidence: seen in recalls\nstatus: staged",
      m9: "# Deep Sleep\nProcess exited with code 1\nRepaired recall artifacts",
    },
  };
}

test("content_preview comes from joined chunk text and annotation fields stay empty", () => {
  const dir = createFixtureDir();
  const outPath = resolve(dir, "annotation.jsonl");
  const fixture = buildCandidateSource();
  const report = exportAnnotationCandidates({
    out: outPath,
    limit: 10,
    format: "jsonl",
    collector: () => ({ candidates: fixture.candidates }),
    chunkTextResolver: (ids) => new Map(ids.map(id => {
      const value = fixture.chunk_text_by_id[id];
      if (Object.hasOwn(fixture.chunk_text_by_id, id)) {
        return [id, {
          found: true,
          text: value,
          missing_reason: String(value || "").trim() ? null : "text_column_empty",
        }];
      }
      return [id, { found: false, text: null, missing_reason: "chunk_not_found" }];
    })),
    now: new Date("2026-06-26T12:00:00.000Z"),
  });

  assert.equal(report.mode, "dry_run");
  assert.equal(report.write_db, false);
  assert.equal(report.annotation_side_effects, false);
  assert.equal(existsSync(outPath), true);

  const lines = readFileSync(outPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const sample = lines.find(item => item.memory_id === "m1");
  assert.equal(Boolean(sample), true);
  assert.equal(sample.sample_type, "memory");
  assert.equal(sample.content_preview.includes("Tool output stdout"), true);
  assert.deepEqual(sample.annotation, {
    quality: null,
    currency: null,
    auto_recall_eligible: null,
    preferred_action: null,
    notes: null,
  });
  assert.equal(sample.sample_buckets.includes("missing_category"), true);
  assert.equal(sample.sample_buckets.includes("raw_log_leak"), true);
  assert.equal(sample.primary_bucket, "raw_log_leak");
});

test("--preview-chars truncates preview to requested length", () => {
  const dir = createFixtureDir();
  const outPath = resolve(dir, "annotation.jsonl");
  const fixture = buildCandidateSource();
  exportAnnotationCandidates({
    out: outPath,
    limit: 2,
    format: "jsonl",
    previewChars: 20,
    collector: () => ({ candidates: fixture.candidates }),
    chunkTextResolver: (ids) => new Map(ids.map(id => [id, {
      found: true,
      text: fixture.chunk_text_by_id[id] || "fallback chunk text",
      missing_reason: null,
    }])),
  });

  const lines = readFileSync(outPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(lines[0].content_preview.length <= 20, true);
});

test("missing joined text sets content_missing_reason", () => {
  const dir = createFixtureDir();
  const outPath = resolve(dir, "annotation.jsonl");
  const fixture = buildCandidateSource();
  exportAnnotationCandidates({
    out: outPath,
    limit: 10,
    format: "jsonl",
    collector: () => ({ candidates: fixture.candidates }),
    chunkTextResolver: (ids) => new Map(ids.map(id => [id, {
      found: Object.hasOwn(fixture.chunk_text_by_id, id),
      text: fixture.chunk_text_by_id[id] || null,
      missing_reason: Object.hasOwn(fixture.chunk_text_by_id, id) ? null : "chunk_not_found",
    }])),
  });

  const lines = readFileSync(outPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const missing = lines.find(item => item.memory_id === "m6");
  assert.equal(Boolean(missing), true);
  assert.equal(missing.content_preview, "");
  assert.equal(missing.content_missing_reason, "chunk_not_found");
});

test("--per-bucket-limit avoids single-bucket domination and emits bucket fields", () => {
  const dir = createFixtureDir();
  const outPath = resolve(dir, "annotation.jsonl");
  const fixture = buildCandidateSource();
  const report = exportAnnotationCandidates({
    out: outPath,
    limit: 4,
    perBucketLimit: 1,
    format: "jsonl",
    collector: () => ({ candidates: fixture.candidates }),
    chunkTextResolver: (ids) => new Map(ids.map(id => [id, {
      found: true,
      text: fixture.chunk_text_by_id[id] || `chunk:${id}`,
      missing_reason: null,
    }])),
  });

  const lines = readFileSync(outPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(lines.length, 4);
  const primaryBuckets = new Set(lines.map(item => item.primary_bucket));
  assert.equal(primaryBuckets.size > 1, true);
  for (const sample of lines) {
    assert.equal(typeof sample.primary_bucket, "string");
    assert.equal(Array.isArray(sample.sample_buckets), true);
    assert.equal(typeof sample.risk_score, "number");
  }
  assert.equal(report.bucket_counts.raw_log_leak >= 1, true);
  assert.equal(
    report.bucket_counts.dreaming_duplicate >= 1
      || report.bucket_counts.dreaming_maintenance_log >= 1
      || report.bucket_counts.dreaming_candidate_staging >= 1,
    true
  );
});

test("primary_bucket prefers dreaming_duplicate over duplicate_exact and missing_category", () => {
  const dir = createFixtureDir();
  const outPath = resolve(dir, "annotation.jsonl");
  const fixture = buildCandidateSource();
  exportAnnotationCandidates({
    out: outPath,
    limit: 10,
    format: "jsonl",
    collector: () => ({ candidates: fixture.candidates }),
    chunkTextResolver: (ids) => new Map(ids.map(id => [id, {
      found: true,
      text: fixture.chunk_text_by_id[id] || `chunk:${id}`,
      missing_reason: null,
    }])),
  });

  const lines = readFileSync(outPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const dreamingDup = lines.find(item => item.memory_id === "m3");
  assert.equal(Boolean(dreamingDup), true);
  assert.equal(dreamingDup.sample_buckets.includes("duplicate_exact"), true);
  assert.equal(dreamingDup.sample_buckets.includes("dreaming_duplicate"), true);
  assert.equal(dreamingDup.sample_buckets.includes("never_retrieved"), true);
  assert.equal(dreamingDup.primary_bucket, "dreaming_duplicate");
});

test("Deep Sleep maintenance log is classified as dreaming_maintenance_log", () => {
  const dir = createFixtureDir();
  const outPath = resolve(dir, "annotation.jsonl");
  const fixture = buildCandidateSource();
  exportAnnotationCandidates({
    out: outPath,
    limit: 20,
    format: "jsonl",
    collector: () => ({ candidates: fixture.candidates }),
    chunkTextResolver: (ids) => new Map(ids.map(id => [id, {
      found: true,
      text: fixture.chunk_text_by_id[id] || `chunk:${id}`,
      missing_reason: null,
    }])),
  });

  const lines = readFileSync(outPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const sample = lines.find(item => item.memory_id === "m7");
  assert.equal(Boolean(sample), true);
  assert.equal(sample.sample_buckets.includes("dreaming_maintenance_log"), true);
  assert.equal(sample.primary_bucket, "dreaming_maintenance_log");
});

test("maintenance detector matches candidate(s) promotion phrases", () => {
  const dir = createFixtureDir();
  const outPath = resolve(dir, "annotation.jsonl");
  const fixture = {
    candidates: [{
      id: "maint-candidate-s",
      path: "memory/dreaming/2026-06-30.md",
      path_family: "dreaming",
      quality_scope_family: "dreaming",
      quality_scope_owner: "memory_engine_lifecycle",
      category: "dreaming",
      has_confidence_record: true,
      confidence: 0.5,
      retrieved_count: 0,
      injected_count: 0,
      updated_at: 1719400011,
      text: "",
    }],
    chunk_text_by_id: {
      "maint-candidate-s": "# Deep Sleep\nRepaired recall artifacts\nRanked 10 candidate(s) for durable promotion\nPromoted 1 candidate(s) into MEMORY.md",
    },
  };
  exportAnnotationCandidates({
    out: outPath,
    limit: 10,
    format: "jsonl",
    collector: () => ({ candidates: fixture.candidates }),
    chunkTextResolver: (ids) => new Map(ids.map(id => [id, {
      found: true,
      text: fixture.chunk_text_by_id[id] || "",
      missing_reason: null,
    }])),
  });

  const lines = readFileSync(outPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].sample_buckets.includes("dreaming_maintenance_log"), true);
  assert.equal(lines[0].primary_bucket, "dreaming_maintenance_log");
});

test("candidate staging record is classified as dreaming_candidate_staging", () => {
  const dir = createFixtureDir();
  const outPath = resolve(dir, "annotation.jsonl");
  const fixture = buildCandidateSource();
  exportAnnotationCandidates({
    out: outPath,
    limit: 20,
    format: "jsonl",
    collector: () => ({ candidates: fixture.candidates }),
    chunkTextResolver: (ids) => new Map(ids.map(id => [id, {
      found: true,
      text: fixture.chunk_text_by_id[id] || `chunk:${id}`,
      missing_reason: null,
    }])),
  });

  const lines = readFileSync(outPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const sample = lines.find(item => item.memory_id === "m8");
  assert.equal(Boolean(sample), true);
  assert.equal(sample.sample_buckets.includes("dreaming_candidate_staging"), true);
  assert.equal(sample.primary_bucket, "dreaming_candidate_staging");
});

test("suspected_tool_output still has higher priority than dreaming maintenance buckets", () => {
  const dir = createFixtureDir();
  const outPath = resolve(dir, "annotation.jsonl");
  const fixture = buildCandidateSource();
  exportAnnotationCandidates({
    out: outPath,
    limit: 20,
    format: "jsonl",
    collector: () => ({ candidates: fixture.candidates }),
    chunkTextResolver: (ids) => new Map(ids.map(id => [id, {
      found: true,
      text: fixture.chunk_text_by_id[id] || `chunk:${id}`,
      missing_reason: null,
    }])),
  });

  const lines = readFileSync(outPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const sample = lines.find(item => item.memory_id === "m9");
  assert.equal(Boolean(sample), true);
  assert.equal(sample.sample_buckets.includes("dreaming_maintenance_log"), true);
  assert.equal(sample.sample_buckets.includes("suspected_tool_output"), true);
  assert.equal(sample.primary_bucket, "suspected_tool_output");
});

test("primary_bucket falls back to missing_category when only missing buckets apply", () => {
  const dir = createFixtureDir();
  const outPath = resolve(dir, "annotation.jsonl");
  const fixture = {
    candidates: [
      {
        id: "only-missing",
        path: "memory/smart-add/2026-06-28.md",
        path_family: "smart-add",
        quality_scope_family: "smart_add",
        quality_scope_owner: "memory_engine_lifecycle",
        category: null,
        has_confidence_record: false,
        confidence: null,
        retrieved_count: 3,
        injected_count: 0,
        updated_at: 1719400010,
        text: "",
      },
    ],
  };
  exportAnnotationCandidates({
    out: outPath,
    limit: 10,
    format: "jsonl",
    collector: () => fixture,
    chunkTextResolver: (ids) => new Map(ids.map(id => [id, {
      found: true,
      text: "plain clean content without raw log leak or duplicate",
      missing_reason: null,
    }])),
  });

  const lines = readFileSync(outPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].sample_buckets.includes("missing_category"), true);
  assert.equal(lines[0].sample_buckets.includes("missing_confidence"), true);
  assert.equal(lines[0].primary_bucket, "missing_category");
});

test("CLI remains dry-run/read-only and does not attempt INSERT UPDATE DELETE", () => {
  const dir = createFixtureDir();
  const fixturePath = resolve(dir, "fixture.json");
  const outPath = resolve(dir, "annotation.md");
  writeFileSync(fixturePath, JSON.stringify(buildCandidateSource()), "utf8");

  const result = spawnSync(process.execPath, [
    resolve(process.cwd(), "bin/export-annotation-candidates.js"),
    "--format", "md",
    "--limit", "3",
    "--per-bucket-limit", "1",
    "--preview-chars", "80",
    "--out", outPath,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      MEMORY_ENGINE_ANNOTATION_CANDIDATE_FIXTURE_PATH: fixturePath,
    },
  });

  assert.equal(result.status, 0);
  assert.equal(existsSync(outPath), true);
  assert.equal(Boolean(String(result.stderr || "").trim()), false);
  assert.equal(/INSERT|UPDATE|DELETE/.test(String(result.stdout || "")), false);
  const markdown = readFileSync(outPath, "utf8");
  assert.equal(markdown.includes("sample_type: memory"), true);
  assert.equal(markdown.includes("primary_bucket:"), true);
  assert.equal(markdown.includes("risk_score:"), true);
});

test("include-buckets returns only requested bucket samples and keeps previews non-empty", () => {
  const dir = createFixtureDir();
  const outPath = resolve(dir, "dreaming-duplicate.jsonl");
  const fixture = buildCandidateSource();

  const report = exportAnnotationCandidates({
    out: outPath,
    limit: 10,
    perBucketLimit: 10,
    includeBuckets: ["dreaming_duplicate"],
    format: "jsonl",
    collector: () => ({ candidates: fixture.candidates }),
    chunkTextResolver: (ids) => new Map(ids.map(id => [id, {
      found: true,
      text: fixture.chunk_text_by_id[id] || `chunk:${id}`,
      missing_reason: null,
    }])),
  });

  const lines = readFileSync(outPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(lines.length >= 1, true);
  for (const row of lines) {
    assert.equal(row.sample_buckets.includes("dreaming_duplicate"), true);
    assert.equal(Boolean(row.content_preview), true);
  }
  assert.deepEqual(report.include_buckets, ["dreaming_duplicate"]);
  assert.deepEqual(report.exclude_buckets, []);
  assert.equal(report.write_db, false);
  assert.equal(report.annotation_side_effects, false);
  assert.equal(report.reinforcement_side_effects, false);
});

test("CLI include-buckets remains read-only and rejects destructive side effects", () => {
  const dir = createFixtureDir();
  const fixturePath = resolve(dir, "fixture.json");
  const outPath = resolve(dir, "dreaming-duplicate.md");
  writeFileSync(fixturePath, JSON.stringify(buildCandidateSource()), "utf8");

  const result = spawnSync(process.execPath, [
    resolve(process.cwd(), "bin/export-annotation-candidates.js"),
    "--include-buckets", "dreaming_duplicate",
    "--format", "md",
    "--limit", "5",
    "--per-bucket-limit", "5",
    "--out", outPath,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      MEMORY_ENGINE_ANNOTATION_CANDIDATE_FIXTURE_PATH: fixturePath,
    },
  });

  assert.equal(result.status, 0);
  assert.equal(existsSync(outPath), true);
  assert.equal(/INSERT|UPDATE|DELETE/.test(String(result.stdout || "")), false);
  const rows = readFileSync(outPath, "utf8");
  assert.equal(rows.includes("dreaming_duplicate"), true);
});

test("docs define memory turn injection schemas and forbid direct reinforcement trigger", () => {
  const content = readFileSync(resolve(process.cwd(), "docs/human-annotation-gold-set.md"), "utf8");
  assert.equal(content.includes("## Memory-Level Schema"), true);
  assert.equal(content.includes("## Turn-Level Schema"), true);
  assert.equal(content.includes("## Injection-Level Schema"), true);
  assert.equal(content.includes("人工标注结果也不直接触发 reinforcement"), true);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  extractCategoryFromText,
  inferCategoryFromChunk,
  inferCategoryFromPath,
} from "../lib/category-inference.js";

test("inferCategoryFromPath covers stable managed and external path rules", () => {
  assert.equal(inferCategoryFromPath("memory.md"), "core_profile");
  assert.equal(inferCategoryFromPath("memory/projects/roadmap.md"), "project");
  assert.equal(inferCategoryFromPath("memory/2026-06-08.md"), "daily_journal");
  assert.equal(inferCategoryFromPath("memory/dreaming/night.md"), "dreaming");
  assert.equal(inferCategoryFromPath("memory/stats-history.md"), "stats");
  assert.equal(inferCategoryFromPath("memory/episodes/e1.md"), "episodic");
  assert.equal(inferCategoryFromPath("memory/smart-add/2026-06-08.md"), "raw_log");
  assert.equal(inferCategoryFromPath("docs/other.md"), "external");
});

test("extractCategoryFromText reads Category header case-insensitively", () => {
  assert.equal(
    extractCategoryFromText("Title\nCategory: Episodic\nbody"),
    "episodic"
  );
  assert.equal(extractCategoryFromText("no category here"), "");
});

test("inferCategoryFromChunk keeps caller fallback semantics via allowCategory", () => {
  assert.equal(
    inferCategoryFromChunk("docs/other.md", "Category: project", {
      fallback: "raw_log",
      allowCategory: category => ["raw_log", "episodic", "project"].includes(category),
    }),
    "project"
  );
  assert.equal(
    inferCategoryFromChunk("docs/other.md", "Category: unknown_bucket", {
      fallback: "raw_log",
      allowCategory: category => ["raw_log", "episodic", "project"].includes(category),
    }),
    "raw_log"
  );
  assert.equal(
    inferCategoryFromChunk("docs/other.md", "Category: external", {
      fallback: "external",
      allowCategory: category => ["external", "daily_journal"].includes(category),
    }),
    "external"
  );
});

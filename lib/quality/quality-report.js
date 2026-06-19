import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function toIsoString(value) {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function summarizeItems(items) {
  const summary = {
    total_items: items.length,
    grades: {},
    suggested_actions: {},
    flagged_items: 0,
  };

  for (const item of items) {
    const grade = String(item.grade || "unknown");
    const action = String(item.suggested_action || "unknown");
    summary.grades[grade] = (summary.grades[grade] || 0) + 1;
    summary.suggested_actions[action] = (summary.suggested_actions[action] || 0) + 1;
    if ((item.flags || []).length > 0) summary.flagged_items += 1;
  }

  return summary;
}

function incrementNestedCount(map, key, item) {
  const name = String(key ?? "unknown");
  if (!map[name]) {
    map[name] = {
      count: 0,
      grades: {},
      suggested_actions: {},
    };
  }
  map[name].count += 1;
  const grade = String(item.grade || "unknown");
  const action = String(item.suggested_action || "unknown");
  map[name].grades[grade] = (map[name].grades[grade] || 0) + 1;
  map[name].suggested_actions[action] = (map[name].suggested_actions[action] || 0) + 1;
}

function buildBreakdowns(items) {
  const by_category = {};
  const by_path_family = {};
  const by_path_prefix = {};
  const by_source = {};

  for (const item of items) {
    incrementNestedCount(by_category, item.category || "unknown", item);
    incrementNestedCount(by_path_family, item.path_family || "unknown", item);
    const pathPrefix = String(item.path || "").split("/").slice(0, 2).join("/") || String(item.path || "unknown");
    incrementNestedCount(by_path_prefix, pathPrefix, item);
    incrementNestedCount(by_source, item.source || "unknown", item);
  }

  return {
    by_category,
    by_path_family,
    by_path_prefix,
    by_source,
  };
}

function buildDuplicateGroups(items) {
  const groups = new Map();

  for (const item of items) {
    if (!(item.flags || []).includes("duplicate_exact")) continue;
    const key = normalizeText(item.text);
    if (!key) continue;
    const entry = groups.get(key) ?? [];
    entry.push(item);
    groups.set(key, entry);
  }

  return Array.from(groups.entries()).map(([key, members], index) => ({
    group_id: `duplicate-exact-${index + 1}`,
    normalized_text: key,
    count: members.length,
    paths: members.map(item => item.path),
    item_ids: members.map(item => item.id),
    suggested_action: "dedupe_candidate",
  })).filter(group => group.count > 1);
}

function rankWorstItems(items, topN) {
  return [...items]
    .sort((a, b) => (
      a.score - b.score ||
      (b.flags || []).length - (a.flags || []).length ||
      String(a.path || "").localeCompare(String(b.path || "")) ||
      String(a.id || "").localeCompare(String(b.id || ""))
    ))
    .slice(0, topN);
}

function renderKeyValueBlock(obj) {
  return Object.entries(obj || {})
    .map(([key, value]) => `- ${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`)
    .join("\n");
}

function buildMarkdown(report, options = {}) {
  const topIssues = {};
  for (const item of report.items) {
    for (const flag of item.flags || []) {
      topIssues[flag] = (topIssues[flag] || 0) + 1;
    }
  }

  const worstItems = rankWorstItems(report.items, options.topN || 10);
  const duplicateLines = report.groups.duplicates.length > 0
    ? report.groups.duplicates.map(group => (
      `- ${group.group_id}: count=${group.count}; paths=${group.paths.join(", ")}; suggested_action=${group.suggested_action}`
    )).join("\n")
    : "- none";

  const topIssueLines = Object.entries(topIssues)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, options.topN || 10)
    .map(([flag, count]) => `- ${flag}: ${count}`)
    .join("\n") || "- none";

  const worstLines = worstItems.map(item => (
    `- score=${item.score} grade=${item.grade} action=${item.suggested_action} path=${item.path} flags=${(item.flags || []).join(", ")}`
  )).join("\n") || "- none";

  const categoryLines = renderKeyValueBlock(
    Object.fromEntries(Object.entries(report.breakdowns.by_category).map(([key, value]) => [key, value.count]))
  ) || "- none";

  const actionLines = renderKeyValueBlock(report.summary.suggested_actions) || "- none";

  return `# Memory Quality Eval Report

## Summary

- run_id: ${report.run_id}
- generated_at: ${report.generated_at}
- git_sha: ${report.git_sha ?? "unknown"}
- scope: ${report.scope}
- total_items: ${report.summary.total_items}
- grades: ${JSON.stringify(report.summary.grades)}
- flagged_items: ${report.summary.flagged_items}

## DB Health Diagnostics

${renderKeyValueBlock({
  chunks_count: report.diagnostics.chunks_count,
  memory_confidence_count: report.diagnostics.memory_confidence_count,
  memory_events_count: report.diagnostics.memory_events_count,
  exact_orphan_confidence_count: report.diagnostics.exact_orphan_confidence_count,
  truly_missing_orphan_confidence_count: report.diagnostics.truly_missing_orphan_confidence_count,
  fake_orphan_confidence_count: report.diagnostics.fake_orphan_confidence_count,
  chunks_without_confidence_count: report.diagnostics.chunks_without_confidence_count,
  chunk_prefix_unique_count: report.diagnostics.chunk_prefix_unique_count,
  chunk_prefix_ambiguous_count: report.diagnostics.chunk_prefix_ambiguous_count,
  event_prefix_total_distinct: report.diagnostics.event_prefix_total_distinct,
  event_prefix_matched_count: report.diagnostics.event_prefix_matched_count,
  event_prefix_unmatched_count: report.diagnostics.event_prefix_unmatched_count,
  event_prefix_ambiguous_count: report.diagnostics.event_prefix_ambiguous_count,
})}

## Orphan Confidence Notes

- orphan confidence is confirmed stale data.
- orphan confidence diagnostics-only, not included in per-memory score.
- cleanup should be handled by a separate dry-run repair script, outside this MVP eval.
- sample_orphan_confidence_ids: ${JSON.stringify(report.diagnostics.sample_orphan_confidence_ids || [])}
- orphan_confidence_month_distribution: ${JSON.stringify(report.diagnostics.orphan_confidence_month_distribution || {})}
- orphan_confidence_event_prefix_seen_count: ${report.diagnostics.orphan_confidence_event_prefix_seen_count ?? 0}

## Scope / Path Family Diagnostics

- stats-history is excluded by default.
- memory_events.memory_id is a 16-character prefix.
- chunks.id prefix16 is currently unique_count=${report.diagnostics.chunk_prefix_unique_count} and ambiguous_count=${report.diagnostics.chunk_prefix_ambiguous_count}.
- path_family_distribution: ${JSON.stringify(report.diagnostics.path_family_distribution || {})}
- confidence_id_length_distribution: ${JSON.stringify(report.diagnostics.confidence_id_length_distribution || {})}

## Signal Quality Notes

- cited / reinforced signals are too sparse to enter per-memory scoring.
- cite_signal_sparse: ${JSON.stringify(report.diagnostics.cite_signal_sparse || {})}
- event_type_distribution: ${JSON.stringify(report.diagnostics.event_type_distribution || {})}
- age uses last_confidence_update or updated_at as an approximation.

## Top Issues

${topIssueLines}

## Worst Memories

${worstLines}

## Duplicate Groups

${duplicateLines}

## Category Breakdown

${categoryLines}

## Recommended Next Actions

${actionLines}
`;
}

export function buildQualityReport({ items, diagnostics, options = {} }) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const run_id = options.runId || `memory-quality-${Date.now()}`;
  const generated_at = toIsoString(options.generatedAt);
  const git_sha = options.gitSha ?? null;
  const scope = options.scope || "active-memory";
  const groups = {
    duplicates: buildDuplicateGroups(normalizedItems),
  };
  const summary = summarizeItems(normalizedItems);
  const breakdowns = buildBreakdowns(normalizedItems);

  const report = {
    run_id,
    generated_at,
    git_sha,
    scope,
    summary,
    diagnostics: { ...(diagnostics || {}) },
    items: normalizedItems,
    groups,
    breakdowns,
  };

  return {
    ...report,
    markdown: buildMarkdown(report, options),
  };
}

export function writeQualityReports(report, options = {}) {
  const outDir = resolve(options.outputDir || "tmp/memory-quality");
  mkdirSync(outDir, { recursive: true });

  const jsonPath = resolve(outDir, "latest.json");
  const mdPath = resolve(outDir, "latest.md");
  const reportJson = {
    run_id: report.run_id,
    generated_at: report.generated_at,
    git_sha: report.git_sha,
    scope: report.scope,
    summary: report.summary,
    diagnostics: report.diagnostics,
    items: report.items,
    groups: report.groups,
    breakdowns: report.breakdowns,
  };

  writeFileSync(jsonPath, `${JSON.stringify(reportJson, null, 2)}\n`, "utf8");
  writeFileSync(mdPath, report.markdown, "utf8");

  const paths = {
    latest_json: jsonPath,
    latest_md: mdPath,
  };

  if (options.writeRunIdFiles !== false && report.run_id) {
    const runJsonPath = resolve(outDir, `${report.run_id}.json`);
    const runMdPath = resolve(outDir, `${report.run_id}.md`);
    writeFileSync(runJsonPath, `${JSON.stringify(reportJson, null, 2)}\n`, "utf8");
    writeFileSync(runMdPath, report.markdown, "utf8");
    paths.run_json = runJsonPath;
    paths.run_md = runMdPath;
  }

  return paths;
}

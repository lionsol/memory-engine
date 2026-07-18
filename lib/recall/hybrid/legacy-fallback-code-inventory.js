import {
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { extname, relative, resolve } from "node:path";

const ALLOWED_DIRECTORY_NAMES = new Set(["lib", "bin", "console", "scripts", "test", "docs"]);
const ALLOWED_ROOT_FILES = new Set(["index.js", "package.json", "openclaw.plugin.json", "README.md"]);
const ALLOWED_EXTENSIONS = new Set([
  ".js", ".cjs", ".mjs", ".json", ".md", ".sql", ".py", ".sh", ".css", ".ejs", ".txt",
]);
const SKIP_DIRECTORY_NAMES = new Set([".git", "node_modules", "reports", "coverage", "dist", "build", "tmp"]);
const INVENTORY_TOOL_PATHS = new Set([
  "lib/recall/hybrid/legacy-fallback-code-inventory.js",
  "bin/audit-legacy-fallback-code-inventory.js",
]);
const PRODUCTION_ENTRYPOINT_FILES = new Set([
  "index.js",
  "lib/recall/hybrid/db-access.js",
  "lib/recall/hybrid-search.js",
  "lib/services/memory-engine-cli-service.js",
]);
const HYBRID_CHANNEL_DIR = "lib/recall/hybrid/channels/";
const PRODUCTION_MODE_FILES = new Set([
  "index.js",
  "lib/recall/hybrid-search.js",
  `${HYBRID_CHANNEL_DIR}kg.js`,
  `${HYBRID_CHANNEL_DIR}recent.js`,
  "lib/recall/hybrid/kg-fail-closed-policy.js",
  "lib/recall/hybrid/recent-fail-closed-policy.js",
]);
const RECENT_QUERY_NAMES = new Set([
  "collectLegacyRecentCandidates",
  "collectLegacyRecentCandidatesWithShadow",
  "collectLegacyRecentCandidatesWithPolicy",
]);
const KG_QUERY_NAMES = new Set(["selectLegacyKgRows"]);
const REQUIRED_SEARCH_TERMS = [
  "collectLegacyRecentCandidates",
  "collectLegacyRecentCandidatesWithShadow",
  "collectLegacyRecentCandidatesWithPolicy",
  "withLegacyDb",
  "legacy_fallback",
  "KG_FAIL_CLOSED_DEFAULT_MODE",
  "RECENT_FAIL_CLOSED_DEFAULT_MODE",
  "kgFailClosedMode",
  "kgFailClosedCanary",
  "recentFailClosedMode",
  "recentFailClosedCanary",
  "kg_access_mode",
  "recent_runtime_mode",
  "recent_fail_closed_fallback_suppressed",
];
const EXECUTABLE_SEARCH_TERMS = [...REQUIRED_SEARCH_TERMS, "selectLegacyKgRows"];

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function isTestPath(path) {
  return path === "test" || path.startsWith("test/") || path.endsWith(".test.js");
}

function isDocPath(path) {
  return path === "README.md" || path.startsWith("docs/") || /\.(md|mdx)$/i.test(path);
}

function isInventoryTool(path) {
  return INVENTORY_TOOL_PATHS.has(path);
}

function isProductionPath(path) {
  return !isTestPath(path) && !isDocPath(path) && !path.startsWith("console/") && !isInventoryTool(path);
}

function lineNumberedContent(content) {
  return String(content || "").split(/\r?\n/).map((text, index) => ({ line: index + 1, text }));
}

function shortMatch(value) {
  return String(value || "").trim().slice(0, 120);
}

function finding({ path, line, symbol, match, category, executionRelevant, reason }) {
  return {
    path,
    line,
    symbol,
    match: shortMatch(match),
    category,
    execution_relevant: executionRelevant,
    reason,
  };
}

function addFinding(findings, item) {
  const key = [item.category, item.path, item.line, item.symbol, item.match].join("\u0000");
  if (!findings.some(existing => [existing.category, existing.path, existing.line, existing.symbol, existing.match].join("\u0000") === key)) {
    findings.push(item);
  }
}

function matchesForLine(text, terms) {
  return terms.filter(term => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text));
}

function isForbiddenTestReference(text) {
  return /forbidden|doesNotMatch|not\s+contain|forbids|forbiddenDependencies/i.test(text);
}

function isRuntimeTestReference(text) {
  return /(?:policy\s*\(\s*["']legacy_fallback|mode\s*:\s*["']legacy_fallback|assert[^\n]*legacy_fallback|withLegacyDb\s*\(|selectLegacyKgRows\s*\(|collectLegacyRecentCandidates\s*\()/i.test(text);
}

function isHistoricalDoc(text) {
  return /histor|migration|previous|deprecated|removed|formerly|legacy path/i.test(text);
}

function isActiveLegacyDoc(text) {
  return /(?:configure|config|enable|use|set|switch|must|require|fallback|legacy)/i.test(text);
}

function isObservationLine(path, text) {
  return path === "lib/recall/hybrid-observation.js"
    || /(?:observation|debug|telemetry|metadata)/i.test(text);
}

function isMetricsLine(path, text) {
  return path === "console/services/metrics-service.js"
    || /(?:metrics|distribution|rate|summary)/i.test(text);
}

function addDynamicFindings(path, line, text, findings) {
  const dynamicPatterns = [
    /\b(?:scope|access|runtime|config)\s*\[[^\]]+\]/,
    /\b(?:withLegacyDb|legacyFallback|failClosed(?:Mode|Canary)|recentFailClosed|kgFailClosed)[A-Za-z_$]*\s*\+\s*[^;]+/,
    /import\s*\(\s*(?!["'`])[^)]*(?:legacy|withLegacy|fallback|failClosed|mode)[^)]*\)/i,
  ];
  if (!dynamicPatterns.some(pattern => pattern.test(text))) return;
  if (!/(legacy|withLegacy|fallback|failClosed|mode|scope\[key\])/i.test(text)) return;
  addFinding(findings, finding({
    path,
    line,
    symbol: "dynamic-reference",
    match: text,
    category: "dynamic_or_ambiguous_reference",
    executionRelevant: true,
    reason: "Computed or dynamically generated legacy access reference cannot be resolved lexically.",
  }));
}

function addQueryFindings(path, line, text, findings) {
  for (const name of [...RECENT_QUERY_NAMES, ...KG_QUERY_NAMES]) {
    const definition = new RegExp(`(?:async\\s+)?function\\s+${name}\\b`).test(text)
      || new RegExp(`(?:const|let|var)\\s+${name}\\s*=`).test(text);
    const call = new RegExp(`\\b${name}\\s*\\(`).test(text);
    if (definition) {
      const isRecent = RECENT_QUERY_NAMES.has(name);
      addFinding(findings, finding({
        path,
        line,
        symbol: name,
        match: name,
        category: isRecent ? "recent_query_definition" : "kg_query_definition",
        executionRelevant: true,
        reason: `Function defines executable ${isRecent ? "Recent" : "KG"} legacy fallback query path.`,
      }));
    } else if (call) {
      const isRecent = RECENT_QUERY_NAMES.has(name);
      addFinding(findings, finding({
        path,
        line,
        symbol: name,
        match: name,
        category: isRecent ? "recent_query_call_site" : "kg_query_call_site",
        executionRelevant: true,
        reason: `Call site can execute the ${isRecent ? "Recent" : "KG"} legacy fallback query path.`,
      }));
    }
  }
}

function addProductionFindings(path, line, text, findings) {
  addQueryFindings(path, line, text, findings);

  if (PRODUCTION_ENTRYPOINT_FILES.has(path)) {
    if (/\bwithLegacyDb\b/.test(text)) {
      addFinding(findings, finding({
        path,
        line,
        symbol: "withLegacyDb",
        match: "withLegacyDb",
        category: "legacy_db_entrypoint",
        executionRelevant: true,
        reason: "Production Hybrid code exposes or consumes the legacy database accessor.",
      }));
    }
    if (/withLegacyDb\s*:\s*withDb|\b(?:const|let|var)\s+withDb\b/.test(text)) {
      addFinding(findings, finding({
        path,
        line,
        symbol: "withDb",
        match: "withDb",
        category: "legacy_db_entrypoint",
        executionRelevant: true,
        reason: "Production adapter wires a legacy combined-database accessor into Hybrid runtime.",
      }));
    }
  }

  if (PRODUCTION_MODE_FILES.has(path)) {
    const modeTerms = [
      "KG_FAIL_CLOSED_DEFAULT_MODE",
      "RECENT_FAIL_CLOSED_DEFAULT_MODE",
      "kgFailClosedMode",
      "kgFailClosedCanary",
      "recentFailClosedMode",
      "recentFailClosedCanary",
      "legacy_fallback",
    ];
    for (const term of matchesForLine(text, modeTerms)) {
      if (/debug\.|metadata|observation|telemetry|recordHybridSearchObservation/i.test(text)
        && !/(?:mode\s*=|mode\s*:|config|canary|fallback\s*\(|return|if\s*\(|switch)/i.test(text)) {
        continue;
      }
      addFinding(findings, finding({
        path,
        line,
        symbol: term,
        match: term,
        category: "runtime_mode_reference",
        executionRelevant: true,
        reason: "Production configuration or branch logic references a legacy-compatible runtime mode.",
      }));
    }
  }
}

function classifyFileEntry(entry, findings, parseErrors) {
  const path = normalizePath(entry.path);
  if (entry.readError) {
    parseErrors.push({ path, error: String(entry.readError) });
    return;
  }
  if (isInventoryTool(path)) return;
  const content = String(entry.content ?? "");
  for (const { line, text } of lineNumberedContent(content)) {
    if (!text.trim()) continue;
    addDynamicFindings(path, line, text, findings);

    const terms = matchesForLine(text, EXECUTABLE_SEARCH_TERMS);
    if (terms.length === 0) continue;

    if (isTestPath(path)) {
      const category = isForbiddenTestReference(text)
        ? "test_forbids_legacy_dependency"
        : isRuntimeTestReference(text)
          ? "test_requires_legacy_fallback"
          : null;
      if (category) {
        for (const term of terms) {
          addFinding(findings, finding({
            path,
            line,
            symbol: term,
            match: term,
            category,
            executionRelevant: category === "test_requires_legacy_fallback",
            reason: category === "test_requires_legacy_fallback"
              ? "Test constructs or asserts executable legacy fallback behavior."
              : "Test references a legacy symbol only to enforce a forbidden dependency boundary.",
          }));
        }
      }
      continue;
    }

    if (isDocPath(path)) {
      const category = isHistoricalDoc(text)
        ? "docs_historical_only"
        : isActiveLegacyDoc(text)
          ? "docs_requiring_legacy_fallback"
          : null;
      if (category) {
        for (const term of terms) {
          addFinding(findings, finding({
            path,
            line,
            symbol: term,
            match: term,
            category,
            executionRelevant: category === "docs_requiring_legacy_fallback",
            reason: category === "docs_requiring_legacy_fallback"
              ? "Documentation gives active guidance about the legacy fallback path."
              : "Documentation records historical or migration context only.",
          }));
        }
      }
      continue;
    }

    if (isMetricsLine(path, text)) {
      for (const term of terms) {
        addFinding(findings, finding({
          path,
          line,
          symbol: term,
          match: term,
          category: "metrics_only_reference",
          executionRelevant: false,
          reason: "Metrics code reads persisted telemetry and does not execute a fallback.",
        }));
      }
      continue;
    }

    if (isObservationLine(path, text)) {
      for (const term of terms) {
        addFinding(findings, finding({
          path,
          line,
          symbol: term,
          match: term,
          category: "observation_only_reference",
          executionRelevant: false,
          reason: "Observation code records or propagates fallback telemetry only.",
        }));
      }
      continue;
    }

    if (isProductionPath(path)) addProductionFindings(path, line, text, findings);
  }
}

function compareFindings(a, b) {
  return a.path.localeCompare(b.path)
    || a.line - b.line
    || a.symbol.localeCompare(b.symbol)
    || a.category.localeCompare(b.category)
    || a.match.localeCompare(b.match);
}

function emptyCategories() {
  return {
    recent_query_definitions: [],
    recent_query_call_sites: [],
    kg_query_definitions: [],
    kg_query_call_sites: [],
    legacy_db_entrypoints: [],
    runtime_mode_references: [],
    observation_only_references: [],
    metrics_only_references: [],
    tests_requiring_legacy_fallback: [],
    tests_forbidding_legacy_dependencies: [],
    docs_requiring_legacy_fallback: [],
    docs_historical_only: [],
    dynamic_or_ambiguous_references: [],
  };
}

function sortUniqueStrings(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function normalizeFileEntries(fileEntries = []) {
  return [...fileEntries]
    .map(entry => ({ ...entry, path: normalizePath(entry.path) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function buildLegacyFallbackCodeInventory({ rootDir, fileEntries = [] } = {}) {
  const findings = [];
  const parseErrors = [];
  const entries = normalizeFileEntries(fileEntries);
  for (const entry of entries) classifyFileEntry(entry, findings, parseErrors);
  findings.sort(compareFindings);

  const categories = emptyCategories();
  for (const item of findings) {
    if (item.category === "recent_query_definition") categories.recent_query_definitions.push(item);
    else if (item.category === "recent_query_call_site") categories.recent_query_call_sites.push(item);
    else if (item.category === "kg_query_definition") categories.kg_query_definitions.push(item);
    else if (item.category === "kg_query_call_site") categories.kg_query_call_sites.push(item);
    else if (item.category === "legacy_db_entrypoint") categories.legacy_db_entrypoints.push(item);
    else if (item.category === "runtime_mode_reference") categories.runtime_mode_references.push(item);
    else if (item.category === "observation_only_reference") categories.observation_only_references.push(item);
    else if (item.category === "metrics_only_reference") categories.metrics_only_references.push(item);
    else if (item.category === "test_requires_legacy_fallback") categories.tests_requiring_legacy_fallback.push(item);
    else if (item.category === "test_forbids_legacy_dependency") categories.tests_forbidding_legacy_dependencies.push(item);
    else if (item.category === "docs_requiring_legacy_fallback") categories.docs_requiring_legacy_fallback.push(item);
    else if (item.category === "docs_historical_only") categories.docs_historical_only.push(item);
    else if (item.category === "dynamic_or_ambiguous_reference") categories.dynamic_or_ambiguous_references.push(item);
  }

  for (const category of Object.values(categories)) category.sort(compareFindings);
  const skippedFiles = sortUniqueStrings(entries.filter(entry => entry.skipped).map(entry => `${entry.path}: ${entry.skipped}`));
  const unexpectedSkippedFiles = entries.filter(entry => entry.skipped && entry.expected !== true);
  parseErrors.sort((a, b) => a.path.localeCompare(b.path) || a.error.localeCompare(b.error));

  return {
    schema_version: 1,
    inventory_complete: parseErrors.length === 0 && unexpectedSkippedFiles.length === 0,
    legacy_query_definitions: categories.recent_query_definitions.length + categories.kg_query_definitions.length,
    legacy_query_call_sites: categories.recent_query_call_sites.length + categories.kg_query_call_sites.length,
    legacy_db_entrypoints: categories.legacy_db_entrypoints.length,
    config_modes_referencing_legacy_fallback: categories.runtime_mode_references.length,
    tests_requiring_legacy_fallback: categories.tests_requiring_legacy_fallback.length,
    docs_requiring_legacy_fallback: categories.docs_requiring_legacy_fallback.length,
    known_dynamic_references: categories.dynamic_or_ambiguous_references.length,
    categories,
    scanned_files: entries.filter(entry => !entry.skipped && !entry.readError).length,
    skipped_files: skippedFiles,
    parse_errors: parseErrors,
    generated_at: new Date().toISOString(),
    root_dir: rootDir ? resolve(rootDir) : null,
  };
}

function isAllowedRelativePath(path) {
  if (ALLOWED_ROOT_FILES.has(path)) return true;
  const top = path.split("/")[0];
  return ALLOWED_DIRECTORY_NAMES.has(top);
}

function shouldSkipFile(path) {
  const normalized = normalizePath(path);
  if (!isAllowedRelativePath(normalized)) return { reason: "outside allowed inventory paths", expected: true };
  const extension = extname(normalized).toLowerCase();
  if (/\.(sqlite|sqlite-wal|sqlite-shm|jsonl)$/i.test(normalized)) {
    return { reason: "generated or database file", expected: true };
  }
  if (!ALLOWED_EXTENSIONS.has(extension)) return { reason: "unsupported file extension", expected: false };
  return null;
}

function walkInventoryFiles(rootDir, currentDir, entries) {
  for (const dirent of readdirSync(currentDir, { withFileTypes: true })) {
    const absolutePath = resolve(currentDir, dirent.name);
    const relativePath = normalizePath(relative(rootDir, absolutePath));
    if (dirent.isDirectory()) {
      if (SKIP_DIRECTORY_NAMES.has(dirent.name)) continue;
      const top = relativePath.split("/")[0];
      if (relativePath !== top && !ALLOWED_DIRECTORY_NAMES.has(top)) continue;
      walkInventoryFiles(rootDir, absolutePath, entries);
      continue;
    }
    if (dirent.isSymbolicLink()) {
      if (isAllowedRelativePath(relativePath)) entries.push({ path: relativePath, skipped: "symbolic link not followed" });
      continue;
    }
    if (!dirent.isFile()) continue;
    const skip = shouldSkipFile(relativePath);
    if (skip) {
      if (isAllowedRelativePath(relativePath)) entries.push({ path: relativePath, skipped: skip.reason, expected: skip.expected === true });
      continue;
    }
    try {
      entries.push({ path: relativePath, content: readFileSync(absolutePath, "utf8") });
    } catch (error) {
      entries.push({ path: relativePath, readError: error.message });
    }
  }
}

export function collectLegacyFallbackInventoryFiles({ rootDir } = {}) {
  if (!rootDir) throw new Error("rootDir is required");
  const requestedRoot = resolve(rootDir);
  const root = realpathSync(requestedRoot);
  const entries = [];
  walkInventoryFiles(root, root, entries);
  return {
    rootDir: root,
    fileEntries: entries.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export const LEGACY_FALLBACK_INVENTORY_SEARCH_TERMS = Object.freeze([...REQUIRED_SEARCH_TERMS]);

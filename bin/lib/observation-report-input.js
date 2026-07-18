const { readFileSync } = require("node:fs");

function parseJsonLines(source, label = "observations") {
  return String(source || "")
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`invalid ${label} JSONL at line ${index + 1}: ${error.message}`);
      }
    });
}

function loadObservationReport(path) {
  if (!path || typeof path !== "string") throw new Error("observation report path is required");
  const source = readFileSync(path, "utf8");
  if (path.toLowerCase().endsWith(".jsonl")) return parseJsonLines(source, path);

  try {
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed)) throw new Error("observations JSON must be an array");
    return parsed;
  } catch (error) {
    const message = String(error?.message || error);
    if (/Unexpected end|Unexpected token|JSON parse/i.test(message)) return parseJsonLines(source, path);
    throw error;
  }
}

function loadObservationReports(paths) {
  const normalized = Array.isArray(paths) ? paths : [paths];
  const nonEmpty = normalized.filter(path => typeof path === "string" && path.trim());
  if (nonEmpty.length === 0) throw new Error("at least one observation report path is required");
  return nonEmpty.flatMap(loadObservationReport);
}

module.exports = {
  loadObservationReport,
  loadObservationReports,
  parseJsonLines,
};

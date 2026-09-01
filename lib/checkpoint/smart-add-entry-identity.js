const { isAbsolute, relative, resolve, sep } = require("node:path");

const FINGERPRINT_LINE_RE = /^\s*<!--\s*smart-add-fingerprint:\s*[a-f0-9]{8,64}\s*-->\s*$/i;
const HEADING_LINE_RE = /^\s*##\s+(.+?)\s*$/;
const CATEGORY_LINE_RE = /^\s*Category:\s*/i;
const PROVENANCE_LINE_RE = /^\s*Provenance:\s*/i;

function parseCanonicalEntryHeader(lines, headingIndex) {
  let metadataIndex = headingIndex + 1;
  while (metadataIndex < lines.length && String(lines[metadataIndex] || "").trim() === "") {
    metadataIndex += 1;
  }

  const categoryLine = lines[metadataIndex];
  if (!CATEGORY_LINE_RE.test(categoryLine || "")) return null;
  const category = String(categoryLine.replace(CATEGORY_LINE_RE, "").split("|")[0] || "")
    .trim()
    .toLowerCase();

  metadataIndex += 1;
  while (metadataIndex < lines.length && String(lines[metadataIndex] || "").trim() === "") {
    metadataIndex += 1;
  }

  const provenanceLine = lines[metadataIndex];
  const provenance = PROVENANCE_LINE_RE.test(provenanceLine || "")
    ? String(provenanceLine.replace(PROVENANCE_LINE_RE, "") || "").trim().toLowerCase()
    : "unknown";

  return { category, provenance };
}

function parseCanonicalSmartAddBlocks(content) {
  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  const canonicalHeaders = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!HEADING_LINE_RE.test(lines[index])) continue;
    const heading = String(lines[index] || "").match(HEADING_LINE_RE);
    const metadata = parseCanonicalEntryHeader(lines, index);
    if (!heading || !metadata) continue;
    canonicalHeaders.push({ headingIndex: index, heading, ...metadata });
  }

  return canonicalHeaders.map((header, position) => {
    const { headingIndex } = header;
    const previousLine = headingIndex > 0 ? lines[headingIndex - 1] : "";
    const startIndex = FINGERPRINT_LINE_RE.test(previousLine) ? headingIndex - 1 : headingIndex;
    const nextHeadingIndex = position + 1 < canonicalHeaders.length
      ? canonicalHeaders[position + 1].headingIndex
      : lines.length;
    const nextPreviousLine = nextHeadingIndex > 0 ? lines[nextHeadingIndex - 1] : "";
    const nextStartIndex = FINGERPRINT_LINE_RE.test(nextPreviousLine)
      ? nextHeadingIndex - 1
      : nextHeadingIndex;
    const blockLines = lines.slice(startIndex, nextStartIndex);
    return {
      entryId: header.heading[1].trim(),
      category: header.category,
      provenance: header.provenance,
      startLine: startIndex + 1,
      endLine: nextStartIndex,
      raw: blockLines.join("\n").trim(),
    };
  });
}

function resolveSourcePath(workspaceDir, sourcePath) {
  const normalizedPath = String(sourcePath || "");
  if (!normalizedPath || isAbsolute(normalizedPath) || normalizedPath.includes("\\")) return null;
  const workspaceRoot = resolve(String(workspaceDir || ""));
  const candidate = resolve(workspaceRoot, normalizedPath);
  const relativePath = relative(workspaceRoot, candidate);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return null;
  }
  return candidate;
}

function parseLineNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 ? number : null;
}

module.exports = {
  parseCanonicalSmartAddBlocks,
  parseLineNumber,
  resolveSourcePath,
};

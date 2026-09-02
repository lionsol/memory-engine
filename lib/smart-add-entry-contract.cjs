const crypto = require("node:crypto");

const FINGERPRINT_LINE_RE = /^\s*<!--\s*smart-add-fingerprint:\s*([a-f0-9]{8,64})\s*-->\s*$/i;
const FINGERPRINT_RE = /<!--\s*smart-add-fingerprint:\s*([a-f0-9]{8,64})\s*-->/gi;
const HEADING_RE = /^\s*##\s+(.+?)\s*$/;
const CATEGORY_RE = /^\s*Category:\s*(.*?)\s*$/i;
const PROVENANCE_RE = /^\s*Provenance:\s*(.*?)\s*$/i;
const KG_DATA_RE = /^\s*kg_data:\s*(.*?)\s*$/i;

const SMART_ADD_FINGERPRINT_MISMATCH = "SMART_ADD_FINGERPRINT_MISMATCH";
const SMART_ADD_DUPLICATE_CHECK_FAILED = "SMART_ADD_DUPLICATE_CHECK_FAILED";

function normalizeSmartAddText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

function normalizeSmartAddCategory(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeSmartAddProvenance(value, fallback = "unknown") {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || fallback;
}

function normalizeProtectedFlag(value) {
  return value ? "1" : "0";
}

function canonicalizeSmartAddFingerprint(text, category, isProtected) {
  return [
    normalizeSmartAddCategory(category),
    normalizeProtectedFlag(isProtected),
    normalizeSmartAddText(text),
  ].join("|");
}

function buildSmartAddFingerprint(text, category, isProtected) {
  return crypto
    .createHash("sha256")
    .update(canonicalizeSmartAddFingerprint(text, category, isProtected))
    .digest("hex")
    .slice(0, 16);
}

function parseSmartAddEntries(content) {
  const lines = String(content ?? "").replace(/\r\n?/g, "\n").split("\n");
  const headingIndexes = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (HEADING_RE.test(lines[index] || "")) headingIndexes.push(index);
  }

  const entries = [];
  for (let position = 0; position < headingIndexes.length; position += 1) {
    const headingIndex = headingIndexes[position];
    const headingMatch = String(lines[headingIndex] || "").match(HEADING_RE);
    if (!headingMatch) continue;

    const previousLine = headingIndex > 0 ? lines[headingIndex - 1] : "";
    const startIndex = FINGERPRINT_LINE_RE.test(previousLine) ? headingIndex - 1 : headingIndex;
    const nextHeadingIndex = headingIndexes[position + 1] ?? lines.length;
    const nextPreviousLine = nextHeadingIndex > 0 ? lines[nextHeadingIndex - 1] : "";
    const endIndex = FINGERPRINT_LINE_RE.test(nextPreviousLine)
      ? nextHeadingIndex - 1
      : nextHeadingIndex;
    const blockLines = lines.slice(startIndex, endIndex);
    const categoryLine = blockLines.find(line => CATEGORY_RE.test(line || ""));
    const provenanceLine = blockLines.find(line => PROVENANCE_RE.test(line || ""));
    const kgDataLine = blockLines.find(line => KG_DATA_RE.test(line || ""));
    const categoryMatch = categoryLine ? String(categoryLine).match(CATEGORY_RE) : null;
    const provenanceMatch = provenanceLine ? String(provenanceLine).match(PROVENANCE_RE) : null;
    const kgDataMatch = kgDataLine ? String(kgDataLine).match(KG_DATA_RE) : null;
    const categoryValue = categoryMatch ? String(categoryMatch[1] || "") : "";
    const normalizedCategory = categoryValue.split("|")[0];
    const fingerprintMatch = blockLines.join("\n").match(FINGERPRINT_RE);
    let fingerprint = null;
    if (fingerprintMatch) {
      const valueMatch = fingerprintMatch[0].match(FINGERPRINT_LINE_RE);
      if (valueMatch) fingerprint = valueMatch[1].toLowerCase();
      else {
        const embedded = fingerprintMatch[0].match(/smart-add-fingerprint:\s*([a-f0-9]{8,64})/i);
        if (embedded) fingerprint = embedded[1].toLowerCase();
      }
    }
    const text = normalizeSmartAddText(blockLines
      .filter(line => (
        !HEADING_RE.test(line || "")
        && !CATEGORY_RE.test(line || "")
        && !PROVENANCE_RE.test(line || "")
        && !KG_DATA_RE.test(line || "")
        && !FINGERPRINT_LINE_RE.test(line || "")
      ))
      .join("\n"));
    if (!text) continue;

    entries.push({
      entryId: String(headingMatch[1] || "").trim(),
      category: normalizeSmartAddCategory(normalizedCategory) || null,
      provenance: normalizeSmartAddProvenance(provenanceMatch ? provenanceMatch[1] : ""),
      isProtected: /\|\s*protected\b/i.test(categoryValue),
      fingerprint,
      kg_data: kgDataMatch ? String(kgDataMatch[1] || "").trim() : null,
      text,
      raw: blockLines.join("\n").trim(),
    });
  }
  return entries;
}

function resolveEntryFields(entry = {}) {
  const source = entry && typeof entry === "object" ? entry : { text: entry };
  const parsed = source.raw ? parseSmartAddEntries(source.raw) : [];
  const parsedEntry = parsed.length === 1 ? parsed[0] : null;
  const hasProtected = Object.prototype.hasOwnProperty.call(source, "isProtected")
    || Object.prototype.hasOwnProperty.call(source, "protected")
    || Object.prototype.hasOwnProperty.call(source, "is_protected");
  return {
    text: source.text ?? parsedEntry?.text ?? source.raw ?? "",
    category: source.category ?? parsedEntry?.category ?? "",
    isProtected: hasProtected
      ? (source.isProtected ?? source.protected ?? source.is_protected)
      : (parsedEntry?.isProtected ?? false),
  };
}

function buildSmartAddFingerprintFromEntry(entry = {}) {
  const fields = resolveEntryFields(entry);
  return buildSmartAddFingerprint(fields.text, fields.category, fields.isProtected);
}

function extractSmartAddFingerprints(content) {
  const raw = String(content ?? "");
  const fingerprints = new Set();
  let match;
  FINGERPRINT_RE.lastIndex = 0;
  while ((match = FINGERPRINT_RE.exec(raw)) !== null) {
    fingerprints.add(String(match[1]).toLowerCase());
  }
  for (const entry of parseSmartAddEntries(raw)) {
    fingerprints.add(buildSmartAddFingerprint(entry.text, entry.category || "", entry.isProtected));
  }
  return fingerprints;
}

function hasSmartAddFingerprintComment(content) {
  FINGERPRINT_RE.lastIndex = 0;
  const found = FINGERPRINT_RE.test(String(content ?? ""));
  FINGERPRINT_RE.lastIndex = 0;
  return found;
}

function renderSmartAddEntry({
  entryId,
  category,
  isProtected = false,
  provenance = "unknown",
  text,
  kg_data,
  fingerprint,
} = {}) {
  const normalizedCategory = normalizeSmartAddCategory(category);
  const normalizedText = normalizeSmartAddText(text);
  const canonicalFingerprint = buildSmartAddFingerprint(normalizedText, normalizedCategory, isProtected);
  if (fingerprint !== undefined && fingerprint !== null
    && String(fingerprint).trim().toLowerCase() !== canonicalFingerprint) {
    const error = new Error("smart-add fingerprint does not match canonical identity");
    error.code = SMART_ADD_FINGERPRINT_MISMATCH;
    throw error;
  }
  const renderedFingerprint = canonicalFingerprint;
  const normalizedProvenance = normalizeSmartAddProvenance(provenance);
  const normalizedKgData = String(kg_data ?? "").trim();
  const metadata = normalizedKgData ? `kg_data: ${normalizedKgData}\n\n` : "";
  return [
    `## ${String(entryId ?? "").trim()}`,
    "",
    `Category: ${normalizedCategory}${isProtected ? " | Protected" : ""}`,
    `Provenance: ${normalizedProvenance}`,
    `<!-- smart-add-fingerprint: ${renderedFingerprint} -->`,
    "",
    `${metadata}${normalizedText}`,
    "",
  ].join("\n");
}

module.exports = {
  FINGERPRINT_LINE_RE,
  SMART_ADD_DUPLICATE_CHECK_FAILED,
  SMART_ADD_FINGERPRINT_MISMATCH,
  buildSmartAddFingerprint,
  buildSmartAddFingerprintFromEntry,
  canonicalizeSmartAddFingerprint,
  extractSmartAddFingerprints,
  hasSmartAddFingerprintComment,
  normalizeProtectedFlag,
  normalizeSmartAddCategory,
  normalizeSmartAddProvenance,
  normalizeSmartAddText,
  parseSmartAddEntries,
  renderSmartAddEntry,
  resolveEntryFields,
};

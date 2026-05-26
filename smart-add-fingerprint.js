import crypto from "crypto";

export function canonicalizeSmartAddFingerprint(text, category, isProtected) {
  const normalizedText = String(text || "").replace(/\r\n?/g, "\n").trim();
  const normalizedCategory = String(category || "").trim().toLowerCase();
  const protectedFlag = isProtected ? "1" : "0";
  return `${normalizedCategory}|${protectedFlag}|${normalizedText}`;
}

export function buildSmartAddFingerprint(text, category, isProtected) {
  const payload = canonicalizeSmartAddFingerprint(text, category, isProtected);
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

import smartAddEntryContract from "./lib/smart-add-entry-contract.cjs";

const {
  buildSmartAddFingerprint: buildCanonicalSmartAddFingerprint,
  canonicalizeSmartAddFingerprint: canonicalizeCanonicalSmartAddFingerprint,
} = smartAddEntryContract;

export function canonicalizeSmartAddFingerprint(text, category, isProtected) {
  return canonicalizeCanonicalSmartAddFingerprint(text, category, isProtected);
}

export function buildSmartAddFingerprint(text, category, isProtected) {
  return buildCanonicalSmartAddFingerprint(text, category, isProtected);
}

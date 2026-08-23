import { DISCLOSURE_DECISIONS } from "./disclosure-types.js";

function compact(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}
function bounded(value, max) {
  const text = compact(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function cardFor(selection) {
  return selection && typeof selection.card === "object" && !Array.isArray(selection.card)
    ? selection.card
    : null;
}

/**
 * Formats only selector-confirmed DIRECT_CARD selections. This function has
 * no access to Canonical Memory, retrieval candidates, projectors, or stores.
 */
export function formatDirectCardContext(selections, { topK = 3 } = {}) {
  const limit = Math.max(1, Number(topK || 3));
  const cards = (Array.isArray(selections) ? selections : [])
    .filter(selection => selection?.decision === DISCLOSURE_DECISIONS.DISCLOSE_CARD && cardFor(selection))
    .slice(0, limit);
  if (cards.length === 0) return "";

  const lines = [
    "## Auto Recall - memory cards",
    "",
    "The following Owner-attested memory cards may help answer this turn. They are bounded card previews; full memory content is not included.",
    "If your answer relies on any card, include a final metadata line exactly like: cited_memory_ids: [\"memory_id\"] using the IDs shown below.",
    "",
  ];

  cards.forEach((selection, index) => {
    const card = cardFor(selection);
    const memoryId = bounded(selection.memory_id, 256) || "unknown";
    const flags = Array.isArray(card.risk_flags) && card.risk_flags.length > 0
      ? card.risk_flags.join(",")
      : "none";
    lines.push(`${index + 1}. [${memoryId}] title=${bounded(card.title, 80)}`);
    lines.push(`   category=${bounded(card.category, 80)} kind=${bounded(card.kind, 80)} confidence=${card.confidence_score ?? "n/a"} risk_flags=${flags}`);
    lines.push(`   summary: ${bounded(card.summary, 220)}`);
    lines.push(`   why: ${bounded(card.salience_reason, 180)}`);
    lines.push(`   source: ${bounded(card.source_hint, 512) || "unknown source"}`);
  });

  return lines.join("\n");
}

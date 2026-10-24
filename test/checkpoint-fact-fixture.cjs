"use strict";
const { PROTOCOL, buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
function factResponse(input, decorate = () => ({})) {
  const facts = [];
  for (const source of input.sources) for (const unit of source.units) {
    facts.push({ unit: unit.index, ...decorate(unit, facts.length) });
  }
  const superseded = new Set(facts.flatMap(fact => fact.supersedes || []));
  const summary = facts.map((fact, i) => fact.id || "f" + (i + 1)).filter(id => !superseded.has(id));
  return { protocol: PROTOCOL, target_date: input.target_date, facts, summary, skipped: [] };
}
function textInput(text, targetDate = "2026-10-20") {
  return buildFactInput([{ text, source: "conversation", category: "raw_log" }], targetDate);
}
module.exports = { factResponse, textInput };

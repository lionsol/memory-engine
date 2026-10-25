"use strict";
const { PROTOCOL, buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
// Test-only shorthand: construct explicitly source-bound quotes, never repair provider output.
function selectedResponse(input, selections) {
  const units = input.sources.flatMap(source => source.units);
  const facts = selections.map(selection => {
    const fact = typeof selection === "number" ? { unit: selection } : selection;
    return { event_id: "fixture", facet: "outcome", quote: units[fact.unit]?.text, ...fact };
  });
  return { protocol: PROTOCOL, target_date: input.target_date, facts };
}
function factResponse(input, decorate = () => ({})) {
  const selections = [];
  for (const source of input.sources) for (const unit of source.units) {
    if (/^(?:HEARTBEAT_OK|\[OpenClaw heartbeat poll\])$/.test(unit.text.trim())) continue;
    selections.push({ unit: unit.index, ...decorate(unit, selections.length) });
  }
  return selectedResponse(input, selections);
}
function textInput(text, targetDate = "2026-10-20") {
  return buildFactInput([{ text, source: "conversation", category: "raw_log" }], targetDate);
}
module.exports = { factResponse, selectedResponse, textInput };

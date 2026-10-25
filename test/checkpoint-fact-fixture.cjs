"use strict";
const { PROTOCOL, buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
function factResponse(input, decorate = () => ({})) {
  const facts = [];
  for (const source of input.sources) for (const unit of source.units) {
    const text = unit.text ?? unit.parts.join("");
    if (/^(?:HEARTBEAT_OK|\[OpenClaw heartbeat poll\])$/.test(text.trim())) continue;
    facts.push({ unit: unit.index, ...decorate(unit, facts.length) });
  }
  return { protocol: PROTOCOL, target_date: input.target_date, facts };
}
function textInput(text, targetDate = "2026-10-20") {
  return buildFactInput([{ text, source: "conversation", category: "raw_log" }], targetDate);
}
module.exports = { factResponse, textInput };

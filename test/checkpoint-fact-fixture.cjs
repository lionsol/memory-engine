"use strict";
const { PROTOCOL, buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
// Test-only constructors. They never repair actual provider responses.
function selectedResponse(input, selections) {
  const units = new Map(input.sources.flatMap(source => source.units).map(unit => [unit.index, unit]));
  const facts = selections.map(selection => {
    const fact = typeof selection === "number" ? { unit: selection } : selection;
    return { event_id: "fixture", facet: "outcome", quote: units.get(fact.unit)?.text, ...fact };
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
function planResponse(input, facts = factResponse(input).facts) {
  const units = new Map(input.sources.flatMap(source => source.units.map(unit => ({...unit,source_id:source.id})))
    .map(unit => [unit.index, unit]));
  const events = new Map();
  for (const fact of facts) {
    const source = units.get(fact.unit).source_id, eventId = fact.event_id || "fixture";
    const key = source + "/" + eventId;
    if (!events.has(key)) events.set(key,{id:eventId,source_id:source,evidence:[]});
    const evidence = {unit:fact.unit,quote:fact.quote,facet:fact.facet||"outcome",kind:fact.kind||"report"};
    if (!events.get(key).evidence.some(ref=>ref.unit===evidence.unit&&ref.quote===evidence.quote&&ref.facet===evidence.facet))
      events.get(key).evidence.push(evidence);
  }
  return { protocol:PROTOCOL,target_date:input.target_date,events:[...events.values()] };
}
function candidateSelectionResponse(input, ids = input.candidates.map(candidate => candidate.id)) {
  return { selected_candidate_ids: ids };
}
function providerResponse(input) {
  return input.stage==="plan"?planResponse(input):candidateSelectionResponse(input);
}
function textInput(text, targetDate = "2026-10-20") {
  return buildFactInput([{ text, source: "conversation", category: "raw_log" }], targetDate);
}
module.exports = { factResponse, selectedResponse, planResponse, candidateSelectionResponse, providerResponse, textInput };

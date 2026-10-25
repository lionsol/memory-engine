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
    if (!events.has(key)) events.set(key,{id:eventId,source_id:source,topic:"Synthetic final state",
      evidence:[],retired_units:[]});
    const evidence = {unit:fact.unit,facet:fact.facet||"outcome",kind:fact.kind||"report"};
    if (!events.get(key).evidence.some(ref=>ref.unit===evidence.unit&&ref.facet===evidence.facet))
      events.get(key).evidence.push(evidence);
  }
  return { protocol:PROTOCOL,target_date:input.target_date,events:[...events.values()] };
}
function plannedFactResponse(input, decorate = () => ({})) {
  if (!input.event_plan) return factResponse(input,decorate);
  const refs=input.event_plan.events.flatMap(event=>event.evidence.map(ref=>({
    unit:ref.unit,event_id:event.id,facet:ref.facet,kind:ref.kind||"report"
  })));
  const units=new Map(input.sources.flatMap(source=>source.units).map(unit=>[unit.index,unit]));
  return selectedResponse(input,refs.map((ref,i)=>({...ref,...decorate(units.get(ref.unit),i)})));
}
function providerResponse(input, decorate) {
  return input.stage==="plan"?planResponse(input):plannedFactResponse(input,decorate);
}
function textInput(text, targetDate = "2026-10-20") {
  return buildFactInput([{ text, source: "conversation", category: "raw_log" }], targetDate);
}
module.exports = { factResponse, selectedResponse, planResponse, plannedFactResponse, providerResponse, textInput };

"use strict";
const { PROTOCOL, validateEventPlan, validateFinalEvidence } = require("./ordinary-event-plan");
const { buildCatalog } = require("./ordinary-evidence-catalog");
const CATALOG_SELECTION = Symbol("checkpoint_catalog_selection");
const facets=new Set(["outcome","constraint","uncertainty","cause"]);
const kinds=new Set(["observation","report","decision","hypothesis","correction","request"]);
const fail=code=>Object.assign(new Error(code),{code});
function decodeCatalogSelection(wire,input) {
  if(!wire||typeof wire!=="object"||Array.isArray(wire)
    ||Object.keys(wire).some(k=>!["protocol","target_date","selected"].includes(k))
    ||wire.protocol!==PROTOCOL||input.protocol!==PROTOCOL||wire.target_date!==input.target_date
    ||!Array.isArray(wire.selected)||!wire.selected.length||wire.selected.length>512)throw fail("summary_catalog_selection");
  // Rebuild from the trusted input, not from candidate text/offsets returned by the model.
  const catalog=buildCatalog(input,()=>({})),known=new Map(catalog.candidates.map(c=>[c.id,c]));
  const seen=new Set(),selected=[];
  for(const row of wire.selected){
    if(!Array.isArray(row)||row.length<1||row.length>3||Object.keys(row).length!==row.length
      ||typeof row[0]!=="string"||!known.has(row[0])||seen.has(row[0])
      ||(row.length>=2&&!facets.has(row[1]))||(row.length===3&&!kinds.has(row[2])))throw fail("summary_catalog_selection");
    seen.add(row[0]);
    selected.push({...known.get(row[0]),facet:row.length>=2?row[1]:"outcome",kind:row.length===3?row[2]:"report"});
  }
  selected.sort((a,b)=>a.unit-b.unit||a.start-b.start);
  for(let i=1;i<selected.length;i++){
    const previous=selected[i-1],current=selected[i];
    if(previous.unit===current.unit&&current.start<previous.end)throw fail("summary_catalog_overlap");
  }
  const events=new Map();
  for(const c of selected){
    if(!events.has(c.unit))events.set(c.unit,{id:"unit_"+c.unit,source_id:c.source_id,evidence:[]});
    events.get(c.unit).evidence.push({unit:c.unit,quote:c.quote,facet:c.facet,kind:c.kind});
  }
  const plan=validateEventPlan({protocol:PROTOCOL,target_date:input.target_date,events:[...events.values()]},input);
  // Immutable copied transport annotations let publication recheck the same choices.
  const selection=Object.freeze({protocol:PROTOCOL,target_date:input.target_date,
    selected:Object.freeze(wire.selected.map(row=>Object.freeze([...row])))});
  return {plan,selection,selected,candidateCount:catalog.candidates.length};
}
function validateCatalogSelection(wire,input,response) {
  const decoded=decodeCatalogSelection(wire,input);
  validateFinalEvidence(decoded.plan,input,response);
  const units=input.sources.flatMap(s=>s.units);
  return {
    catalog_selection_applied:true,catalog_candidate_count:decoded.candidateCount,
    catalog_selected_ids:decoded.selected.map(c=>c.id),
    catalog_selection_columns:["fact_id","candidate_id","unit","start","end"],
    catalog_selection:decoded.selected.map((c,i)=>[
      response.facts[i].id,c.id,c.unit,units[c.unit].start+c.start,units[c.unit].start+c.end]),
    event_grouping:"source_unit_not_semantic",
    model_final_selection_verified:false,
  };
}
module.exports={CATALOG_SELECTION,decodeCatalogSelection,validateCatalogSelection};

"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {buildFactInput,buildSummarySelection,validateAndRenderFacts,SUMMARY_SELECTION}=require("../lib/checkpoint/ordinary-summary-facts");
const {textInput,selectedResponse:reply,factResponse}=require("./checkpoint-fact-fixture.cjs");
const oversized=()=>textInput("**Assistant:** "+"背景。".repeat(1900)+"\n\n最终结果：未解决，决定停止部署。");

test("selection is unnecessary for a body that already fits",()=>{
  const input=textInput("**Assistant:** 最终结果正常。");
  assert.equal(buildSummarySelection(factResponse(input),input,45000),null);
});
test("oversized candidates expose validated immutable quotations and conservative render costs",()=>{
  const input=oversized(),response=factResponse(input),before=JSON.stringify(response);
  const packet=JSON.parse(buildSummarySelection(response,input,45000).prompt);
  assert.deepEqual(packet.candidates.map(f=>f.id),["f1","f2"]);
  assert.equal(packet.candidates[0].quote,input.sources[0].units[0].text);
  assert.equal(packet.summary_budget.max_chars,5000);
  assert.equal(packet.sources[0].assistant_result_required,true);
  assert.ok(packet.candidates.every(f=>f.cost>f.quote.length));
  const selection={selected_fact_ids:["f2"]};
  const rendered=validateAndRenderFacts(response,input,selection);
  assert.match(rendered.episode_summary,/未解决，决定停止部署/);
  assert.ok(!rendered.episode_summary.includes("背景。"));
  assert.deepEqual(rendered.validation.summary_fact_ids,["f2"]);
  assert.equal(rendered.validation.candidate_fact_count,2);
  assert.equal(rendered.validation.candidate_evidence.length,2);
  assert.equal(rendered.validation.evidence.length,1);
  assert.equal(rendered.validation.semantic_quality,"not_independently_verified");
  assert.equal(JSON.stringify(response),before);
  assert.ok(rendered.episode_summary.length<=packet.summary_budget.header_chars+packet.candidates[1].cost);
});
for(const selection of [null,{},[],{selected_fact_ids:[]},{selected_fact_ids:["unknown"]},
  {selected_fact_ids:["f2","f2"]},{selected_fact_ids:[2]},
  {selected_fact_ids:["f2"],quote:"invented"}]){
  test("invalid selection is rejected without replacing facts: "+JSON.stringify(selection),()=>{
    const input=oversized(),response=factResponse(input),before=JSON.stringify(response);
    assert.throws(()=>validateAndRenderFacts(response,input,selection),{code:"summary_selection"});
    assert.equal(JSON.stringify(response),before);
  });
}
test("invalid unselected quotes stop preparation and cannot be discarded to repair a provider response",()=>{
  const input=oversized(),response=factResponse(input);
  response.facts[0].quote="改写的背景";
  assert.throws(()=>buildSummarySelection(response,input,45000),{code:"summary_quote"});
  assert.throws(()=>validateAndRenderFacts(response,input,{selected_fact_ids:["f2"]}),{code:"summary_quote"});
});
test("selection must still represent independent sources and real assistant results",()=>{
  const input=buildFactInput([
    {text:"**Assistant:** "+"背景。".repeat(1900)+"\n\n最终结果正常。",source:"conversation"},
    {text:"**User:** 请检查。\n\n**Assistant:** 03:00 全部正常。",source:"conversation"}
  ],"2026-10-20");
  const response=factResponse(input);
  for(const ids of [["f2"],["f2","f3"]])
    assert.throws(()=>validateAndRenderFacts(response,input,{selected_fact_ids:ids}),{code:"summary_source_coverage"});
  const rendered=validateAndRenderFacts(response,input,{selected_fact_ids:["f2","f4"]});
  assert.match(rendered.episode_summary,/03:00 全部正常/);
});
test("selection cannot orphan either side of correction links or restore derived eligibility",()=>{
  const input=textInput("**Assistant:** "+"背景。".repeat(1900)+"\n\nmode = old。\n\nmode = new，旧设置作废。\n\n无关结果。");
  const response=reply(input,[0,{unit:1,memory_type:"event",config:{key:"mode",value:"old"}},
    {unit:2,kind:"correction",supersedes:["f2"],memory_type:"event",config:{key:"mode",value:"new"}},
    {unit:3,memory_type:"event"}]);
  for(const ids of [["f2"],["f3"]])
    assert.throws(()=>validateAndRenderFacts(response,input,{selected_fact_ids:ids}),{code:"summary_selection_correction"});
  const result=validateAndRenderFacts(response,input,{selected_fact_ids:["f2","f3","f4"]});
  assert.deepEqual(result.validation.derived_excluded_fact_ids,["f2","f3"]);
  assert.deepEqual(result.configs,[]);
  assert.equal(result.smart_memories.length,1);
  assert.match(result.smart_memories[0].text,/无关结果/);
  assert.equal(result.validation.candidate_evidence.length,4);
});
test("standalone corrections can be selected without derived writes or invented old facts",()=>{
  const input=textInput("**Assistant:** "+"背景。".repeat(1900)+"\n\n最终纠正：决定停止。");
  const response=reply(input,[0,{unit:1,kind:"correction",memory_type:"event"}]);
  const result=validateAndRenderFacts(response,input,{selected_fact_ids:["f2"]});
  assert.deepEqual(result.smart_memories,[]);
  assert.deepEqual(result.validation.derived_excluded_fact_ids,["f2"]);
});
test("selecting every oversized candidate still fails the body budget without truncation",()=>{
  const input=oversized(),response=factResponse(input);
  assert.throws(()=>validateAndRenderFacts(response,input,{selected_fact_ids:["f1","f2"]}),{code:"summary_budget"});
  assert.throws(()=>buildSummarySelection(response,input,10),{code:"summary_selection_input_budget"});
});
test("private selection annotation retains original fact IDs and does not alter public fact JSON",()=>{
  const input=oversized(),response=factResponse(input),before=JSON.stringify(response);
  Object.defineProperty(response,SUMMARY_SELECTION,{value:{selected_fact_ids:["f2"]}});
  assert.deepEqual(validateAndRenderFacts(response,input).validation.summary_fact_ids,["f2"]);
  assert.equal(JSON.stringify(response),before);
});

function eventFixture(){
  const input=textInput("**Assistant:** "+"背景。".repeat(1900)+"\n\n事项甲已完成。\n\n事项乙仍待验证。\n\n每日上限为十条。\n\n取消没有运行证据。\n\n原因已确认：采集顺序错误。");
  const response=reply(input,[
    {unit:0,event_id:"background",facet:"context"},
    {unit:1,event_id:"a",facet:"outcome"},
    {unit:2,event_id:"b",facet:"outcome"},
    {unit:3,event_id:"a",facet:"constraint"},
    {unit:4,event_id:"b",facet:"uncertainty"},
    {unit:5,event_id:"a",facet:"cause"}
  ]);
  return {input,response};
}
test("requirements come from extraction events and facets before selection",()=>{
  const {input,response}=eventFixture();
  const packet=JSON.parse(buildSummarySelection(response,input,45000).prompt);
  assert.deepEqual(packet.required_fact_ids,["f4","f5","f6"]);
  assert.deepEqual(packet.events,[
    {source_id:"s0",event_id:"a",outcome_fact_ids:["f2"]},
    {source_id:"s0",event_id:"b",outcome_fact_ids:["f3"]}
  ]);
  assert.throws(()=>validateAndRenderFacts(response,input,{selected_fact_ids:["f2"]}),
    {code:"summary_required_facts"});
  assert.throws(()=>validateAndRenderFacts(response,input,{selected_fact_ids:["f2","f4","f5","f6"]}),
    {code:"summary_event_coverage"});
  const rendered=validateAndRenderFacts(response,input,{selected_fact_ids:["f2","f3","f4","f5","f6"]});
  assert.equal(rendered.validation.declared_event_coverage_complete,true);
  assert.equal(rendered.validation.model_event_groups_verified,false);
  assert.equal(rendered.validation.model_evidence_facets_verified,false);
  assert.equal(rendered.validation.candidate_events.length,6);
  assert.equal(rendered.validation.fact_events.length,5);
  assert.equal(rendered.validation.semantic_quality,"not_independently_verified");
});
for(const [field,value]of [["event_id",undefined],["event_id",""],["event_id",12],["event_id","x".repeat(65)],
  ["facet",undefined],["facet",null],["facet","report"],["facet",[]]]){
  test("missing or invalid event/facet annotations fail instead of being inferred: "+field+"/"+String(value),()=>{
    const input=textInput("**Assistant:** 结果正常。"),response=factResponse(input);
    if(value===undefined)delete response.facts[0][field];else response.facts[0][field]=value;
    assert.throws(()=>validateAndRenderFacts(response,input),{code:"summary_event_structure"});
    assert.throws(()=>buildSummarySelection(response,input,45000),{code:"summary_event_structure"});
  });
}
test("assistant context alone cannot represent an available outcome",()=>{
  const {input,response}=eventFixture();
  assert.throws(()=>validateAndRenderFacts(response,input,{selected_fact_ids:["f1"]}),
    {code:"summary_source_coverage"});
});
test("decision and correction kinds stay mandatory even when mislabeled context",()=>{
  const input=textInput("**Assistant:** "+"背景。".repeat(1900)+"\n\n结果正常。\n\n决定停止部署。");
  const response=reply(input,[{unit:0,facet:"context"},1,{unit:2,kind:"decision",facet:"context"}]);
  assert.throws(()=>validateAndRenderFacts(response,input,{selected_fact_ids:["f2"]}),
    {code:"summary_required_facts"});
  assert.match(validateAndRenderFacts(response,input,{selected_fact_ids:["f2","f3"]}).episode_summary,/决定停止部署/);
});
test("equal event IDs in different sources cannot collapse independent outcomes",()=>{
  const input=buildFactInput(["甲","乙"].map(name=>({source:"conversation",
    text:"**Assistant:** "+"背景。".repeat(1000)+"\n\n"+name+"检查正常。"})),"2026-10-20");
  const response=reply(input,[{unit:0,facet:"context",event_id:"same"}, {unit:1,event_id:"same"},
    {unit:2,facet:"context",event_id:"same"},{unit:3,event_id:"same"}]);
  const packet=JSON.parse(buildSummarySelection(response,input,45000).prompt);
  assert.equal(packet.events.length,2);
  assert.deepEqual(packet.events.map(e=>e.source_id),["s0","s1"]);
  assert.equal(validateAndRenderFacts(response,input,{selected_fact_ids:["f2","f4"]}).validation.declared_event_coverage_complete,true);
});

test("context stays quoted but cannot become a durable memory or configuration",()=>{
  const input=textInput("**Assistant:** mode = old，已被后续纠正。\n\n最终结果：检查已完成。");
  const response=reply(input,[
    {unit:0,facet:"context",memory_type:"pattern",config:{key:"mode",value:"old"}},
    {unit:1,memory_type:"event"}
  ]);
  const rendered=validateAndRenderFacts(response,input);
  assert.match(rendered.episode_summary,/mode = old/);
  assert.deepEqual(rendered.configs,[]);
  assert.equal(rendered.smart_memories.length,1);
  assert.match(rendered.smart_memories[0].text,/最终结果：检查已完成/);
  assert.deepEqual(rendered.validation.derived_excluded_fact_ids,["f1"]);
});

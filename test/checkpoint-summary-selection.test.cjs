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

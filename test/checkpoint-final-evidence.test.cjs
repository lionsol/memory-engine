"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const f=require("../lib/checkpoint/ordinary-summary-facts");
const {textInput,planResponse,modelPlanResponse}=require("./checkpoint-fact-fixture.cjs");
const finish=(input,facts)=>f.completeFinalEvidence(modelPlanResponse(planResponse(input,facts)),input);
test("final extraction transmits complete input once and directly renders only final literal evidence",()=>{
 const input=textInput("**Assistant:** 旧判断：无限回填。每日上限十条。最终确认：只处理当日队列。\n\n"+ "冗长过程。".repeat(1000));
 const packet=f.buildFinalEvidencePrompt(input,45000),wire=JSON.parse(packet.prompt);
 assert.equal(wire.stage,"final_evidence");assert.equal(wire.protocol,"checkpoint-source-facts-v14");
 assert.deepEqual(wire.sources.flatMap(s=>s.units.map(u=>u.text)),input.sources.flatMap(s=>s.units.map(u=>u.text)));
 assert.equal(wire.candidate_rows,undefined);assert.match(packet.system,/没有第二轮/);
 const response=finish(input,[{unit:0,quote:"每日上限十条。",facet:"constraint"},
  {unit:0,quote:"最终确认：只处理当日队列。",facet:"outcome",kind:"correction"}]);
 const rendered=f.validateAndRenderFacts(response,input);
 assert.match(rendered.episode_summary,/每日上限十条/);assert.match(rendered.episode_summary,/只处理当日队列/);
 assert.doesNotMatch(rendered.episode_summary,/无限回填|冗长过程/);
 assert.equal(rendered.validation.final_evidence_count,2);
 assert.equal(rendered.validation.final_evidence_selection_applied,true);
 assert.equal(rendered.validation.candidate_omissions_complete,undefined);
 assert.equal(rendered.validation.model_final_selection_verified,false);
 assert.equal(rendered.validation.unit_coverage_complete,false);
 assert.deepEqual(rendered.smart_memories,[]);assert.deepEqual(rendered.configs,[]);
 assert.equal(response[f.EVENT_PLAN],undefined);assert.ok(response[f.FINAL_EVIDENCE]);
});
test("whole paragraph qualifications remain literal when explicitly selected",()=>{
 const input=textInput("**Assistant:** 样本15条。valid=true，来源为用户。取消事件0条，不能证明取消生效。");
 const result=f.validateAndRenderFacts(finish(input),input);
 assert.match(result.episode_summary,/valid=true/);assert.match(result.episode_summary,/不能证明取消生效/);
});
test("long source paragraph can yield a short final judgment without forcing the whole paragraph into the body",()=>{
 const input=textInput("**Assistant:** 最终已完成。"+"A".repeat(10000));
 const result=f.validateAndRenderFacts(finish(input,[{unit:0,quote:"最终已完成。"}]),input);
 assert.ok(result.episode_summary.length<5000);
 assert.throws(()=>finish(input),{code:"summary_budget"});
});
test("table row context is retained and a bare cell is rejected",()=>{
 const input=textInput("**Assistant:** | 分段 | n | p50 | max |\n|---|---|---|---|\n| embedding | 15 | 333 | 3139 |\n| 其它 | 1 | 9 | 10 |");
 const response=finish(input,[{unit:0,quote:"| embedding | 15 | 333 | 3139 |"}]);
 const result=f.validateAndRenderFacts(response,input);
 assert.match(result.episode_summary,/p50.*max/);assert.doesNotMatch(result.episode_summary,/其它/);
 assert.throws(()=>finish(input,[{unit:0,quote:"333"}]),{code:"summary_plan_table_row_scope"});
});
test("final evidence owns copied annotations and refuses changed quotes, labels, derived fields and reselection",()=>{
 const input=textInput("**Assistant:** 最终确认：原因是令牌过期。");
 const wire=modelPlanResponse(planResponse(input));
 const response=f.completeFinalEvidence(wire,input);wire.events[0][1][0][1]="伪造";
 assert.doesNotThrow(()=>f.validateAndRenderFacts(response,input));
 for(const change of [
  r=>{r.facts[0].quote="令牌过期";},r=>{r.facts[0].kind="decision";},
  r=>{r.facts[0].facet="cause";},r=>{r.facts[0].memory_type="event";},
  r=>{r.facts[0].config={key:"令牌",value:"过期"};}
 ]){const r=finish(input);change(r);assert.throws(()=>f.validateAndRenderFacts(r,input),{code:"summary_plan_fact_scope"});}
 assert.throws(()=>f.validateAndRenderFacts(response,input,{selected_fact_ids:["c1"]}),{code:"summary_plan_selection"});
});
test("source coverage, exact unique spans and overlap remain enforced",()=>{
 const input=f.buildFactInput([{text:"**Assistant:** 甲完成。",source:"conversation"},{text:"**Assistant:** 乙完成。",source:"conversation"}],"2026-10-20");
 assert.throws(()=>finish(input,[{unit:0,quote:"甲完成。"}]),{code:"summary_plan_source_coverage"});
 const repeated=textInput("**Assistant:** 完成。完成。");
 assert.throws(()=>finish(repeated,[{unit:0,quote:"完成。"}]),{code:"summary_plan_quote_ambiguous"});
 const mixed=textInput("**Assistant:** 限制：每天十条。最终已完成。");
 assert.throws(()=>finish(mixed,[{unit:0,quote:mixed.sources[0].units[0].text},{unit:0,quote:"最终已完成。"}]),
  {code:"summary_plan_evidence_overlap"});
});
test("old protocol, selector output and derived fields cannot be accepted as a final response",()=>{
 const input=textInput("**Assistant:** 完成。");
 for(const wire of [
  {...modelPlanResponse(planResponse(input)),protocol:"checkpoint-source-facts-v13"},
  {selected_candidate_ids:["c1"],omissions:[]},
  {...modelPlanResponse(planResponse(input)),configs:[]}
 ])assert.throws(()=>f.completeFinalEvidence(wire,input),{code:"summary_plan_structure"});
 const p=f.buildFinalEvidencePrompt(input,45000);
 assert.doesNotThrow(()=>f.buildFinalEvidencePrompt(input,p.system.length+p.prompt.length));
 assert.throws(()=>f.buildFinalEvidencePrompt(input,p.system.length+p.prompt.length-1),{code:"summary_input_budget"});
});

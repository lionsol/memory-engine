"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {PROTOCOL,EVENT_PLAN,buildFactInput,buildEventPlanPrompt,buildCandidateSelectionPrompt,completeCandidateSelection,validateAndRenderFacts}=require("../lib/checkpoint/ordinary-summary-facts");
const {validateEventPlan}=require("../lib/checkpoint/ordinary-event-plan");
const {textInput,planResponse}=require("./checkpoint-fact-fixture.cjs");
const copy=value=>JSON.parse(JSON.stringify(value));
const ref=(input,unit,facet="outcome",kind="report",quote=input.sources.flatMap(s=>s.units)[unit].text)=>({unit,quote,facet,kind});
function sample(){
 const input=textInput("**Assistant:** 归档任务先前失败，暂疑网络。\n\n最终确认：令牌过期。\n\n归档任务更新令牌后成功，校验通过。\n\n每批上限保持2GB。");
 const plan={protocol:PROTOCOL,target_date:input.target_date,events:[{id:"archive",source_id:"s0",
  evidence:[ref(input,1,"cause","correction"),ref(input,2),ref(input,3,"constraint")]}]};
 return {input,plan};
}
function selected(plan,input,ids){
 const prompt=buildCandidateSelectionPrompt(plan,input,45000),wire=JSON.parse(prompt.prompt);
 const response=completeCandidateSelection(plan,{selected_candidate_ids:ids||wire.candidates.map(c=>c.id)},input);
 return {prompt,wire,response};
}
function cost(wire,ids){
 const chosen=new Set(ids);let total=wire.summary_budget.header_chars,previous=null;
 for(const c of wire.candidates)if(chosen.has(c.id)){
  total+=c.cost;if(c.group_key!==previous)total+=c.group_cost;previous=c.group_key;
 }
 return total;
}
test("full source planning is followed by costed ID selection, with no quote/label rewrite",()=>{
 const {input,plan}=sample(),first=JSON.parse(buildEventPlanPrompt(input,45000).prompt);
 assert.deepEqual(first.sources[0].units.map(u=>u.text),input.sources[0].units.map(u=>u.text));
 const {wire,response,prompt}=selected(plan,input);
 assert.equal(wire.stage,"select");assert.equal(wire.event_plan,undefined);
 assert.ok(!prompt.prompt.includes("暂疑网络"));assert.deepEqual(response.facts.map(f=>f.id),["c1","c2","c3"]);
 assert.equal(response.facts[0].kind,"correction");assert.equal(response.facts[0].quote,plan.events[0].evidence[0].quote);
 const result=validateAndRenderFacts(response,input);
 assert.equal(result.validation.selected_candidate_coverage_complete,true);
 assert.equal(result.validation.candidate_pool_coverage_complete,true);
 assert.equal(result.validation.model_final_selection_verified,false);
 assert.equal(result.validation.event_plan_coverage_complete,undefined);
 assert.equal(JSON.stringify(response).includes("selected_candidate_ids"),false);
 assert.equal(result.episode_summary.length,cost(wire,["c1","c2","c3"]));
});
for(const [name,change,code] of [
 ["old protocol",p=>p.protocol="checkpoint-source-facts-v10","summary_plan_structure"],
 ["topic",p=>p.events[0].topic="invented","summary_plan_structure"],
 ["retired spans",p=>p.events[0].retired_evidence=[],"summary_plan_structure"],
 ["retired units",p=>p.events[0].retired_units=[],"summary_plan_structure"],
 ["empty evidence",p=>p.events[0].evidence=[],"summary_plan_structure"],
 ["unknown unit",p=>p.events[0].evidence[0].unit=999,"summary_plan_evidence"],
 ["wrong taxonomy",p=>p.events[0].evidence[0].facet="correction","summary_plan_evidence"],
 ["context facet",p=>p.events[0].evidence[0].facet="context","summary_plan_evidence"],
 ["invalid kind",p=>p.events[0].evidence[0].kind="cause","summary_plan_evidence"],
 ["missing scope",p=>delete p.events[0].evidence[0].quote,"summary_plan_quote"],
 ["rewritten scope",p=>p.events[0].evidence[0].quote="最终确认：网络故障。","summary_plan_quote"],
 ["overlap",p=>p.events[0].evidence.push(copy(p.events[0].evidence[0])),"summary_plan_evidence_overlap"],
 ["duplicate event",p=>p.events.push(copy(p.events[0])),"summary_plan_structure"]
])test("invalid candidate pool is rejected before selection: "+name,()=>{
 const {input,plan}=sample();change(plan);const before=JSON.stringify(plan);
 assert.throws(()=>buildCandidateSelectionPrompt(plan,input,45000),{code});assert.equal(JSON.stringify(plan),before);
});
for(const protocol of ["checkpoint-source-facts-v7","checkpoint-source-facts-v8","checkpoint-source-facts-v9","checkpoint-source-facts-v10"])
 test("old input refused before planning: "+protocol,()=>{
  const {input}=sample();input.protocol=protocol;
  assert.throws(()=>buildEventPlanPrompt(input,45000),{code:"summary_input_protocol"});
 });
test("source coverage and same-source binding still apply to candidates and final selection",()=>{
 const input=buildFactInput([{text:"**Assistant:** 甲完成。",source:"conversation"},{text:"**Assistant:** 乙正常。",source:"conversation"}],"2026-10-20"),plan=planResponse(input);
 const cross=copy(plan);cross.events[0].evidence[0].unit=1;
 assert.throws(()=>validateEventPlan(cross,input),{code:"summary_plan_evidence"});
 const missing=copy(plan);missing.events.pop();
 assert.throws(()=>validateEventPlan(missing,input),{code:"summary_plan_source_coverage"});
 assert.throws(()=>completeCandidateSelection(plan,{selected_candidate_ids:["c1"]},input),{code:"summary_source_coverage"});
});
test("user request alone cannot represent an assistant source after selection",()=>{
 const input=textInput("**User:** 检查归档。\n\n**Assistant:** 归档完成。"),plan=planResponse(input);
 assert.throws(()=>completeCandidateSelection(plan,{selected_candidate_ids:["c1"]},input),{code:"summary_source_coverage"});
});
test("control markers remain unavailable as candidates",()=>{
 const input=textInput("**Assistant:** HEARTBEAT_OK\n\n完成。"),plan=planResponse(input);
 plan.events[0].evidence[0].unit=0;
 assert.throws(()=>validateEventPlan(plan,input),{code:"summary_plan_evidence"});
});
test("source context contains only the original heading, never following unselected paragraph text",()=>{
 const input=textInput("**Assistant:** **03:00 归档任务**\n不发送这行旧说明。\n\n重跑成功。"),plan=planResponse(input);
 plan.events[0].evidence=[ref(input,1)];
 const {wire,prompt,response}=selected(plan,input);
 assert.deepEqual(wire.candidates[0].context.map(c=>[c.kind,c.text]),[["heading","**03:00 归档任务**"]]);
 assert.ok(!prompt.prompt.includes("不发送这行旧说明"));
 assert.match(validateAndRenderFacts(response,input).episode_summary,/03:00 归档任务/);
});
for(const payload of [{},{selected_candidate_ids:[]},{selected_candidate_ids:["c1","c1"]},{selected_candidate_ids:["unknown"]},
 {selected_candidate_ids:"c1"},{selected_fact_ids:["c1"]},{selected_candidate_ids:["c1"],facts:[]},
 {selected_candidate_ids:["c1"],kind:"report"}])
 test("ID response is strict, nonempty and known: "+JSON.stringify(payload),()=>{
  const {input,plan}=sample();
  assert.throws(()=>completeCandidateSelection(plan,payload,input),{code:"summary_candidate_selection"});
 });
for(const [name,change,code] of [
 ["missing selected fact",r=>r.facts.pop(),"summary_plan_fact_scope"],
 ["changed event",r=>r.facts[0].event_id="different","summary_plan_fact_scope"],
 ["changed facet",r=>r.facts[0].facet="uncertainty","summary_plan_fact_scope"],
 ["missing nondefault kind",r=>delete r.facts[0].kind,"summary_plan_fact_scope"],
 ["changed quote",r=>r.facts[1].quote="归档任务更新令牌后成功","summary_plan_fact_scope"],
 ["rewritten quote",r=>r.facts[0].quote="invented","summary_quote"],
 ["unselected earlier claim",r=>r.facts.push({id:"old",unit:0,quote:"归档任务先前失败，暂疑网络。",event_id:"archive",facet:"outcome",kind:"report"}),"summary_plan_fact_scope"],
 ["injected derivation",r=>r.facts[0].memory_type="event","summary_plan_fact_scope"]
])test("program-owned facts are rechecked before publication: "+name,()=>{
 const {input,plan}=sample(),{response}=selected(plan,input);change(response);
 assert.throws(()=>validateAndRenderFacts(response,input),{code});
});
test("both complete request budgets include instructions, candidates, costs and context",()=>{
 const {input,plan}=sample(),first=buildEventPlanPrompt(input,45000),second=buildCandidateSelectionPrompt(plan,input,45000);
 assert.deepEqual(buildEventPlanPrompt(input,first.system.length+first.prompt.length),first);
 assert.throws(()=>buildEventPlanPrompt(input,first.system.length+first.prompt.length-1),{code:"summary_input_budget"});
 assert.deepEqual(buildCandidateSelectionPrompt(plan,input,second.system.length+second.prompt.length),second);
 assert.throws(()=>buildCandidateSelectionPrompt(plan,input,second.system.length+second.prompt.length-1),{code:"summary_plan_input_budget"});
});
test("legacy required-all ID annotation cannot alter an already completed final selection",()=>{
 const {input,plan}=sample(),{response}=selected(plan,input);
 assert.throws(()=>validateAndRenderFacts(response,input,{selected_fact_ids:["c2"]}),{code:"summary_plan_selection"});
});
test("report-only selected evidence remains summary-only without retirement/correction labels",()=>{
 const input=textInput("**Assistant:** 每日上限十条。\n\n最终任务成功。"),plan=planResponse(input),{response}=selected(plan,input);
 const result=validateAndRenderFacts(response,input);
 assert.deepEqual(result.smart_memories,[]);assert.deepEqual(result.configs,[]);
 assert.deepEqual(result.validation.plan_non_derivable_fact_ids,["c1","c2"]);
 assert.equal(result.validation.plan_derivation_policy,"summary_only_unverified_selection");
});
test("candidate audit and selected evidence are distinguished in persistent metadata",()=>{
 const {input,plan}=sample(),{response}=selected(plan,input,["c2","c3"]),result=validateAndRenderFacts(response,input);
 assert.equal(result.validation.candidate_count,3);assert.equal(result.validation.selected_candidate_count,2);
 assert.equal(result.validation.candidate_pool_coverage_complete,false);
 assert.deepEqual(result.validation.excluded_candidate_ids,["c1"]);
 assert.equal(result.validation.candidate_evidence.length,3);assert.equal(result.validation.plan_evidence.length,2);
 assert.deepEqual(result.validation.selected_candidate_ids,["c2","c3"]);
});
test("large provisional pools can select a feasible final result without freezing obsolete constraints/events",()=>{
 const input=textInput("**Assistant:** "+Array.from({length:24},(_,i)=>"旧运行"+i+"的记录。"+"背景".repeat(125)+"。").concat("最终只需记录：任务成功。").join("\n\n"));
 const plan=planResponse(input);plan.events[0].evidence[0].kind="decision";plan.events[0].evidence[0].facet="constraint";
 const all=JSON.parse(buildCandidateSelectionPrompt(plan,input,45000).prompt).candidates.map(c=>c.id);
 assert.throws(()=>completeCandidateSelection(plan,{selected_candidate_ids:all},input),e=>e.code==="summary_budget"&&e.observedSummaryChars>5000);
 const result=validateAndRenderFacts(completeCandidateSelection(plan,{selected_candidate_ids:["c25"]},input),input);
 assert.match(result.episode_summary,/任务成功/);assert.doesNotMatch(result.episode_summary,/旧运行/);
 assert.equal(result.validation.candidate_count,25);assert.equal(result.validation.selected_candidate_count,1);
});
test("displayed cost formula equals the actual renderer across role switches, escaping, context and arbitrary selections",()=>{
 const input=buildFactInput([{source:"conversation",text:"**Assistant:** 检查标题：\n\n结果 <a>&。\n\n**User:** 决定停止。\n\n**Assistant:** 已停止。\n\n| A | B |\n|---|---|\n| 行 | 2 |"},
 {source:"conversation",text:"**Assistant:** 独立正常。"}],"2026-10-20"),plan=planResponse(input);
 const wire=JSON.parse(buildCandidateSelectionPrompt(plan,input,45000).prompt);
 let checked=0;
 for(let mask=1;mask<2**wire.candidates.length;mask++){
  const ids=wire.candidates.filter((_,i)=>mask&(1<<i)).map(c=>c.id);
  try{
   const result=validateAndRenderFacts(completeCandidateSelection(plan,{selected_candidate_ids:ids},input),input);
   assert.equal(result.episode_summary.length,cost(wire,ids));checked++;
  }catch(error){if(error.code!=="summary_source_coverage")throw error;}
 }
 assert.ok(checked>10);
});
test("same-paragraph old claims cannot be restored by returning a new candidate identifier",()=>{
 const input=textInput("**Assistant:** 旧判断：无限回填。每日十条上限。最终只处理当日。");
 const plan=planResponse(input,[{unit:0,quote:"每日十条上限。",event_id:"queue",facet:"constraint"},
  {unit:0,quote:"最终只处理当日。",event_id:"queue",facet:"outcome"}]);
 const {response,prompt}=selected(plan,input);assert.ok(!prompt.prompt.includes("无限回填"));
 response.facts[0].quote="旧判断：无限回填。";
 assert.throws(()=>validateAndRenderFacts(response,input),{code:"summary_plan_fact_scope"});
});
test("ambiguous and malformed literal scopes remain rejected before ID selection",()=>{
 const input=textInput("**Assistant:** 成功。成功。"),plan=planResponse(input);plan.events[0].evidence[0].quote="成功。";
 assert.throws(()=>validateEventPlan(plan,input),{code:"summary_plan_quote_ambiguous"});
 plan.events[0].evidence[0].quote="\ud800";
 assert.throws(()=>validateEventPlan(plan,input),{code:"summary_plan_quote"});
});

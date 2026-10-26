"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {PROTOCOL,EVENT_PLAN,buildFactInput,buildEventPlanPrompt,buildPlannedFactPrompt,validateAndRenderFacts}=require("../lib/checkpoint/ordinary-summary-facts");
const {validateEventPlan}=require("../lib/checkpoint/ordinary-event-plan");
const {textInput,planResponse,plannedFactResponse}=require("./checkpoint-fact-fixture.cjs");
const copy=value=>JSON.parse(JSON.stringify(value));
const ref=(input,unit,facet="outcome",kind="report",quote=input.sources.flatMap(s=>s.units)[unit].text)=>({unit,quote,facet,kind});
function sample(){
 const input=textInput("**Assistant:** 归档任务先前失败，暂疑网络。\n\n最终确认：令牌过期。\n\n归档任务更新令牌后成功，校验通过。\n\n每批上限保持2GB。");
 const plan={protocol:PROTOCOL,target_date:input.target_date,events:[{id:"archive",source_id:"s0",
  evidence:[ref(input,1,"cause","correction"),ref(input,2),ref(input,3,"constraint")]}]};
 return {input,plan};
}
function extracted(plan,input){
 const prompt=buildPlannedFactPrompt(plan,input,45000),wire=JSON.parse(prompt.prompt);
 const response=plannedFactResponse(wire);Object.defineProperty(response,EVENT_PLAN,{value:plan});
 return {response,prompt,wire};
}
test("planning sees full input; quotation receives only selected scopes and stable indices",()=>{
 const {input,plan}=sample(),first=buildEventPlanPrompt(input,45000),wire=JSON.parse(first.prompt);
 assert.deepEqual(wire.sources[0].units.map(u=>u.text),input.sources[0].units.map(u=>u.text));
 assert.deepEqual(wire.plan_contract.event_fields,["id","source_id","evidence"]);
 assert.equal(wire.fact_contract,undefined);
 const {response,prompt,wire:second}=extracted(plan,input);
 assert.deepEqual(second.sources[0].units.map(u=>u.index),[1,2,3]);
 assert.ok(second.sources[0].units.every(u=>u.text===undefined));assert.ok(!prompt.prompt.includes("暂疑网络"));
 const result=validateAndRenderFacts(response,input);
 assert.doesNotMatch(result.episode_summary,/暂疑网络/);assert.match(result.episode_summary,/令牌过期/);
 assert.equal(result.validation.event_plan_coverage_complete,true);assert.equal(result.validation.model_event_plan_verified,false);
 assert.equal(result.validation.plan_retired,undefined);assert.equal(result.validation.input_units.length,4);
});
for(const [name,change,code] of [
 ["old protocol",p=>p.protocol="checkpoint-source-facts-v9","summary_plan_structure"],
 ["topic no longer accepted",p=>p.events[0].topic="UNSUPPORTED_CAUSE","summary_plan_structure"],
 ["retired spans no longer accepted",p=>p.events[0].retired_evidence=[],"summary_plan_structure"],
 ["retired units no longer accepted",p=>p.events[0].retired_units=[],"summary_plan_structure"],
 ["empty evidence",p=>p.events[0].evidence=[],"summary_plan_structure"],
 ["unknown unit",p=>p.events[0].evidence[0].unit=999,"summary_plan_evidence"],
 ["wrong taxonomy",p=>p.events[0].evidence[0].facet="correction","summary_plan_evidence"],
 ["context facet",p=>p.events[0].evidence[0].facet="context","summary_plan_evidence"],
 ["invalid kind",p=>p.events[0].evidence[0].kind="cause","summary_plan_evidence"],
 ["missing literal scope",p=>delete p.events[0].evidence[0].quote,"summary_plan_quote"],
 ["rewritten literal scope",p=>p.events[0].evidence[0].quote="最终确认：网络故障。","summary_plan_quote"],
 ["overlapping evidence",p=>p.events[0].evidence.push(copy(p.events[0].evidence[0])),"summary_plan_evidence_overlap"],
 ["duplicate event",p=>p.events.push(copy(p.events[0])),"summary_plan_structure"]
])test("invalid selection stops before quoting without repairing provider response: "+name,()=>{
 const {input,plan}=sample();change(plan);const before=JSON.stringify(plan);
 assert.throws(()=>buildPlannedFactPrompt(plan,input,45000),{code});assert.equal(JSON.stringify(plan),before);
});
for(const protocol of ["checkpoint-source-facts-v7","checkpoint-source-facts-v8","checkpoint-source-facts-v9"])test("old input is refused before any planning request: "+protocol,()=>{
 const {input}=sample();input.protocol=protocol;
 assert.throws(()=>buildEventPlanPrompt(input,45000),{code:"summary_input_protocol"});
});
test("source binding cannot borrow a scope from another source or omit its assistant evidence",()=>{
 const input=buildFactInput([{text:"**Assistant:** 甲已完成。",source:"conversation"},{text:"**Assistant:** 乙待确认。",source:"conversation"}],"2026-10-20"),plan=planResponse(input);
 const cross=copy(plan);cross.events[0].evidence[0].unit=1;
 assert.throws(()=>validateEventPlan(cross,input),{code:"summary_plan_evidence"});
 const missing=copy(plan);missing.events.pop();
 assert.throws(()=>validateEventPlan(missing,input),{code:"summary_plan_source_coverage"});
});
test("an assistant source cannot be represented only by a user check request",()=>{
 const input=textInput("**User:** 检查归档。\n\n**Assistant:** 归档已完成。"),plan=planResponse(input);
 plan.events[0].evidence=plan.events[0].evidence.slice(0,1);
 assert.throws(()=>validateEventPlan(plan,input),{code:"summary_plan_source_coverage"});
});
test("control markers remain unavailable as evidence",()=>{
 const input=textInput("**Assistant:** HEARTBEAT_OK\n\n最终完成。"),plan=planResponse(input);
 plan.events[0].evidence[0].unit=0;
 assert.throws(()=>validateEventPlan(plan,input),{code:"summary_plan_evidence"});
});
test("only the necessary source heading is sent, never its unselected following paragraph text",()=>{
 const input=textInput("**Assistant:** **03:00 归档任务**\n不发送这行旧说明。\n\n重跑成功。"),plan=planResponse(input);
 plan.events[0].evidence=[ref(input,1)];
 const {response,prompt,wire}=extracted(plan,input);
 assert.deepEqual(wire.sources[0].units.map(u=>u.index),[0,1]);
 assert.deepEqual(wire.sources[0].units[0].contexts.map(c=>[c.kind,c.text]),[["heading","**03:00 归档任务**"]]);
 assert.ok(!prompt.prompt.includes("不发送这行旧说明"));
 assert.match(validateAndRenderFacts(response,input).episode_summary,/03:00 归档任务/);
 response.facts.push({unit:0,quote:"**03:00 归档任务**",event_id:"fixture",facet:"outcome"});
 assert.throws(()=>validateAndRenderFacts(response,input),{code:"summary_plan_fact_scope"});
});
for(const [name,change,code] of [
 ["missing limit",r=>r.facts.pop(),"summary_plan_fact_coverage"],
 ["changed event",r=>r.facts[0].event_id="other","summary_plan_fact_scope"],
 ["changed facet",r=>r.facts[0].facet="uncertainty","summary_plan_fact_scope"],
 ["changed kind",r=>r.facts[0].kind="report","summary_plan_fact_scope"],
 ["unselected earlier claim",r=>r.facts.push({unit:0,quote:"归档任务先前失败，暂疑网络。",event_id:"archive",facet:"outcome"}),"summary_plan_fact_scope"],
 ["rewritten quote",r=>r.facts[0].quote="最终确认：网络故障。","summary_quote"]
])test("quotation remains fail closed: "+name,()=>{
 const {input,plan}=sample(),{response}=extracted(plan,input);change(response);
 assert.throws(()=>validateAndRenderFacts(response,input),{code});
});
test("one literal source range cannot be registered twice under different events",()=>{
 const {input,plan}=sample();plan.events.push({id:"other",source_id:"s0",evidence:[ref(input,2,"cause","report","校验通过")]});
 assert.throws(()=>validateEventPlan(plan,input),{code:"summary_plan_evidence_overlap"});
});
test("both request budgets include complete instructions, scopes and source context without truncation",()=>{
 const {input,plan}=sample(),first=buildEventPlanPrompt(input,45000),second=buildPlannedFactPrompt(plan,input,45000);
 assert.deepEqual(buildEventPlanPrompt(input,first.system.length+first.prompt.length),first);
 assert.throws(()=>buildEventPlanPrompt(input,first.system.length+first.prompt.length-1),{code:"summary_input_budget"});
 assert.deepEqual(buildPlannedFactPrompt(plan,input,second.system.length+second.prompt.length),second);
 assert.throws(()=>buildPlannedFactPrompt(plan,input,second.system.length+second.prompt.length-1),{code:"summary_plan_input_budget"});
});
test("obsolete ID selection cannot strip planned evidence",()=>{
 const {input,plan}=sample(),{response}=extracted(plan,input);
 assert.throws(()=>validateAndRenderFacts(response,input,{selected_fact_ids:["f2"]}),{code:"summary_plan_selection"});
});
test("even report-only plans cannot derive long-term memory/config without correction or retirement labels",()=>{
 const input=textInput("**Assistant:** 每日上限十条。\n\n最终任务成功。"),plan=planResponse(input),{response}=extracted(plan,input);
 response.facts[0].memory_type="preference";response.facts[0].config={key:"每日",value:"十条"};
 response.facts[1].memory_type="event";
 const before=JSON.stringify(response),result=validateAndRenderFacts(response,input);
 assert.deepEqual(result.smart_memories,[]);assert.deepEqual(result.configs,[]);
 assert.deepEqual(result.validation.plan_non_derivable_fact_ids,["f1","f2"]);
 assert.equal(result.validation.plan_derivation_policy,"summary_only_unverified_selection");
 assert.equal(JSON.stringify(response),before);
});
test("selection metadata contains original scope offsets, never invented planning prose",()=>{
 const {input,plan}=sample(),{response}=extracted(plan,input),result=validateAndRenderFacts(response,input);
 assert.deepEqual(result.validation.planned_event_columns,["source_id","event_id"]);
 assert.deepEqual(result.validation.plan_evidence[0],["s0","archive",1,input.sources[0].units[1].start,input.sources[0].units[1].end,"cause","correction"]);
 assert.equal(result.validation.plan_retired_columns,undefined);
});
test("literal date/config scope checks are retained before summary-only derivation exclusion",()=>{
 const {input,plan}=sample(),{response}=extracted(plan,input);
 response.facts[0].config={key:"令牌",value:"过期"};response.facts[0].memory_type="event";
 assert.deepEqual(validateAndRenderFacts(response,input).configs,[]);
 response.facts[2].subject_dates=["2099-01-01"];
 assert.throws(()=>validateAndRenderFacts(response,input),{code:"summary_fact_scope"});
});
function mixed(){
 const input=textInput("**Assistant:** 旧判断：可无限回填；每天十条上限保持。后来确认：只处理当日队列。未选说明也不能写入。");
 const plan={protocol:PROTOCOL,target_date:input.target_date,events:[{id:"queue",source_id:"s0",
  evidence:[ref(input,0,"constraint","report","每天十条上限保持。"),ref(input,0,"outcome","correction","后来确认：只处理当日队列。")]}]};
 return {input,plan};
}
test("mixed paragraphs keep final constraints and outcome without any retirement manifest",()=>{
 const {input,plan}=mixed(),{response,prompt}=extracted(plan,input);
 assert.ok(!prompt.prompt.includes("可无限回填"));assert.ok(!prompt.prompt.includes("未选说明"));
 const result=validateAndRenderFacts(response,input);
 assert.match(result.episode_summary,/每天十条上限保持/);assert.match(result.episode_summary,/只处理当日队列/);
 assert.doesNotMatch(result.episode_summary,/可无限回填|未选说明/);
});
for(const quote of ["旧判断：可无限回填；","未选说明也不能写入。","旧判断：可无限回填；每天十条上限保持。","每天十条上限保持。后来确认：只处理当日队列。"])
 test("same-paragraph quote cannot escape its allowed range: "+quote,()=>{
  const {input,plan}=mixed(),{response}=extracted(plan,input);response.facts[0].quote=quote;
  assert.throws(()=>validateAndRenderFacts(response,input),{code:"summary_plan_quote_scope"});
 });
test("later clarification may live in another event without requiring a reverse chronology retirement relation",()=>{
 const input=textInput("**Assistant:** 确实补了十条。但永远追不上。\n\n上限十条明确保留；旧队列不能当作新版可恢复队列。");
 const plan={protocol:PROTOCOL,target_date:input.target_date,events:[
  {id:"write",source_id:"s0",evidence:[ref(input,0,"outcome","report","确实补了十条。")]},
  {id:"scope",source_id:"s0",evidence:[ref(input,1,"constraint")]}]};
 const {response,prompt}=extracted(plan,input);
 assert.ok(!prompt.prompt.includes("永远追不上"));
 assert.match(validateAndRenderFacts(response,input).episode_summary,/旧队列不能当作/);
});
test("each disjoint scope must be covered even with identical source/event/unit/facet/kind",()=>{
 const input=textInput("**Assistant:** 甲任务成功。乙任务成功。"),plan=planResponse(input);
 plan.events[0].evidence=[ref(input,0,"outcome","report","甲任务成功。"),ref(input,0,"outcome","report","乙任务成功。")];
 const {response}=extracted(plan,input);validateAndRenderFacts(response,input);response.facts.pop();
 assert.throws(()=>validateAndRenderFacts(response,input),{code:"summary_plan_fact_coverage"});
});
test("literal binding still rejects ambiguous occurrences and malformed Unicode",()=>{
 const input=textInput("**Assistant:** 成功。成功。"),plan=planResponse(input);
 plan.events[0].evidence[0].quote="成功。";
 assert.throws(()=>validateEventPlan(plan,input),{code:"summary_plan_quote_ambiguous"});
 plan.events[0].evidence[0].quote="\ud800";
 assert.throws(()=>validateEventPlan(plan,input),{code:"summary_plan_quote"});
});
test("range coverage is explicitly not a semantic completeness certificate",()=>{
 const {input,plan}=sample(),{response}=extracted(plan,input);response.facts[1].quote="归档任务更新令牌后成功";
 const result=validateAndRenderFacts(response,input);
 assert.equal(result.validation.event_plan_coverage_complete,true);assert.equal(result.validation.model_event_plan_verified,false);
});

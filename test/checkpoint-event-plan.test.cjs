"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {PROTOCOL,EVENT_PLAN,buildFactInput,buildEventPlanPrompt,buildPlannedFactPrompt,validateAndRenderFacts}=require("../lib/checkpoint/ordinary-summary-facts");
const {validateEventPlan}=require("../lib/checkpoint/ordinary-event-plan");
const {textInput,planResponse,plannedFactResponse}=require("./checkpoint-fact-fixture.cjs");
const copy=value=>JSON.parse(JSON.stringify(value));
const ref=(input,unit,facet="outcome",kind="report",quote=input.sources.flatMap(s=>s.units)[unit].text)=>({unit,quote,facet,kind});
const removed=(input,unit,quote=input.sources.flatMap(s=>s.units)[unit].text)=>({unit,quote});
function sample(){
 const input=textInput("**Assistant:** 归档任务先前失败，暂疑网络。\n\n最终确认：令牌过期。\n\n归档任务更新令牌后成功，校验通过。\n\n每批上限保持2GB。");
 const plan={protocol:PROTOCOL,target_date:input.target_date,events:[{id:"archive",source_id:"s0",topic:"归档最终结果、原因及限制",
  evidence:[ref(input,1,"cause","correction"),ref(input,2),ref(input,3,"constraint")],retired_evidence:[removed(input,0)]}]};
 return {input,plan};
}
function extracted(plan,input){
 const prompt=buildPlannedFactPrompt(plan,input,45000),wire=JSON.parse(prompt.prompt);
 const response=plannedFactResponse(wire);
 Object.defineProperty(response,EVENT_PLAN,{value:plan});
 return {response,prompt,wire};
}
test("planning sees full originals while quotation receives only literal scopes and stable source indices",()=>{
 const {input,plan}=sample(),first=buildEventPlanPrompt(input,45000),firstWire=JSON.parse(first.prompt);
 assert.equal(firstWire.stage,"plan");assert.equal(firstWire.fact_contract,undefined);
 assert.deepEqual(firstWire.sources[0].units.map(u=>u.text),input.sources[0].units.map(u=>u.text));
 const {response,wire,prompt}=extracted(plan,input);
 assert.equal(wire.stage,"extract");assert.deepEqual(wire.sources[0].units.map(u=>u.index),[1,2,3]);
 assert.ok(!prompt.prompt.includes("暂疑网络"));
 assert.ok(wire.sources[0].units.every(unit=>unit.text===undefined));
 const body=validateAndRenderFacts(response,input);
 assert.match(body.episode_summary,/令牌过期/);assert.doesNotMatch(body.episode_summary,/暂疑网络/);
 assert.equal(body.validation.event_plan_coverage_complete,true);assert.equal(body.validation.model_event_plan_verified,false);
 const old=input.sources[0].units[0];
 assert.deepEqual(body.validation.plan_retired,[["s0","archive",0,old.start,old.end]]);
 assert.equal(body.validation.input_units.length,4);
});
for(const [name,change,code]of [
 ["legacy protocol",p=>p.protocol="checkpoint-source-facts-v8","summary_plan_structure"],
 ["extra field",p=>p.events[0].quote="invented","summary_plan_structure"],
 ["empty evidence",p=>p.events[0].evidence=[],"summary_plan_structure"],
 ["unknown unit",p=>p.events[0].evidence[0].unit=999,"summary_plan_evidence"],
 ["context is not final-state role",p=>p.events[0].evidence[0].facet="context","summary_plan_evidence"],
 ["wrong taxonomy",p=>p.events[0].evidence[0].facet="correction","summary_plan_evidence"],
 ["invalid kind",p=>p.events[0].evidence[0].kind="cause","summary_plan_evidence"],
 ["missing scope",p=>delete p.events[0].evidence[0].quote,"summary_plan_quote"],
 ["rewritten scope",p=>p.events[0].evidence[0].quote="最终确认：网络故障。","summary_plan_quote"],
 ["duplicate evidence",p=>p.events[0].evidence.push(copy(p.events[0].evidence[0])),"summary_plan_evidence_overlap"],
 ["duplicate event",p=>p.events.push(copy(p.events[0])),"summary_plan_structure"],
 ["live retired",p=>p.events[0].retired_evidence=[{unit:1,quote:p.events[0].evidence[0].quote}],"summary_plan_retired"],
 ["future retired",p=>p.events[0].retired_evidence=[{unit:3,quote:p.events[0].evidence[2].quote}],"summary_plan_retired"],
 ["invalid retired",p=>p.events[0].retired_evidence=["0"],"summary_plan_retired"],
 ["duplicate retired",p=>p.events[0].retired_evidence.push(copy(p.events[0].retired_evidence[0])),"summary_plan_retired"],
 ["old paragraph retirement field",p=>p.events[0].retired_units=[0],"summary_plan_structure"]
]){
 test("invalid plan stops before quoting without modifying provider response: "+name,()=>{
  const {input,plan}=sample();change(plan);const before=JSON.stringify(plan);
  assert.throws(()=>buildPlannedFactPrompt(plan,input,45000),{code});assert.equal(JSON.stringify(plan),before);
 });
}
for(const protocol of ["checkpoint-source-facts-v7","checkpoint-source-facts-v8"])test("legacy input is refused before planning: "+protocol,()=>{
 const {input}=sample();input.protocol=protocol;
 assert.throws(()=>buildEventPlanPrompt(input,45000),{code:"summary_input_protocol"});
});
test("planning cannot borrow another source's scope or omit an assistant source",()=>{
 const input=buildFactInput([{text:"**Assistant:** 甲已完成。",source:"conversation"},{text:"**Assistant:** 乙待确认。",source:"conversation"}],"2026-10-20");
 const plan=planResponse(input),cross=copy(plan);cross.events[0].evidence[0].unit=1;
 assert.throws(()=>validateEventPlan(cross,input),{code:"summary_plan_evidence"});
 const missing=copy(plan);missing.events.pop();
 assert.throws(()=>validateEventPlan(missing,input),{code:"summary_plan_source_coverage"});
});
test("an assistant source cannot be represented only by a user check request",()=>{
 const input=textInput("**User:** 检查归档。\n\n**Assistant:** 归档已完成。"),plan=planResponse(input);
 plan.events[0].evidence=plan.events[0].evidence.slice(0,1);
 assert.throws(()=>validateEventPlan(plan,input),{code:"summary_plan_source_coverage"});
});
test("control scopes and retired heading fragments are rejected before quote context",()=>{
 const input=textInput("**Assistant:** HEARTBEAT_OK\n\n最终完成。"),plan=planResponse(input);
 plan.events[0].evidence[0].unit=0;
 assert.throws(()=>validateEventPlan(plan,input),{code:"summary_plan_evidence"});
 const headed=textInput("**Assistant:** **旧推测：网络原因**\n\n最终完成。"),p=planResponse(headed);
 p.events[0].evidence=[ref(headed,1)];p.events[0].retired_evidence=[removed(headed,0,"网络原因")];
 assert.throws(()=>validateEventPlan(p,headed),{code:"summary_plan_retired_context"});
});
test("necessary original headings are context only and never expose the rest of their paragraph",()=>{
 const input=textInput("**Assistant:** **03:00 归档任务**\n这行旧说明不在标题范围。\n\n重跑成功。"),plan=planResponse(input);
 plan.events[0].evidence=[ref(input,1)];
 const {response,wire,prompt}=extracted(plan,input);
 assert.deepEqual(wire.sources[0].units.map(u=>u.index),[0,1]);
 assert.equal(wire.sources[0].units[0].context_text,"**03:00 归档任务**");
 assert.ok(!prompt.prompt.includes("这行旧说明"));
 assert.match(validateAndRenderFacts(response,input).episode_summary,/03:00 归档任务/);
 response.facts.push({unit:0,quote:"**03:00 归档任务**",event_id:"fixture",facet:"outcome"});
 assert.throws(()=>validateAndRenderFacts(response,input),{code:"summary_plan_fact_scope"});
});
for(const [name,change,code]of [
 ["missing planned limit",r=>r.facts.pop(),"summary_plan_fact_coverage"],
 ["changed event",r=>r.facts[0].event_id="different","summary_plan_fact_scope"],
 ["changed facet",r=>r.facts[0].facet="uncertainty","summary_plan_fact_scope"],
 ["changed kind",r=>r.facts[0].kind="report","summary_plan_fact_scope"],
 ["revived old claim",r=>r.facts.push({unit:0,quote:"归档任务先前失败，暂疑网络。",event_id:"archive",facet:"outcome"}),"summary_plan_retired_fact"],
 ["rewritten quote",r=>r.facts[0].quote="最终确认：网络故障。","summary_quote"]
]){
 test("planned extraction stays fail closed: "+name,()=>{
  const {input,plan}=sample(),{response}=extracted(plan,input);change(response);
  assert.throws(()=>validateAndRenderFacts(response,input),{code});
 });
}
test("retirement cannot overlap another event's live scope",()=>{
 const {input,plan}=sample();
 plan.events.push({id:"other",source_id:"s0",topic:"另一事项",evidence:[ref(input,0)]});
 assert.throws(()=>validateEventPlan(plan,input),{code:"summary_plan_retired"});
});
test("repeated or overlapping live evidence across events is rejected rather than double-counted",()=>{
 const {input,plan}=sample();
 plan.events.push({id:"other",source_id:"s0",topic:"重复的同一结果",evidence:[ref(input,2,"cause","report","校验通过")]});
 assert.throws(()=>validateEventPlan(plan,input),{code:"summary_plan_evidence_overlap"});
});
test("both input budgets count instructions and metadata without truncation",()=>{
 const {input,plan}=sample(),first=buildEventPlanPrompt(input,45000),second=buildPlannedFactPrompt(plan,input,45000);
 assert.deepEqual(buildEventPlanPrompt(input,first.system.length+first.prompt.length),first);
 assert.throws(()=>buildEventPlanPrompt(input,first.system.length+first.prompt.length-1),{code:"summary_input_budget"});
 assert.deepEqual(buildPlannedFactPrompt(plan,input,second.system.length+second.prompt.length),second);
 assert.throws(()=>buildPlannedFactPrompt(plan,input,second.system.length+second.prompt.length-1),{code:"summary_plan_input_budget"});
});
test("obsolete ID selection cannot strip scoped planned evidence",()=>{
 const {input,plan}=sample(),{response}=extracted(plan,input);
 assert.throws(()=>validateAndRenderFacts(response,input,{selected_fact_ids:["f2"]}),{code:"summary_plan_selection"});
});
test("unverified retirement excludes all event facts from derived memories and configuration",()=>{
 const {input,plan}=sample(),{response}=extracted(plan,input);
 response.facts[1].memory_type="event";response.facts[1].config={key:"归档任务",value:"校验通过"};
 const before=JSON.stringify(response),result=validateAndRenderFacts(response,input);
 assert.deepEqual(result.smart_memories,[]);assert.deepEqual(result.configs,[]);
 assert.deepEqual(result.validation.plan_non_derivable_fact_ids,["f1","f2","f3"]);
 assert.equal(JSON.stringify(response),before);
});
test("planning prose never becomes published evidence or persistent metadata; scope offsets are auditable",()=>{
 const {input,plan}=sample();plan.events[0].topic="UNSUPPORTED_CAUSAL_EXPLANATION";
 const {response,prompt}=extracted(plan,input),result=validateAndRenderFacts(response,input);
 assert.ok(!prompt.prompt.includes("UNSUPPORTED_CAUSAL_EXPLANATION"));
 assert.ok(!JSON.stringify(result).includes("UNSUPPORTED_CAUSAL_EXPLANATION"));
 assert.ok(!JSON.stringify(response).includes("UNSUPPORTED_CAUSAL_EXPLANATION"));
 assert.deepEqual(result.validation.planned_event_columns,["source_id","event_id"]);
 assert.deepEqual(result.validation.plan_evidence_columns,["source_id","event_id","unit","start","end","facet","kind"]);
 assert.deepEqual(result.validation.plan_evidence[0],["s0","archive",1,input.sources[0].units[1].start,input.sources[0].units[1].end,"cause","correction"]);
});
test("literal date/config scope safeguards still apply after plan validation",()=>{
 const {input,plan}=sample(),{response}=extracted(plan,input);
 response.facts[0].config={key:"令牌",value:"过期"};response.facts[0].memory_type="event";
 const result=validateAndRenderFacts(response,input);
 assert.deepEqual(result.smart_memories,[]);assert.deepEqual(result.configs,[]);
 response.facts[2].subject_dates=["2099-01-01"];
 assert.throws(()=>validateAndRenderFacts(response,input),{code:"summary_fact_scope"});
});
function mixed(){
 const input=textInput("**Assistant:** 旧判断：可无限回填；每天十条上限保持。后来确认：只处理当日队列。未选说明也不能写入。");
 const plan={protocol:PROTOCOL,target_date:input.target_date,events:[{id:"queue",source_id:"s0",topic:"最终队列范围和有效上限",
  evidence:[ref(input,0,"constraint","report","每天十条上限保持。"),ref(input,0,"outcome","correction","后来确认：只处理当日队列。")],
  retired_evidence:[removed(input,0,"旧判断：可无限回填；")]}]};
 return {input,plan};
}
test("a mixed paragraph can retire an old claim and retain disjoint current constraints and outcome",()=>{
 const {input,plan}=mixed(),{response,prompt}=extracted(plan,input);
 assert.ok(!prompt.prompt.includes("可无限回填"));assert.ok(!prompt.prompt.includes("未选说明"));
 const result=validateAndRenderFacts(response,input);
 assert.match(result.episode_summary,/每天十条上限保持/);assert.match(result.episode_summary,/只处理当日队列/);
 assert.doesNotMatch(result.episode_summary,/可无限回填|未选说明/);
 assert.equal(result.validation.plan_retired[0][2],0);
 assert.equal(result.validation.plan_evidence.every(row=>row[2]===0),true);
});
for(const [quote,code]of [
 ["旧判断：可无限回填；","summary_plan_retired_fact"],
 ["未选说明也不能写入。","summary_plan_quote_scope"],
 ["旧判断：可无限回填；每天十条上限保持。","summary_plan_retired_fact"],
 ["每天十条上限保持。后来确认：只处理当日队列。","summary_plan_quote_scope"]
])test("same-paragraph extraction cannot escape its declared scope: "+quote,()=>{
 const {input,plan}=mixed(),{response}=extracted(plan,input);response.facts[0].quote=quote;
 assert.throws(()=>validateAndRenderFacts(response,input),{code});
});
test("each disjoint scope must be covered even if source/event/unit/facet/kind are identical",()=>{
 const input=textInput("**Assistant:** 甲任务成功。乙任务成功。"),plan=planResponse(input);
 plan.events[0].evidence=[ref(input,0,"outcome","report","甲任务成功。"),ref(input,0,"outcome","report","乙任务成功。")];
 const {response}=extracted(plan,input);validateAndRenderFacts(response,input);
 response.facts.pop();
 assert.throws(()=>validateAndRenderFacts(response,input),{code:"summary_plan_fact_coverage"});
});
test("literal scope binding rejects ambiguous occurrences and malformed unicode",()=>{
 const input=textInput("**Assistant:** 成功。成功。"),plan=planResponse(input);
 plan.events[0].evidence[0].quote="成功。";
 assert.throws(()=>validateEventPlan(plan,input),{code:"summary_plan_quote_ambiguous"});
 plan.events[0].evidence[0].quote="\ud800";
 assert.throws(()=>validateEventPlan(plan,input),{code:"summary_plan_quote"});
});
test("shorter complete literal judgments may stay inside a wider allowed scope, but scopes are never semantic proof",()=>{
 const {input,plan}=sample(),{response}=extracted(plan,input);
 response.facts[1].quote="归档任务更新令牌后成功";
 const result=validateAndRenderFacts(response,input);
 assert.equal(result.validation.event_plan_coverage_complete,true);assert.equal(result.validation.model_event_plan_verified,false);
});

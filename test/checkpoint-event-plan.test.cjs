"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {PROTOCOL,EVENT_PLAN,buildFactInput,buildEventPlanPrompt,buildPlannedFactPrompt,validateAndRenderFacts}=require("../lib/checkpoint/ordinary-summary-facts");
const {validateEventPlan}=require("../lib/checkpoint/ordinary-event-plan");
const {textInput,planResponse,plannedFactResponse}=require("./checkpoint-fact-fixture.cjs");
const copy=value=>JSON.parse(JSON.stringify(value));
function sample(){
 const input=textInput("**Assistant:** 归档任务先前失败，暂疑网络。\n\n最终确认：令牌过期。\n\n归档任务更新令牌后成功，校验通过。\n\n每批上限保持2GB。");
 const plan={protocol:PROTOCOL,target_date:input.target_date,events:[{id:"archive",source_id:"s0",topic:"归档最终结果、原因及限制",
  evidence:[{unit:1,facet:"cause",kind:"correction"},{unit:2,facet:"outcome"},{unit:3,facet:"constraint"}],retired_units:[0]}]};
 return {input,plan};
}
function extracted(plan,input){
 const prompt=buildPlannedFactPrompt(plan,input,45000),wire=JSON.parse(prompt.prompt);
 const response=plannedFactResponse(wire);
 Object.defineProperty(response,EVENT_PLAN,{value:plan});
 return {response,prompt,wire};
}
test("planning sees complete source once while quoting sees only planned originals with stable indices",()=>{
 const {input,plan}=sample(),first=buildEventPlanPrompt(input,45000),firstWire=JSON.parse(first.prompt);
 assert.equal(firstWire.stage,"plan");
 assert.equal(firstWire.fact_contract,undefined);
 assert.deepEqual(firstWire.sources[0].units.map(u=>u.text),input.sources[0].units.map(u=>u.text));
 const {response,wire}=extracted(plan,input);
 assert.equal(wire.stage,"extract");
 assert.deepEqual(wire.sources[0].units.map(u=>u.index),[1,2,3]);
 assert.ok(!JSON.stringify(wire.sources).includes("暂疑网络"));
 const body=validateAndRenderFacts(response,input);
 assert.match(body.episode_summary,/令牌过期/);
 assert.doesNotMatch(body.episode_summary,/暂疑网络/);
 assert.equal(body.validation.event_plan_coverage_complete,true);
 assert.equal(body.validation.model_event_plan_verified,false);
 assert.deepEqual(body.validation.plan_retired,[["s0","archive",0]]);
 assert.equal(body.validation.input_units.length,4);
});
for(const [name,change,code]of [
 ["legacy protocol",p=>p.protocol="checkpoint-source-facts-v7","summary_plan_structure"],
 ["extra quote",p=>p.events[0].quote="invented","summary_plan_structure"],
 ["empty evidence",p=>p.events[0].evidence=[],"summary_plan_structure"],
 ["unknown unit",p=>p.events[0].evidence[0].unit=999,"summary_plan_evidence"],
 ["context is not a final-state role",p=>p.events[0].evidence[0].facet="context","summary_plan_evidence"],
 ["wrong taxonomy",p=>p.events[0].evidence[0].facet="correction","summary_plan_evidence"],
 ["invalid kind",p=>p.events[0].evidence[0].kind="cause","summary_plan_evidence"],
 ["duplicate evidence",p=>p.events[0].evidence.push(copy(p.events[0].evidence[0])),"summary_plan_evidence"],
 ["duplicate event",p=>p.events.push(copy(p.events[0])),"summary_plan_structure"],
 ["live retired",p=>p.events[0].retired_units=[1],"summary_plan_retired"],
 ["future retired",p=>p.events[0].retired_units=[3],"summary_plan_retired"],
 ["invalid retired",p=>p.events[0].retired_units=["0"],"summary_plan_retired"],
 ["duplicate retired",p=>p.events[0].retired_units=[0,0],"summary_plan_retired"]
]){
 test("invalid plan stops before quoting: "+name,()=>{
  const {input,plan}=sample();change(plan);const before=JSON.stringify(plan);
  assert.throws(()=>buildPlannedFactPrompt(plan,input,45000),{code});
  assert.equal(JSON.stringify(plan),before);
 });
}
test("legacy input is refused before planning rather than converted to v8",()=>{
 const {input}=sample();input.protocol="checkpoint-source-facts-v7";
 assert.throws(()=>buildEventPlanPrompt(input,45000),{code:"summary_input_protocol"});
});
test("planning cannot borrow a unit from another source or omit a source",()=>{
 const input=buildFactInput([{text:"**Assistant:** 甲已完成。",source:"conversation"},{text:"**Assistant:** 乙待确认。",source:"conversation"}],"2026-10-20");
 const plan=planResponse(input);
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
test("control references and retired headings are rejected before they can become quote context",()=>{
 const input=textInput("**Assistant:** HEARTBEAT_OK\n\n最终完成。"),plan=planResponse(input);
 plan.events[0].evidence[0].unit=0;
 assert.throws(()=>validateEventPlan(plan,input),{code:"summary_plan_evidence"});
 const headed=textInput("**Assistant:** **旧推测：网络原因**\n\n最终完成。"),headedPlan=planResponse(headed);
 headedPlan.events[0].evidence=[{unit:1,facet:"outcome"}];headedPlan.events[0].retired_units=[0];
 assert.throws(()=>validateEventPlan(headedPlan,headed),{code:"summary_plan_retired_context"});
});
test("necessary original headings are transmitted as context without authorizing new facts",()=>{
 const input=textInput("**Assistant:** **03:00 归档任务**\n\n重跑成功。"),plan=planResponse(input);
 plan.events[0].evidence=[{unit:1,facet:"outcome"}];
 const {response,wire}=extracted(plan,input);
 assert.deepEqual(wire.sources[0].units.map(u=>u.index),[0,1]);
 assert.match(validateAndRenderFacts(response,input).episode_summary,/03:00 归档任务/);
 response.facts.push({unit:0,quote:input.sources[0].units[0].text,event_id:"fixture",facet:"outcome"});
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
 test("planned extraction remains fail closed: "+name,()=>{
  const {input,plan}=sample(),{response}=extracted(plan,input);change(response);
  assert.throws(()=>validateAndRenderFacts(response,input),{code});
 });
}
test("a plan cannot retire another event's live unit, even across event records",()=>{
 const {input,plan}=sample();
 plan.events.push({id:"other",source_id:"s0",topic:"另一事项",evidence:[{unit:0,facet:"outcome"}]});
 assert.throws(()=>validateEventPlan(plan,input),{code:"summary_plan_retired"});
});
test("planning and extraction budgets count their complete instructions and metadata without truncation",()=>{
 const {input,plan}=sample(),first=buildEventPlanPrompt(input,45000),second=buildPlannedFactPrompt(plan,input,45000);
 assert.deepEqual(buildEventPlanPrompt(input,first.system.length+first.prompt.length),first);
 assert.throws(()=>buildEventPlanPrompt(input,first.system.length+first.prompt.length-1),{code:"summary_input_budget"});
 assert.deepEqual(buildPlannedFactPrompt(plan,input,second.system.length+second.prompt.length),second);
 assert.throws(()=>buildPlannedFactPrompt(plan,input,second.system.length+second.prompt.length-1),{code:"summary_plan_input_budget"});
});
test("planned evidence cannot be stripped later through the obsolete ID-selection annotation",()=>{
 const {input,plan}=sample(),{response}=extracted(plan,input);
 assert.throws(()=>validateAndRenderFacts(response,input,{selected_fact_ids:["f2"]}),{code:"summary_plan_selection"});
});
test("unverified plan retirement cannot authorize derived memory or configuration through default report kinds",()=>{
 const {input,plan}=sample(),{response}=extracted(plan,input);
 response.facts[1].memory_type="event";
 response.facts[1].config={key:"归档任务",value:"校验通过"};
 const before=JSON.stringify(response),result=validateAndRenderFacts(response,input);
 assert.deepEqual(result.smart_memories,[]);assert.deepEqual(result.configs,[]);
 assert.deepEqual(result.validation.plan_non_derivable_fact_ids,["f1","f2","f3"]);
 assert.equal(JSON.stringify(response),before);
});
test("free-form planning topics never become published evidence or persistent metadata",()=>{
 const {input,plan}=sample();plan.events[0].topic="UNSUPPORTED_CAUSAL_EXPLANATION";
 const {response}=extracted(plan,input),result=validateAndRenderFacts(response,input);
 assert.ok(!JSON.stringify(result).includes("UNSUPPORTED_CAUSAL_EXPLANATION"));
 assert.ok(!JSON.stringify(response).includes("UNSUPPORTED_CAUSAL_EXPLANATION"));
 assert.deepEqual(result.validation.planned_event_columns,["source_id","event_id"]);
});
test("planned quotations retain literal scope checks for dates and derived configuration",()=>{
 const {input,plan}=sample(),{response}=extracted(plan,input);
 response.facts[0].config={key:"令牌",value:"过期"};
 response.facts[0].memory_type="event";
 const result=validateAndRenderFacts(response,input);
 assert.deepEqual(result.smart_memories,[]);assert.deepEqual(result.configs,[]);
 response.facts[2].subject_dates=["2099-01-01"];
 assert.throws(()=>validateAndRenderFacts(response,input),{code:"summary_fact_scope"});
});

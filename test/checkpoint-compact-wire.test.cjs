"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {PROTOCOL,decodeEventPlan}=require("../lib/checkpoint/ordinary-event-plan");
const {buildEventPlanPrompt,buildCandidateSelectionPrompt,completeCandidateSelection,validateAndRenderFacts}=require("../lib/checkpoint/ordinary-summary-facts");
const {textInput}=require("./checkpoint-fact-fixture.cjs");
function sample(){
 const input=textInput("**Assistant:** 旧判断：网络异常。\n\n最终确认：令牌过期。\n\n任务成功。\n\n仍限每日两批。");
 const wire={protocol:PROTOCOL,target_date:input.target_date,events:[["s0",[
  [1,"最终确认：令牌过期。","cause","correction"],[2,"任务成功。"],[3,"仍限每日两批。","constraint"]]]]};
 return {input,wire};
}
const copy=x=>JSON.parse(JSON.stringify(x));
test("compact plan decodes defaults and nondefault labels without changing source text",()=>{
 const {input,wire}=sample(),before=JSON.stringify(wire),plan=decodeEventPlan(wire,input);
 assert.equal(JSON.stringify(wire),before);assert.equal(plan.events[0].id,"e1");
 assert.deepEqual(plan.events[0].evidence,[
  {unit:1,quote:"最终确认：令牌过期。",facet:"cause",kind:"correction"},
  {unit:2,quote:"任务成功。",facet:"outcome",kind:"report"},
  {unit:3,quote:"仍限每日两批。",facet:"constraint",kind:"report"}]);
 const response=completeCandidateSelection(plan,{selected_candidate_ids:["c1","c2","c3"],omissions:[]},input);
 const result=validateAndRenderFacts(response,input);
 assert.match(result.episode_summary,/令牌过期/);assert.deepEqual(result.smart_memories,[]);assert.deepEqual(result.configs,[]);
});
test("plan prompt documents the exact tuple contract and contains a valid JSON example",()=>{
 const {input}=sample(),p=buildEventPlanPrompt(input,45000),wire=JSON.parse(p.prompt);
 const match=p.system.match(/只返回 (\{.*?\})。events/);assert.ok(match);
 assert.ok(Array.isArray(JSON.parse(match[1]).events[0]));
 assert.deepEqual(wire.plan_contract.event_columns,["source_id","evidence_rows"]);
 assert.deepEqual(wire.plan_contract.evidence_columns,["unit","quote","facet","kind"]);
 assert.deepEqual(wire.plan_contract.defaults,{facet:"outcome",kind:"report"});
});
for(const[name,change,code]of [
 ["old protocol",w=>w.protocol="checkpoint-source-facts-v12","summary_plan_structure"],
 ["canonical objects on provider boundary",w=>w.events=[{id:"e1",source_id:"s0",evidence:[]}],"summary_plan_structure"],
 ["extra event column",w=>w.events[0].push("e1"),"summary_plan_structure"],
 ["missing event column",w=>w.events[0].pop(),"summary_plan_structure"],
 ["object reference",w=>w.events[0][1][0]={unit:1,quote:"最终确认：令牌过期。"},"summary_plan_evidence"],
 ["short reference",w=>w.events[0][1][0]=[1],"summary_plan_evidence"],
 ["long reference",w=>w.events[0][1][0].push("extra"),"summary_plan_evidence"],
 ["wrong facet",w=>w.events[0][1][0][2]="correction","summary_plan_evidence"],
 ["null optional facet",w=>w.events[0][1][1].push(null),"summary_plan_evidence"],
 ["null optional kind",w=>w.events[0][1][0][3]=null,"summary_plan_evidence"],
 ["unknown unit",w=>w.events[0][1][0][0]=999,"summary_plan_evidence"],
 ["rewritten quote",w=>w.events[0][1][0][1]="最终确认：没有故障。","summary_plan_quote"],
 ["duplicate source scope",w=>w.events[0][1].push(copy(w.events[0][1][0])),"summary_plan_evidence_overlap"],
 ["empty reference group",w=>w.events[0][1]=[],"summary_plan_structure"],
])test("compact model plan rejects "+name,()=>{
 const {input,wire}=sample();change(wire);
 assert.throws(()=>decodeEventPlan(wire,input),{code});
});
test("compact plan retains same-source checks and refuses partial table cells",()=>{
 const input=textInput("**Assistant:** | 项目 | p50 | max |\n|---|---|---|\n| embedding | 333 | 3139 |");
 const wire={protocol:PROTOCOL,target_date:input.target_date,events:[["s0",[[0,"333"]]]]};
 assert.throws(()=>decodeEventPlan(wire,input),{code:"summary_plan_table_row_scope"});
 wire.events[0][1][0][1]="| embedding | 333 | 3139 |";
 assert.doesNotThrow(()=>decodeEventPlan(wire,input));
 wire.events[0][0]="s1";
 assert.throws(()=>decodeEventPlan(wire,input),{code:"summary_plan_structure"});
});
test("compact decode enforces the total reference cap before source binding",()=>{
 const {input,wire}=sample();
 wire.events[0][1]=Array.from({length:513},()=>[2,"任务成功。"]);
 assert.throws(()=>decodeEventPlan(wire,input),{code:"summary_plan_evidence"});
});
test("candidate column rows reconstruct every field including exact context and costs",()=>{
 const {input,wire}=sample(),plan=decodeEventPlan(wire,input),p=buildCandidateSelectionPrompt(plan,input,45000),packet=JSON.parse(p.prompt);
 assert.equal(packet.candidates,undefined);
 assert.deepEqual(packet.candidate_columns,["id","unit","source_id","role","origin","event_id","facet","kind","quote","context","cost","group_key","group_cost"]);
 assert.ok(packet.candidate_rows.every(row=>row.length===packet.candidate_columns.length));
 const rows=packet.candidate_rows.map(row=>Object.fromEntries(packet.candidate_columns.map((key,i)=>[key,row[i]])));
 const quote=packet.candidate_columns.indexOf("quote");
 assert.deepEqual(packet.candidate_rows.map(row=>row[quote]),rows.map(row=>row.quote));
 assert.equal(rows[0].kind,"correction");assert.equal(rows[0].facet,"cause");
 let n=packet.summary_budget.header_chars,group=null;
 for(const c of rows){n+=c.cost;if(group!==c.group_key)n+=c.group_cost;group=c.group_key;}
 const rendered=validateAndRenderFacts(completeCandidateSelection(plan,{selected_candidate_ids:rows.map(c=>c.id),omissions:[]},input),input);
 assert.equal(n,rendered.episode_summary.length);
 assert.doesNotThrow(()=>buildCandidateSelectionPrompt(plan,input,p.system.length+p.prompt.length));
 assert.throws(()=>buildCandidateSelectionPrompt(plan,input,p.system.length+p.prompt.length-1),{code:"summary_plan_input_budget"});
});

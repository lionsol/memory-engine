"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {PROTOCOL,buildFactInput,buildFactPrompt,validateAndRenderFacts}=require("../lib/checkpoint/ordinary-summary-facts");
const {textInput,selectedResponse:reply}=require("./checkpoint-fact-fixture.cjs");
test("selected facts produce a concise body while complete input ranges remain independently auditable",()=>{
  const input=textInput("**Assistant:** "+Array.from({length:196},(_,i)=>"背景"+i+"："+"背景材料。".repeat(10)).concat("最终结果：修复已验证。").join("\n\n"));
  const result=validateAndRenderFacts(reply(input,[196]),input);
  assert.match(result.episode_summary,/最终结果：修复已验证/);
  assert.ok(!result.episode_summary.includes("背景材料"));
  assert.ok(result.episode_summary.length<3000);
  assert.equal(result.validation.input_units.length,197);
  assert.equal(result.validation.evidence.length,1);
  assert.equal(result.validation.selected_unit_count,1);
  assert.deepEqual(result.validation.summary_fact_ids,["f1"]);
  assert.equal(result.validation.unit_coverage_complete,false);
  assert.equal(result.validation.source_coverage_complete,true);
  assert.equal(result.validation.semantic_quality,"not_independently_verified");
  assert.deepEqual(result.validation.evidence[0].slice(2,4),
    [input.sources[0].units[196].start,input.sources[0].units[196].end]);
  assert.ok(!JSON.stringify(result.validation).includes("背景材料"));
});
test("source coverage cannot hide a missing short health record",()=>{
  const input=buildFactInput([
    {text:"**Assistant:** 较长记录。\n\n其他背景。",source:"conversation"},
    {text:"**Assistant:** 01:00 健康检查正常。",source:"conversation"},
    {text:"**Assistant:** 02:00 健康检查正常。",source:"conversation"},
    {text:"**Assistant:** 03:00 健康检查正常。",source:"conversation"}
  ],"2026-10-20");
  assert.throws(()=>validateAndRenderFacts(reply(input,[0,2,3]),input),{code:"summary_source_coverage"});
  const result=validateAndRenderFacts(reply(input,[0,2,3,4]),input);
  for(const time of ["01:00","02:00","03:00"])assert.ok(result.episode_summary.includes(time));
});
test("request-only selection cannot conceal assistant results present in the input",()=>{
  const input=textInput("**User:** 检查 03:00。\n\n**Assistant:** 03:00 三项全部正常。");
  assert.throws(()=>validateAndRenderFacts(reply(input,[0]),input),{code:"summary_source_coverage"});
});
test("explicit user decisions can represent their source without unrelated assistant material",()=>{
  const input=textInput("**Assistant:** 其他任务正常。\n\n**User:** 决定停止本次部署。");
  const result=validateAndRenderFacts(reply(input,[{unit:1,kind:"decision"}]),input);
  assert.match(result.episode_summary,/决定停止本次部署/);
  assert.ok(!result.episode_summary.includes("其他任务正常"));
});
test("model correction history preserves both quotations and blocks both endpoints from derived writes",()=>{
  const input=textInput("**Assistant:** mode = old。\n\n**Assistant:** mode = new，旧设置作废。");
  const result=validateAndRenderFacts(reply(input,[
    {unit:0,memory_type:"preference",config:{key:"mode",value:"old"}},
    {unit:1,kind:"correction",supersedes:["f1"],memory_type:"preference",config:{key:"mode",value:"new"}}
  ]),input);
  assert.ok(result.episode_summary.includes("mode = old"));
  assert.match(result.episode_summary,/mode = new/);
  assert.match(result.episode_summary,/纠正关联为模型标注/);
  assert.deepEqual(result.validation.evidence.map(e=>e[0]),["f1","f2"]);
  assert.deepEqual(result.validation.evidence[1][4],["f1"]);
  assert.equal(result.smart_memories.length,0);
  assert.equal(result.configs.length,0);
  assert.deepEqual(result.validation.derived_excluded_fact_ids,["f1","f2"]);
});
test("correction chains retain every quotation instead of trusting transitive suppression",()=>{
  const input=textInput("**Assistant:** 旧计划。\n\n第二计划。\n\n最终计划。");
  const result=validateAndRenderFacts(reply(input,[0,{unit:1,kind:"correction",supersedes:["f1"]},
    {unit:2,kind:"correction",supersedes:["f2"]}]),input);
  assert.match(result.episode_summary,/最终计划/);
  assert.ok(result.episode_summary.includes("旧计划"));
  assert.ok(result.episode_summary.includes("第二计划"));
  assert.equal(result.validation.evidence.length,3);
});
test("a standalone final correction is quoted without inventing an earlier fact or derived writes",()=>{
  const input=textInput("**Assistant:** mode = new，旧设置作废。");
  const result=validateAndRenderFacts(reply(input,[{unit:0,kind:"correction",
    memory_type:"preference",config:{key:"mode",value:"new"}}]),input);
  assert.match(result.episode_summary,/mode = new，旧设置作废/);
  assert.ok(!result.episode_summary.includes("前述记录引用"));
  assert.deepEqual(result.validation.evidence[0][4],[]);
  assert.deepEqual(result.validation.derived_excluded_fact_ids,["f1"]);
  assert.deepEqual(result.smart_memories,[]);assert.deepEqual(result.configs,[]);
  assert.equal(result.validation.semantic_quality,"not_independently_verified");
});
test("standalone corrections cannot conceal omitted independent health sources",()=>{
  const input=buildFactInput([
    {text:"**Assistant:** 调度提议已撤回。\n\n先前的版本判断有误。\n\nmtime 不能证明启用时间。",source:"conversation"},
    {text:"**Assistant:** 03:00 三项检查正常。",source:"conversation"},
    {text:"**Assistant:** 02:00 三项检查正常。",source:"conversation"},
    {text:"**Assistant:** 01:00 三项检查正常。",source:"conversation"}
  ],"2026-10-20");
  const rejected=reply(input,[{unit:0,kind:"correction"},{unit:1,kind:"correction"},
    {unit:2,kind:"correction"},3]);
  const before=JSON.stringify(rejected);
  assert.throws(()=>validateAndRenderFacts(rejected,input),{code:"summary_source_coverage"});
  assert.equal(JSON.stringify(rejected),before);
  const complete=validateAndRenderFacts(reply(input,[...rejected.facts,4,5]),input);
  assert.equal(complete.validation.source_coverage_complete,true);
  assert.deepEqual(complete.validation.derived_excluded_fact_ids,["f1","f2","f3"]);
});
test("optional correction links still reject unknown, forward and cross-source references",()=>{
  const input=buildFactInput([
    {text:"**Assistant:** 来源 A 的结果。",source:"conversation"},
    {text:"**Assistant:** 来源 B 的最终纠正。",source:"conversation"}
  ],"2026-10-20");
  for(const facts of [
    [0,{unit:1,kind:"correction",supersedes:["missing"]}],
    [{unit:0,kind:"correction",supersedes:["f2"]},1],
    [0,{unit:1,kind:"correction",supersedes:["f1"]}]
  ])assert.throws(()=>validateAndRenderFacts(reply(input,facts),input),{code:"summary_supersedes"});
});
test("control markers are handled locally without renumbering real source units",()=>{
  const input=buildFactInput([{text:"**Assistant:** 正常。\n\nHEARTBEAT_OK\n\n另一次正常。",source:"conversation"},
    {text:"[OpenClaw heartbeat poll]",source:"conversation"}],"2026-10-20");
  const wire=JSON.parse(buildFactPrompt(input,45000).prompt);
  assert.deepEqual(wire.sources[0].units.map(u=>u.index),[0,2]);
  assert.equal(wire.sources[1].units.length,0);
  const result=validateAndRenderFacts(reply(input,[0,2]),input);
  assert.deepEqual(result.validation.excluded_control_unit_ids,["s0.t0.p1","s1.t0.p0"]);
  assert.equal(result.validation.input_units.length,4);
  assert.equal(result.validation.content_unit_count,2);
  assert.equal(result.validation.unit_coverage_complete,true);
  assert.throws(()=>validateAndRenderFacts(reply(input,[1]),input),{code:"summary_noise"});
});
for(const field of ["summary","skipped","coverage"])test("old bookkeeping fields are rejected rather than normalized: "+field,()=>{
  const input=textInput("**Assistant:** 正常。"),r=reply(input,[0]);
  r[field]=field==="summary"?["f1"]:[];
  assert.throws(()=>validateAndRenderFacts(r,input),{code:"summary_structure"});
});
test("full-copy output remains invalid under the 5000-character bound",()=>{
  const input=textInput("**Assistant:** "+Array.from({length:197},(_,i)=>"记录"+i+"："+"原文。".repeat(12)).join("\n\n"));
  assert.throws(()=>validateAndRenderFacts(reply(input,Array.from({length:197},(_,i)=>i)),input),
    {code:"summary_budget"});
});
test("source quotations still cannot certify omitted assertions or unmarked corrections",()=>{
  const input=textInput("**Assistant:** 任务 A 成功。任务 B 失败。");
  const result=validateAndRenderFacts(reply(input,[{unit:0,quote:"任务 A 成功。"}]),input);
  assert.ok(!result.episode_summary.includes("任务 B"));
  assert.equal(result.validation.semantic_quality,"not_independently_verified");
});
test("the simplified output contract has a distinct protocol version",()=>{
  assert.equal(PROTOCOL,"checkpoint-source-facts-v8");
});

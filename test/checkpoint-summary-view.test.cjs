"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {PROTOCOL,buildFactInput,validateAndRenderFacts}=require("../lib/checkpoint/ordinary-summary-facts");
const {factResponse,textInput}=require("./checkpoint-fact-fixture.cjs");
const reply=(input,summary,decorate)=>({...factResponse(input,decorate),summary});
test("197 reviewed paragraphs can produce a concise body with all evidence locators retained",()=>{
  const input=textInput("**Assistant:** "+Array.from({length:196},(_,i)=>"背景"+i+"："+ "背景材料。".repeat(10)).concat("最终结果：修复已验证。").join("\n\n"));
  const result=validateAndRenderFacts(reply(input,["f197"]),input);
  assert.match(result.episode_summary,/最终结果：修复已验证/);
  assert.ok(!result.episode_summary.includes("背景材料"));
  assert.ok(result.episode_summary.length<3000);
  assert.equal(result.validation.fact_count,197);
  assert.equal(result.validation.evidence.length,197);
  assert.deepEqual(result.validation.summary_fact_ids,["f197"]);
  assert.equal(result.validation.unit_coverage_complete,true);
  assert.equal(result.validation.summary_unit_coverage_complete,false);
  assert.equal(result.validation.semantic_quality,"not_independently_verified");
  const row=result.validation.evidence[0];
  assert.equal(row[0],"f1");
  assert.equal(row[1],"s0");
  assert.deepEqual(row.slice(2,4),[input.sources[0].units[0].start,input.sources[0].units[0].end]);
  assert.ok(!JSON.stringify(result.validation).includes("背景材料"));
});
for(const summary of [undefined,[],null,"f1",["missing"],["f1","f1"],[0]])test("invalid summary selection fails closed: "+JSON.stringify(summary),()=>{
  const input=textInput("**Assistant:** 结果正常。"),r=reply(input,summary);
  if(summary===undefined)delete r.summary;
  assert.throws(()=>validateAndRenderFacts(r,input),{code:"summary_selection"});
});
test("source coverage in evidence cannot hide a missing short source in the body",()=>{
  const input=buildFactInput([
    {text:"**Assistant:** 较长记录。\n\n其他背景。",source:"conversation"},
    {text:"**Assistant:** 01:00 健康检查正常。",source:"conversation"},
    {text:"**Assistant:** 02:00 健康检查正常。",source:"conversation"},
    {text:"**Assistant:** 03:00 健康检查正常。",source:"conversation"}
  ],"2026-10-20");
  assert.throws(()=>validateAndRenderFacts(reply(input,["f1","f3","f4"]),input),
    {code:"summary_source_coverage"});
  const result=validateAndRenderFacts(reply(input,["f1","f3","f4","f5"]),input);
  assert.match(result.episode_summary,/01:00/);assert.match(result.episode_summary,/02:00/);
  assert.match(result.episode_summary,/03:00/);
});
test("a source with assistant results cannot be represented only by its request",()=>{
  const input=textInput("**User:** 检查 03:00。\n\n**Assistant:** 03:00 三项全部正常。");
  assert.throws(()=>validateAndRenderFacts(reply(input,["f1"]),input),{code:"summary_source_coverage"});
});
test("current correction replaces the body and derived writes while preserving old evidence",()=>{
  const input=textInput("**Assistant:** mode = old。\n\n**Assistant:** mode = new，旧设置作废。");
  const r=reply(input,["f2"],(u,i)=>({kind:i?"correction":"report",supersedes:i?["f1"]:[],
    memory_type:"preference",config:{key:"mode",value:i?"new":"old"}}));
  const result=validateAndRenderFacts(r,input);
  assert.ok(!result.episode_summary.includes("mode = old"));
  assert.match(result.episode_summary,/mode = new/);
  assert.match(result.episode_summary,/纠正关联为模型标注/);
  assert.deepEqual(result.validation.evidence.map(e=>e[0]),["f1","f2"]);
  assert.deepEqual(result.validation.evidence[1][4],["f1"]);
  assert.equal(result.smart_memories.length,1);
  assert.equal(result.configs.length,1);
  assert.equal(result.configs[0].value,"new");
});
test("selecting a superseded claim is rejected, even alongside the latest correction",()=>{
  const input=textInput("**Assistant:** 计划 04:10。\n\n**Assistant:** 04:10 作废。");
  const r=reply(input,["f1","f2"],(u,i)=>i?{kind:"correction",supersedes:["f1"]}:{});
  assert.throws(()=>validateAndRenderFacts(r,input),{code:"summary_superseded"});
});
test("the latest explicit correction must be visible rather than left only in metadata",()=>{
  const input=textInput("**Assistant:** 计划 04:10。\n\n**Assistant:** 04:10 作废。\n\n其他工作正常。");
  const r=reply(input,["f3"],(u,i)=>i===1?{kind:"correction",supersedes:["f1"]}:{});
  assert.throws(()=>validateAndRenderFacts(r,input),{code:"summary_correction_missing"});
});
test("correction chains need only the final leaf in the body",()=>{
  const input=textInput("**Assistant:** 旧计划。\n\n第二计划。\n\n最终计划。");
  const r=reply(input,["f3"],(u,i)=>i?{kind:"correction",supersedes:["f"+i]}:{});
  assert.match(validateAndRenderFacts(r,input).episode_summary,/最终计划/);
});
test("an explicit correction cannot omit its correction link",()=>{
  const input=textInput("**Assistant:** 旧状态。\n\n新状态。");
  const r=reply(input,["f2"],(u,i)=>i?{kind:"correction"}:{});
  assert.throws(()=>validateAndRenderFacts(r,input),{code:"summary_correction_link"});
});
test("the summary body has a hard size bound instead of truncating evidence",()=>{
  const input=textInput("**Assistant:** "+"A".repeat(3100));
  assert.throws(()=>validateAndRenderFacts(reply(input,["f1"]),input),{code:"summary_budget"});
});
test("full-copy output from the v2 failure is rejected by the summary bound",()=>{
  const input=textInput("**Assistant:** "+Array.from({length:197},(_,i)=>"记录"+i+"："+"原文。".repeat(12)).join("\n\n"));
  const r=reply(input,Array.from({length:197},(_,i)=>"f"+(i+1)));
  assert.throws(()=>validateAndRenderFacts(r,input),{code:"summary_budget"});
});
test("a source containing only allowed control noise need not appear in the body",()=>{
  const input=buildFactInput([{text:"**Assistant:** 正常。",source:"conversation"},
    {text:"HEARTBEAT_OK",source:"conversation"}],"2026-10-20");
  const r=reply(input,["f1"]);r.facts.pop();
  r.skipped=[{unit_id:input.sources[1].units[0].id,disposition:"noise"}];
  assert.match(validateAndRenderFacts(r,input).episode_summary,/正常/);
});
test("an explicit user decision can represent its source without copying an unrelated assistant report",()=>{
  const input=textInput("**Assistant:** 其他任务正常。\n\n**User:** 决定停止本次部署。");
  const r=reply(input,["f2"],(u,i)=>i?{kind:"decision"}:{});
  const result=validateAndRenderFacts(r,input);
  assert.match(result.episode_summary,/决定停止本次部署/);
  assert.ok(!result.episode_summary.includes("其他任务正常"));
});
test("wire protocol version declares the two-output contract",()=>{
  assert.equal(PROTOCOL,"checkpoint-source-facts-v3");
});

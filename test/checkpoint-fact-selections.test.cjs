"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { PROTOCOL, buildFactInput, buildFactPrompt, validateAndRenderFacts } = require("../lib/checkpoint/ordinary-summary-facts");
const inputFor = text => buildFactInput([{text, source:"conversation"}], "2026-10-20");
const response = (input, facts) => ({protocol:PROTOCOL,target_date:input.target_date,facts,
  summary:facts.map((f,i)=>f?.id || "f"+(i+1)),skipped:[]});
test("numeric selections extract all paragraphs locally without echoing source text",()=>{
  const input=inputFor("**User:** 检查结果。\n\n**Assistant:** 10-18/19 恢复。10-15/16 仍无对话，原因未确认。");
  const reply=response(input,[0,1]), result=validateAndRenderFacts(reply,input);
  assert.match(result.episode_summary,/10-18\/19 恢复。10-15\/16 仍无对话，原因未确认。/);
  assert.equal(result.validation.unit_count,2);
  assert.equal(result.validation.semantic_quality,"not_independently_verified");
  assert.ok(!JSON.stringify(reply).includes("原因未确认"));
});
test("prompt enumerates exact contiguous parts without duplicating original text",()=>{
  const original="**Assistant:** 第一项正常。第二项未确认。\r\n第三项失败。";
  const input=inputFor(original), wire=JSON.parse(buildFactPrompt(input,45000).prompt);
  const unit=wire.sources[0].units[0];
  assert.equal(unit.index,0);
  assert.deepEqual(unit.parts,["第一项正常。","第二项未确认。\r\n","第三项失败。"]);
  assert.equal(unit.parts.join(""),input.sources[0].units[0].text);
  assert.equal(unit.text,undefined);
  const result=validateAndRenderFacts(response(input,[{unit:0,span:[1,2]}]),input);
  const quote=unit.parts.slice(1,3).join("");
  const start=original.indexOf(quote);
  assert.ok(result.episode_summary.includes(quote.replace(/\r?\n/g,"\n  > ")));
  assert.match(result.episode_summary,new RegExp("原文范围 "+start+":"+(start+quote.length)));
});
test("indexed repeated passages resolve to the chosen original occurrence",()=>{
  const input=inputFor("**Assistant:** 正常。正常。");
  const result=validateAndRenderFacts(response(input,[{unit:0,span:[1,1]}]),input);
  assert.match(result.episode_summary,/原文范围 18:21/);
});
for(const facts of [[-1],[1],[0.5],["0"],[null],[true],[[0]],
  [{unit:0,span:[]}],[{unit:0,span:[0]}],[{unit:0,span:[1,0]}],
  [{unit:0,span:[0,3]}],[{unit:0,span:[0,0.5]}],
  [{unit:0,span:["0",0]}],[{unit:0,span:null}],
  [{unit:0,quote:"伪造因果"}],[{unit:0,source_ref:"s0.t0.p0"}]]) {
  test("invalid or textual selection is rejected: "+JSON.stringify(facts),()=>{
    const input=inputFor("**Assistant:** 已恢复。原因未确认。");
    assert.throws(()=>validateAndRenderFacts(response(input,facts),input));
  });
}
test("short sources remain mandatory under compact selections",()=>{
  const input=buildFactInput([
    {text:"**Assistant:** 较长记录。\n\n仍需核验。",source:"conversation"},
    {text:"**Assistant:** 01:00 健康检查全部通过。",source:"conversation"},
    {text:"**Assistant:** 02:00 健康检查全部通过。",source:"conversation"},
    {text:"**Assistant:** 03:00 健康检查全部通过。",source:"conversation"}],"2026-10-20");
  assert.throws(()=>validateAndRenderFacts(response(input,[0,1,2,3]),input),{code:"summary_coverage"});
  assert.match(validateAndRenderFacts(response(input,[0,1,2,3,4]),input).episode_summary,/03:00/);
});
test("derived memories use selected original spans and reject metadata outside that span",()=>{
  const input=inputFor("**Assistant:** theme = solarized。旧设置为 dark。");
  const fact={unit:0,span:[0,0],memory_type:"preference",config:{key:"theme",value:"solarized"}};
  const result=validateAndRenderFacts(response(input,[fact]),input);
  assert.match(result.smart_memories[0].text,/theme = solarized/);
  assert.ok(!result.smart_memories[0].text.includes("dark"));
  fact.config.value="dark";
  assert.throws(()=>validateAndRenderFacts(response(input,[fact]),input),{code:"summary_config"});
});
test("older responses cannot be silently reused against a v3 request",()=>{
  const input=inputFor("记录。");
  assert.equal(PROTOCOL,"checkpoint-source-facts-v3");
  assert.throws(()=>validateAndRenderFacts({...response(input,[0]),protocol:"checkpoint-source-facts-v1"},input),
    {code:"summary_structure"});
});
test("197 whole-unit selections remain compact even when source paragraphs are long",()=>{
  const input=inputFor(Array.from({length:197},(_,i)=>"记录"+i+"："+"来源内容。".repeat(15)).join("\n\n"));
  const reply=response(input,Array.from({length:197},(_,i)=>i));
  assert.ok(JSON.stringify(reply).length<3000);
  assert.throws(()=>validateAndRenderFacts(reply,input),{code:"summary_budget"});
});
test("selecting one sentence still does not establish complete paragraph semantics",()=>{
  const input=inputFor("**Assistant:** 任务 A 成功。任务 B 失败。");
  const result=validateAndRenderFacts(response(input,[{unit:0,span:[0,0]}]),input);
  assert.equal(result.validation.semantic_quality,"not_independently_verified");
  assert.ok(!result.episode_summary.includes("任务 B"));
});

"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { PROTOCOL, buildFactInput, buildFactPrompt, validateAndRenderFacts } = require("../lib/checkpoint/ordinary-summary-facts");
const inputFor = text => buildFactInput([{text,source:"conversation"}], "2026-10-20");
const reply = (input,facts) => ({protocol:PROTOCOL,target_date:input.target_date,facts});

test("model correction links cannot hide unrelated source claims or produce derived writes",()=>{
  const input=inputFor("**Assistant:** 采集顺序已修复。\n\n新条目身份已有修复路径。\n\nmtime 不能证明部署时间。");
  const result=validateAndRenderFacts(reply(input,[
    {unit:0,memory_type:"event"},
    {unit:1,memory_type:"event"},
    {unit:2,kind:"correction",supersedes:["f1","f2"],memory_type:"event"}
  ]),input);
  for(const text of ["采集顺序已修复","新条目身份已有修复路径","mtime 不能证明部署时间"])assert.ok(result.episode_summary.includes(text));
  assert.deepEqual(result.validation.summary_fact_ids,["f1","f2","f3"]);
  assert.deepEqual(result.smart_memories,[]);
  assert.equal(result.validation.model_correction_links_verified,false);
  assert.deepEqual(result.validation.derived_excluded_fact_ids,["f1","f2","f3"]);
});

test("result paragraphs retain the nearest standalone heading within their own turn",()=>{
  const text="**Assistant:** 健康检查通过（03:00）：\n\n- LLM：OK\n- Embedding：OK\n- Vision：OK\n\n**User:** 另一个问题。\n\n**Assistant:** 已完成。";
  const input=inputFor(text),wire=JSON.parse(buildFactPrompt(input,45000).prompt);
  const result=validateAndRenderFacts(reply(input,[1,3]),input);
  assert.match(result.episode_summary,/健康检查通过（03:00）：/);
  assert.equal((result.episode_summary.match(/健康检查通过/g)||[]).length,1);
  assert.deepEqual(wire.sources[0].units[1].context,[0]);
  assert.equal(wire.sources[0].units[3].context,undefined);
  const contexts=result.validation.context_evidence;
  assert.deepEqual(contexts,[["f1","s0",input.sources[0].units[0].start,input.sources[0].units[0].end]]);
  for(const [,source,start,end] of contexts){assert.equal(source,"s0");assert.equal(text.slice(start,end),"健康检查通过（03:00）：");}
});

test("spans cannot detach result lines from an in-paragraph heading, including CRLF",()=>{
  const text="**Assistant:** 健康检查通过（03:00）：\r\n- LLM：OK\r\n- Vision：OK";
  const input=inputFor(text);
  const result=validateAndRenderFacts(reply(input,[{unit:0,span:[1,2],memory_type:"event"}]),input);
  assert.match(result.episode_summary,/健康检查通过（03:00）：/);
  assert.match(result.smart_memories[0].text,/03:00/);
  const row=result.validation.context_evidence[0];
  assert.equal(text.slice(row[2],row[3]),"健康检查通过（03:00）：");
  assert.match(result.episode_summary,/- LLM：OK/);
});

test("context and escaping are included in the visible full-unit render cost",()=>{
  const input=inputFor("**Assistant:** 03:00 检查：\n\n<result>&OK\r\n第二行");
  const wire=JSON.parse(buildFactPrompt(input,45000).prompt);
  const result=validateAndRenderFacts(reply(input,[1]),input);
  assert.ok(wire.sources[0].units[1].cost>input.sources[0].units[1].text.length);
  assert.ok(result.episode_summary.length<=wire.summary_budget.header_chars+wire.sources[0].units[1].cost);
  assert.equal(wire.summary_budget.max_chars,3000);
  assert.match(result.episode_summary,/&lt;result&gt;&amp;OK/);
});

test("required context counts toward the unchanged body budget and is never truncated",()=>{
  const input=inputFor("**Assistant:** "+"标题".repeat(1500)+"：\n\n结果正常。");
  assert.throws(()=>validateAndRenderFacts(reply(input,[1]),input),
    e=>e.code==="summary_budget"&&e.observedSummaryChars>3000);
});

// Captured d2cb4c9 provider selections; text below is synthetic/de-identified, not the private source.
// This freezes the 44 whole-paragraph selections and mistaken f8/f10 targets without claiming model quality.
const capturedFacts=[
  {unit:1,kind:"report"},{unit:3,kind:"report"},{unit:4,kind:"report"},{unit:5,kind:"report"},
  {unit:16,kind:"report"},{unit:22,kind:"report"},{unit:26,kind:"report"},{unit:32,kind:"report"},
  {unit:35,kind:"report"},{unit:42,kind:"correction",supersedes:["f8","f9"]},
  {unit:43,kind:"correction",supersedes:["f7"]},{unit:47,kind:"decision"},
  {unit:49,kind:"correction",supersedes:["f8"]},{unit:50,kind:"correction",supersedes:["f9"]},
  {unit:51,kind:"correction",supersedes:["f10"]},{unit:60,kind:"decision"},{unit:61,kind:"decision"},
  ...[67,68].map(unit=>({unit,kind:"report"})),{unit:71,kind:"decision"},{unit:76,kind:"decision"},
  ...[102,104,105,109,113,117,121,127,130,134,142,150,153,156,159,176,178,179,182,186,189,192,195].map(unit=>({unit,kind:"report"}))
];
test("captured over-selection still fails closed instead of silently dropping facts",()=>{
  assert.equal(capturedFacts.length,44);
  assert.equal(capturedFacts.filter(f=>f.span).length,0);
  const counts=[187,4,3,3];
  const input=buildFactInput(counts.map((n,source)=>({source:"conversation",
    text:"**Assistant:** "+Array.from({length:n},(_,i)=>"来源"+source+"段"+i+"："+ "实际结果及限制。".repeat(20)).join("\n\n")})),"2026-10-20");
  assert.throws(()=>validateAndRenderFacts(reply(input,capturedFacts),input),
    e=>e.code==="summary_budget"&&e.observedSummaryChars>3000);
});

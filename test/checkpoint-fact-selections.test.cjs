"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {PROTOCOL,buildFactInput,buildFactPrompt,validateAndRenderFacts}=require("../lib/checkpoint/ordinary-summary-facts");
const inputFor=text=>buildFactInput([{text,source:"conversation"}],"2026-10-20");
const response=(input,facts)=>({protocol:PROTOCOL,target_date:input.target_date,facts});

test("literal excerpts are located exactly without model-computed fragment or character offsets",()=>{
  const original="**Assistant:** 第一项正常。第二项未确认。\r\n第三项失败。";
  const input=inputFor(original),wire=JSON.parse(buildFactPrompt(input,45000).prompt);
  assert.equal(wire.sources[0].units[0].text,input.sources[0].units[0].text);
  assert.equal(wire.sources[0].units[0].parts,undefined);
  const quote="第二项未确认。\r\n第三项失败。";
  const result=validateAndRenderFacts(response(input,[{unit:0,quote}]),input);
  const start=original.indexOf(quote);
  assert.doesNotMatch(result.episode_summary,/原文范围 \d+:\d+/);
  for(const line of quote.split(/\r?\n/))assert.ok(result.episode_summary.includes(line));
  assert.deepEqual(result.validation.evidence[0].slice(2,4),[start,start+quote.length]);
  assert.ok(!result.episode_summary.includes("第一项正常"));
});

test("ambiguous repeated excerpts are rejected rather than guessed or silently expanded",()=>{
  const input=inputFor("**Assistant:** 正常。正常。");
  assert.throws(()=>validateAndRenderFacts(response(input,[{unit:0,quote:"正常。"}]),input),
    {code:"summary_quote_ambiguous"});
  const whole=validateAndRenderFacts(response(input,[{unit:0,quote:"正常。正常。"}]),input);
  assert.equal(whole.validation.evidence[0][2],input.sources[0].units[0].start);
});

for(const facts of [[0],[-1],[null],[true],["0"],[[0]],
  [{unit:999,quote:"结果。"}],[{unit:0.5,quote:"结果。"}],[{unit:"0",quote:"结果。"}],
  [{unit:0}],[{unit:0,quote:""}],[{unit:0,quote:"  "}],[{unit:0,quote:12}],
  [{unit:0,quote:"伪造原因。"}],[{unit:0,quote:"结 果"}],
  [{unit:0,quote:"结果正常。",span:[0,1]}],
  [{unit:0,quote:"结果正常。",source_ref:"s0.t0.p0"}],
  [{unit:0,quote:String.fromCharCode(0xd800)}]]) {
  test("invalid quote or legacy range is rejected: "+JSON.stringify(facts),()=>{
    const input=inputFor("**Assistant:** 结果正常。");
    assert.throws(()=>validateAndRenderFacts(response(input,facts),input));
  });
}

test("whitespace and punctuation are not normalized to force a match",()=>{
  const input=inputFor("**Assistant:** 检查：失败。\r\n原因未确认。");
  for(const quote of ["检查:失败。","检查：成功。","检查：失败。\n原因未确认。"]){
    assert.throws(()=>validateAndRenderFacts(response(input,[{unit:0,quote}]),input),{code:"summary_quote"});
  }
});

test("an excerpt cannot cross source paragraphs or borrow evidence from a different source",()=>{
  const input=buildFactInput([
    {text:"**Assistant:** A 成功。\n\nB 失败。",source:"conversation"},
    {text:"**Assistant:** C 正常。",source:"conversation"}],"2026-10-20");
  for(const quote of ["A 成功。\n\nB 失败。","C 正常。"]){
    assert.throws(()=>validateAndRenderFacts(response(input,[{unit:0,quote}]),input),{code:"summary_quote"});
  }
});

test("derived memories and metadata stay within the selected literal evidence",()=>{
  const input=inputFor("**Assistant:** theme = solarized。旧设置为 dark。");
  const fact={unit:0,quote:"theme = solarized。",memory_type:"preference",config:{key:"theme",value:"solarized"}};
  const result=validateAndRenderFacts(response(input,[fact]),input);
  assert.match(result.smart_memories[0].text,/theme = solarized/);
  assert.ok(!result.smart_memories[0].text.includes("dark"));
  fact.config.value="dark";
  assert.throws(()=>validateAndRenderFacts(response(input,[fact]),input),{code:"summary_config"});
});

test("v1-v5 output cannot be repaired or reused against a literal-quote v6 request",()=>{
  const input=inputFor("记录。");
  assert.equal(PROTOCOL,"checkpoint-source-facts-v6");
  for(const version of [1,2,3,4,5]){
    assert.throws(()=>validateAndRenderFacts({...response(input,[{unit:0,quote:"记录。"}]),
      protocol:"checkpoint-source-facts-v"+version},input),{code:"summary_structure"});
  }
  assert.throws(()=>validateAndRenderFacts(response(input,[{unit:0,span:[0,1]}]),input),{code:"summary_fact_structure"});
});

test("the 5000-character body boundary accepts exact fits and rejects overflow without truncation",()=>{
  const sample=inputFor("**Assistant:** 文");
  assert.equal(JSON.parse(buildFactPrompt(sample,45000).prompt).summary_budget.max_chars,5000);
  const overhead=validateAndRenderFacts(response(sample,[{unit:0,quote:"文"}]),sample).episode_summary.length-1;
  const fits=inputFor("**Assistant:** "+"文".repeat(5000-overhead));
  const result=validateAndRenderFacts(response(fits,[{unit:0,quote:fits.sources[0].units[0].text}]),fits);
  assert.equal(result.episode_summary.length,5000);
  assert.equal(result.validation.semantic_quality,"not_independently_verified");
  const overflow=inputFor("**Assistant:** "+"文".repeat(5001-overhead));
  const selection=response(overflow,[{unit:0,quote:overflow.sources[0].units[0].text}]);
  const before=JSON.stringify(selection);
  assert.throws(()=>validateAndRenderFacts(selection,overflow),
    e=>e.code==="summary_budget"&&e.observedSummaryChars===5001&&e.maxSummaryChars===5000);
  assert.equal(JSON.stringify(selection),before);
});

test("exact excerpts still cannot certify omitted assertions or unmarked corrections",()=>{
  const input=inputFor("**Assistant:** 任务 A 成功。任务 B 失败。");
  const result=validateAndRenderFacts(response(input,[{unit:0,quote:"任务 A 成功。"}]),input);
  assert.equal(result.validation.semantic_quality,"not_independently_verified");
  assert.ok(!result.episode_summary.includes("任务 B"));
});

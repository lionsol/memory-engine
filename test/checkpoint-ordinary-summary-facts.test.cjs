"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { buildFactInput, buildFactPrompt, validateAndRenderFacts } = require("../lib/checkpoint/ordinary-summary-facts");
const { factResponse, textInput } = require("./checkpoint-fact-fixture.cjs");
const DATE = "2026-10-20";
// Synthetic de-identified fixture based on the recorded four-entry distinctions; not a model replay.
function recordedInput() {
  const texts = [
    "**User:** 检查今天凌晨任务。\n\n**Assistant:** 02:00 Nightly Maintenance 正常（dry-run）；04:00 Daily Stats 正常。\n\n10-18/19 的 episode 重跑恢复。\n\n10-15/16 重跑仍为 0 条对话，原因未确认。\n\n对 10-19 的报告认为采集在 reconciliation 之前；不是等待某个更晚时刻。\n\nentryId 与 identity 的早期判断已纠正；04:10 提议作废。",
    "**User:** 检查 03:00。\n\n**Assistant:** 03:00 健康检查正常，LLM、Embedding、Vision 全部通过。",
    "**User:** 检查 02:00。\n\n**Assistant:** 02:00 健康检查正常，LLM、Embedding、Vision 全部通过。",
    "**User:** 检查 01:00。\n\n**Assistant:** 01:00 健康检查正常，LLM、Embedding、Vision 全部通过。",
  ];
  return buildFactInput(texts.map((text, i) => ({ text, source: "conversation",
    category: "raw_log", entry_id: "record-" + i })), DATE);
}
test("four-entry evidence preserves health checks, dry-run, different historical dates and corrections", () => {
  const input = recordedInput(), result = validateAndRenderFacts(factResponse(input), input);
  for (const expected of ["01:00", "02:00", "03:00", "04:00", "dry-run", "10-18/19",
    "10-15/16", "原因未确认", "identity", "04:10 提议作废"]) assert.ok(result.episode_summary.includes(expected));
  assert.equal(result.validation.source_count, 4);
  assert.equal(result.validation.semantic_quality, "not_independently_verified");
  assert.match(result.episode_summary, /助手报告（未独立核验）/);
});
test("missing any short health entry is rejected despite the full long entry", () => {
  for (const index of [1, 2, 3]) {
    const input = recordedInput(), reply = factResponse(input);
    const ids = new Set(input.sources[index].units.map(u => u.index));
    reply.facts = reply.facts.filter(f => !ids.has(f.unit));
    assert.throws(() => validateAndRenderFacts(reply, input), { code: "summary_source_coverage" });
  }
});
test("partial selection retains a complete input audit without claiming paragraph completeness", () => {
  const input=recordedInput(),reply=factResponse(input);
  reply.facts=reply.facts.filter(f=>f.unit!==input.sources[0].units[3].index);
  const result=validateAndRenderFacts(reply,input);
  assert.equal(result.validation.unit_coverage_complete,false);
  assert.equal(result.validation.input_units.length,input.sources.flatMap(s=>s.units).length);
  assert.equal(result.validation.semantic_quality,"not_independently_verified");
});
test("the observed four-day causal merge cannot be invented as an evidence quote", () => {
  const input = recordedInput(), reply = factResponse(input);
  reply.facts[0].quote = "10-15/16/18/19 均因采集时序竞态生成占位。";
  assert.throws(() => validateAndRenderFacts(reply, input), { code: "summary_quote" });
});
test("explicit source causal assertions remain attributed quotations, not independently verified causes", () => {
  const input = textInput("**Assistant:** 初步认为 10-19 因采集顺序生成占位，尚待验证。");
  const reply = factResponse(input);
  reply.facts[0].causal_evidence = "因采集顺序生成占位";
  const result = validateAndRenderFacts(reply, input);
  assert.match(result.episode_summary, /初步认为.*尚待验证/);
  assert.equal(result.validation.semantic_quality, "not_independently_verified");
  reply.facts[0].causal_evidence = "四天都是同一原因";
  assert.throws(() => validateAndRenderFacts(reply, input), { code: "summary_causal_evidence" });
});
for (const [name, change, code] of [
  ["unknown reference", r => { r.facts[0].unit = 999; }, "summary_fact_structure"],
  ["scope expansion", r => { r.facts[0].subject_dates = ["10-15"]; }, "summary_fact_scope"],
  ["invented event time", r => { r.facts[0].event_time = "04:10"; }, "summary_fact_scope"],
  ["false noise", r => { r.facts=[]; }, "summary_structure"],
  ["extra narrative", r => { r.episode_summary = "invented"; }, "summary_structure"],
  ["duplicate fact IDs", r => { r.facts[0].id="same"; r.facts.push({...r.facts[0]}); }, "summary_fact_structure"],
  ["unknown skipped unit", r => { r.skipped=[{unit_id:"missing",disposition:"noise"}]; }, "summary_structure"],
  ["overlapping skip", r => { r.skipped=[{unit_id:"s0.t0.p0",disposition:"noise"}]; }, "summary_structure"],
  ["invented config", r => { r.facts[0].config={key:"missing",value:"fake"}; }, "summary_config"],
  ["invented category", r => { r.facts[0].memory_type="unknown"; }, "summary_memory_type"],
]) test(name, () => {
  const input = textInput("**Assistant:** 10-19 重跑恢复。"), reply = factResponse(input);
  change(reply);
  assert.throws(() => validateAndRenderFacts(reply, input), {code});
});
test("substantive results cannot be represented only by user requests", () => {
  const input=textInput("**User:** 什么结果？\n\n**Assistant:** 任务失败。");
  const reply=factResponse(input);reply.facts.pop();
  assert.throws(()=>validateAndRenderFacts(reply,input),{code:"summary_source_coverage"});
});
test("identical paragraphs stay auditable while only exact control markers are excluded", () => {
  const input=textInput("**User:** 再检查。\n\n再检查。\n\n**Assistant:** HEARTBEAT_OK");
  const result=validateAndRenderFacts(factResponse(input),input);
  assert.equal(result.validation.input_units.length,3);
  assert.equal(result.validation.content_unit_count,2);
  assert.equal(result.validation.evidence.length,2);
});
test("later corrections keep the earlier assertion and cannot refer forward or across sources", () => {
  const input = textInput("**Assistant:** 需要修复。\n\n**User:** 已修复并验证。");
  const reply = factResponse(input);
  reply.facts[1].kind="correction"; reply.facts[1].supersedes=["f1"];
  const result=validateAndRenderFacts(reply,input), text=result.episode_summary;
  assert.ok(text.includes("需要修复"));
  assert.match(text,/已修复并验证/);
  assert.deepEqual(result.validation.evidence.map(row=>row[0]),["f1","f2"]);
  assert.match(text,/保留双方引文/);
  reply.facts[0].supersedes=["f2"];
  assert.throws(()=>validateAndRenderFacts(reply,input),{code:"summary_supersedes"});
});
test("derived memories/configs share source quotations; unknown role stays unknown", () => {
  const input=textInput("theme = solarized");
  const reply=factResponse(input,()=>({memory_type:"preference",config:{key:"theme",value:"solarized"}}));
  const result=validateAndRenderFacts(reply,input);
  assert.equal(result.smart_memories.length,1); assert.equal(result.configs.length,1);
  assert.match(result.smart_memories[0].text,/角色未明/);
  assert.match(result.configs[0].context,/theme = solarized/);
});
test("source entry identity and private collector metadata are retained without changing log shape", () => {
  const logs=[{text:"**User:** 今天的记录",source:"conversation",chunk_id:null}];
  Object.defineProperty(logs,"segmentedInput",{value:{entries:[{...logs[0],entryId:"stable-entry",
    provenance:"session_flush",timestampMs:123}]}});
  const source=buildFactInput(logs,DATE).sources[0];
  assert.equal(source.entry_id,"stable-entry"); assert.equal(source.provenance,"session_flush");
  assert.equal(source.collected_timestamp_ms,123); assert.match(source.source_hash,/^[a-f0-9]{64}$/);
});
test("CRLF paragraph and role ranges point into original text; HTML stays quoted", () => {
  const text="**User:** 问题\r\n\r\n**Assistant:** <script>bad()</script>\r\n\r\n另一个结果";
  const input=textInput(text), units=input.sources[0].units;
  for(const unit of units) assert.equal(text.slice(unit.start,unit.end),unit.text);
  const rendered=validateAndRenderFacts(factResponse(input),input).episode_summary;
  assert.match(rendered,/&lt;script&gt;/); assert.doesNotMatch(rendered,/<script>/);
});
test("prompt has a distinct JSON data message and rejects oversized requests without truncation", () => {
  const input=recordedInput(), prompt=buildFactPrompt(input,45000);
  const wire=JSON.parse(prompt.prompt);
  assert.equal(wire.protocol,input.protocol);
  assert.deepEqual(wire.sources.map(s=>s.source_hash),input.sources.map(s=>s.source_hash));
  assert.deepEqual(wire.sources.flatMap(s=>s.units.map(u=>u.text)),
    input.sources.flatMap(s=>s.units.map(u=>u.text)));
  assert.ok(!prompt.system.includes("{chunks_text}"));
  assert.ok(!prompt.system.includes("不超过 300"));
  assert.throws(()=>buildFactPrompt(input,prompt.system.length+prompt.prompt.length-1),
    {code:"summary_input_budget"});
});
test("malformed Unicode cannot silently remove a source from coverage", () => {
  assert.throws(() => buildFactInput([{text:"valid",source:"conversation"},
    {text:String.fromCharCode(0xd800),source:"conversation"}], DATE), {code:"summary_input_unicode"});
});
test("short acknowledgements and status replies are not automatically noise", () => {
  for(const answer of ["OK","收到","谢谢","你好"]){
    const input=textInput("**User:** 请确认检查结果。\n\n**Assistant:** "+answer);
    const wire=JSON.parse(buildFactPrompt(input,45000).prompt);
    assert.equal(wire.sources[0].units[1].text,answer);
    const result=validateAndRenderFacts(factResponse(input),input);
    assert.ok(result.episode_summary.includes(answer));
    assert.equal(result.validation.excluded_control_unit_ids.length,0);
  }
});
test("mechanical coverage does not certify all assertions within a paragraph", () => {
  const input=textInput("**Assistant:** 任务 A 成功。任务 B 失败。"), reply=factResponse(input);
  reply.facts[0].quote="任务 A 成功。";
  assert.equal(validateAndRenderFacts(reply,input).validation.semantic_quality,
    "not_independently_verified");
});

test("source-bound quotes derive coverage without a second model-declared manifest",()=>{
  const input=recordedInput(), reply=factResponse(input);
  assert.ok(reply.facts.every(f=>Object.keys(f).length===2));
  assert.equal(validateAndRenderFacts(reply,input).validation.unit_coverage_complete,true);
  reply.coverage=input.sources.flatMap(s=>s.units.map(u=>u.id));
  assert.throws(()=>validateAndRenderFacts(reply,input),{code:"summary_structure"});
});
test("identical results in separate turns remain distinct source facts",()=>{
  const input=textInput("**Assistant:** 任务正常。\n\n**User:** 再检查。\n\n**Assistant:** 任务正常。");
  const result=validateAndRenderFacts(factResponse(input),input);
  assert.equal(result.validation.fact_count,3);
  assert.equal((result.episode_summary.match(/任务正常/g)||[]).length,2);
});

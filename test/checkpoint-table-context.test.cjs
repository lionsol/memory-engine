"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {PROTOCOL,EVENT_PLAN,buildFactInput,buildCandidateSelectionPrompt,validateAndRenderFacts}=require("../lib/checkpoint/ordinary-summary-facts");
const {textInput,selectedResponse,planResponse}=require("./checkpoint-fact-fixture.cjs");
const {selectPlanFacts}=require("../lib/checkpoint/ordinary-event-plan");
const header="| 分段 | n | p50 | max |\n|---|---|---|---|";
const row="| embedding | 15 | 333 | 3139 |";
function selected(text,quote=row){
 const input=textInput("**Assistant:** "+text);
 const plan=planResponse(input,[{unit:0,quote,event_id:"latency",facet:"outcome"}]);
 const prompt=buildCandidateSelectionPrompt(plan,input,45000),wire=JSON.parse(prompt.prompt),selection={selected_candidate_ids:wire.candidates.map(c=>c.id)};
 const chosen=selectPlanFacts(plan,selection,input),response={protocol:PROTOCOL,target_date:input.target_date,facts:chosen.facts};
 Object.defineProperty(response,EVENT_PLAN,{value:{plan,selection}});
 return {input,plan,prompt,wire,response};
}
test("selected table rows retain literal column names in the quote request and final body",()=>{
 const {input,prompt,wire,response}=selected(header+"\n"+row+"\n| 未选行 | 1 | 99 | 100 |");
 assert.ok(prompt.prompt.includes("p50"));assert.ok(prompt.prompt.includes("max"));
 assert.ok(!prompt.prompt.includes("未选行"));
 const contexts=wire.candidates[0].context;
 assert.deepEqual(contexts.map(c=>[c.kind,c.text]),[["table_header",header]]);
 const result=validateAndRenderFacts(response,input);
 assert.match(result.episode_summary,/表格列名（原文）/);
 for(const line of header.split("\n"))assert.ok(result.episode_summary.includes(line));
 assert.ok(result.episode_summary.includes(row));assert.equal((result.episode_summary.match(/p50/g)||[]).length,1);
 assert.equal(result.validation.context_evidence.length,1);
 const [,source,start,end]=result.validation.context_evidence[0];
 assert.equal(source,"s0");assert.equal(("**Assistant:** "+header+"\n"+row+"\n| 未选行 | 1 | 99 | 100 |").slice(start,end),header);
});
test("CRLF, escaped pipes and code-span pipes keep original context ranges",()=>{
 const text="表格：\r\n| 指标 | p\\|50 | `max|值` |\r\n|---|---|---|\r\n| `emb|等待` | 333 | 3139 |";
 const {input,wire,response}=selected(text,"| `emb|等待` | 333 | 3139 |");
 assert.deepEqual(wire.candidates[0].context.map(c=>c.kind),["heading","table_header"]);
 const result=validateAndRenderFacts(response,input);
 for(const [,source,start,end] of result.validation.context_evidence){
  assert.equal(source,"s0");
  assert.ok(wire.candidates[0].context.some(c=>c.text===("**Assistant:** "+text).slice(start,end)));
 }
 assert.ok(result.episode_summary.includes("p\\|50"));
});
test("full-table quotations do not duplicate their own column header as extra context",()=>{
 const quote=header+"\n"+row,{input,response,wire}=selected(quote,quote);
 assert.deepEqual(wire.candidates[0].context,[]);
 const result=validateAndRenderFacts(response,input);
 assert.equal(result.validation.context_evidence.length,0);
 assert.equal((result.episode_summary.match(/p50/g)||[]).length,1);
});
test("different tables in one paragraph keep only the intersected table's columns",()=>{
 const first="| A | B |\n|---|---|\n| 旧行 | 1 |";
 const second="| 项目 | max |\n|---|---|\n| 新行 | 2 |";
 const {input,wire,response}=selected(first+"\n说明不是表格。\n"+second,"| 新行 | 2 |");
 assert.deepEqual(wire.candidates[0].context.map(c=>c.text),["| 项目 | max |\n|---|---|"]);
 const body=validateAndRenderFacts(response,input).episode_summary;
 assert.doesNotMatch(body,/旧行|\| A \| B/);assert.match(body,/项目.*max/);
});
test("column context never leaks from another source or earlier table paragraph",()=>{
 const input=buildFactInput([{text:"**Assistant:** "+header+"\n"+row,source:"conversation"},
  {text:"**Assistant:** 独立结果正常。",source:"conversation"}],"2026-10-20");
 const result=validateAndRenderFacts(selectedResponse(input,[0,1]),input);
 assert.equal(result.validation.context_evidence.length,0);
});
for(const quote of ["333","| embedding | 15 | 333","embedding | 15 | 333 | 3139"])
 test("planning refuses detached table cells before quotation: "+quote,()=>{
  const input=textInput("**Assistant:** "+header+"\n"+row),plan=planResponse(input,[{unit:0,quote,event_id:"latency",facet:"outcome"}]);
  assert.throws(()=>buildCandidateSelectionPrompt(plan,input,45000),{code:"summary_plan_table_row_scope"});
 });
test("quote stage cannot detach a number from an otherwise valid planned data row",()=>{
 const {input,response}=selected(header+"\n"+row);response.facts[0].quote="333";
 assert.throws(()=>validateAndRenderFacts(response,input),{code:"summary_table_row_scope"});
});
test("whole data rows may omit only surrounding line whitespace",()=>{
 const {input,response}=selected(header+"\n  "+row+"  ",row);
 assert.match(validateAndRenderFacts(response,input).episode_summary,/333/);
});
test("single-column pipe tables retain their column name",()=>{
 const {input,response}=selected("| 状态 |\n|---|\n| 已完成 |","| 已完成 |");
 assert.match(validateAndRenderFacts(response,input).episode_summary,/状态/);
});
test("header context participates in the same hard body budget without truncation",()=>{
 const h="| "+"列名".repeat(2500)+" | max |\n|---|---|";
 const {input,response}=selected(h+"\n| 结果 | 2 |","| 结果 | 2 |");
 assert.throws(()=>validateAndRenderFacts(response,input),e=>e.code==="summary_budget"&&e.observedSummaryChars>5000);
});
test("unrecognized pipe text is not assigned invented columns from another line",()=>{
 const input=textInput("**Assistant:** 说明 A | B\n这行不是分隔线\n结果 C | D");
 const result=validateAndRenderFacts(selectedResponse(input,[{unit:0,quote:"结果 C | D"}]),input);
 assert.equal(result.validation.context_evidence.length,0);
});
test("provider cannot forge program-owned table context on a fact",()=>{
 const {input,response}=selected(header+"\n"+row);response.facts[0].contexts=[{text:"invented"}];
 assert.throws(()=>validateAndRenderFacts(response,input),{code:"summary_fact_structure"});
});

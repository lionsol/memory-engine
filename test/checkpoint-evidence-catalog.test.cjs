"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const f=require("../lib/checkpoint/ordinary-summary-facts");
const {partition,buildCatalog,buildCatalogPreview}=require("../lib/checkpoint/ordinary-evidence-catalog");
const {textInput,planResponse,modelPlanResponse}=require("./checkpoint-fact-fixture.cjs");
const catalog=input=>buildCatalog(input,(u,s,q)=>f.previewLiteralCost(input,u,s,q));
const finish=(input,selected)=>f.validateAndRenderFacts(f.completeFinalEvidence(modelPlanResponse(planResponse(input,
 selected.map(c=>({unit:c.unit,quote:c.quote})))),input),input);
test("mixed paragraph offers old and new scopes separately, while retaining every source character",()=>{
 const input=textInput("**Assistant:** 旧判断：无限回填。每日上限十条。最终确认：只处理当日队列。");
 const pool=catalog(input),u=pool.units[0];
 assert.equal(u.parts.map(r=>r[0]).join(""),input.sources[0].units[0].text);
 const selected=pool.candidates.filter(c=>["每日上限十条。","最终确认：只处理当日队列。"].includes(c.quote));
 assert.equal(selected.length,2);
 const result=finish(input,selected);assert.doesNotMatch(result.episode_summary,/无限回填/);
 assert.match(result.episode_summary,/每日上限十条/);assert.match(result.episode_summary,/只处理当日队列/);
 assert.ok(pool.candidates.some(c=>c.id==="u0"&&c.quote.includes("无限回填")));
 assert.throws(()=>finish(input,[pool.candidates[0],...selected]),{code:"summary_plan_evidence_overlap"});
});
test("long paragraph has a selectable short result and an untruncated whole alternative",()=>{
 const input=textInput("**Assistant:** 最终已完成。"+"A".repeat(10000)),pool=catalog(input);
 assert.equal(pool.candidates[0].quote,input.sources[0].units[0].text);
 const short=pool.candidates.find(c=>c.quote==="最终已完成。");
 assert.ok(finish(input,[short]).episode_summary.length<5000);
 assert.throws(()=>finish(input,[pool.candidates[0]]),{code:"summary_budget"});
});
for(const newline of ["\n","\r\n"])test("escaped/code pipes, complete table rows and column context: "+JSON.stringify(newline),()=>{
 const text=["| 指标 | 数值 |","|---|---|","| a | `x|y` |","| b | x\\|y |"].join(newline);
 const input=textInput("**Assistant:** "+text),pool=catalog(input);
 assert.equal(pool.units[0].parts.map(r=>r[0]).join(""),text);
 const rows=pool.candidates.filter(c=>c.quote==="| a | `x|y` |"||c.quote==="| b | x\\|y |");
 assert.equal(rows.length,2);
 const result=finish(input,[rows[0]]);
 assert.match(result.episode_summary,/指标.*数值/);assert.ok(result.episode_summary.includes(rows[0].quote));
 assert.ok(!pool.candidates.some(c=>c.quote==="数值"||c.quote==="|---|---|"));
});
for(const text of [
 "原因（包含。条件）成立。下一项。",
 "说明“不是。这个原因”。下一项。",
 "数值1.23，网址https://example.test/a。完成。",
 "代码`a。b`不拆。结束。",
 "代码``a`。b``不拆。结束。",
 "未闭合`代码。仍完整。",
 "未闭合（条件。仍完整。",
 "```js\na();\nb();\n```",
 "~~~\n代码。\n~~~",
 "完成。完成。",
 "甲。  \r\n乙！\n丙？"
])test("partition is lossless and every offered quote remains unique: "+text.slice(0,18),()=>{
 const input=textInput("**Assistant:** "+text),unit=input.sources[0].units[0],pool=catalog(input);
 assert.equal(partition(unit).map(p=>p.text).join(""),unit.text);
 for(const c of pool.candidates){
  assert.equal(unit.text.slice(c.start,c.end),c.quote);
  assert.equal(unit.text.indexOf(c.quote),c.start);
  assert.equal(unit.text.indexOf(c.quote,c.start+1),-1);
 }
 if(text.startsWith("未闭合")||text.startsWith("```")||text.startsWith("~~~"))assert.equal(pool.candidates.length,1);
});
test("whole alternatives retain qualifiers but syntax segmentation does not certify semantic completeness",()=>{
 const input=textInput("**Assistant:** 样本15条。只有valid=true才算有效。取消事件0条。不能证明取消生效。"),pool=catalog(input);
 const whole=finish(input,[pool.candidates[0]]);
 assert.match(whole.episode_summary,/只有valid=true/);assert.match(whole.episode_summary,/不能证明/);
 const short=pool.candidates.find(c=>c.quote==="样本15条。");
 // Explicitly record the remaining limitation instead of claiming a semantic guard.
 assert.doesNotMatch(finish(input,[short]).episode_summary,/只有valid=true/);
});
test("preview transmits each unit once, counts its entire input and never accepts a production reply",()=>{
 const input=textInput("**Assistant:** ## 结果\n\n甲完成。乙仍受限。");
 const budget=JSON.parse(f.buildFinalEvidencePrompt(input,45000).prompt).summary_budget;
 const describe=(u,s,q)=>f.previewLiteralCost(input,u,s,q);
 const packet=buildCatalogPreview(input,describe,budget,45000),wire=JSON.parse(packet.prompt);
 assert.equal(wire.protocol,"checkpoint-evidence-catalog-preview-v1");
 for(const row of wire.units)assert.equal(row[5].map(part=>part[0]).join(""),input.sources[0].units[row[0]].text);
 assert.equal(wire.units[1][4],0);
 const size=packet.system.length+packet.prompt.length;
 assert.doesNotThrow(()=>buildCatalogPreview(input,describe,budget,size));
 assert.throws(()=>buildCatalogPreview(input,describe,budget,size-1),{code:"summary_catalog_input_budget"});
 assert.throws(()=>f.completeFinalEvidence({selected_ids:["u1"]},input),{code:"summary_plan_structure"});
});
test("catalog keeps original global indices and excludes only independent control markers",()=>{
 const input=textInput("**Assistant:** HEARTBEAT_OK\n\n业务提到HEARTBEAT_OK。\n\n完成。");
 const pool=catalog(input);
 assert.deepEqual(pool.units.map(u=>u.index),[1,2]);
 assert.ok(pool.candidates.some(c=>c.quote.includes("业务提到HEARTBEAT_OK")));
});
test("catalog refuses excessive fragment counts instead of clipping source evidence",()=>{
 const input=textInput("**Assistant:** "+Array.from({length:2050},(_,i)=>"条"+i+"。").join(""));
 assert.throws(()=>catalog(input),{code:"summary_catalog_count"});
});
test("conservative displayed cost includes headings and bounds actual generated fact IDs",()=>{
 const input=textInput("**Assistant:** ## 结果\n\n甲完成。乙仍受限。"),pool=catalog(input);
 const selected=pool.candidates.filter(c=>c.unit===1&&c.id!=="u1");
 const result=finish(input,selected);
 const header=JSON.parse(f.buildFinalEvidencePrompt(input,45000).prompt).summary_budget.header_chars;
 const upper=header+selected.reduce((n,c)=>n+c.cost,0)+selected[0].group_cost;
 assert.ok(upper>=result.episode_summary.length);
 assert.ok(upper-result.episode_summary.length<=selected.length*3);
 assert.equal(result.validation.model_final_selection_verified,false);
});
